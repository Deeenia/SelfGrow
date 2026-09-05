import { SelfGrowError } from '../domain';
import type { HTTPTransport, SecretResolver } from '../platform/ports';
import { z } from '../schema/zod';
import type { ExtractionProviderSettings } from '../settings';
import { validateCompleteContent } from './completeness';
import type { PlatformProviderPort } from './priority-platform-extractor';
import type { ExtractionOutcome, ExtractionRequest } from './types';

const TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 2_000_000;

const responseSchema = z.strictObject({
  author: z.string().optional(),
  body: z.string(),
  bodyKind: z.enum(['article', 'transcript']),
  canonicalURL: z.url().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  finalURL: z.url(),
  platform: z.enum(['youtube', 'bilibili', 'xiaohongshu', 'douyin', 'wechat_official_account']),
  publishedAt: z.string().optional(),
  sourceLanguage: z.string().optional(),
  title: z.string().optional(),
});

/**
 * Adapter for the documented SelfGrow extraction-provider protocol. TikHub is
 * deliberately not treated as protocol-compatible: its platform APIs require
 * endpoint-specific adapters and must never receive data through guessed calls.
 */
export class ConfiguredPlatformProvider implements PlatformProviderPort {
  readonly #configuration: () => ExtractionProviderSettings | null;
  readonly #http: HTTPTransport;
  readonly #secrets: SecretResolver;

  constructor(dependencies: {
    configuration(): ExtractionProviderSettings | null;
    http: HTTPTransport;
    secretResolver: SecretResolver;
  }) {
    this.#configuration = () => dependencies.configuration();
    this.#http = dependencies.http;
    this.#secrets = dependencies.secretResolver;
  }

  async extract(request: ExtractionRequest): Promise<ExtractionOutcome> {
    const configuration = this.#configuration();
    if (
      configuration === null ||
      configuration.preset !== 'custom' ||
      !configuration.disclosureAccepted ||
      configuration.connectionTest === null
    ) {
      return incomplete(
        'provider_not_configured',
        'A tested extraction provider is not configured.',
      );
    }
    const secret = this.#secrets.get({ name: configuration.secretName });
    if (secret === null || secret.trim().length === 0 || /[\r\n]/.test(secret)) {
      return incomplete(
        'provider_not_configured',
        'The extraction provider secret is unavailable.',
      );
    }
    let response;
    try {
      response = await this.#http.request({
        body: JSON.stringify({
          language: request.language,
          platform: request.url.platform,
          protocol: 'selfgrow-extraction-v1',
          url: request.url.normalized,
        }),
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        maxResponseBytes: MAX_RESPONSE_BYTES,
        method: 'POST',
        timeoutMs: TIMEOUT_MS,
        url: extractionEndpoint(configuration.baseURL),
      });
    } catch (error) {
      if (error instanceof SelfGrowError && error.code === 'NETWORK_UNAVAILABLE') throw error;
      return incomplete('provider_unavailable', 'The extraction provider is unavailable.');
    }
    if (response.status === 401 || response.status === 403) {
      return incomplete(
        'provider_authentication_failed',
        'The extraction provider rejected its credential.',
      );
    }
    if (response.status < 200 || response.status >= 300) {
      return incomplete('provider_unavailable', 'The extraction provider is unavailable.');
    }
    const parsed = responseSchema.safeParse(parseJSON(response.body));
    if (!parsed.success || parsed.data.platform !== request.url.platform) {
      return incomplete(
        'provider_response_invalid',
        'The extraction provider response was invalid.',
      );
    }
    if (
      parsed.data.bodyKind === 'transcript' &&
      (parsed.data.durationSeconds === undefined || parsed.data.durationSeconds > 300)
    ) {
      return incomplete(
        'video_too_long',
        'Only videos up to five minutes are transcribed. Open the original link.',
      );
    }
    const isVideoDescription =
      parsed.data.bodyKind === 'article' && parsed.data.platform !== 'wechat_official_account';
    const completeness = isVideoDescription
      ? validateVideoDescription(parsed.data.body)
      : validateCompleteContent(parsed.data.body);
    if (completeness.kind === 'incomplete') {
      return incomplete(
        parsed.data.bodyKind === 'transcript' ? 'transcript_missing' : 'main_text_missing',
        'The extraction provider did not return complete content.',
      );
    }
    return {
      content: {
        ...parsed.data,
        body: completeness.normalized,
        route: 'third_party_provider',
      },
      kind: 'complete',
    };
  }
}

function validateVideoDescription(
  value: string,
): { kind: 'complete'; normalized: string } | { kind: 'incomplete' } {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length >= 20 ? { kind: 'complete', normalized } : { kind: 'incomplete' };
}

function extractionEndpoint(baseURL: string): string {
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    throw new SelfGrowError('INVALID_URL', 'The extraction provider URL is invalid.');
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new SelfGrowError('INVALID_URL', 'The extraction provider URL is invalid.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/extract') ? path : `${path}/extract`;
  return url.toString();
}

function parseJSON(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function incomplete(code: string, message: string): ExtractionOutcome {
  return { code, kind: 'incomplete', message };
}
