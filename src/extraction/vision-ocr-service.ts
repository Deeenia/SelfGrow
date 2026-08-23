import { isKnownMultimodalModel } from '../ai/model-catalog-service';
import {
  RAW_CATEGORIES,
  SelfGrowError,
  type Language,
  type PreferenceRecommendation,
  type RawCategory,
} from '../domain';
import type { HTTPTransport, SecretResolver } from '../platform/ports';
import { z } from '../schema/zod';
import {
  applyPreferenceProfile,
  preferenceKeywordsReady,
  preferenceProfilePromptValue,
  type EndpointSettings,
  type PreferenceKeywordSettings,
  type PreferenceProfile,
} from '../settings';
import preferenceProtocol from '../../preference-protocol.json';

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 8_000_000;

const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

export interface ImageData {
  bytes: Uint8Array;
  mimeType: string;
}

export interface CaptureImagePort {
  read(path: string): Promise<ImageData>;
}

export interface CaptureOCRPort {
  recognize(paths: readonly string[]): Promise<string>;
}

export interface CaptureVisionPort extends CaptureOCRPort {
  preview(paths: readonly string[], language: Language): Promise<VisualPreview>;
}

export interface VisualPreview {
  category: RawCategory;
  preview: string;
  recommendation: PreferenceRecommendation | null;
  title: string;
}

const visualPreviewSchema = z.strictObject({
  category: z.enum(RAW_CATEGORIES),
  matchedInterestedKeywords: z.array(z.string().min(1).max(40)).max(30).optional(),
  matchedPreferenceSignalIds: z.array(z.string().min(1).max(64)).max(40).optional(),
  matchedUninterestedKeywords: z.array(z.string().min(1).max(40)).max(30).optional(),
  preview: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => value === value.trim() && !/[\r\n]/.test(value) && isSingleSentence(value)),
  recommendationReason: z
    .string()
    .min(8)
    .max(120)
    .refine((value) => value === value.trim() && isSingleSentence(value))
    .optional(),
  recommendationScore: z.number().int().min(0).max(100).optional(),
  title: z
    .string()
    .min(1)
    .max(80)
    .refine((value) => value === value.trim() && !/[\r\n]/.test(value)),
});

export class OpenAIVisionOCRService implements CaptureVisionPort {
  readonly #configuration: () => EndpointSettings;
  readonly #http: HTTPTransport;
  readonly #images: CaptureImagePort;
  readonly #preferenceKeywords: () => PreferenceKeywordSettings;
  readonly #preferenceProfile: () => Promise<PreferenceProfile | null>;
  readonly #secrets: SecretResolver;

  constructor(dependencies: {
    configuration(): EndpointSettings;
    http: HTTPTransport;
    images: CaptureImagePort;
    preferenceKeywords?(): PreferenceKeywordSettings;
    preferenceProfile?(): Promise<PreferenceProfile | null>;
    secretResolver: SecretResolver;
  }) {
    this.#configuration = () => dependencies.configuration();
    this.#http = dependencies.http;
    this.#images = dependencies.images;
    this.#preferenceKeywords = () =>
      dependencies.preferenceKeywords?.() ?? { interested: [], uninterested: [] };
    this.#preferenceProfile = () => dependencies.preferenceProfile?.() ?? Promise.resolve(null);
    this.#secrets = dependencies.secretResolver;
  }

