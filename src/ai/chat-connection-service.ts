import { SelfGrowError, isSelfGrowError, type Language } from '../domain';
import type {
  HTTPRequest,
  HTTPResponse,
  HTTPTransport,
  SecretResolver,
  TemporalContext,
} from '../platform/ports';
import { z } from '../schema/zod';
import type { EndpointSettings } from '../settings';

const CHAT_PROBE_MESSAGE = 'Reply with OK.';
const CHAT_PROBE_TIMEOUT_MS = 30_000;
const CHAT_PROBE_MAX_RESPONSE_BYTES = 65_536;

const chatMessageContentSchema = z.union([
  z.string(),
  z.array(z.object({ text: z.string().optional(), type: z.string() })),
]);

const chatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: chatMessageContentSchema,
          reasoning_content: z.string().optional(),
          role: z.string(),
        }),
      }),
    )
    .min(1),
  id: z.string().min(1),
  model: z.string().min(1),
  object: z.literal('chat.completion'),
});

const providerErrorSchema = z.object({
  code: z.string().optional(),
  error: z
    .object({
      code: z.string().optional(),
      type: z.string().optional(),
    })
    .optional(),
  type: z.string().optional(),
});

type ChatCompletion = z.infer<typeof chatCompletionSchema>;

export interface ChatConnectionServiceDependencies {
  clock: TemporalContext;
  http: HTTPTransport;
  language?: Language;
  secretResolver: SecretResolver;
}

export interface ChatConnectionTestResult {
  fingerprint: string;
  model: string;
  testedAt: string;
}

interface ResolvedConfiguration {
  endpointURL: string;
  model: string;
  preset: EndpointSettings['preset'];
  secretName: string;
}

type ErrorKind =
  | 'authentication'
  | 'configuration'
  | 'connection'
  | 'invalidURL'
  | 'model'
  | 'network'
  | 'protocol'
  | 'secret'
  | 'unsafeURL';

const MESSAGES: Record<Language, Record<ErrorKind, string>> = {
  'zh-CN': {
    authentication: '聊天服务认证失败。',
    configuration: '聊天连接配置不完整。',
    connection: '聊天连接测试失败。',
    invalidURL: '聊天服务地址无效。',
    model: '聊天服务模型未找到。',
    network: '无法连接聊天服务。',
    protocol: '聊天服务返回了不受支持的协议响应。',
    secret: '未找到聊天服务密钥。',
    unsafeURL: '聊天服务地址不安全。',
  },
  en: {
    authentication: 'Chat service authentication failed.',
    configuration: 'Chat connection configuration is incomplete.',
    connection: 'Chat connection test failed.',
    invalidURL: 'The chat service URL is invalid.',
    model: 'The chat service model was not found.',
    network: 'The chat service is unavailable.',
    protocol: 'The chat service returned an unsupported protocol response.',
    secret: 'The chat service secret was not found.',
    unsafeURL: 'The chat service URL is unsafe.',
  },
};

export const CHAT_CONNECTION_PROBE = Object.freeze({
  maxResponseBytes: CHAT_PROBE_MAX_RESPONSE_BYTES,
  message: CHAT_PROBE_MESSAGE,
  timeoutMs: CHAT_PROBE_TIMEOUT_MS,
});

export class ChatConnectionService {
  readonly #clock: TemporalContext;
  readonly #language: Language;
  readonly #secretResolver: SecretResolver;
  readonly #transport: HTTPTransport;

  constructor(dependencies: ChatConnectionServiceDependencies) {
    this.#clock = dependencies.clock;
    this.#language = normalizeLanguage(dependencies.language);
    this.#secretResolver = dependencies.secretResolver;
    this.#transport = dependencies.http;
  }

  async testChat(
    configuration: EndpointSettings | null | undefined,
  ): Promise<ChatConnectionTestResult> {
    const resolved = resolveConfiguration(configuration, this.#language);

    let secret: string | null;
    try {
      secret = this.#secretResolver.get({ name: resolved.secretName });
    } catch {
      throw localizedError('SECRET_NOT_FOUND', 'secret', this.#language, {
        reason: 'secret_lookup_failed',
      });
    }
    if (secret === null || secret.trim().length === 0 || /[\r\n]/.test(secret)) {
      throw localizedError('SECRET_NOT_FOUND', 'secret', this.#language, {
        reason: 'secret_not_found',
      });
    }

