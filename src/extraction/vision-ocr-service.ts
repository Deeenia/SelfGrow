import { isKnownMultimodalModel } from '../ai/model-catalog-service';
import {
  RAW_CATEGORIES,
  SelfGrowError,
  type Language,
  type PreferenceRecommendation,
  type PreferenceRecommendationIssue,
  type RawCategory,
} from '../domain';
import type { HTTPTransport, SecretResolver } from '../platform/ports';
import { z } from '../schema/zod';
import {
  preferenceProfileHasSignals,
  preferenceProfilePromptValue,
  type EndpointSettings,
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
  recommendationIssue?: PreferenceRecommendationIssue | null;
  title: string;
}

const visualPreviewSchema = z.object({
  category: z.enum(RAW_CATEGORIES),
  preview: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => value === value.trim() && !/[\r\n]/.test(value) && isSingleSentence(value)),
  title: z
    .string()
    .min(1)
    .max(80)
    .refine((value) => value === value.trim() && !/[\r\n]/.test(value)),
});

const visualRecommendationSchema = z.object({
  recommendationReason: z
    .string()
    .min(8)
    .max(120)
    .refine((value) => value === value.trim() && isSingleSentence(value)),
  recommendationScore: z.number().int().min(0).max(100),
});

const reportedMatchesSchema = z.array(z.string().min(1).max(40)).max(40);

export class OpenAIVisionOCRService implements CaptureVisionPort {
  readonly #configuration: () => EndpointSettings;
  readonly #http: HTTPTransport;
  readonly #images: CaptureImagePort;
  readonly #preferenceProfile: () => Promise<PreferenceProfile | null>;
  readonly #secrets: SecretResolver;

  constructor(dependencies: {
    configuration(): EndpointSettings;
    http: HTTPTransport;
    images: CaptureImagePort;
    preferenceProfile?(): Promise<PreferenceProfile | null>;
    secretResolver: SecretResolver;
  }) {
    this.#configuration = () => dependencies.configuration();
    this.#http = dependencies.http;
    this.#images = dependencies.images;
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
    const profile = await this.#preferenceProfile();
    const preference = visualPreferencePrompt(language, profile);
    const output = await this.#complete(
      paths,
      language === 'zh-CN'
        ? `直接理解图片的视觉内容，不要只做 OCR。仅返回 JSON：{"category":"Project|Skill|Experience","title":"可辨识的简短标题","preview":"一句不超过 200 字的高密度描述，说明画面主体、关键信息及用途或意义"${preference.jsonFields}}。category 根据图片可见内容选择：项目、产品或工具界面→Project；明确的 Skill、提示词或能力包→Skill；其他方法、案例、知识或生活记录→Experience。${preference.instructions}不要推测图片外的信息。${preference.context}`
        : `Understand the visual content directly; do not substitute OCR for visual reasoning. Return JSON only: {"category":"Project|Skill|Experience","title":"short recognizable title","preview":"one information-dense sentence under 200 characters describing the subject, key information, and use or significance"${preference.jsonFields}}. Classify visible projects, products, and tool interfaces as Project; explicit Skills, prompts, or capability packs as Skill; and other methods, cases, knowledge, or personal records as Experience. ${preference.instructions}Do not infer beyond the image.${preference.context}`,
      'json',
    );
    const parsedOutput = parseJSON(output);
    const parsed = visualPreviewSchema.safeParse(parsedOutput);
    if (!parsed.success) {
      throw new SelfGrowError('AI_OUTPUT_INVALID', 'The visual preview is invalid.', {
        issueCount: parsed.error.issues.length,
      });
    }
    const recommendation = visualRecommendation(parsedOutput, profile);
    return {
      category: parsed.data.category,
      preview: parsed.data.preview,
      recommendation: recommendation.value,
      recommendationIssue: recommendation.issue,
      title: parsed.data.title,
    };
  }

  async #complete(
    paths: readonly string[],
    prompt: string,
    outputMode: 'json' | 'text' = 'text',
  ): Promise<string> {
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
        ...(outputMode === 'json'
          ? { max_tokens: 720, response_format: { type: 'json_object' } }
          : {}),
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
  input: unknown,
  profile: PreferenceProfile | null,
): { issue: PreferenceRecommendationIssue | null; value: PreferenceRecommendation | null } {
  if (!recommendationEnabled(profile)) return { issue: null, value: null };
  const recommendation = visualRecommendationSchema.safeParse(input);
  if (!recommendation.success) return { issue: 'invalid_output', value: null };
  return {
    issue: null,
    value: {
      matchedInterestedKeywords: [],
      matchedPreferenceSignals: matchedPreferenceLabels(input, profile),
      matchedUninterestedKeywords: [],
      profileVersion: profile?.profileVersion ?? null,
      protocolVersion: preferenceProtocol.version,
      reason: recommendation.data.recommendationReason,
      score: recommendation.data.recommendationScore,
    },
  };
}