  async recognize(paths: readonly string[]): Promise<string> {
    if (paths.length === 0) return '';
    const text = await this.#complete(
      paths,
      'Extract all readable text from these images in natural reading order. Preserve headings, lists, code, and technical terms. Return only the extracted text. Do not summarize or explain. If no text is readable, return [NO_TEXT].',
    );
    return text === '[NO_TEXT]' ? '' : text;
  }

  async preview(paths: readonly string[], language: Language): Promise<VisualPreview> {
    if (paths.length === 0) {
      throw new SelfGrowError('EXTRACTION_FAILED', 'A visual preview requires an image.');
    }
    const configuredModel = this.#configuration().model;
    if (!this.#configuration().multimodal && !isKnownMultimodalModel(configuredModel)) {
      throw new SelfGrowError(
        'AI_PROTOCOL_UNSUPPORTED',
        language === 'zh-CN'
          ? '当前模型未标记为多模态，无法生成图片预览。'
          : 'The selected model is not marked as multimodal and cannot generate an image preview.',
      );
    }
    const keywords = this.#preferenceKeywords();
    const profile = await this.#preferenceProfile();
    const preference = visualPreferencePrompt(language, keywords, profile);
    const output = await this.#complete(
      paths,
      language === 'zh-CN'
        ? `直接理解图片的视觉内容，不要只做 OCR。仅返回 JSON：{"category":"Project|Skill|Experience","title":"可辨识的简短标题","preview":"一句不超过 200 字的高密度描述，说明画面主体、关键信息及用途或意义"${preference.jsonFields}}。category 根据图片可见内容选择：项目、产品或工具界面→Project；明确的 Skill、提示词或能力包→Skill；其他方法、案例、知识或生活记录→Experience。${preference.instructions}不要推测图片外的信息。${preference.context}`
        : `Understand the visual content directly; do not substitute OCR for visual reasoning. Return JSON only: {"category":"Project|Skill|Experience","title":"short recognizable title","preview":"one information-dense sentence under 200 characters describing the subject, key information, and use or significance"${preference.jsonFields}}. Classify visible projects, products, and tool interfaces as Project; explicit Skills, prompts, or capability packs as Skill; and other methods, cases, knowledge, or personal records as Experience. ${preference.instructions}Do not infer beyond the image.${preference.context}`,
    );
    const parsed = visualPreviewSchema.safeParse(parseJSON(output));
    if (!parsed.success) {
      throw new SelfGrowError('AI_OUTPUT_INVALID', 'The visual preview is invalid.', {
        issueCount: parsed.error.issues.length,
      });
    }
    const recommendation = visualRecommendation(parsed.data, keywords, profile);
    if (!recommendation.valid) {
      throw new SelfGrowError('AI_OUTPUT_INVALID', 'The visual recommendation is invalid.');
    }
    return {
      category: parsed.data.category,
      preview: parsed.data.preview,
      recommendation: recommendation.value,
      title: parsed.data.title,
    };
  }

  async #complete(paths: readonly string[], prompt: string): Promise<string> {
    if (paths.length > MAX_IMAGES) {
      throw new SelfGrowError('EXTRACTION_FAILED', 'A capture may contain at most three images.');
    }
    const configuration = this.#configuration();
    if (
      configuration.baseURL.length === 0 ||
      configuration.model.length === 0 ||
      configuration.secretName.length === 0
    ) {
      throw new SelfGrowError('AI_CONFIGURATION_MISSING', 'AI configuration is incomplete.');
    }
    const secret = this.#secrets.get({ name: configuration.secretName });
    if (secret === null || secret.trim().length === 0 || /[\r\n]/.test(secret)) {
      throw new SelfGrowError('SECRET_NOT_FOUND', 'The AI service secret was not found.');
    }

    const content: Array<Record<string, unknown>> = [
      {
        text: prompt,
        type: 'text',
      },
    ];
    for (const path of paths) {
      const image = await this.#images.read(path);
      if (image.bytes.byteLength === 0 || image.bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new SelfGrowError('EXTRACTION_FAILED', 'A capture image has an invalid size.');
      }
      if (!/^image\/(?:jpeg|png|webp|gif)$/i.test(image.mimeType)) {
        throw new SelfGrowError('EXTRACTION_FAILED', 'The capture image format is unsupported.');
      }
      content.push({
        image_url: { url: `data:${image.mimeType};base64,${base64(image.bytes)}` },
        type: 'image_url',
      });
    }

    const response = await this.#http.request({
      body: JSON.stringify({
        messages: [{ content, role: 'user' }],
        model: configuration.model,
        temperature: 0,
      }),
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      maxResponseBytes: 256_000,
      method: 'POST',
      timeoutMs: 30_000,
      url: chatEndpoint(configuration.baseURL),
    });
    if (response.status === 401 || response.status === 403) {
      throw new SelfGrowError(
        'AI_AUTHENTICATION_FAILED',
        'AI image recognition authentication failed.',
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new SelfGrowError('AI_CONNECTION_TEST_FAILED', 'AI image recognition failed.', {
        status: response.status,
      });
    }
    const parsed = responseSchema.safeParse(parseJSON(response.body));
    const text = parsed.success ? parsed.data.choices[0]?.message.content.trim() : undefined;
    if (text === undefined) {
      throw new SelfGrowError(
        'AI_PROTOCOL_UNSUPPORTED',
        'The AI service does not support image recognition.',
      );
    }
    return text;
  }
}

