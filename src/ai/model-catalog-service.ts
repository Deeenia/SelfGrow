import { SelfGrowError, type Language } from '../domain';
import type { HTTPTransport, SecretResolver } from '../platform/ports';
import { z } from '../schema/zod';
import type { EndpointSettings } from '../settings';

const MODELS_TIMEOUT_MS = 10_000;
const MODELS_MAX_RESPONSE_BYTES = 262_144;

const modelsResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
      }),
    )
    .min(1),
});

export interface ModelCatalogEntry {
  description: string;
  id: string;
}

export interface ModelCatalogServiceDependencies {
  configuration(): EndpointSettings;
  http: HTTPTransport;
  secretResolver: SecretResolver;
}

/**
 * Loads available model IDs from an OpenAI-compatible `/models` endpoint and
 * decorates the known subset with a compact local profile. Unknown models stay
 * selectable without a description instead of showing generic filler text.
 */
export class ModelCatalogService {
  readonly #dependencies: ModelCatalogServiceDependencies;

  constructor(dependencies: ModelCatalogServiceDependencies) {
    this.#dependencies = dependencies;
  }

  async list(language: Language): Promise<ModelCatalogEntry[]> {
    const configuration = this.#dependencies.configuration();
    const baseURL = configuration.baseURL.trim();
    const secretName = configuration.secretName.trim();
    if (baseURL.length === 0 || secretName.length === 0) {
      throw new SelfGrowError(
        'AI_CONFIGURATION_MISSING',
        language === 'zh-CN'
          ? '请先填写服务地址并保存 SecretStorage 密钥。'
          : 'Fill in the service URL and save a SecretStorage key first.',
      );
    }

    const secret = this.#dependencies.secretResolver.get({ name: secretName });
    if (secret === null || secret.trim().length === 0 || /[\r\n]/.test(secret)) {
      throw new SelfGrowError(
        'SECRET_NOT_FOUND',
        language === 'zh-CN'
          ? '当前 Vault 或设备未找到 API 密钥，请重新保存。'
          : 'The API key was not found in this Vault or device. Save it again.',
      );
    }

    const response = await this.#dependencies.http.request({
      headers: { Authorization: `Bearer ${secret}` },
      maxResponseBytes: MODELS_MAX_RESPONSE_BYTES,
      method: 'GET',
      timeoutMs: MODELS_TIMEOUT_MS,
      url: modelsEndpoint(baseURL),
    });

    if (response.status === 401 || response.status === 403) {
      throw new SelfGrowError(
        'AI_AUTHENTICATION_FAILED',
        language === 'zh-CN'
          ? '模型列表加载失败：API 密钥无效。'
          : 'Model list failed: invalid API key.',
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new SelfGrowError(
        'AI_CONNECTION_TEST_FAILED',
        language === 'zh-CN'
          ? '模型列表加载失败，请检查服务地址。'
          : 'Model list failed. Check the service URL.',
        { status: response.status },
      );
    }

    const parsed = modelsResponseSchema.safeParse(parseJSON(response.body));
    if (!parsed.success) {
      throw new SelfGrowError('AI_PROTOCOL_UNSUPPORTED', 'The model list response is invalid.', {
        issueCount: parsed.error.issues.length,
      });
    }

    const payload: z.infer<typeof modelsResponseSchema> = parsed.data;
    return [...new Set<string>(payload.data.map((item) => item.id))]
      .sort((left, right) => left.localeCompare(right))
      .map((id) => ({ description: modelDescription(id, language), id }));
  }

  /**
   * Loads remote models when a valid key is available, then merges the local
   * provider catalog. Missing or invalid keys fall back to the local catalog so
   * switching providers or keys never blocks model selection.
   */
  async listWithFallback(language: Language): Promise<ModelCatalogEntry[]> {
    const configuration = this.#dependencies.configuration();
    const baseURL = configuration.baseURL.trim();
    const local = baseURL.length === 0 ? [] : knownModelCatalog(baseURL, language);
    if (configuration.secretName.trim().length === 0) return local;

    const secret = this.#dependencies.secretResolver.get({
      name: configuration.secretName,
    });
    if (secret === null || secret.trim().length === 0 || /[\r\n]/.test(secret)) {
      return local;
    }

    try {
      return mergeModelCatalogs(local, await this.list(language));
    } catch (error) {
      if (isModelCatalogFallbackError(error)) return local;
      throw error;
    }
  }
}

export function modelsEndpoint(baseURL: string): string {
  let url: URL;
  try {
    url = new URL(baseURL.trim());
  } catch {
    throw new SelfGrowError('INVALID_URL', 'The chat service URL is invalid.');
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new SelfGrowError('INVALID_URL', 'The chat service URL is invalid.');
  }
  let path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/chat/completions')) {
    path = path.slice(0, -'/chat/completions'.length);
  }
  url.pathname = path.endsWith('/models') ? path : `${path}/models`;
  return url.toString();
}