function configuredMatches(configured: readonly string[], reported: readonly string[]): string[] {
  const byKey = new Map(configured.map((keyword) => [keyword.toLocaleLowerCase(), keyword]));
  const result: string[] = [];
  const seen = new Set<string>();
  for (const keyword of reported) {
    const normalized = keyword.trim().toLocaleLowerCase();
    const canonical = byKey.get(normalized);
    if (canonical === undefined) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(canonical);
  }
  return result;
}

function reportedMatches(input: unknown, field: string): string[] {
  if (typeof input !== 'object' || input === null) return [];
  const parsed = reportedMatchesSchema.safeParse((input as Record<string, unknown>)[field]);
  return parsed.success ? parsed.data : [];
}

function matchedPreferenceLabels(input: unknown, profile: PreferenceProfile | null): string[] {
  if (profile === null) return [];
  const labels = [...profile.positiveSignals, ...profile.negativeSignals].map(
    (signal) => signal.label,
  );
  return configuredMatches(labels, reportedMatches(input, 'matchedPreferenceSignals'));
}

function recommendationEnabled(profile: PreferenceProfile | null): boolean {
  return profile !== null && preferenceProfileHasSignals(profile);
}

function visualPreferencePrompt(
  language: Language,
  profile: PreferenceProfile | null,
): { context: string; instructions: string; jsonFields: string } {
  if (profile === null || !preferenceProfileHasSignals(profile)) {
    return {
      context: '',
      instructions:
        language === 'zh-CN'
          ? '用户没有启用个人偏好协议，不要返回推荐度字段。'
          : 'The user has not enabled a personal preference profile, so omit recommendation fields. ',
      jsonFields: '',
    };
  }
  const profileContext = `\n<preference_profile>${JSON.stringify(preferenceProfilePromptValue(profile))}</preference_profile>`;
  const profileInstructions =
    language === 'zh-CN'
      ? '完整阅读正向偏好、负向偏好、权重和说明，将权重直接且仅应用一次；可在 matchedPreferenceSignals 中返回命中的人类可读偏好名称，不得返回或依赖内部 ID。'
      : 'Read the positive and negative preferences, weights, and descriptions in full and apply each weight directly exactly once. matchedPreferenceSignals may contain human-readable preference names; never return or depend on internal IDs. ';
  return {
    context: `\n<preference_protocol>${JSON.stringify(preferenceProtocol)}</preference_protocol>${profileContext}`,
    instructions:
      language === 'zh-CN'
        ? `recommendationScore 必须综合图片可见内容、通用规则和完整个人偏好协议直接给出 0-100 整数；recommendationReason 用一句自然语言说明。${profileInstructions}`
        : `recommendationScore must be a direct 0-100 integer based on visible content, the generic protocol, and the complete personal preference profile; recommendationReason must be one sentence. ${profileInstructions}`,
    jsonFields:
      ',"recommendationScore":0,"recommendationReason":"one advisory reason","matchedPreferenceSignals":["human-readable preference name"]',
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
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
    if (fenced === null) return null;
    try {
      return JSON.parse(fenced[1] ?? '') as unknown;
    } catch {
      return null;
    }
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
