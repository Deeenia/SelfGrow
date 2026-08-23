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
        multimodal: true,
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
                      category: 'Project',
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
        model: 'kimi-k3',
        multimodal: true,
        preset: 'kimi',
        secretName: 'Chat Secret',
      }),
      http,
      images: {
        read: () => Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }),
      },
      secretResolver: new FakeSecretResolver({ 'Chat Secret': 'fixture-secret' }),
    });

    await expect(service.preview(['capture.png'], 'zh-CN')).resolves.toEqual({
      category: 'Project',
      preview: '图片展示了由服务、队列和数据库组成的系统架构。',
      recommendation: null,
      title: '服务队列架构图',
    });
    expect(http.calls[0]?.body).toContain('不要只做 OCR');
  });

  it('scores a pure image against editable keywords and returns exact matched keywords', async () => {
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
                      category: 'Project',
                      matchedInterestedKeywords: ['rag'],
                      matchedPreferenceSignalIds: ['visual-workflows'],
                      matchedUninterestedKeywords: [],
                      preview: '界面展示了检索、重排与回答组成的 RAG 工作流。',
                      recommendationReason: '命中了用户关注的 RAG 关键词，具有直接参考价值。',
                      recommendationScore: 86,
                      title: 'RAG 工作流界面',
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
        model: 'custom-vision-model',
        multimodal: true,
        preset: 'custom',
        secretName: 'Chat Secret',
      }),
      http,
      images: {
        read: () => Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }),
      },
      preferenceKeywords: () => ({
        interested: ['RAG', '本地优先'],
        uninterested: ['营销炒作'],
      }),
      preferenceProfile: () =>
        Promise.resolve({
          schemaVersion: 1 as const,
          profileVersion: 'vision-profile-v1',
          updatedAt: '2026-08-24T01:00:00Z',
          positiveSignals: [
            {
              description: '偏好能清楚表达研究流程的图示。',
              id: 'visual-workflows',
              label: '研究流程图示',
              weight: 10,
            },
          ],
          negativeSignals: [],
          sources: [{ project: 'Fixture', summaryHash: 'b'.repeat(64) }],
        }),
      secretResolver: new FakeSecretResolver({ 'Chat Secret': 'fixture-secret' }),
    });

    await expect(service.preview(['capture.png'], 'zh-CN')).resolves.toMatchObject({
      category: 'Project',
      recommendation: {
        matchedInterestedKeywords: ['RAG'],
        matchedPreferenceSignals: ['研究流程图示'],
        matchedUninterestedKeywords: [],
        profileVersion: 'vision-profile-v1',
        protocolVersion: 'user-keywords-profile-v2',
        score: 96,
      },
      title: 'RAG 工作流界面',
    });
    expect(http.calls[0]?.body).toContain('<preference_keywords>');
    expect(http.calls[0]?.body).toContain('<preference_profile>');
  });
});
