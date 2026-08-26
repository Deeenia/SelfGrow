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
    expect(JSON.parse(http.calls[0]?.body ?? '{}')).not.toHaveProperty('response_format');
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
        multimodal: false,
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
      recommendationIssue: null,
      title: '服务队列架构图',
    });
    expect(http.calls[0]?.body).toContain('不要只做 OCR');
    expect(JSON.parse(http.calls[0]?.body ?? '{}')).toMatchObject({
      max_completion_tokens: 720,
      model: 'kimi-k3',
      reasoning_effort: 'low',
    });
    expect(JSON.parse(http.calls[0]?.body ?? '{}')).not.toHaveProperty('max_tokens');
    expect(JSON.parse(http.calls[0]?.body ?? '{}')).not.toHaveProperty('response_format');
    expect(JSON.parse(http.calls[0]?.body ?? '{}')).not.toHaveProperty('temperature');
  });

  it('normalizes common provider wrappers without discarding valid visual understanding', async () => {
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
                    content: [
                      {
                        text: `识别结果如下：\n${JSON.stringify({
                          category: '项目',
                          preview:
                            '图片展示了一篇讨论森林火灾与地表升温关系的 Nature 论文。页面包含摘要、方法和数据入口。',
                          title: '# 森林火灾与地表升温',
                        })}\n请查收。`,
                        type: 'output_text',
                      },
                    ],
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
        model: 'deepseek-v4-flash-vision-exp',
        multimodal: true,
        preset: 'deepseek',
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
      preview:
        '图片展示了一篇讨论森林火灾与地表升温关系的 Nature 论文；页面包含摘要、方法和数据入口。',
      recommendation: null,
      recommendationIssue: null,
      title: '森林火灾与地表升温',
    });
    expect(http.calls).toHaveLength(1);
  });

  it('retries once with a core-only visual schema when the first response has no valid card', async () => {
    const response = (content: string) => ({
      body: JSON.stringify({ choices: [{ message: { content } }] }),
      headers: {},
      status: 200,
    });
    const http = new FixtureHTTPTransport([
      {
        method: 'POST',
        outcome: [
          { kind: 'response', response: response('图片内容很清楚，但无法按要求输出。') },
          {
            kind: 'response',
            response: response(
              JSON.stringify({
                category: 'Experience',
                preview: '图片展示了论文标题、摘要、作者信息与正文导航。',
                title: '森林火灾与地表升温论文',
              }),
            ),
          },
        ],
        url: 'https://ai.example/v1/chat/completions',
      },
    ]);
    const service = new OpenAIVisionOCRService({
      configuration: () => ({
        baseURL: 'https://ai.example/v1',
        connectionTest: null,
        model: 'deepseek-v4-flash-vision-exp',
        multimodal: true,
        preset: 'deepseek',
        secretName: 'Chat Secret',
      }),
      http,
      images: {
        read: () => Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }),
      },
      secretResolver: new FakeSecretResolver({ 'Chat Secret': 'fixture-secret' }),
    });

    await expect(service.preview(['capture.png'], 'zh-CN')).resolves.toMatchObject({
      category: 'Experience',
      preview: '图片展示了论文标题、摘要、作者信息与正文导航。',
      recommendation: null,
      title: '森林火灾与地表升温论文',
    });
    expect(http.calls).toHaveLength(2);
    expect(http.calls[1]?.body).toContain('不要重新分析图片');
    expect(http.calls[1]?.body).not.toContain('data:image/png');
  });

  it('keeps a useful natural-language visual description without uploading the image again', async () => {
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
                    content:
                      '图片展示了一篇研究森林火灾规模与火后地表升温关系的 Nature 论文。页面可见标题、摘要、作者和章节导航。',
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
        model: 'deepseek-v4-flash-vision-exp',
        multimodal: true,
        preset: 'deepseek',
        secretName: 'Chat Secret',
      }),
      http,
      images: {
        read: () => Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }),
      },
      secretResolver: new FakeSecretResolver({ 'Chat Secret': 'fixture-secret' }),
    });

    await expect(service.preview(['capture.png'], 'zh-CN')).resolves.toEqual({
      category: 'Experience',
      preview:
        '图片展示了一篇研究森林火灾规模与火后地表升温关系的 Nature 论文；页面可见标题、摘要、作者和章节导航。',
      recommendation: null,
      recommendationIssue: null,
      title: '一篇研究森林火灾规模与火后地表升温关系的 Nature 论文',
    });
    expect(http.calls).toHaveLength(1);
  });

  it('scores a pure image against the single merged personal profile', async () => {
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
                    content: `\`\`\`json\n${JSON.stringify({
                      category: 'Project',
                      matchedInterestedKeywords: ['rag'],
                      matchedPreferenceSignals: ['研究流程图示'],
                      matchedUninterestedKeywords: [],
                      preview: '界面展示了检索、重排与回答组成的 RAG 工作流。',
                      recommendationReason: '命中了用户关注的 RAG 关键词，具有直接参考价值。',
                      recommendationScore: 86,
                      title: 'RAG 工作流界面',
                    })}\n\`\`\``,
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
      preferenceProfile: () =>
        Promise.resolve({
          schemaVersion: 1 as const,
          profileVersion: 'vision-profile-v1',
          updatedAt: '2026-08-24T01:00:00Z',
          positiveSignals: [
            {
              description: '用户明确选择，希望相关内容提高推荐度。',
              id: 'manual-interest-rag',
              label: '感兴趣：RAG',
              weight: 8,
            },
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
        matchedInterestedKeywords: [],
        matchedPreferenceSignals: ['研究流程图示'],
        matchedUninterestedKeywords: [],
        profileVersion: 'vision-profile-v1',
        protocolVersion: 'unified-preference-profile-v4',
        score: 86,
      },
      title: 'RAG 工作流界面',
    });
    expect(http.calls[0]?.body).not.toContain('<preference_keywords>');
    expect(http.calls[0]?.body).toContain('<preference_profile>');
    expect(http.calls[0]?.body).not.toContain('visual-workflows');
    expect(JSON.parse(http.calls[0]?.body ?? '{}')).toMatchObject({
      max_tokens: 720,
      response_format: { type: 'json_object' },
    });
  });

  it('scores a pure image from the complete preference profile when keywords are empty', async () => {
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
                      matchedPreferenceSignals: ['视觉与多模态证据'],
                      preview: '图片展示了带有数据来源、处理步骤和验证结果的研究流程图。',
                      recommendationReason: '完整偏好协议重视可检查的视觉证据和研究流程。',
                      recommendationScore: 84,
                      title: '研究数据处理流程',
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
      preferenceProfile: () =>
        Promise.resolve({
          schemaVersion: 1 as const,
          profileVersion: 'vision-profile-only-v1',
          updatedAt: '2026-08-25T01:00:00Z',
          positiveSignals: [
            {
              description: '重视图片中可检查的研究步骤、数据来源和结果边界。',
              id: 'visual-evidence',
              label: '视觉与多模态证据',
              weight: 14,
            },
          ],
          negativeSignals: [],
          sources: [{ project: 'Fixture', summaryHash: 'c'.repeat(64) }],
        }),
      secretResolver: new FakeSecretResolver({ 'Chat Secret': 'fixture-secret' }),
    });

    await expect(service.preview(['capture.png'], 'zh-CN')).resolves.toMatchObject({
      category: 'Project',
      recommendation: {
        matchedInterestedKeywords: [],
        matchedPreferenceSignals: ['视觉与多模态证据'],
        matchedUninterestedKeywords: [],
        profileVersion: 'vision-profile-only-v1',
        protocolVersion: 'unified-preference-profile-v4',
        score: 84,
      },
      recommendationIssue: null,
      title: '研究数据处理流程',
    });
    const body = http.calls[0]?.body ?? '';
    const request = JSON.parse(body) as {
      messages?: Array<{ content?: Array<{ text?: string }> }>;
    };
    const prompt = request.messages?.[0]?.content?.[0]?.text ?? '';
    expect(prompt).not.toContain('<preference_keywords>');
    expect(prompt).toContain('<preference_profile>');
    expect(prompt).toContain('视觉与多模态证据');
    expect(prompt).toContain('重视图片中可检查的研究步骤、数据来源和结果边界。');
    expect(prompt).toContain('"weight":14');
    expect(prompt).not.toContain('visual-evidence');
    expect(prompt).not.toContain('Fixture');
  });

  it('keeps a valid pure-image title, category, and preview when its score is invalid', async () => {
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
                      category: 'Skill',
                      preview: '图片展示了用于复现实验步骤和核对结果的研究工作流。',
                      recommendationReason: '内容符合用户的研究方法偏好。',
                      recommendationScore: 101,
                      title: '实验复现工作流',
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
      preferenceProfile: () =>
        Promise.resolve({
          schemaVersion: 1 as const,
          profileVersion: 'manual-topic-v1',
          updatedAt: '2026-08-25T01:00:00Z',
          positiveSignals: [
            {
              description: '用户明确选择，希望相关内容提高推荐度。',
              id: 'manual-interest-research-methods',
              label: '感兴趣：研究方法',
              weight: 8,
            },
          ],
          negativeSignals: [],
          sources: [],
        }),
      secretResolver: new FakeSecretResolver({ 'Chat Secret': 'fixture-secret' }),
    });

    await expect(service.preview(['capture.png'], 'zh-CN')).resolves.toMatchObject({
      category: 'Skill',
      preview: '图片展示了用于复现实验步骤和核对结果的研究工作流。',
      recommendation: null,
      recommendationIssue: 'invalid_output',
      title: '实验复现工作流',
    });
  });
});
