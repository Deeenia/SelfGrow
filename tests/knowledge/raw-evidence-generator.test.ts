import { describe, expect, it } from 'vitest';
import { vaultPath } from '../../src/domain';
import type { ExtractedContent } from '../../src/extraction';
import {
  parseKnowledgeNoteContent,
  RawEvidenceGenerator,
  serializeKnowledgeNoteContent,
} from '../../src/knowledge';
import { FakeSecretResolver, FixtureHTTPTransport } from '../harness';
import type { PreferenceProfile } from '../../src/settings';

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
      matchedInterestedKeywords: ['可复用'],
      matchedUninterestedKeywords: [],
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
  preferenceProfile?: PreferenceProfile,
): RawEvidenceGenerator {
  return new RawEvidenceGenerator({
    configuration: () => ({
      baseURL: 'https://api.example.com/v1',
      connectionTest: null,
      model: 'fixture-model',
      multimodal: false,
      preset: 'custom',
      secretName: 'Chat Secret',
    }),
    http,
    preferenceKeywords: () => ({
      interested: ['可复用', '本地优先'],
      uninterested: ['营销炒作'],
    }),
    ...(preferenceProfile === undefined
      ? {}
      : { preferenceProfile: () => Promise.resolve(preferenceProfile) }),
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

  it('keeps the existing one-sentence visual preview path', async () => {
    const result = await new RawEvidenceGenerator().generate(
      {
        ...CONTENT,
        body: '图片展示了由服务、队列和数据库组成的系统架构。',
        route: 'visual_preview',
        sourceLanguage: 'zh-CN',
        title: '服务队列架构图',
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
      title: '服务队列架构图',
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
          title: 'Learn Harness Engineering',
        }),
      ),
    ]);
    const result = await generator(http).generate(CONTENT, 'zh-CN');

    expect(result).toMatchObject({
      category: 'Skill',
      githubQueries: ['Learn Harness Engineering'],
      recommendation: {
        matchedInterestedKeywords: ['可复用'],
        matchedUninterestedKeywords: [],
        protocolVersion: 'user-keywords-profile-v2',
        reason: '符合可复用、可验证和实际工程价值偏好。',
        score: 82,
      },
      recognitionSource: 'ai',
      summaryMarkdown:
        '课程通过任务规范、上下文供给、执行环境和验证反馈，为 AI Agent 建立可验证的工程闭环。',
      title: 'Learn Harness Engineering',
    });
    expect(http.calls).toHaveLength(1);
    const request = JSON.parse(http.calls[0]?.body ?? '{}') as {
      max_tokens?: number;
      messages?: Array<{ content?: string }>;
    };
    expect(request.max_tokens).toBe(520);
    expect(request.messages?.[0]?.content).toContain(CONTENT.body);
    expect(request.messages?.[0]?.content).toContain('preference_keywords');
  });

  it('applies only validated personal-profile signal weights without sending source records', async () => {
    const http = new FixtureHTTPTransport([
      chatRoute(
        JSON.stringify({
          category: 'Skill',
          githubQueries: [],
          matchedPreferenceSignalIds: ['reproducible-evidence'],
          preview: '方法提供可重复执行的数据步骤，并保留可检查的验证边界。',
          title: '可复现研究方法',
        }),
      ),
    ]);
    const result = await generator(http, PREFERENCE_PROFILE).generate(CONTENT, 'zh-CN');

    expect(result.recommendation).toMatchObject({
      matchedPreferenceSignals: ['可复现证据'],
      profileVersion: 'profile-v1',
      protocolVersion: 'user-keywords-profile-v2',
      score: 94,
    });
    const body = http.calls[0]?.body ?? '';
    expect(body).toContain('<preference_profile>');
    expect(body).toContain('reproducible-evidence');
    expect(body).not.toContain('Private fixture');
  });

  it('rejects personal-profile signal IDs that were not approved', async () => {
    const invalid = JSON.stringify({
      category: 'Project',
      githubQueries: [],
      matchedInterestedKeywords: ['可复用'],
      matchedPreferenceSignalIds: ['invented-signal'],
      matchedUninterestedKeywords: [],
      preview: '提供一条足够长且不重复标题的工程实践筛选理由。',
      recommendationReason: '内容声称命中了个人协议，但该信号没有获得批准。',
      recommendationScore: 80,
      title: '工程实践',
    });
    const http = new FixtureHTTPTransport([chatRoute(invalid, invalid)]);

    await expect(
      generator(http, PREFERENCE_PROFILE).generate(CONTENT, 'zh-CN'),
    ).rejects.toMatchObject({ code: 'AI_OUTPUT_INVALID' });
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

  it('repairs an invalid card once and reports failure when the repair is still invalid', async () => {
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
    await expect(generator(http).generate(CONTENT, 'en')).rejects.toMatchObject({
      code: 'AI_OUTPUT_INVALID',
    });
    expect(http.calls).toHaveLength(2);
  });

  it('rejects an out-of-range recommendation score', async () => {
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
    const http = new FixtureHTTPTransport([chatRoute(invalid, invalid)]);

    await expect(generator(http).generate(CONTENT, 'zh-CN')).rejects.toMatchObject({
      code: 'AI_OUTPUT_INVALID',
    });
    expect(http.calls).toHaveLength(2);
  });

  it('rejects keyword hits that were not configured by the user', async () => {
    const invalid = JSON.stringify({
      category: 'Project',
      githubQueries: [],
      matchedInterestedKeywords: ['模型声称的额外兴趣'],
      matchedUninterestedKeywords: [],
      preview: '提供一条足够长且不重复标题的工程实践筛选理由。',
      recommendationReason: '内容具有工程价值，但命中了并不存在的用户关键词。',
      recommendationScore: 80,
      title: '工程实践',
    });
    const http = new FixtureHTTPTransport([chatRoute(invalid, invalid)]);

    await expect(generator(http).generate(CONTENT, 'zh-CN')).rejects.toMatchObject({
      code: 'AI_OUTPUT_INVALID',
    });
    expect(http.calls).toHaveLength(2);
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
      ),
    ]);
    const result = await generator(http).generate(CONTENT, 'zh-CN');
    expect(result.title).toBe('OpenHands');
    expect(result.category).toBe('Project');
    expect(http.calls).toHaveLength(2);
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
