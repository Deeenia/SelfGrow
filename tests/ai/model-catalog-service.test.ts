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
    multimodal: false,
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

  it('keeps and orders only current recommended Qwen models from the broad catalog', async () => {
    const http = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: {
          kind: 'response',
          response: {
            body: JSON.stringify({
              data: [
                { id: 'deepseek-v3' },
                { id: 'qwen3.7-flash' },
                { id: 'qwen3.8-max' },
                { id: 'qwen3.7-plus' },
                { id: 'qwen-plus' },
                { id: 'qvq-max' },
                { id: 'wan2.6-t2v' },
              ],
            }),
            headers: {},
            status: 200,
          },
        },
        url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
      },
    ]);
    const service = new ModelCatalogService({
      configuration: () =>
        configuration({
          baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          preset: 'qwen',
        }),
      http,
      secretResolver: new FakeSecretResolver({ chat: OBVIOUSLY_FAKE_SECRET }),
    });

    const models = await service.list('zh-CN');
    expect(models.map((model) => model.id)).toEqual([
      'qwen3.8-max',
      'qwen3.7-plus',
      'qwen3.7-flash',
    ]);
    expect(models.every((model) => model.description.includes('推荐'))).toBe(true);
  });

  it('uses the service root, not the chat completions path', () => {
    expect(modelsEndpoint('https://api.example.com/v1/chat/completions')).toBe(
      'https://api.example.com/v1/models',
    );
  });

  it('uses compact current catalogs for DeepSeek and Qwen', () => {
    expect(knownModelCatalog('https://api.deepseek.com', 'zh-CN').map((model) => model.id)).toEqual(
      ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4-pro'],
    );
    expect(
      knownModelCatalog('https://dashscope.aliyuncs.com/compatible-mode/v1', 'zh-CN').map(
        (model) => model.id,
      ),
    ).toEqual(['qwen3.8-max', 'qwen3.7-plus', 'qwen3.7-flash']);
  });

  it('keeps the DeepSeek experimental vision model available when the provider list lags', async () => {
    const http = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: {
          kind: 'response',
          response: {
            body: JSON.stringify({
              data: [
                { id: 'deepseek-v4-pro' },
                { id: 'retired-deepseek-model' },
                { id: 'deepseek-v4-flash' },
              ],
            }),
            headers: {},
            status: 200,
          },
        },
        url: 'https://api.deepseek.com/models',
      },
    ]);
    const service = new ModelCatalogService({
      configuration: () =>
        configuration({ baseURL: 'https://api.deepseek.com', preset: 'deepseek' }),
      http,
      secretResolver: new FakeSecretResolver({ chat: OBVIOUSLY_FAKE_SECRET }),
    });

    const models = await service.list('zh-CN');
    expect(models.map((model) => model.id)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-flash-vision-exp',
      'deepseek-v4-pro',
    ]);
    expect(models[1]?.description).toBe('多模态 · 视觉实验模型');
  });

  it('reports known multimodal models', () => {
    expect(
      knownModelCatalog('https://api.moonshot.cn/v1', 'zh-CN').map((model) => model.id),
    ).toContain('kimi-k3');
    expect(isKnownMultimodalModel('kimi-k3')).toBe(true);
    expect(isKnownMultimodalModel('deepseek-v4-flash')).toBe(false);
    expect(isKnownMultimodalModel('deepseek-v4-flash-vision-exp')).toBe(true);
  });

  it('keeps recommended Kimi models and removes unknown or retired entries', async () => {
    const http = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: {
          kind: 'response',
          response: {
            body: JSON.stringify({
              data: [
                { id: 'kimi-k2' },
                { id: 'kimi-k2.6' },
                { id: 'kimi-k3' },
                { id: 'kimi-latest' },
                { id: 'moonshot-v1-8k' },
              ],
            }),
            headers: {},
            status: 200,
          },
        },
        url: 'https://api.moonshot.cn/v1/models',
      },
    ]);
    const service = new ModelCatalogService({
      configuration: () => configuration({ baseURL: 'https://api.moonshot.cn/v1', preset: 'kimi' }),
      http,
      secretResolver: new FakeSecretResolver({ chat: OBVIOUSLY_FAKE_SECRET }),
    });

    const models = await service.list('zh-CN');

    expect(models.map((model) => model.id)).toEqual(['kimi-k3', 'kimi-k2.6']);
    expect(models[0]?.description).toContain('推荐');
    expect(models[1]?.description).toContain('通用多模态');
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
