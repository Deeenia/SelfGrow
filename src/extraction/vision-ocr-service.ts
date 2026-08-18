import { SelfGrowError, type Language } from '../domain';
import type { HTTPTransport, SecretResolver } from '../platform/ports';
import { z } from '../schema/zod';
import type { EndpointSettings } from '../settings';

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
  preview: string;
  title: string;
}

const visualPreviewSchema = z.strictObject({
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

export class OpenAIVisionOCRService implements CaptureVisionPort {
  readonly #configuration: () => EndpointSettings;
  readonly #http: HTTPTransport;
  readonly #images: CaptureImagePort;
  readonly #secrets: SecretResolver;

  constructor(dependencies: {
    configuration(): EndpointSettings;
    http: HTTPTransport;
    images: CaptureImagePort;
    secretResolver: SecretResolver;
  }) {
    this.#configuration = () => dependencies.configuration();
    this.#http = dependencies.http;
    this.#images = dependencies.images;
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
    const output = await this.#complete(
      paths,
      language === 'zh-CN'
        ? '直接理解图片的视觉内容，不要只做 OCR。仅返回 JSON：{"title":"可辨识的简短标题","preview":"一句不超过 200 字的高密度描述，说明画面主体、关键信息及用途或意义"}。不要推测图片外的信息。'
        : 'Understand the visual content directly; do not substitute OCR for visual reasoning. Return JSON only: {"title":"short recognizable title","preview":"one information-dense sentence under 200 characters describing the subject, key information, and use or significance"}. Do not infer beyond the image.',
    );
    const parsed = visualPreviewSchema.safeParse(parseJSON(output));
    if (!parsed.success) {
      throw new SelfGrowError('AI_OUTPUT_INVALID', 'The visual preview is invalid.', {
        issueCount: parsed.error.issues.length,
      });
    }
    return parsed.data;
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