function parseJSON(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function knownModelCatalog(baseURL: string, language: Language): ModelCatalogEntry[] {
  const family = providerFamily(baseURL);
  const prefixes = PROVIDER_MODEL_PREFIXES[family];
  return Object.keys(MODEL_PROFILES)
    .filter((id) => prefixes.some((prefix) => id.startsWith(prefix)))
    .sort((left, right) => left.localeCompare(right))
    .map((id) => ({ description: modelDescription(id, language), id }));
}

export function isKnownMultimodalModel(id: string): boolean {
  return MODEL_PROFILES[id]?.multimodal === true;
}

type ModelProviderFamily = 'custom' | 'deepseek' | 'kimi' | 'openai' | 'qwen';

const PROVIDER_MODEL_PREFIXES: Readonly<Record<ModelProviderFamily, readonly string[]>> = {
  custom: [],
  deepseek: ['deepseek-'],
  kimi: ['kimi-', 'moonshot-v1-'],
  openai: ['gpt-', 'codex-'],
  qwen: ['qwen-'],
};

function providerFamily(baseURL: string): ModelProviderFamily {
  const hostname = new URL(baseURL.trim()).hostname.toLowerCase();
  if (hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) return 'deepseek';
  if (hostname === 'api.openai.com' || hostname.endsWith('.openai.com')) return 'openai';
  if (hostname === 'dashscope.aliyuncs.com' || hostname.endsWith('.aliyuncs.com')) return 'qwen';
  if (
    hostname === 'api.moonshot.cn' ||
    hostname === 'api.moonshot.ai' ||
    hostname.endsWith('.moonshot.cn') ||
    hostname.endsWith('.moonshot.ai')
  ) {
    return 'kimi';
  }
  return 'custom';
}

function mergeModelCatalogs(
  local: readonly ModelCatalogEntry[],
  remote: readonly ModelCatalogEntry[],
): ModelCatalogEntry[] {
  const byID = new Map<string, ModelCatalogEntry>();
  for (const entry of [...local, ...remote]) {
    const current = byID.get(entry.id);
    if (current === undefined || current.description.length === 0) byID.set(entry.id, entry);
  }
  return [...byID.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function isModelCatalogFallbackError(error: unknown): boolean {
  if (!(error instanceof SelfGrowError)) return false;
  return (
    error.code === 'SECRET_NOT_FOUND' ||
    error.code === 'AI_AUTHENTICATION_FAILED' ||
    error.code === 'AI_CONNECTION_TEST_FAILED' ||
    error.code === 'AI_PROTOCOL_UNSUPPORTED' ||
    error.code === 'NETWORK_UNAVAILABLE'
  );
}

type LocalizedText = { en: string; 'zh-CN': string };

interface ModelProfile {
  context?: string;
  multimodal?: boolean;
  positioning: LocalizedText;
  recommended?: boolean;
}

const MODEL_PROFILES: Readonly<Record<string, ModelProfile>> = {
  'deepseek-chat': {
    positioning: { en: 'general-purpose', 'zh-CN': '通用模型' },
  },
  'deepseek-reasoner': {
    positioning: { en: 'reasoning', 'zh-CN': '推理模型' },
  },
  'deepseek-v4-flash': {
    positioning: { en: 'low-cost fast', 'zh-CN': '高性价比快速' },
    recommended: true,
  },
  'deepseek-v4-flash-vision-exp': {
    multimodal: true,
    positioning: { en: 'experimental vision', 'zh-CN': '视觉实验模型' },
  },
  'gpt-4.1': {
    positioning: { en: 'general-purpose', 'zh-CN': '通用模型' },
  },
  'gpt-4.1-mini': {
    positioning: { en: 'lightweight fast', 'zh-CN': '轻量快速' },
  },
  'gpt-5.1': {
    positioning: { en: 'flagship', 'zh-CN': '旗舰模型' },
    recommended: true,
  },
  'gpt-5.6-sol': {
    positioning: { en: 'coding agent, high usage', 'zh-CN': '编码 Agent，用量较高' },
  },
  'qwen-max': {
    positioning: { en: 'flagship', 'zh-CN': '旗舰模型' },
    recommended: true,
  },
  'qwen-plus': {
    positioning: { en: 'balanced', 'zh-CN': '均衡模型' },
  },
  'qwen-turbo': {
    positioning: { en: 'fast response', 'zh-CN': '快速响应' },
  },
  'kimi-k3': {
    multimodal: true,
    positioning: { en: 'flagship', 'zh-CN': '旗舰模型' },
    recommended: true,
  },
  'kimi-latest': {
    positioning: { en: 'latest pointer', 'zh-CN': '最新动态' },
  },
  'moonshot-v1-8k': {
    context: '8K',
    positioning: { en: 'legacy', 'zh-CN': '早期模型' },
  },
  'moonshot-v1-32k': {
    context: '32K',
    positioning: { en: 'legacy', 'zh-CN': '早期模型' },
  },
  'moonshot-v1-128k': {
    context: '128K',
    positioning: { en: 'legacy', 'zh-CN': '早期模型' },
  },
  'kimi-k2': {
    positioning: { en: 'general-purpose', 'zh-CN': '通用模型' },
  },
  'kimi-k2-turbo-preview': {
    positioning: { en: 'fast preview', 'zh-CN': '快速预览' },
  },
  'kimi-k2-thinking': {
    positioning: { en: 'thinking', 'zh-CN': '思考模型' },
  },
};

function modelDescription(id: string, language: Language): string {
  const profile = MODEL_PROFILES[id];
  if (profile === undefined) return '';
  const parts: string[] = [];
  if (profile.multimodal === true) {
    parts.push(language === 'zh-CN' ? '多模态' : 'multimodal');
  }
  if (profile.context !== undefined) {
    parts.push(language === 'zh-CN' ? `${profile.context} 上下文` : `${profile.context} context`);
  }
  parts.push(profile.positioning[language]);
  if (profile.recommended === true) {
    parts.push(language === 'zh-CN' ? '推荐' : 'recommended');
  }
  return parts.join(' · ');
}
