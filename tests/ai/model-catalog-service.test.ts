import { describe, expect, it } from 'vitest';
import {
  isKnownMultimodalModel,
  knownModelCatalog,
  ModelCatalogService,
  modelsEndpoint,
} from '../../src/ai';
import { FakeSecretResolver, FixtureHTTPTransport, OBVIOUSLY_FAKE_SECRET } from '../harness';
import type { EndpointSettings } from '../../src/settings';

function configuration(overrides: Partial<EndpointSettings> = {}): EndpointSettings {
  return {
    baseURL: 'https://api.example.com/v1',
    connectionTest: null,
    model: '',
    preset: 'openai',
    secretName: 'chat',
    ...overrides,
  };
}

describe('ModelCatalogService', () => {
  it('loads, sorts, and describes models from the OpenAI-compatible models endpoint', async () => {
    const http = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: {
          kind: 'response',
          response: {
            body: JSON.stringify({
              data: [{ id: 'deepseek-v4-flash' }, { id: 'unknown-model' }],
            }),
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        },
        url: 'https://api.example.com/v1/models',
      },
    ]);
    const service = new ModelCatalogService({
      configuration: () => configuration(),
      http,
      secretResolver: new FakeSecretResolver({ chat: OBVIOUSLY_FAKE_SECRET }),
    });

    const models = await service.list('zh-CN');

    expect(models.map((model) => model.id)).toEqual(['deepseek-v4-flash', 'unknown-model']);
    expect(models[0]?.description).toContain('推荐');
    expect(models[1]?.description).toBe('');
    expect(http.calls[0]?.method).toBe('GET');
    expect(http.calls[0]?.headers?.['Authorization']).toBe('[REDACTED]');
  });

  it('uses the service root, not the chat completions path', () => {
    expect(modelsEndpoint('https://api.example.com/v1/chat/completions')).toBe(
      'https://api.example.com/v1/models',
    );
  });

  it('provides a local provider catalog without requiring an API key', async () => {
    const service = new ModelCatalogService({
      configuration: () => configuration({ baseURL: 'https://api.moonshot.cn/v1' }),
      http: new FixtureHTTPTransport([]),
      secretResolver: new FakeSecretResolver({}),
    });

    const models = await service.listWithFallback('zh-CN');

    expect(models.map((model) => model.id)).toContain('kimi-k3');
    expect(models.find((model) => model.id === 'kimi-k3')?.description).toContain('推荐');
  });

  it('falls back to local models when the remote list fails authentication', async () => {
    const service = new ModelCatalogService({
      configuration: () => configuration({ baseURL: 'https://api.moonshot.cn/v1' }),
      http: new FixtureHTTPTransport([
        {
          method: 'GET',
          outcome: {
            kind: 'response',
            response: { body: '{}', headers: {}, status: 401 },
          },
          url: 'https://api.moonshot.cn/v1/models',
        },
      ]),
      secretResolver: new FakeSecretResolver({ chat: OBVIOUSLY_FAKE_SECRET }),
    });

    const models = await service.listWithFallback('zh-CN');

    expect(models.map((model) => model.id)).toContain('kimi-k3');
  });

  it('reports known multimodal models', () => {
    expect(
      knownModelCatalog('https://api.moonshot.cn/v1', 'zh-CN').map((model) => model.id),
    ).toContain('kimi-k3');
    expect(isKnownMultimodalModel('kimi-k3')).toBe(true);
    expect(isKnownMultimodalModel('deepseek-v4-flash')).toBe(false);
  });

  it('describes known Kimi models and omits filler for unknown models', async () => {
    const http = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: {
          kind: 'response',
          response: {
            body: JSON.stringify({ data: [{ id: 'kimi-k3' }, { id: 'kimi-future-model' }] }),
            headers: {},
            status: 200,
          },
        },
        url: 'https://api.moonshot.cn/v1/models',
      },
    ]);
    const service = new ModelCatalogService({
      configuration: () => configuration({ baseURL: 'https://api.moonshot.cn/v1' }),
      http,
      secretResolver: new FakeSecretResolver({ chat: OBVIOUSLY_FAKE_SECRET }),
    });

    const models = await service.list('zh-CN');

    expect(models.find((model) => model.id === 'kimi-k3')?.description).toContain('多模态');
    expect(models.find((model) => model.id === 'kimi-k3')?.description).toContain('推荐');
    expect(models.find((model) => model.id === 'kimi-future-model')?.description).toBe('');
  });

  it('requires a saved SecretStorage key', async () => {
    const service = new ModelCatalogService({
      configuration: () => configuration(),
      http: new FixtureHTTPTransport([]),
      secretResolver: new FakeSecretResolver({}),
    });

    await expect(service.list('zh-CN')).rejects.toMatchObject({ code: 'SECRET_NOT_FOUND' });
  });

  it('requires service URL and secret name before any request', async () => {
    const service = new ModelCatalogService({
      configuration: () => configuration({ baseURL: '' }),
      http: new FixtureHTTPTransport([]),
      secretResolver: new FakeSecretResolver({}),
    });

    await expect(service.list('zh-CN')).rejects.toMatchObject({
      code: 'AI_CONFIGURATION_MISSING',
    });
  });

  it('maps authentication failures without exposing provider details', async () => {
    const service = new ModelCatalogService({
      configuration: () => configuration(),
      http: new FixtureHTTPTransport([
        {
          method: 'GET',
          outcome: {
            kind: 'response',
            response: { body: '{}', headers: {}, status: 401 },
          },
          url: 'https://api.example.com/v1/models',
        },
      ]),
      secretResolver: new FakeSecretResolver({ chat: OBVIOUSLY_FAKE_SECRET }),
    });

    await expect(service.list('zh-CN')).rejects.toMatchObject({
      code: 'AI_AUTHENTICATION_FAILED',
    });
  });

  it('rejects malformed model-list responses', async () => {
    const service = new ModelCatalogService({
      configuration: () => configuration(),
      http: new FixtureHTTPTransport([
        {
          method: 'GET',
          outcome: {
            kind: 'response',
            response: { body: '{"data":[]}', headers: {}, status: 200 },
          },
          url: 'https://api.example.com/v1/models',
        },
      ]),
      secretResolver: new FakeSecretResolver({ chat: OBVIOUSLY_FAKE_SECRET }),
    });

    await expect(service.list('zh-CN')).rejects.toMatchObject({
      code: 'AI_PROTOCOL_UNSUPPORTED',
    });
  });
});
