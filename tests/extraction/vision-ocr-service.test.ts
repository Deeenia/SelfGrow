import { describe, expect, it } from 'vitest';
import { OpenAIVisionOCRService } from '../../src/extraction';
import { FakeSecretResolver, FixtureHTTPTransport } from '../harness';

describe('OpenAIVisionOCRService', () => {
  it('sends bounded image data to the configured AI endpoint and returns only recognized text', async () => {
    const http = new FixtureHTTPTransport([
      {
        method: 'POST',
        outcome: {
          kind: 'response',
          response: {
            body: JSON.stringify({ choices: [{ message: { content: 'OCR 技术文字' } }] }),
            headers: {},
            status: 200,
          },
        },
        url: 'https://ai.example/v1/chat/completions',
      },
    ]);
    const service = new OpenAIVisionOCRService({
      configuration: () => ({
        baseURL: 'https://ai.example/v1',
        connectionTest: null,
        model: 'vision-model',
        preset: 'custom',
        secretName: 'Chat Secret',
      }),
      http,
      images: {
        read: () => Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }),
      },
      secretResolver: new FakeSecretResolver({ 'Chat Secret': 'fixture-secret' }),
    });
    await expect(service.recognize(['capture.png'])).resolves.toBe('OCR 技术文字');
    expect(http.calls[0]?.body).toContain('data:image/png;base64,AQID');
    expect(JSON.stringify(http.calls)).not.toContain('fixture-secret');
  });

  it('returns a bounded one-sentence multimodal preview', async () => {
    const http = new FixtureHTTPTransport([
      {
        method: 'POST',
        outcome: {
          kind: 'response',
          response: {
            body: JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      preview: '图片展示了由服务、队列和数据库组成的系统架构。',
                      title: '服务队列架构图',
                    }),
                  },
                },
              ],
            }),
            headers: {},
            status: 200,
          },
        },
        url: 'https://ai.example/v1/chat/completions',
      },
    ]);
    const service = new OpenAIVisionOCRService({
      configuration: () => ({
        baseURL: 'https://ai.example/v1',
        connectionTest: null,
        model: 'vision-model',
        preset: 'custom',
        secretName: 'Chat Secret',
      }),
      http,
      images: {
        read: () => Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }),
      },
      secretResolver: new FakeSecretResolver({ 'Chat Secret': 'fixture-secret' }),
    });

    await expect(service.preview(['capture.png'], 'zh-CN')).resolves.toEqual({
      preview: '图片展示了由服务、队列和数据库组成的系统架构。',
      title: '服务队列架构图',
    });
    expect(http.calls[0]?.body).toContain('不要只做 OCR');
  });
});
