import { describe, expect, it } from 'vitest';
import { CHAT_CONNECTION_PROBE, ChatConnectionService } from '../../src/ai';
import type {
  HTTPRequest,
  HTTPResponse,
  HTTPTransport,
  SecretReference,
  SecretResolver,
} from '../../src/platform/ports';
import type { EndpointSettings } from '../../src/settings';
import { FixedTemporalContext, FixtureHTTPTransport, OBVIOUSLY_FAKE_SECRET } from '../harness';

const BASE_URL = 'https://api.example.test/v1';
const ENDPOINT_URL = `${BASE_URL}/chat/completions`;
const MODEL = 'fixture-chat-model';
const TESTED_AT = '2026-08-09T04:05:06.000Z';
const RAW_PROVIDER_MESSAGE = 'provider-private-message-should-not-escape';

function configuration(overrides: Partial<EndpointSettings> = {}): EndpointSettings {
  return {
    baseURL: BASE_URL,
    connectionTest: null,
    model: MODEL,
    multimodal: false,
    preset: 'custom',
    secretName: 'Fixture Chat Secret',
    ...overrides,
  };
}

function successBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    choices: [
      {
        finish_reason: 'stop',
        index: 0,
        message: { content: 'OK', role: 'assistant' },
      },
    ],
    id: 'chatcmpl-fixture',
    model: MODEL,
    object: 'chat.completion',
    ...overrides,
  });
}

function response(body: string, status = 200): HTTPResponse {
  return { body, headers: { 'content-type': 'application/json' }, status };
}

function route(body: string, status = 200) {
  return {
    method: 'POST' as const,
    outcome: { kind: 'response' as const, response: response(body, status) },
    url: ENDPOINT_URL,
  };
}

function service(
  transport: HTTPTransport,
  resolver: SecretResolver = new MutableSecretResolver([OBVIOUSLY_FAKE_SECRET]),
  language: 'zh-CN' | 'en' = 'en',
): ChatConnectionService {
  return new ChatConnectionService({
    clock: new FixedTemporalContext(TESTED_AT, 'Asia/Shanghai'),
    http: transport,
    language,
    secretResolver: resolver,
  });
}

class MutableSecretResolver implements SecretResolver {
  readonly #values: string[];
  #lookups = 0;

  constructor(values: readonly string[]) {
    this.#values = [...values];
  }

  get(_reference: SecretReference): string | null {
    const value = this.#values[Math.min(this.#lookups, this.#values.length - 1)] ?? null;
    this.#lookups += 1;
    return value;
  }

  get lookups(): number {
    return this.#lookups;
  }
}

