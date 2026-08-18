import { describe, expect, it } from 'vitest';
import { analyzeManualCapture, extractFirstHTTPURL, looksLikeGitHubName } from '../../src/inbox';

describe('manual capture analysis', () => {
  it('extracts the first link and discards surrounding platform share copy', () => {
    const analysis = analyzeManualCapture({
      imageCount: 0,
      note: '',
      shareText:
        '推荐大家都用 codex 做自己人生管理系统… https://xhslink.cn/o/7cOrkzfefJK 保留口令，直达【小红书】围观～',
    });

    expect(analysis).toMatchObject({
      materialText: '',
      route: 'ai',
      sourceURL: 'https://xhslink.cn/o/7cOrkzfefJK',
    });
  });

  it('keeps only the separate body when share text contains a link', () => {
    expect(
      analyzeManualCapture({
        imageCount: 0,
        note: '用户明确填写的正文',
        shareText: '复制打开抖音看看 https://v.douyin.com/example/ 宣传口令',
      }),
    ).toMatchObject({
      materialText: '用户明确填写的正文',
      sourceURL: 'https://v.douyin.com/example/',
    });
  });

  it('strips Chinese sentence punctuation after a shared link', () => {
    expect(extractFirstHTTPURL('查看 https://example.com/article。')).toBe(
      'https://example.com/article',
    );
  });

  it('accepts GitHub links without an explicit protocol', () => {
    expect(extractFirstHTTPURL('仓库地址：github.com/acme/tool。')).toBe(
      'https://github.com/acme/tool',
    );
  });

  it('allows content without a link and sends all text through AI', () => {
    expect(
      analyzeManualCapture({ imageCount: 0, note: '一条简短想法', shareText: '' }),
    ).toMatchObject({ route: 'ai', sourceURL: null });
    expect(
      analyzeManualCapture({
        imageCount: 0,
        note: '知'.repeat(301),
        shareText: '',
      }),
    ).toMatchObject({ characterCount: 301, route: 'ai', sourceURL: null });
  });

  it('summarizes pure links and link-plus-text shares', () => {
    expect(
      analyzeManualCapture({
        imageCount: 0,
        note: '',
        shareText: 'https://example.com/article',
      }).route,
    ).toBe('ai');
    expect(
      analyzeManualCapture({
        imageCount: 0,
        note: '',
        shareText: '值得看看 https://example.com/article',
      }).route,
    ).toBe('ai');
  });

  it('does not classify an image plus a link as pure-link input', () => {
    expect(
      analyzeManualCapture({
        imageCount: 1,
        note: '',
        shareText: 'https://example.com/article',
      }).route,
    ).toBe('direct');
  });

  it('summarizes text even when an image is also attached', () => {
    expect(
      analyzeManualCapture({
        imageCount: 1,
        note: '图片旁边的一句经验说明',
        shareText: '',
      }).route,
    ).toBe('ai');
  });

  it('routes image-only input through multimodal preview generation', () => {
    expect(analyzeManualCapture({ imageCount: 1, note: '', shareText: '' }).route).toBe('ai');
  });
});

describe('looksLikeGitHubName', () => {
  it('accepts repository and Skill names with optional owner prefix', () => {
    expect(looksLikeGitHubName('OpenHands')).toBe(true);
    expect(looksLikeGitHubName('All-Hands-AI/OpenHands')).toBe(true);
    expect(looksLikeGitHubName('deep-research')).toBe(true);
    expect(looksLikeGitHubName('LangGraph')).toBe(true);
  });

  it('rejects URLs, Chinese sentences and names with spaces', () => {
    expect(looksLikeGitHubName('https://github.com/a/b')).toBe(false);
    expect(looksLikeGitHubName('使用 LangGraph 构建')).toBe(false);
    expect(looksLikeGitHubName('two words')).toBe(false);
    expect(looksLikeGitHubName('')).toBe(false);
    expect(looksLikeGitHubName('a/b/c')).toBe(false);
  });
});
