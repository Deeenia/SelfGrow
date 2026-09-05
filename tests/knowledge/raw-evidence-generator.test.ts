import { describe, expect, it } from 'vitest';
import { SelfGrowError, vaultPath } from '../../src/domain';
import type { ExtractedContent } from '../../src/extraction';
import {
  parseKnowledgeNoteContent,
  RawEvidenceGenerator,
  serializeKnowledgeNoteContent,
} from '../../src/knowledge';
import { FakeSecretResolver, FixtureHTTPTransport } from '../harness';
import type { EndpointSettings, PreferenceProfile } from '../../src/settings';

const CONTENT: ExtractedContent = {
  body: '## First\n\nComplete source body.\n\n## Second\n\nMore evidence.',
  bodyKind: 'article',
  finalURL: 'https://example.com/article',
  platform: 'generic_web',
  route: 'local_article',
  title: 'Fixture source',
};

function chatRoute(
  ...contents: readonly string[]
): ConstructorParameters<typeof FixtureHTTPTransport>[0][number] {
  const outcomes = contents.map((content) => ({
    kind: 'response' as const,
    response: {
      body: JSON.stringify({ choices: [{ message: { content: withRecommendation(content) } }] }),
      headers: {},
      status: 200,
    },
  }));
  return {
    method: 'POST',
    outcome: outcomes.length === 1 ? (outcomes[0] as (typeof outcomes)[number]) : outcomes,
    url: 'https://api.example.com/v1/chat/completions',
  };
}

function withRecommendation(content: string): string {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return JSON.stringify({
      matchedPreferenceSignals: ['可复现证据'],
      recommendationReason: '符合可复用、可验证和实际工程价值偏好。',
      recommendationScore: 82,
      ...parsed,
    });
  } catch {
    return content;
  }
}

function generator(
  http: FixtureHTTPTransport,
  preferenceProfile: PreferenceProfile | null = PREFERENCE_PROFILE,
  configuration: Partial<EndpointSettings> = {},
): RawEvidenceGenerator {
  return new RawEvidenceGenerator({
    configuration: () => ({
      baseURL: 'https://api.example.com/v1',
      connectionTest: null,
      model: 'fixture-model',
      multimodal: false,
      preset: 'custom',
      secretName: 'Chat Secret',
      ...configuration,
    }),
    http,
    preferenceProfile: () => Promise.resolve(preferenceProfile),
    secretResolver: new FakeSecretResolver({ 'Chat Secret': 'fixture-secret' }),
  });
}

const PREFERENCE_PROFILE: PreferenceProfile = {
  schemaVersion: 1,
  profileVersion: 'profile-v1',
  updatedAt: '2026-08-24T01:00:00Z',
  positiveSignals: [
    {
      description: '包含可以重复验证的数据、代码或步骤。',
      id: 'reproducible-evidence',
      label: '可复现证据',
      weight: 12,
    },
  ],
  negativeSignals: [],
  sources: [{ project: 'Private fixture', summaryHash: 'a'.repeat(64) }],
};