describe('Task-015 chat connection test', () => {
  it.each(['zh-CN', 'en'] as const)(
    'accepts a localized OpenAI-compatible success (%s)',
    async (language) => {
      const transport = new FixtureHTTPTransport([route(successBody())]);
      const result = await service(transport, undefined, language).testChat(configuration());

      expect(result).toEqual({
        fingerprint: result.fingerprint,
        model: MODEL,
        testedAt: TESTED_AT,
      });
      expect(result.fingerprint).toMatch(/^chat\.completion-[0-9a-f]{8}$/);
    },
  );

  it('builds the exact safe endpoint, deterministic probe, and redacted headers', async () => {
    const transport = new FixtureHTTPTransport([route(successBody())]);
    await service(transport).testChat({ ...configuration(), baseURL: `${BASE_URL}/` });

    const call = transport.calls[0];
    expect(call).toMatchObject({
      maxResponseBytes: CHAT_CONNECTION_PROBE.maxResponseBytes,
      method: 'POST',
      timeoutMs: CHAT_CONNECTION_PROBE.timeoutMs,
      url: ENDPOINT_URL,
    });
    expect(call?.headers).toEqual({
      Authorization: '[REDACTED]',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(call?.body ?? '')).toEqual({
      messages: [{ content: CHAT_CONNECTION_PROBE.message, role: 'user' }],
      model: MODEL,
      max_tokens: 64,
      temperature: 0,
    });
    expect(call?.body).not.toContain(OBVIOUSLY_FAKE_SECRET);
  });

  it('uses a lightweight provider-compatible probe for Kimi models', async () => {
    const transport = new FixtureHTTPTransport([route(successBody())]);
    await service(transport).testChat(configuration({ model: 'kimi-k3', preset: 'kimi' }));

    const call = transport.calls[0];
    expect(JSON.parse(call?.body ?? '')).toEqual({
      max_completion_tokens: 64,
      messages: [{ content: CHAT_CONNECTION_PROBE.message, role: 'user' }],
      model: 'kimi-k3',
      reasoning_effort: 'low',
    });
  });

  it('accepts reasoning models that return only reasoning_content', async () => {
    const transport = new FixtureHTTPTransport([
      route(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '',
                reasoning_content: 'connectivity check',
                role: 'assistant',
              },
            },
          ],
          id: 'chatcmpl-reasoning-fixture',
          model: MODEL,
          object: 'chat.completion',
        }),
      ),
    ]);
    await expect(service(transport).testChat(configuration())).resolves.toMatchObject({
      model: MODEL,
    });
  });

  it('accepts vision-model responses whose content is an array', async () => {
    const transport = new FixtureHTTPTransport([
      route(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [{ text: 'OK', type: 'text' }],
                role: 'assistant',
              },
            },
          ],
          id: 'chatcmpl-vision-fixture',
          model: 'deepseek-v4-flash-vision-exp',
          object: 'chat.completion',
        }),
      ),
    ]);
    await service(transport).testChat(
      configuration({ model: 'deepseek-v4-flash-vision-exp', preset: 'deepseek' }),
    );
    expect(transport.calls[0]?.body).not.toContain('data:image/png;base64,');
  });

  it('resolves the SecretStorage reference anew on every testChat call', async () => {
    const resolver = new MutableSecretResolver([
      'fixture-secret-first-not-valid',
      'fixture-secret-second-not-valid',
    ]);
    const transport = new FixtureHTTPTransport([route(successBody())]);
    const chat = service(transport, resolver);

    await chat.testChat(configuration());
    await chat.testChat(configuration());

    expect(resolver.lookups).toBe(2);
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls.every((call) => call.headers?.Authorization === '[REDACTED]')).toBe(
      true,
    );
  });

  it.each([
    [{ ...configuration(), baseURL: '' }, 'AI_CONFIGURATION_MISSING'],
    [{ ...configuration(), model: '   ' }, 'AI_CONFIGURATION_MISSING'],
    [{ ...configuration(), secretName: '' }, 'AI_CONFIGURATION_MISSING'],
    [undefined, 'AI_CONFIGURATION_MISSING'],
  ] as const)('rejects missing configuration before HTTP: %o', async (config, code) => {
    const transport = new FixtureHTTPTransport([route(successBody())]);
    const resolver = new MutableSecretResolver([OBVIOUSLY_FAKE_SECRET]);

    await expect(service(transport, resolver).testChat(config)).rejects.toMatchObject({ code });
    expect(transport.calls).toHaveLength(0);
    expect(resolver.lookups).toBe(0);
  });

  it('maps a missing SecretStorage value without exposing the reference', async () => {
    const resolver = new MutableSecretResolver([]);
    const transport = new FixtureHTTPTransport([route(successBody())]);
    const error = await service(transport, resolver)
      .testChat(configuration())
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'SECRET_NOT_FOUND',
      message: 'The chat service secret was not found.',
    });
    expect(transport.calls).toHaveLength(0);
  });

  it.each([
    'https://api.example.test/v1?tenant=fixture',
    'https://api.example.test/v1#fixture-fragment',
    'https://[invalid',
  ])('rejects invalid/query/fragment Base URLs before HTTP: %s', async (baseURL) => {
    const transport = new FixtureHTTPTransport([route(successBody())]);

    await expect(service(transport).testChat(configuration({ baseURL }))).rejects.toMatchObject({
      code: 'INVALID_URL',
    });
    expect(transport.calls).toHaveLength(0);
  });

  it('lets the HTTP boundary enforce private-target policy and localizes the safe URL error', async () => {
    const transport = new FixtureHTTPTransport([]);

    await expect(
      service(transport, undefined, 'zh-CN').testChat(
        configuration({ baseURL: 'http://127.0.0.1/v1' }),
      ),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL', message: '聊天服务地址不安全。' });
    expect(transport.calls).toHaveLength(0);
  });

  it.each([401, 403] as const)(
    'maps HTTP %s to localized authentication failure',
    async (status) => {
      const transport = new FixtureHTTPTransport([
        route(JSON.stringify({ error: { message: RAW_PROVIDER_MESSAGE } }), status),
      ]);

      await expect(service(transport).testChat(configuration())).rejects.toMatchObject({
        code: 'AI_AUTHENTICATION_FAILED',
        diagnostics: { status },
        message: 'Chat service authentication failed.',
      });
    },
  );

  it('maps an explicit provider model-not-found code without retaining its message', async () => {
    const transport = new FixtureHTTPTransport([
      route(
        JSON.stringify({
          error: {
            code: 'model_not_found',
            message: RAW_PROVIDER_MESSAGE,
            type: 'invalid_request_error',
          },
        }),
        404,
      ),
    ]);

    const error = await service(transport)
      .testChat(configuration())
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: 'AI_MODEL_NOT_FOUND',
      diagnostics: { status: 404 },
      message: 'The chat service model was not found.',
    });
    expect(JSON.stringify(error)).not.toContain(RAW_PROVIDER_MESSAGE);
  });

  it('rejects non-JSON successful responses as unsupported protocol', async () => {
    const transport = new FixtureHTTPTransport([route('<html>not-json</html>')]);

    await expect(service(transport).testChat(configuration())).rejects.toMatchObject({
      code: 'AI_PROTOCOL_UNSUPPORTED',
      diagnostics: { reason: 'non_json', status: 200 },
    });
  });

  it.each([
    ['object', { object: 'chat.response' }],
    ['id', { id: '   ' }],
    ['model', { model: '' }],
    ['choices', { choices: [] }],
    ['assistant role', { choices: [{ message: { content: 'OK', role: 'user' } }] }],
    ['assistant content', { choices: [{ message: { content: '   ', role: 'assistant' } }] }],
    ['textual content', { choices: [{ message: { content: ['OK'], role: 'assistant' } }] }],
  ] as const)('rejects malformed 2xx %s response shape', async (_label, override) => {
    const transport = new FixtureHTTPTransport([route(successBody(override))]);

    await expect(service(transport).testChat(configuration())).rejects.toMatchObject({
      code: 'AI_PROTOCOL_UNSUPPORTED',
      diagnostics: { status: 200 },
    });
  });

  it('maps generic non-success statuses without exposing provider details', async () => {
    const transport = new FixtureHTTPTransport([
      route(JSON.stringify({ message: RAW_PROVIDER_MESSAGE }), 500),
    ]);

    const error = await service(transport)
      .testChat(configuration())
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: 'AI_CONNECTION_TEST_FAILED',
      diagnostics: { reason: 'http_status', status: 500 },
    });
    expect(JSON.stringify(error)).not.toContain(RAW_PROVIDER_MESSAGE);
  });

  it('maps timeout and network failures to safe categories', async () => {
    const timeoutTransport = new FixtureHTTPTransport([
      { method: 'POST', outcome: { kind: 'timeout' }, url: ENDPOINT_URL },
    ]);
    await expect(service(timeoutTransport).testChat(configuration())).rejects.toMatchObject({
      code: 'NETWORK_UNAVAILABLE',
      diagnostics: { reason: 'timeout' },
    });

    const networkTransport: HTTPTransport = {
      request: async (_request: HTTPRequest): Promise<HTTPResponse> => {
        throw new Error(`Bearer ${OBVIOUSLY_FAKE_SECRET} ${RAW_PROVIDER_MESSAGE}`);
      },
    };
    const networkError = await service(networkTransport)
      .testChat(configuration())
      .catch((caught: unknown) => caught);
    expect(networkError).toMatchObject({ code: 'NETWORK_UNAVAILABLE' });
    expect(JSON.stringify(networkError)).not.toContain(OBVIOUSLY_FAKE_SECRET);
    expect(JSON.stringify(networkError)).not.toContain(RAW_PROVIDER_MESSAGE);
  });

  it('fails closed when the endpoint was not registered in the fixture transport', async () => {
    const transport = new FixtureHTTPTransport([]);
    const error = await service(transport)
      .testChat(configuration())
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'AI_CONNECTION_TEST_FAILED',
      diagnostics: { reason: 'unregistered_request' },
    });
    expect(transport.calls).toHaveLength(1);
  });

  it('returns deterministic model identity and injected timestamp', async () => {
    const transport = new FixtureHTTPTransport([route(successBody())]);
    const chat = service(transport);

    const first = await chat.testChat(configuration());
    const second = await chat.testChat(configuration());

    expect(second).toEqual(first);
    expect(first).toEqual({
      fingerprint: first.fingerprint,
      model: MODEL,
      testedAt: TESTED_AT,
    });
    expect(first.fingerprint).not.toContain(OBVIOUSLY_FAKE_SECRET);
  });

  it.each(['zh-CN', 'en'] as const)('localizes safe protocol errors (%s)', async (language) => {
    const transport = new FixtureHTTPTransport([route('{}')]);
    const error = await service(transport, undefined, language)
      .testChat(configuration())
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'AI_PROTOCOL_UNSUPPORTED',
      message:
        language === 'zh-CN'
          ? '聊天服务返回了不受支持的协议响应。'
          : 'The chat service returned an unsupported protocol response.',
    });
  });

  it('never serializes fake secrets, raw bodies, authorization, cookies, or provider messages', async () => {
    const transport = new FixtureHTTPTransport([
      route(
        JSON.stringify({
          error: {
            code: 'provider_failure',
            message: `${RAW_PROVIDER_MESSAGE} Bearer ${OBVIOUSLY_FAKE_SECRET}`,
          },
        }),
        502,
      ),
    ]);
    const error = await service(transport)
      .testChat(configuration())
      .catch((caught: unknown) => caught);
    const serialized = JSON.stringify(error);

    expect(serialized).not.toContain(OBVIOUSLY_FAKE_SECRET);
    expect(serialized).not.toContain(RAW_PROVIDER_MESSAGE);
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('Cookie');
    expect(serialized).not.toContain('provider_failure');
  });
});
