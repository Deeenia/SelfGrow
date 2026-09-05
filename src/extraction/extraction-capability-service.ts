import { SelfGrowError, isSelfGrowError, PLATFORMS } from '../domain';
import type { HTTPTransport, SecretResolver, TemporalContext } from '../platform/ports';
import { z } from '../schema/zod';
import type { ExtractionCapabilities, ExtractionProviderSettings } from '../settings';

const CAPABILITY_TIMEOUT_MS = 20_000;
const CAPABILITY_MAX_RESPONSE_BYTES = 250_000;

const capabilityResponseSchema = z.strictObject({
  articleBody: z.strictObject({
    body: z.string().min(200),
  }),
  platformDetail: z.strictObject({
    platform: z.enum(PLATFORMS),
    title: z.string().min(1),
  }),
  provider: z.string().min(1),
  subtitles: z.strictObject({
    segments: z.array(z.strictObject({ text: z.string().min(1) })).min(1),
  }),
});

export interface ExtractionCapabilityServiceDependencies {
  clock: TemporalContext;
  http: HTTPTransport;
  secretResolver: SecretResolver;
}

export interface ExtractionCapabilityTestResult {
  capabilities: ExtractionCapabilities;
  provider: string;
  testedAt: string;
}

export class ExtractionCapabilityService {
  readonly #clock: TemporalContext;
  readonly #http: HTTPTransport;
  readonly #secretResolver: SecretResolver;

  constructor(dependencies: ExtractionCapabilityServiceDependencies) {
    this.#clock = dependencies.clock;
    this.#http = dependencies.http;
    this.#secretResolver = dependencies.secretResolver;
  }

  async test(configuration: ExtractionProviderSettings): Promise<ExtractionCapabilityTestResult> {
    if (!configuration.disclosureAccepted) {
      throw new SelfGrowError(
        'AI_CONFIGURATION_MISSING',
        'Extraction provider disclosure must be accepted before testing.',
      );
    }
    const secret = this.#secretResolver.get({ name: configuration.secretName });
    if (secret === null || secret.trim().length === 0 || /[\r\n]/.test(secret)) {
      throw new SelfGrowError('SECRET_NOT_FOUND', 'The extraction provider secret was not found.');
    }
    let response;
    try {
      response = await this.#http.request({
        body: JSON.stringify({
          probes: ['article_body', 'platform_detail', 'subtitles'],
          protocol: 'selfgrow-capabilities-v1',
        }),
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        maxResponseBytes: CAPABILITY_MAX_RESPONSE_BYTES,
        method: 'POST',
        timeoutMs: CAPABILITY_TIMEOUT_MS,
        url: capabilityEndpoint(configuration.baseURL),
      });
    } catch (error) {
      if (isSelfGrowError(error)) throw error;
      throw new SelfGrowError('NETWORK_UNAVAILABLE', 'The extraction capability test failed.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new SelfGrowError(
        'AI_AUTHENTICATION_FAILED',
        'Extraction provider authentication failed.',
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new SelfGrowError('AI_CONNECTION_TEST_FAILED', 'Extraction capability test failed.', {
        status: response.status,
      });
    }
    const parsed = capabilityResponseSchema.safeParse(parseJSON(response.body));
    if (!parsed.success) {
      throw new SelfGrowError(
        'AI_PROTOCOL_UNSUPPORTED',
        'The extraction provider capability response is invalid.',
        { issueCount: parsed.error.issues.length },
      );
    }
    return {
      capabilities: { articleBody: true, platformDetail: true, subtitles: true },
      provider: parsed.data.provider,
      testedAt: validNow(this.#clock),
    };
  }
}

function capabilityEndpoint(baseURL: string): string {
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
  url.pathname = path.endsWith('/capabilities') ? path : `${path}/capabilities`;
  return url.toString();
}

function parseJSON(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function validNow(clock: TemporalContext): string {
  const now = clock.now();
  if (!Number.isFinite(now.getTime())) {
    throw new SelfGrowError('AI_CONNECTION_TEST_FAILED', 'Capability test time is invalid.');
  }
  return now.toISOString();
}