describe('RawEvidenceGenerator', () => {
  it('summarizes an authorized academic document into ordered technical sections', async () => {
    const http = new FixtureHTTPTransport([
      chatRoute(
        JSON.stringify({
          category: 'Experience',
          githubQueries: [],
          preview: '研究分析全球植物菌根性状的环境调节机制，并比较气候与土壤因素对不同性状的影响。',
          title: '全球植物菌根性状研究',
        }),
        JSON.stringify({
          sections: [
            {
              details: '研究检验全球尺度环境条件如何调节植物菌根类型与依赖状态。',
              title: '研究问题',
            },
            {
              details: '研究整合物种分布、系统发育、气候与土壤数据，并建立比较模型。',
              title: '数据与方法',
            },
            {
              details: '结果揭示不同环境因子对菌根性状具有差异化影响，并说明解释边界。',
              title: '结果与限制',
            },
          ],
        }),
      ),
    ]);

    const result = await generator(http, null).generate(
      {
        ...CONTENT,
        documentKind: 'academic_paper',
        route: 'local_document',
      },
      'zh-CN',
    );

    expect(result.coreKnowledge.map((section) => section.title)).toEqual([
      '研究问题',
      '数据与方法',
      '结果与限制',
    ]);
    expect(result.coreKnowledge[0]?.explanationMarkdown).not.toBe(CONTENT.body);
    expect(http.calls).toHaveLength(2);
  });

  it('prepares a local preview and preserves the complete Markdown body without AI', async () => {
    const result = await new RawEvidenceGenerator().generate(CONTENT, 'en');

    expect(result).toMatchObject({
      category: 'Experience',
      coreKnowledge: [{ title: 'Extracted text' }],
      githubQueries: [],
      outputLanguage: 'en',
      recommendation: null,
      recognitionSource: 'local',
      title: 'Fixture source',
    });
    expect(result.summaryMarkdown).toBe('First Complete source body. Second More evidence.');
    expect(result.coreKnowledge[0]?.explanationMarkdown).toBe(CONTENT.body);
    const markdown = serializeKnowledgeNoteContent({
      ...result,
      attachmentPaths: [vaultPath('SelfGrow/Attachments/report.pdf')],
      imagePaths: [],
      personalNoteMarkdown: '',
      sourceURL: CONTENT.finalURL,
    });
    expect(parseKnowledgeNoteContent(markdown, 'en').coreKnowledge).toEqual(result.coreKnowledge);
    expect(parseKnowledgeNoteContent(markdown, 'en')).toMatchObject({
      attachmentPaths: ['SelfGrow/Attachments/report.pdf'],
      imagePaths: [],
    });
  });

  it.each([
    '服务队列架构图',
    'FIT5122 Professional Practice 专业实践：安全更新与系统稳定性的决策边界',
  ])('preserves the validated visual title without a second cut: %s', async (title) => {
    const result = await new RawEvidenceGenerator().generate(
      {
        ...CONTENT,
        body: '图片展示了由服务、队列和数据库组成的系统架构。',
        route: 'visual_preview',
        sourceLanguage: 'zh-CN',
        title,
        visualRecognition: {
          category: 'Project',
          recommendation: {
            matchedInterestedKeywords: ['系统架构'],
            matchedUninterestedKeywords: [],
            protocolVersion: 'user-keywords-profile-v2',
            reason: '图片命中了系统架构关键词。',
            score: 84,
          },
          source: 'ai',
        },
      },
      'zh-CN',
    );

    expect(result).toMatchObject({
      category: 'Project',
      coreKnowledge: [{ title: '视觉边界' }],
      recognitionSource: 'ai',
      recommendation: {
        matchedInterestedKeywords: ['系统架构'],
        score: 84,
      },
      summaryMarkdown: '图片展示了由服务、队列和数据库组成的系统架构。',
      title,
    });
  });

  it('does not require AI recognition for a video transcript', async () => {
    const http = new FixtureHTTPTransport([]);
    const result = await generator(http).generate(
      { ...CONTENT, bodyKind: 'transcript', platform: 'youtube' },
      'zh-CN',
    );

    expect(result.recognitionSource).toBe('local');
    expect(http.calls).toHaveLength(0);
  });

  it('does not use license or author notices as the local selection preview', async () => {
    const result = await new RawEvidenceGenerator().generate(
      {
        ...CONTENT,
        body: [
          '# Example Skill',
          '',
          '> Free for personal, educational and non-commercial use.',
          '',
          'This skill turns a source photo into a restrained editorial composition with a memory panel.',
          '',
          '<!-- author contact and donation details -->',
        ].join('\n'),
        title: 'Example Skill',
      },
      'en',
    );

    expect(result.summaryMarkdown).toContain(
      'turns a source photo into a restrained editorial composition',
    );
    expect(result.summaryMarkdown).not.toMatch(/commercial|license|author|donation/i);
  });

  it('preserves headings, lists, code, tables, links and images without a giant blockquote', async () => {
    const body = [
      '# 原文标题',
      '',
      '## 二级标题',
      '',
      '- 列表项一',
      '  - 嵌套项',
      '1. 有序项',
      '',
      '> 引用内容',
      '',
      '**粗体** 和 *斜体*，行内 `code`。',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '| 列A | 列B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '[链接](https://example.com) ![图片](https://example.com/a.png)',
      '',
      '段落与空行。',
    ].join('\n');
    const result = await new RawEvidenceGenerator().generate(
      { ...CONTENT, body, sourceLanguage: 'zh-CN' },
      'zh-CN',
    );

    const explanation = result.coreKnowledge[0]?.explanationMarkdown ?? '';
    expect(explanation).toContain('# 原文标题');
    expect(explanation).toContain('## 二级标题');
    expect(explanation).toContain('- 列表项一\n  - 嵌套项');
    expect(explanation).toContain('```ts\nconst x = 1;\n```');
    expect(explanation).toContain('| 列A | 列B |');
    expect(explanation).toContain('> 引用内容');
    expect(explanation).toContain('[链接](https://example.com)');
    expect(explanation.startsWith('> ')).toBe(false);
    expect(explanation).toBe(body);
  });

  it('normalizes GitHub material even when a generic extractor omitted GitHub metadata', async () => {
    const result = await new RawEvidenceGenerator().generate(
      {
        ...CONTENT,
        body: [
          '# Tool',
          '',
          '<img src="https://raw.githubusercontent.com/acme/tool/main/main/assets/case.jpg" alt="Case">',
          '',
          '<!--',
          'hidden footer source',
          '-->',
          '',
          'Visible explanation with enough useful evidence for a Raw card.',
        ].join('\n'),
        finalURL: 'https://github.com/acme/tool',
      },
      'en',
    );

    const body = result.coreKnowledge[0]?.explanationMarkdown ?? '';
    expect(body).toContain(
      '![Case](https://raw.githubusercontent.com/acme/tool/main/assets/case.jpg)',
    );
    expect(body).not.toContain('main/main');
    expect(body).not.toContain('hidden footer source');
  });

  it('turns a repeated platform description into a topic title and non-repeating preview', async () => {
    const body =
      '这篇图文提出了一套旨在降低AI使用成本的智能体进化方案。该方案的核心是让一个智能体通过循环学习，从海量知识库中构建、使用并删除技能，从而用更小的算力完成更多任务。方案运行逻辑通过一个闭环流程实现。第三句不应进入预览。';
    const result = await new RawEvidenceGenerator().generate(
      {
        ...CONTENT,
        body,
        sourceLanguage: 'zh-CN',
        title: body,
      },
      'zh-CN',
    );

    expect(result.title).toBe('降低AI使用成本的智能体进化方案');
    expect(result.summaryMarkdown).toBe(
      '该方案的核心是让一个智能体通过循环学习，从海量知识库中构建、使用并删除技能，从而用更小的算力完成更多任务。方案运行逻辑通过一个闭环流程实现。',
    );
    expect(result.summaryMarkdown).not.toContain('这篇图文');
    expect(result.coreKnowledge[0]?.explanationMarkdown).toContain(body);
  });

  it('uses one bounded AI call for a valid recognition card with category and queries', async () => {
    const http = new FixtureHTTPTransport([
      chatRoute(
        JSON.stringify({
          category: 'Skill',
          githubQueries: ['Learn Harness Engineering'],
          preview:
            '课程通过任务规范、上下文供给、执行环境和验证反馈，为 AI Agent 建立可验证的工程闭环。',
          title: 'Harness Engineering 工程课程',
        }),
      ),
    ]);
    const result = await generator(http).generate(CONTENT, 'zh-CN');

    expect(result).toMatchObject({
      category: 'Skill',
      githubQueries: ['Learn Harness Engineering'],
      recommendation: {
        matchedInterestedKeywords: [],
        matchedPreferenceSignals: ['可复现证据'],
        matchedUninterestedKeywords: [],
        protocolVersion: 'unified-preference-profile-v4',
        reason: '符合可复用、可验证和实际工程价值偏好。',
        score: 82,
      },
      recognitionSource: 'ai',
      summaryMarkdown:
        '课程通过任务规范、上下文供给、执行环境和验证反馈，为 AI Agent 建立可验证的工程闭环。',
      title: 'Harness Engineering 工程课程',
    });
    expect(http.calls).toHaveLength(1);
    const request = JSON.parse(http.calls[0]?.body ?? '{}') as {
      max_tokens?: number;
      messages?: Array<{ content?: string }>;
    };
    expect(request.max_tokens).toBe(2048);
    expect(http.calls[0]?.timeoutMs).toBe(60_000);
    expect(request.messages?.[0]?.content).toContain(CONTENT.body);
    expect(request.messages?.[0]?.content).toContain('preference_profile');
    expect(request.messages?.[0]?.content).not.toContain('preference_keywords');
  });

  it('uses provider-compatible Kimi request fields', async () => {
    const http = new FixtureHTTPTransport([
      chatRoute(
        JSON.stringify({
          category: 'Project',
          githubQueries: [],
          preview: '提供可验证的工程实践，并说明适用范围与限制条件。',
          title: '工程实践',
        }),
      ),
    ]);

    await generator(http, PREFERENCE_PROFILE, {
      model: 'kimi-k3',
      preset: 'kimi',
    }).generate(CONTENT, 'zh-CN');

    const request = JSON.parse(http.calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(request).toMatchObject({
      max_completion_tokens: 2_048,
      model: 'kimi-k3',
      reasoning_effort: 'low',
      response_format: { type: 'json_object' },
    });
    expect(request).not.toHaveProperty('max_tokens');
    expect(request).not.toHaveProperty('temperature');
  });

  it('disables DeepSeek thinking for structured card output', async () => {
    const http = new FixtureHTTPTransport([
      chatRoute(
        JSON.stringify({
          category: 'Project',
          githubQueries: [],
          preview: '提供可验证的工程实践，并说明适用范围与限制条件。',
          title: '工程实践',
        }),
      ),
    ]);

    await generator(http, PREFERENCE_PROFILE, {
      model: 'deepseek-v4-pro',
      preset: 'deepseek',
    }).generate(CONTENT, 'zh-CN');

    const request = JSON.parse(http.calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(request).toMatchObject({
      max_tokens: 2_048,
      model: 'deepseek-v4-pro',
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
    });
  });

  it('accepts a multiword English project name in a Chinese DeepSeek card', async () => {
    const http = new FixtureHTTPTransport([
      chatRoute(
        JSON.stringify({
          category: 'Project',
          githubQueries: ['earendil-works/pi'],
          preview:
            '提供可扩展的编码代理运行时、多模型接口与命令行工具，并支持工具调用、状态管理和容器化隔离。',
          title: 'Pi Agent Harness',
        }),
      ),
    ]);

    const result = await generator(http, null, {
      model: 'deepseek-v4-flash',
      preset: 'deepseek',
    }).generate(CONTENT, 'zh-CN');

    expect(result).toMatchObject({
      recognitionSource: 'ai',
      title: 'Pi Agent Harness',
    });
    expect(http.calls).toHaveLength(1);
  });

  it('lets the model score the complete natural-language profile without sending IDs or source records', async () => {
    const http = new FixtureHTTPTransport([
      chatRoute(
        JSON.stringify({
          category: 'Skill',
          githubQueries: [],
          matchedPreferenceSignals: ['可复现证据'],
          preview: '方法提供可重复执行的数据步骤，并保留可检查的验证边界。',
          recommendationReason: '完整协议将可复现证据列为高权重正向偏好。',
          recommendationScore: 91,
          title: '可复现研究方法',
        }),
      ),
    ]);
    const result = await generator(http, PREFERENCE_PROFILE).generate(CONTENT, 'zh-CN');

    expect(result.recommendation).toMatchObject({
      matchedPreferenceSignals: ['可复现证据'],
      profileVersion: 'profile-v1',
      protocolVersion: 'unified-preference-profile-v4',
      score: 91,
    });
    const body = http.calls[0]?.body ?? '';
    const request = JSON.parse(body) as { messages?: Array<{ content?: string }> };
    const prompt = request.messages?.[0]?.content ?? '';
    expect(prompt).toContain('<preference_profile>');
    expect(prompt).toContain('可复现证据');
    expect(prompt).toContain('包含可以重复验证的数据、代码或步骤。');
    expect(prompt).toContain('"weight":12');
    expect(prompt).not.toContain('reproducible-evidence');
    expect(prompt).not.toContain('Private fixture');
  });

  it('accepts one complete fenced JSON card with the unified profile active', async () => {
    const content = `\`\`\`json\n${JSON.stringify({
      category: 'Project',
      githubQueries: [],
      matchedPreferenceSignals: ['可复现证据'],
      preview: '提供可复现的数据处理步骤，并明确说明验证边界与适用范围。',
      recommendationReason: '内容直接符合协议中的可复现证据偏好。',
      recommendationScore: 87,
      title: '可复现数据流程',
    })}\n\`\`\``;
    const http = new FixtureHTTPTransport([
      {
        method: 'POST',
        outcome: {
          kind: 'response',
          response: {
            body: JSON.stringify({ choices: [{ message: { content } }] }),
            headers: {},
            status: 200,
          },
        },
        url: 'https://api.example.com/v1/chat/completions',
      },
    ]);

    await expect(generator(http).generate(CONTENT, 'zh-CN')).resolves.toMatchObject({
      recommendation: { score: 87 },
      recognitionSource: 'ai',
      title: '可复现数据流程',
    });
  });

  it('does not use legacy internal signal IDs as a recommendation validity gate', async () => {
    const invalid = JSON.stringify({
      category: 'Project',
      githubQueries: [],
      matchedInterestedKeywords: ['可复用'],
      matchedPreferenceSignals: [],
      matchedPreferenceSignalIds: ['invented-signal'],
      matchedUninterestedKeywords: [],
      preview: '提供一条足够长且不重复标题的工程实践筛选理由。',
      recommendationReason: '内容声称命中了个人协议，但该信号没有获得批准。',
      recommendationScore: 80,
      title: '工程实践',
    });
    const http = new FixtureHTTPTransport([chatRoute(invalid)]);
    const result = await generator(http, PREFERENCE_PROFILE).generate(CONTENT, 'zh-CN');

    expect(result).toMatchObject({
      recommendation: {
        matchedPreferenceSignals: [],
        profileVersion: 'profile-v1',
        score: 80,
      },
      recommendationIssue: null,
      summaryMarkdown: '提供一条足够长且不重复标题的工程实践筛选理由。',
      title: '工程实践',
    });
    expect(http.calls).toHaveLength(1);
  });

  it('scores from the single enabled personal profile', async () => {
    const http = new FixtureHTTPTransport([
      chatRoute(
        JSON.stringify({
          category: 'Project',
          githubQueries: [],
          matchedInterestedKeywords: undefined,
          matchedPreferenceSignals: ['可复现证据'],
          matchedUninterestedKeywords: undefined,
          preview: '提供可重复验证的研究步骤，并明确记录适用范围和证据边界。',
          recommendationReason: '完整偏好协议将可复现和证据边界列为正向标准。',
          recommendationScore: 88,
          title: '可复现研究流程',
        }),
      ),
    ]);
    const configured = new RawEvidenceGenerator({
      configuration: () => ({
        baseURL: 'https://api.example.com/v1',
        connectionTest: null,
        model: 'fixture-model',
        multimodal: false,
        preset: 'custom',
        secretName: 'Chat Secret',
      }),
      http,
      preferenceProfile: () => Promise.resolve(PREFERENCE_PROFILE),
      secretResolver: new FakeSecretResolver({ 'Chat Secret': 'fixture-secret' }),
    });

    const result = await configured.generate(CONTENT, 'zh-CN');
    expect(result.recommendation).toMatchObject({
      matchedInterestedKeywords: [],
      matchedPreferenceSignals: ['可复现证据'],
      matchedUninterestedKeywords: [],
      profileVersion: 'profile-v1',
      score: 88,
    });
    expect(http.calls[0]?.body).not.toContain('<preference_keywords>');
    expect(http.calls[0]?.body).toContain('<preference_profile>');
  });

  it('accepts a concise one-sentence Chinese AI preview', async () => {
    const http = new FixtureHTTPTransport([
      chatRoute(
        JSON.stringify({
          category: 'Project',
          githubQueries: [],
          preview: '聚焦前沿AI安全研究，并将风险治理落实到模型与产品开发中。',
          title: 'Anthropic AI安全研究',
        }),
      ),
    ]);

    const result = await generator(http).generate(CONTENT, 'zh-CN');

    expect(result).toMatchObject({
      recognitionSource: 'ai',
      summaryMarkdown: '聚焦前沿AI安全研究，并将风险治理落实到模型与产品开发中。',
      title: 'Anthropic AI安全研究',
    });
  });

  it('accepts wrapped JSON from provider text content parts', async () => {
    const content = JSON.stringify({
      category: 'Project',
      githubQueries: [],
      matchedPreferenceSignals: ['可复现证据'],
      preview: '提供可重复验证的工程步骤，并明确记录适用范围和证据边界。',
      recommendationReason: '完整偏好协议将可复现和证据边界列为正向标准。',
      recommendationScore: 88,
      title: '可复现工程流程',
    });
    const http = new FixtureHTTPTransport([
      {
        method: 'POST',
        outcome: {
          kind: 'response',
          response: {
            body: JSON.stringify({
              choices: [
                { message: { content: [{ text: `识别结果如下：\n${content}`, type: 'text' }] } },
              ],
            }),
            headers: {},
            status: 200,
          },
        },
        url: 'https://api.example.com/v1/chat/completions',
      },
    ]);

    await expect(generator(http).generate(CONTENT, 'zh-CN')).resolves.toMatchObject({
      recognitionSource: 'ai',
      recommendation: { score: 88 },
      summaryMarkdown: '提供可重复验证的工程步骤，并明确记录适用范围和证据边界。',
      title: '可复现工程流程',
    });
    expect(http.calls).toHaveLength(1);
  });

  it('uses reasoning content when a compatible provider leaves content empty', async () => {
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
                    content: '',
                    reasoning_content: JSON.stringify({
                      category: 'Experience',
                      githubQueries: [],
                      preview: '总结可复用的实践步骤，并说明验证方式与适用边界。',
                      title: '工程复盘方法',
                    }),
                  },
                },
              ],
            }),
            headers: {},
            status: 200,
          },
        },
        url: 'https://api.example.com/v1/chat/completions',
      },
    ]);

    await expect(generator(http, null).generate(CONTENT, 'zh-CN')).resolves.toMatchObject({
      recognitionSource: 'ai',
      summaryMarkdown: '总结可复用的实践步骤，并说明验证方式与适用边界。',
      title: '工程复盘方法',
    });
    expect(http.calls).toHaveLength(1);
  });

  it.each([
    {
      title: 'FIT5122 Professional Practice: Update Paradox &',
      preview: 'Monash University slide asking questions ab',
    },
    { title: '更新悖论', preview: '课程讨论安全更新与系统稳定之间的取舍。还需要进一步考虑' },
    { title: '更新悖论', preview: '课程讨论安全更新与系统稳定之间的取舍，并提出若干思考…' },
  ])('repairs an invalid core card and then scores it: $preview', async (invalid) => {
    const http = new FixtureHTTPTransport([
      chatRoute(
        JSON.stringify({
          category: 'Experience',
          githubQueries: [],
          ...invalid,
        }),
        JSON.stringify({
          category: 'Experience',
          githubQueries: [],
          preview: '课程讨论安全更新与系统稳定之间的取舍，并引导学生分析更新悖论。',
          title: 'FIT5122 专业实践：更新悖论',
        }),
        JSON.stringify({
          recommendationScore: 86,
          recommendationReason: '工程决策的验证边界符合用户协议中的实践偏好。',
        }),
      ),
    ]);

    await expect(generator(http).generate(CONTENT, 'zh-CN')).resolves.toMatchObject({
      recognitionSource: 'ai',
      summaryMarkdown: '课程讨论安全更新与系统稳定之间的取舍，并引导学生分析更新悖论。',
      title: 'FIT5122 专业实践：更新悖论',
      recommendation: { score: 86 },
    });
    expect(http.calls).toHaveLength(3);
    expect(http.calls[2]?.body).toContain('<preference_profile>');
  });

  it('repairs a Qwen long-English fallback from the actual invalid output', async () => {
    const article: ExtractedContent = {
      body: 'Evidence of dispersal limitation in soil microorganisms: Isolation reduces species richness on mycorrhizal tree islands\n\nPEAY, MATTEO GARBELOTTO, AND THOMAS D. BRUNS\n\nDepartment of Environmental Science, Policy and Management, University of California.\n\nDispersal limitation plays an important role in community ecology. The study uses tree islands to test ectomycorrhizal fungal richness across increasing isolation distances.',
      bodyKind: 'article',
      finalURL: 'selfgrow:text:english-paper',
      platform: 'unknown',
      route: 'captured_text',
    };
    const invalid = JSON.stringify({
      category: 'Research',
      githubQueries: [],
      preview:
        'PEAY, MATTEO GARBELOTTO, AND THOMAS D. BRUNS, Department of Environmental Science, Policy and Management.',
      title: 'Evidence of dispersal limitation in soil microorganisms',
    });
    const repaired = JSON.stringify({
      category: 'Experience',
      githubQueries: [],
      preview:
        '研究利用菌根树岛的隔离梯度检验外生菌根真菌物种丰富度，说明扩散限制会显著影响群落组装。',
      title: '菌根树岛微生物扩散限制研究',
    });
    const http = new FixtureHTTPTransport([chatRoute(invalid, repaired)]);

    const result = await generator(http, null, {
      model: 'qwen3.7-flash',
      preset: 'qwen',
    }).generate(article, 'zh-CN');

    expect(result).toMatchObject({
      category: 'Experience',
      recognitionSource: 'ai',
      summaryMarkdown:
        '研究利用菌根树岛的隔离梯度检验外生菌根真菌物种丰富度，说明扩散限制会显著影响群落组装。',
      title: '菌根树岛微生物扩散限制研究',
    });
    expect(http.calls).toHaveLength(2);
    const firstRequest = JSON.parse(http.calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(firstRequest).toMatchObject({
      enable_thinking: false,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
    });
    expect(http.calls[1]?.body).toContain('<invalid_card>');
    expect(http.calls[1]?.body).toContain('PEAY, MATTEO GARBELOTTO');
    expect(http.calls[1]?.body).toContain('<source>');
  });

  it('uses strict JSON Schema only for a Qwen model that supports it', async () => {
    const http = new FixtureHTTPTransport([
      chatRoute(
        JSON.stringify({
          category: 'Experience',
          githubQueries: [],
          preview: '材料总结了一个可验证的工程方法，并清楚说明了实施步骤、适用范围和主要限制。',
          title: '可验证工程方法',
        }),
      ),
    ]);

    await generator(http, null, {
      model: 'qwen3.8-flash',
      preset: 'qwen',
    }).generate(CONTENT, 'zh-CN');

    const request = JSON.parse(http.calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(request).toMatchObject({
      response_format: {
        json_schema: { name: 'selfgrow_raw_card', strict: true },
        type: 'json_schema',
      },
    });
    expect(request).not.toHaveProperty('max_tokens');
  });

  it.each([
    {
      label: 'a content block without type',
      shape: (card: Record<string, unknown>) => [{ text: JSON.stringify(card) }],
    },
    {
      label: 'an already parsed JSON object',
      shape: (card: Record<string, unknown>) => card,
    },
  ])('accepts Qwen structured output returned as $label', async ({ shape }) => {
    const card = {
      category: 'Experience',
      githubQueries: [],
      matchedPreferenceSignals: ['可复现证据'],
      preview: '研究利用菌根树岛的隔离梯度检验真菌物种丰富度，说明扩散限制会影响群落组装。',
      recommendationReason: '研究包含可重复检验的生态学证据，符合可复现偏好。',
      recommendationScore: 88,
      title: '菌根树岛微生物扩散限制研究',
    };
    const http = new FixtureHTTPTransport([
      {
        method: 'POST',
        outcome: {
          kind: 'response',
          response: {
            body: JSON.stringify({ choices: [{ message: { content: shape(card) } }] }),
            headers: {},
            status: 200,
          },
        },
        url: 'https://api.example.com/v1/chat/completions',
      },
    ]);

    await expect(
      generator(http, PREFERENCE_PROFILE, {
        model: 'qwen3.7-flash',
        preset: 'qwen',
      }).generate(CONTENT, 'zh-CN'),
    ).resolves.toMatchObject({
      recognitionSource: 'ai',
      recommendation: { score: 88 },
      title: '菌根树岛微生物扩散限制研究',
    });
    expect(http.calls).toHaveLength(1);
  });

  it('falls back locally when both the full card and core-only repair are invalid', async () => {
    const http = new FixtureHTTPTransport([
      chatRoute(
        JSON.stringify({
          category: 'Project',
          preview: 'Fixture source 是一份值得保留的资料。',
          title: 'Fixture source',
        }),
        JSON.stringify({
          category: 'Project',
          preview: 'Fixture source remains a preview that only restates the title.',
          title: 'Fixture source',
        }),
      ),
    ]);
    await expect(generator(http).generate(CONTENT, 'en')).resolves.toMatchObject({
      recognitionSource: 'local',
      recommendation: null,
    });
    expect(http.calls).toHaveLength(2);
  });

  it('keeps a valid core card when the recommendation score is out of range', async () => {
    const invalid = JSON.stringify({
      category: 'Project',
      githubQueries: [],
      preview: '提供可验证的工程实践，并说明适用范围与限制条件。',
      recommendationReason: '与协议中的可验证工程偏好一致。',
      recommendationScore: 101,
      matchedInterestedKeywords: ['可复用'],
      matchedUninterestedKeywords: [],
      title: '工程实践',
    });
    const repairedRecommendation = JSON.stringify({
      matchedPreferenceSignals: ['可复现证据'],
      recommendationReason: '内容提供可验证的工程实践，符合个人协议中的高权重偏好。',
      recommendationScore: 86,
    });
    const http = new FixtureHTTPTransport([chatRoute(invalid, repairedRecommendation)]);
    const result = await generator(http).generate(CONTENT, 'zh-CN');

    expect(result).toMatchObject({
      category: 'Project',
      recommendation: { matchedPreferenceSignals: ['可复现证据'], score: 86 },
      recommendationIssue: null,
      summaryMarkdown: '提供可验证的工程实践，并说明适用范围与限制条件。',
      title: '工程实践',
    });
    expect(http.calls).toHaveLength(2);
  });

  it.each([
    { forcedThinking: false, model: 'kimi-k2.6', thinking: { type: 'disabled' } },
    { forcedThinking: true, model: 'kimi-k2.7-code', thinking: undefined },
    { forcedThinking: true, model: 'kimi-k2.7-code-highspeed', thinking: undefined },
  ])(
    'repairs an omitted recommendation for $model without replacing the core card',
    async ({ forcedThinking, model, thinking }) => {
      const http = new FixtureHTTPTransport([
        chatRoute(
          JSON.stringify({
            category: 'Project',
            githubQueries: [],
            preview: '核心卡片已经成功生成，并保留这份来源的用途和实际价值。',
            recommendationReason: null,
            recommendationScore: null,
            title: 'Kimi 核心卡片',
          }),
          JSON.stringify({
            matchedPreferenceSignals: ['可复现证据'],
            recommendationReason: '内容提供可复现的证据路径，符合个人偏好协议中的正向标准。',
            recommendationScore: 84,
          }),
        ),
      ]);

      const result = await generator(http, PREFERENCE_PROFILE, {
        model,
        preset: 'kimi',
      }).generate(CONTENT, 'zh-CN');

      expect(result).toMatchObject({
        recommendation: {
          matchedPreferenceSignals: ['可复现证据'],
          reason: '内容提供可复现的证据路径，符合个人偏好协议中的正向标准。',
          score: 84,
        },
        recommendationIssue: null,
        summaryMarkdown: '核心卡片已经成功生成，并保留这份来源的用途和实际价值。',
        title: 'Kimi 核心卡片',
      });
      expect(http.calls).toHaveLength(2);
      const repairBody = JSON.parse(http.calls[1]?.body ?? '{}') as Record<string, unknown>;
      expect(repairBody).toMatchObject(
        forcedThinking
          ? {
              model,
              response_format: {
                json_schema: { name: 'selfgrow_recommendation', strict: true },
                type: 'json_schema',
              },
            }
          : {
              max_completion_tokens: 2_048,
              model,
              response_format: { type: 'json_object' },
            },
      );
      if (forcedThinking) {
        expect(repairBody).not.toHaveProperty('max_completion_tokens');
        expect(repairBody).not.toHaveProperty('max_tokens');
      }
      if (thinking === undefined) expect(repairBody).not.toHaveProperty('thinking');
      else expect(repairBody).toMatchObject({ thinking });
      expect(repairBody).not.toHaveProperty('reasoning_effort');
      expect(http.calls[1]?.body).toContain('<source>');
      expect(http.calls[1]?.body).toContain('推荐字段未通过校验');
      expect(http.calls[1]?.timeoutMs).toBe(forcedThinking ? 180_000 : 60_000);
    },
  );

  it('reports a Kimi K2.7 model timeout instead of a network wait', async () => {
    const http = {
      request: () =>
        Promise.reject(
          new SelfGrowError('NETWORK_UNAVAILABLE', 'The HTTP request timed out.', {
            reason: 'timeout',
          }),
        ),
    };

    await expect(
      generator(http as unknown as FixtureHTTPTransport, null, {
        model: 'kimi-k2.7-code',
        preset: 'kimi',
      }).generate(CONTENT, 'zh-CN'),
    ).rejects.toMatchObject({
      code: 'AI_REQUEST_TIMEOUT',
      diagnostics: { model: 'kimi-k2.7-code', reason: 'model_timeout' },
    });
  });

  it('normalizes a numeric string score and multiline recommendation reason', async () => {
    const http = new FixtureHTTPTransport([
      chatRoute(
        JSON.stringify({
          category: 'Project',
          githubQueries: [],
          preview: '提供可验证的工程实践，并说明适用范围与限制条件。',
          recommendationReason: '内容符合可复现证据偏好。\n同时具有实际工程价值。',
          recommendationScore: '86',
          title: '工程实践',
        }),
      ),
    ]);

    const result = await generator(http).generate(CONTENT, 'zh-CN');

    expect(result).toMatchObject({
      recommendation: {
        reason: '内容符合可复现证据偏好。 同时具有实际工程价值。',
        score: 86,
      },
      recommendationIssue: null,
    });
    expect(http.calls).toHaveLength(1);
  });

  it('drops unknown profile labels without discarding a valid score or core card', async () => {
    const invalid = JSON.stringify({
      category: 'Project',
      githubQueries: [],
      matchedPreferenceSignals: ['模型声称的额外偏好'],
      preview: '提供一条足够长且不重复标题的工程实践筛选理由。',
      recommendationReason: '内容具有工程价值，但命中了并不存在的用户关键词。',
      recommendationScore: 80,
      title: '工程实践',
    });
    const http = new FixtureHTTPTransport([chatRoute(invalid)]);
    const result = await generator(http).generate(CONTENT, 'zh-CN');

    expect(result).toMatchObject({
      recommendation: {
        matchedInterestedKeywords: [],
        matchedPreferenceSignals: [],
        matchedUninterestedKeywords: [],
        score: 80,
      },
      recommendationIssue: null,
      title: '工程实践',
    });
    expect(http.calls).toHaveLength(1);
  });

  it('rejects a cliché title and uses the repaired card', async () => {
    const http = new FixtureHTTPTransport([
      chatRoute(
        JSON.stringify({
          category: 'Project',
          preview: '这是一句符合要求的筛选理由，说明该工具值得保留的原因。',
          title: '这篇文章介绍了OpenHands',
        }),
        JSON.stringify({
          category: 'Project',
          githubQueries: ['OpenHands'],
          preview:
            '提供可扩展的软件开发 Agent 运行环境，覆盖代码修改、命令执行与任务验证的完整闭环流程。',
          title: 'OpenHands',
        }),
        'Recommendation still unavailable',
      ),
    ]);
    const result = await generator(http).generate(CONTENT, 'zh-CN');
    expect(result.title).toBe('OpenHands');
    expect(result.category).toBe('Project');
    expect(result.recommendation).toBeNull();
    expect(result.recommendationIssue).toBe('invalid_output');
    expect(http.calls).toHaveLength(3);
    expect(http.calls[1]?.body).not.toContain('<preference_profile>');
  });

  it('falls back to a deterministic local card when AI is not configured', async () => {
    const result = await new RawEvidenceGenerator().recognizeRaw(
      'Complete source body with a useful method for everyone to follow.',
      'en',
    );
    expect(result.source).toBe('local');
    expect(result.card.category).toBe('Experience');
    expect(result.card.title.length).toBeGreaterThan(0);
    expect(result.card.preview.length).toBeGreaterThan(0);
    expect(result.card.githubQueries).toEqual([]);
    expect(result.card.recommendation).toBeNull();
  });

  it('requires the stored AI secret in a production-configured generator', async () => {
    const configured = new RawEvidenceGenerator({
      configuration: () => ({
        baseURL: 'https://api.example.com/v1',
        connectionTest: null,
        model: 'fixture-model',
        multimodal: false,
        preset: 'custom',
        secretName: 'Missing Secret',
      }),
      http: new FixtureHTTPTransport([]),
      secretResolver: new FakeSecretResolver({}),
    });

    await expect(configured.generate(CONTENT, 'zh-CN')).rejects.toMatchObject({
      code: 'SECRET_NOT_FOUND',
    });
  });

  it('classifies a GitHub source as Project in the local fallback', async () => {
    const result = await new RawEvidenceGenerator().generate(
      { ...CONTENT, finalURL: 'https://github.com/acme/tool' },
      'en',
    );
    expect(result.category).toBe('Project');
    expect(result.recognitionSource).toBe('local');
  });
});