function visualRecommendation(
  value: z.infer<typeof visualPreviewSchema>,
  keywords: PreferenceKeywordSettings,
  profile: PreferenceProfile | null,
): { valid: boolean; value: PreferenceRecommendation | null } {
  if (!preferenceKeywordsReady(keywords)) return { valid: true, value: null };
  if (
    value.recommendationReason === undefined ||
    value.recommendationScore === undefined ||
    value.matchedInterestedKeywords === undefined ||
    value.matchedUninterestedKeywords === undefined
  ) {
    return { valid: false, value: null };
  }
  const interested = configuredMatches(keywords.interested, value.matchedInterestedKeywords);
  const uninterested = configuredMatches(keywords.uninterested, value.matchedUninterestedKeywords);
  if (interested === null || uninterested === null) return { valid: false, value: null };
  const appliedProfile =
    profile === null
      ? { matchedLabels: [], score: value.recommendationScore }
      : value.matchedPreferenceSignalIds === undefined
        ? null
        : applyPreferenceProfile(
            value.recommendationScore,
            value.matchedPreferenceSignalIds,
            profile,
          );
  if (appliedProfile === null) return { valid: false, value: null };
  return {
    valid: true,
    value: {
      matchedInterestedKeywords: interested,
      matchedPreferenceSignals: appliedProfile.matchedLabels,
      matchedUninterestedKeywords: uninterested,
      profileVersion: profile?.profileVersion ?? null,
      protocolVersion: preferenceProtocol.version,
      reason: value.recommendationReason,
      score: appliedProfile.score,
    },
  };
}

function configuredMatches(
  configured: readonly string[],
  reported: readonly string[],
): string[] | null {
  const byKey = new Map(configured.map((keyword) => [keyword.toLocaleLowerCase(), keyword]));
  const result: string[] = [];
  const seen = new Set<string>();
  for (const keyword of reported) {
    const normalized = keyword.trim().toLocaleLowerCase();
    const canonical = byKey.get(normalized);
    if (canonical === undefined) return null;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(canonical);
  }
  return result;
}

function visualPreferencePrompt(
  language: Language,
  keywords: PreferenceKeywordSettings,
  profile: PreferenceProfile | null,
): { context: string; instructions: string; jsonFields: string } {
  if (!preferenceKeywordsReady(keywords)) {
    return {
      context: '',
      instructions:
        language === 'zh-CN'
          ? '用户尚未完整配置两组偏好关键词，不要返回推荐度或关键词命中字段。'
          : 'The user has not configured both keyword groups, so omit recommendation and matched-keyword fields. ',
      jsonFields: '',
    };
  }
  const context = JSON.stringify({
    interested: keywords.interested,
    uninterested: keywords.uninterested,
  });
  const profileContext =
    profile === null
      ? ''
      : `\n<preference_profile>${JSON.stringify(preferenceProfilePromptValue(profile))}</preference_profile>`;
  const profileInstructions =
    profile === null
      ? ''
      : language === 'zh-CN'
        ? 'matchedPreferenceSignalIds 只能逐字返回被图片语义支持的个人协议信号 ID，无命中则返回空数组；插件会在基础分上应用权重。'
        : 'matchedPreferenceSignalIds may contain only exact personal-profile signal IDs supported by the image, or an empty array; the plugin applies their weights to the base score. ';
  return {
    context: `\n<preference_protocol>${JSON.stringify(preferenceProtocol)}</preference_protocol>\n<preference_keywords>${context}</preference_keywords>${profileContext}`,
    instructions:
      language === 'zh-CN'
        ? `recommendationScore 只能依据图片可见内容、通用规则与用户关键词给出 0-100 基础整数；recommendationReason 用一句话说明；两个关键词 matched 数组只能逐字返回已配置且被图片语义命中的关键词，无命中时返回空数组。${profileInstructions}`
        : `recommendationScore must be a 0-100 integer base score based only on visible content, the generic protocol, and configured keywords; recommendationReason must be one sentence; keyword match arrays may contain only exact configured keyword strings supported by the image, or be empty. ${profileInstructions}`,
    jsonFields: `,"recommendationScore":0,"recommendationReason":"one advisory reason","matchedInterestedKeywords":["exact configured keyword"],"matchedUninterestedKeywords":["exact configured keyword"]${profile === null ? '' : ',"matchedPreferenceSignalIds":["exact profile signal id"]'}`,
  };
}

function chatEndpoint(baseURL: string): string {
  const url = new URL(baseURL);
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new SelfGrowError('INVALID_URL', 'The AI service URL is invalid.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
  return url.toString();
}

function parseJSON(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isSingleSentence(value: string): boolean {
  const terminals = value.match(/[。！？!?]|\.(?=\s|$)/g);
  return (terminals?.length ?? 0) <= 1;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
