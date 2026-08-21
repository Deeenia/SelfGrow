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
 * decorates them with a small local description catalog. Unlisted models stay
 * selectable with a neutral description so the provider list never blocks use.
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
          ? '������д�����ַ������ SecretStorage ��Կ��'
          : 'Fill in the service URL and save a SecretStorage key first.',
      );
    }

    const secret = this.#dependencies.secretResolver.get({ name: secretName });
    if (secret === null || secret.trim().length === 0 || /[\r\n]/.test(secret)) {
      throw new SelfGrowError(
        'SECRET_NOT_FOUND',
        language === 'zh-CN'
          ? '��ǰ Vault ���豸δ�ҵ� API ��Կ�������±��档'
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
        language === 'zh-CN' ? 'ģ���б�����ʧ�ܣ�API ��Կ��Ч��' : 'Model list failed: invalid API key.',
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new SelfGrowError(
        'AI_CONNECTION_TEST_FAILED',
        language === 'zh-CN'
          ? 'ģ���б�����ʧ�ܣ���������ַ��'
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

const MODEL_DESCRIPTIONS: Readonly<Record<string, { en: string; 'zh-CN': string }>> = {
  'deepseek-chat': {
    en: 'DeepSeek general chat model.',
    'zh-CN': 'DeepSeek ͨ�öԻ�ģ�͡�',
  },
  'deepseek-reasoner': {
    en: 'DeepSeek reasoning model.',
    'zh-CN': 'DeepSeek ����ģ�͡�',
  },
  'deepseek-v4-flash': {
    en: 'DeepSeek low-cost flash model; good for Raw recognition.',
    'zh-CN': 'DeepSeek ���Լ۱ȿ���ģ�ͣ��ʺ� Raw ʶ��',
  },
  'gpt-4.1': {
    en: 'OpenAI general-purpose model.',
    'zh-CN': 'OpenAI ͨ��ģ�͡�',
  },
  'gpt-4.1-mini': {
    en: 'OpenAI lightweight fast model.',
    'zh-CN': 'OpenAI ��������ģ�͡�',
  },
  'gpt-5.1': {
    en: 'OpenAI flagship-class model.',
    'zh-CN': 'OpenAI �콢��ģ�͡�',
  },
  'gpt-5.6-sol': {
    en: 'OpenAI coding-agent model; high token usage.',
    'zh-CN': 'OpenAI ���� Agent ģ�ͣ������ϸߡ�',
  },
  'qwen-max': {
    en: 'Qwen flagship model with strong Chinese performance.',
    'zh-CN': 'ͨ��ǧ���콢ģ�ͣ�����������ǿ��',
  },
  'qwen-plus': {
    en: 'Qwen balanced model.',
    'zh-CN': 'ͨ��ǧ�ʾ����ģ�͡�',
  },
  'qwen-turbo': {
    en: 'Qwen fast low-latency model.',
    'zh-CN': 'ͨ��ǧ�ʿ�����Ӧģ�͡�',
  },
};

function modelDescription(id: string, language: Language): string {
  const entry = MODEL_DESCRIPTIONS[id];
  if (entry !== undefined) return entry[language];
  return language === 'zh-CN' ? 'δ��¼ģ�ͣ����ֶ�ʹ�á�' : 'Unlisted model; manual use is supported.';
}