    const request: HTTPRequest = {
      body: JSON.stringify(chatProbeBody(resolved)),
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      maxResponseBytes: CHAT_PROBE_MAX_RESPONSE_BYTES,
      method: 'POST',
      timeoutMs: CHAT_PROBE_TIMEOUT_MS,
      url: resolved.endpointURL,
    };

    let response: HTTPResponse;
    try {
      response = await this.#transport.request(request);
    } catch (error) {
      throw mapTransportFailure(error, this.#language);
    }

    return validateResponse(response, resolved.model, this.#clock, this.#language);
  }
}

function resolveConfiguration(
  configuration: EndpointSettings | null | undefined,
  language: Language,
): ResolvedConfiguration {
  if (configuration === null || configuration === undefined) {
    throw localizedError('AI_CONFIGURATION_MISSING', 'configuration', language, {
      reason: 'missing_configuration',
    });
  }

  const baseURL = configuration.baseURL.trim();
  const model = configuration.model.trim();
  const secretName = configuration.secretName.trim();
  if (
    baseURL.length === 0 ||
    model.length === 0 ||
    secretName.length === 0 ||
    hasControlCharacter(model) ||
    hasControlCharacter(secretName)
  ) {
    throw localizedError('AI_CONFIGURATION_MISSING', 'configuration', language, {
      reason: 'missing_configuration',
    });
  }

  return {
    endpointURL: chatCompletionsEndpoint(baseURL, language),
    model,
    preset: configuration.preset,
    secretName,
  };
}

function chatProbeBody(resolved: ResolvedConfiguration): Record<string, unknown> {
  const body: Record<string, unknown> = {
    messages: [{ content: CHAT_PROBE_MESSAGE, role: 'user' }],
    model: resolved.model,
  };
  if (resolved.preset === 'kimi') {
    body.max_completion_tokens = 64;
    if (resolved.model === 'kimi-k3') body.reasoning_effort = 'low';
  } else {
    body.max_tokens = 64;
    body.temperature = 0;
  }
  return body;
}

function chatCompletionsEndpoint(baseURL: string, language: Language): string {
  if (baseURL.includes('?') || baseURL.includes('#')) {
    throw localizedError('INVALID_URL', 'invalidURL', language, {
      reason: 'base_url_query_or_fragment',
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw localizedError('INVALID_URL', 'invalidURL', language, {
      reason: 'invalid_base_url',
    });
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
  return parsed.toString();
}

function validateResponse(
  response: HTTPResponse,
  requestedModel: string,
  clock: TemporalContext,
  language: Language,
): ChatConnectionTestResult {
  const status = safeHTTPStatus(response.status);

  if (status === 401 || status === 403) {
    throw localizedError('AI_AUTHENTICATION_FAILED', 'authentication', language, { status });
  }

  if (status === null || status < 200 || status >= 300) {
    if (hasExplicitModelNotFound(response.body)) {
      throw localizedError('AI_MODEL_NOT_FOUND', 'model', language, {
        status: status ?? 0,
      });
    }
    throw localizedError('AI_CONNECTION_TEST_FAILED', 'connection', language, {
      ...(status === null ? {} : { status }),
      reason: 'http_status',
    });
  }

  const parsed = parseJSON(response.body);
  if (parsed === null) {
    throw localizedError('AI_PROTOCOL_UNSUPPORTED', 'protocol', language, {
      reason: 'non_json',
      status,
    });
  }
  const completion = chatCompletionSchema.safeParse(parsed);
  if (!completion.success || !hasAssistantContent(completion.data)) {
    throw localizedError('AI_PROTOCOL_UNSUPPORTED', 'protocol', language, {
      reason: 'invalid_shape',
      status,
    });
  }

  const responseModel = completion.data.model.trim();
  if (completion.data.id.trim().length === 0 || responseModel.length === 0) {
    throw localizedError('AI_PROTOCOL_UNSUPPORTED', 'protocol', language, {
      reason: 'invalid_identity',
      status,
    });
  }

  let testedAt: string;
  try {
    const now = clock.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new RangeError('Invalid clock value.');
    }
    testedAt = now.toISOString();
  } catch {
    throw localizedError('AI_CONNECTION_TEST_FAILED', 'connection', language, {
      reason: 'clock_failed',
    });
  }

  return {
    fingerprint: protocolFingerprint(responseModel),
    model: requestedModel,
    testedAt,
  };
}

function parseJSON(body: unknown): unknown {
  if (typeof body !== 'string') return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function hasAssistantContent(completion: ChatCompletion): boolean {
  return completion.choices.some((choice) => {
    if (choice.message.role !== 'assistant') return false;
    if ((choice.message.reasoning_content ?? '').trim().length > 0) return true;
    const content = choice.message.content;
    if (typeof content === 'string') return content.trim().length > 0;
    return content.some((part) => part.type === 'text' && (part.text ?? '').trim().length > 0);
  });
}

function hasExplicitModelNotFound(body: string): boolean {
  const parsed = parseJSON(body);
  if (parsed === null) return false;
  const result = providerErrorSchema.safeParse(parsed);
  if (!result.success) return false;

  return [
    result.data.code,
    result.data.type,
    result.data.error?.code,
    result.data.error?.type,
  ].some((value) => value !== undefined && isModelNotFoundCode(value));
}

function isModelNotFoundCode(value: string): boolean {
  return /(?:^|[_-])model(?:[_-]?(?:not|does)[_-]?(?:found|exist))(?:$|[_-])/i.test(value);
}

function mapTransportFailure(error: unknown, language: Language): SelfGrowError {
  if (isSelfGrowError(error)) {
    switch (error.code) {
      case 'INVALID_URL':
        return localizedError('INVALID_URL', 'invalidURL', language, {
          reason: 'invalid_base_url',
        });
      case 'UNSAFE_URL':
        return localizedError('UNSAFE_URL', 'unsafeURL', language, {
          reason: 'unsafe_base_url',
        });
      case 'NETWORK_UNAVAILABLE':
        return localizedError('NETWORK_UNAVAILABLE', 'network', language, {
          reason: safeNetworkReason(error.diagnostics.reason),
        });
      default:
        return localizedError('AI_CONNECTION_TEST_FAILED', 'connection', language, {
          reason: 'transport_failed',
        });
    }
  }

  const transportCode = readErrorCode(error);
  if (transportCode === 'TIMEOUT') {
    return localizedError('NETWORK_UNAVAILABLE', 'network', language, { reason: 'timeout' });
  }
  if (transportCode === 'UNREGISTERED_REQUEST') {
    return localizedError('AI_CONNECTION_TEST_FAILED', 'connection', language, {
      reason: 'unregistered_request',
    });
  }
  if (transportCode === 'OVERSIZED_BODY') {
    return localizedError('AI_CONNECTION_TEST_FAILED', 'connection', language, {
      reason: 'response_too_large',
    });
  }

  return localizedError('NETWORK_UNAVAILABLE', 'network', language, {
    reason: 'request_failed',
  });
}

function localizedError(
  code: SelfGrowError['code'],
  kind: ErrorKind,
  language: Language,
  diagnostics: Readonly<Record<string, boolean | number | string | null>> = {},
): SelfGrowError {
  return new SelfGrowError(code, MESSAGES[language][kind], diagnostics);
}

function protocolFingerprint(model: string): string {
  const identity = `chat.completion|${model}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `chat.completion-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function safeHTTPStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

function safeNetworkReason(value: unknown): string {
  return value === 'timeout' || value === 'request_failed' ? value : 'request_failed';
}

function readErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function normalizeLanguage(language: Language | undefined): Language {
  return language === 'zh-CN' || language === 'en' ? language : 'zh-CN';
}
