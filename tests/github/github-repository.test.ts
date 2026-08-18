import { describe, expect, it } from 'vitest';
import {
  GitHubRepositoryExtractor,
  parseGitHubRepository,
  resolveGitHubDefaultBranch,
  selectGitHubReadme,
} from '../../src/github';
import { FixtureHTTPTransport } from '../harness';

function rawRoute(path: string, markdown: string, status = 200) {
  return {
    method: 'GET' as const,
    outcome: {
      kind: 'response' as const,
      response: { body: markdown, headers: {}, status },
    },
    url: `https://raw.githubusercontent.com/acme/tool/main/${path}`,
  };
}

function contentsRoute(path: string, markdown: string) {
  let binary = '';
  for (const byte of new TextEncoder().encode(markdown)) binary += String.fromCharCode(byte);
  return {
    method: 'GET' as const,
    outcome: {
      kind: 'response' as const,
      response: {
        body: JSON.stringify({ content: btoa(binary), encoding: 'base64', type: 'file' }),
        headers: {},
        status: 200,
      },
    },
    url: `https://api.github.com/repos/acme/tool/contents/${path}?ref=main`,
  };
}

function contentsDirectoryRoute(paths: readonly string[]) {
  return {
    method: 'GET' as const,
    outcome: {
      kind: 'response' as const,
      response: {
        body: JSON.stringify(paths.map((path) => ({ path, type: 'file' }))),
        headers: {},
        status: 200,
      },
    },
    url: 'https://api.github.com/repos/acme/tool/contents?ref=main',
  };
}

const apiRoute = {
  method: 'GET' as const,
  outcome: {
    kind: 'response' as const,
    response: {
      body: JSON.stringify({ default_branch: 'main', description: 'A fixture tool.' }),
      headers: {},
      status: 200,
    },
  },
  url: 'https://api.github.com/repos/acme/tool',
};

describe('parseGitHubRepository', () => {
  it('parses github.com URLs, tree paths and bare owner/repo names', () => {
    expect(parseGitHubRepository('https://github.com/acme/tool')).toEqual({
      owner: 'acme',
      repo: 'tool',
    });
    expect(parseGitHubRepository('https://github.com/acme/tool/tree/main/docs')).toEqual({
      owner: 'acme',
      repo: 'tool',
    });
    expect(parseGitHubRepository('acme/tool')).toEqual({ owner: 'acme', repo: 'tool' });
    expect(parseGitHubRepository('https://example.com/not-github')).toBeNull();
    expect(parseGitHubRepository('single')).toBeNull();
    expect(parseGitHubRepository('a/b/c')).toBeNull();
  });
});

describe('resolveGitHubDefaultBranch', () => {
  it('uses the API default branch and falls back to main', async () => {
    const http = new FixtureHTTPTransport([apiRoute]);
    expect(await resolveGitHubDefaultBranch(http, { owner: 'acme', repo: 'tool' })).toBe('main');
    expect(http.calls[0]?.headers?.['User-Agent']).toBe('SelfGrow/0.1');
    const offline = new FixtureHTTPTransport([]);
    expect(await resolveGitHubDefaultBranch(offline, { owner: 'acme', repo: 'tool' })).toBe('main');
  });
});

describe('selectGitHubReadme', () => {
  it('picks the zh-CN README when it exists alongside the English default', async () => {
    const http = new FixtureHTTPTransport([
      rawRoute('README.zh-CN.md', '# 中文标题\n\n中文正文。'),
      rawRoute('README.zh.md', '# 中文备选'),
      rawRoute('README_CN.md', '# 中文备选二'),
      rawRoute('README-CN.md', '# 中文备选三'),
      rawRoute('docs/zh-CN/README.md', '# 中文文档目录'),
      rawRoute('docs/zh/README.md', '# 中文文档目录二'),
    ]);
    const readme = await selectGitHubReadme(http, { owner: 'acme', repo: 'tool' }, 'main', 'zh-CN');
    expect(readme).toMatchObject({
      defaultUsed: false,
      language: 'zh-CN',
      path: 'README.zh-CN.md',
    });
    expect(readme?.markdown).toContain('中文正文');
  });

  it('picks the English README when the default is Chinese', async () => {
    const http = new FixtureHTTPTransport([
      rawRoute('README.en.md', '# English title\n\nEnglish body.'),
      rawRoute('README.md', '# 中文标题'),
    ]);
    const readme = await selectGitHubReadme(http, { owner: 'acme', repo: 'tool' }, 'main', 'en');
    expect(readme).toMatchObject({ defaultUsed: false, language: 'en', path: 'README.en.md' });
    expect(readme?.markdown).toContain('English body');
  });

  it('follows a language-switch link inside the default README within the same repo', async () => {
    const http = new FixtureHTTPTransport([
      contentsDirectoryRoute(['README.md']),
      rawRoute('README.md', '# Tool\n\n[English](README.en.md) · [中文](README.zh_cn.md)'),
      rawRoute('README.zh_cn.md', '# 中文标题'),
    ]);
    const readme = await selectGitHubReadme(http, { owner: 'acme', repo: 'tool' }, 'main', 'zh-CN');
    expect(readme).toMatchObject({
      defaultUsed: false,
      language: 'zh-CN',
      path: 'README.zh_cn.md',
    });
  });

  it('uses the language label when the README filename is not language-shaped', async () => {
    const http = new FixtureHTTPTransport([
      contentsDirectoryRoute(['README.md']),
      rawRoute('README.md', '# Tool\n\n[English](README.en.md) · [中文](README-CN-简体.md)'),
      rawRoute('README-CN-简体.md', '# 中文标题'),
    ]);
    const readme = await selectGitHubReadme(http, { owner: 'acme', repo: 'tool' }, 'main', 'zh-CN');
    expect(readme).toMatchObject({
      defaultUsed: false,
      language: 'zh-CN',
      path: 'README-CN-简体.md',
    });
  });

  it('falls back to the default README when no target language exists', async () => {
    const http = new FixtureHTTPTransport([rawRoute('README.md', '# Default\n\nDefault body.')]);
    const readme = await selectGitHubReadme(http, { owner: 'acme', repo: 'tool' }, 'main', 'zh-CN');
    expect(readme).toMatchObject({ defaultUsed: true, language: null, path: 'README.md' });
    expect(readme?.markdown).toContain('Default body');
  });

  it('falls back to the GitHub Contents API when raw file access fails', async () => {
    const http = new FixtureHTTPTransport([
      contentsDirectoryRoute(['README.md']),
      contentsRoute('README.md', '# API fallback\n\nBody.'),
    ]);
    const readme = await selectGitHubReadme(http, { owner: 'acme', repo: 'tool' }, 'main', 'en');
    expect(readme).toMatchObject({ defaultUsed: true, language: null, path: 'README.md' });
    expect(readme?.markdown).toContain('API fallback');
  });

  it('uses the root listing to avoid probing missing README candidates', async () => {
    const http = new FixtureHTTPTransport([
      contentsDirectoryRoute(['README.md']),
      contentsRoute('README.md', '# Listed README\n\nBody.'),
    ]);
    const readme = await selectGitHubReadme(http, { owner: 'acme', repo: 'tool' }, 'main', 'zh-CN');
    expect(readme).toMatchObject({ defaultUsed: true, path: 'README.md' });
    expect(http.calls.map((call) => call.url)).toEqual([
      'https://api.github.com/repos/acme/tool/contents?ref=main',
      'https://api.github.com/repos/acme/tool/contents/README.md?ref=main',
    ]);
    expect(http.calls.every((call) => call.headers?.['User-Agent'] === 'SelfGrow/0.1')).toBe(true);
  });

  it('does not follow switch links to other repositories', async () => {
    const http = new FixtureHTTPTransport([
      rawRoute('README.md', '# Tool\n\n[其他仓库](https://github.com/other/thing)'),
    ]);
    const readme = await selectGitHubReadme(http, { owner: 'acme', repo: 'tool' }, 'main', 'zh-CN');
    expect(readme).toMatchObject({ defaultUsed: true, path: 'README.md' });
  });

  it('returns null when the repository exposes no README at all', async () => {
    const http = new FixtureHTTPTransport([]);
    const readme = await selectGitHubReadme(http, { owner: 'acme', repo: 'tool' }, 'main', 'en');
    expect(readme).toBeNull();
  });

  it('bounds the no-API fallback to concurrent localized and default raw probes', async () => {
    const http = new FixtureHTTPTransport([rawRoute('README.md', '# Default')]);

    await selectGitHubReadme(http, { owner: 'acme', repo: 'tool' }, 'main', 'zh-CN');

    expect(http.calls.map((call) => call.url)).toEqual([
      'https://api.github.com/repos/acme/tool/contents?ref=main',
      'https://raw.githubusercontent.com/acme/tool/main/README.zh-CN.md',
      'https://raw.githubusercontent.com/acme/tool/main/README.md',
    ]);
  });
});

describe('GitHubRepositoryExtractor', () => {
  it('extracts README Markdown in an Obsidian-renderable form', async () => {
    const http = new FixtureHTTPTransport([
      apiRoute,
      rawRoute(
        'README.md',
        [
          '# Tool',
          '',
          '## Getting started',
          '',
          'See [docs](docs/guide.md) and ![logo](assets/logo.png).',
          '',
          '```js',
          '# inside code stays',
          '```',
        ].join('\n'),
      ),
    ]);
    const extractor = new GitHubRepositoryExtractor(http);
    expect(extractor.canHandle(new URL('https://github.com/acme/tool'))).toBe(true);
    expect(extractor.canHandle(new URL('https://example.com/article'))).toBe(false);

    const outcome = await extractor.extract({
      capturedText: undefined,
      id: 'id' as never,
      language: 'en',
      url: {
        normalized: 'https://github.com/acme/tool',
        platform: 'generic_web',
        received: 'https://github.com/acme/tool',
      },
    });
    expect(outcome.kind).toBe('complete');
    if (outcome.kind !== 'complete') return;
    expect(outcome.content.title).toBe('Tool');
    expect(outcome.content.finalURL).toBe('https://github.com/acme/tool');
    expect(outcome.content.github).toEqual({
      owner: 'acme',
      readmeLanguage: null,
      readmePath: 'README.md',
      repo: 'tool',
    });
    const body = outcome.content.body;
    expect(body).toContain('# Tool');
    expect(body).toContain('## Getting started');
    expect(body).toContain('[docs](https://github.com/acme/tool/blob/main/docs/guide.md)');
    expect(body).toContain(
      '![logo](https://raw.githubusercontent.com/acme/tool/main/assets/logo.png)',
    );
    expect(body).toContain('```js\n# inside code stays\n```');
  });
});
