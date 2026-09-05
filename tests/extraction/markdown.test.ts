import { describe, expect, it } from 'vitest';
import {
  demoteHeadings,
  normalizeGithubMarkdownForObsidian,
  rewriteGithubMarkdown,
} from '../../src/extraction/markdown';

describe('demoteHeadings', () => {
  it('demotes H1→H4, H2→H5 and keeps deeper headings within H4–H6', () => {
    const markdown = [
      '# Source title',
      '',
      '## Section',
      '',
      '### Sub section',
      '',
      '#### Note',
      '',
      'Body paragraph.',
    ].join('\n');
    expect(demoteHeadings(markdown, 3)).toBe(
      [
        '#### Source title',
        '',
        '##### Section',
        '',
        '###### Sub section',
        '',
        '###### Note',
        '',
        'Body paragraph.',
      ].join('\n'),
    );
  });

  it('never changes headings inside fenced code blocks', () => {
    const markdown = ['# Title', '', '```md', '# not a heading', '## also not', '```', ''].join(
      '\n',
    );
    expect(demoteHeadings(markdown, 3)).toContain('```md\n# not a heading\n## also not\n```');
    expect(demoteHeadings(markdown, 3)).toContain('#### Title');
  });

  it('converts setext headings to demoted ATX headings', () => {
    const markdown = ['Setext One', '=========', '', 'Setext Two', '---------', '', 'Body.'].join(
      '\n',
    );
    const result = demoteHeadings(markdown, 3);
    expect(result).toBe(['#### Setext One', '', '##### Setext Two', '', 'Body.'].join('\n'));
  });

  it('demotes headings nested inside blockquotes and lists', () => {
    const markdown = ['> ## Quoted', '', '- ### ListHead', ''].join('\n');
    const result = demoteHeadings(markdown, 3);
    expect(result).toBe(['> ##### Quoted', '', '- ###### ListHead', ''].join('\n'));
  });

  it('preserves indented code and thematic breaks', () => {
    const markdown = ['    # indented code', '', '---', '', '# Heading', ''].join('\n');
    expect(demoteHeadings(markdown, 3)).toBe(
      ['    # indented code', '', '---', '', '#### Heading', ''].join('\n'),
    );
  });
});

describe('rewriteGithubMarkdown', () => {
  const context = { branch: 'main', directory: '', owner: 'acme', repo: 'tool' };

  it('rewrites relative links and images to absolute GitHub URLs', () => {
    const markdown = [
      '# Tool',
      '',
      'See [docs](docs/guide.md) and the [root file](/LICENSE).',
      '',
      '![architecture](assets/diagram.png)',
      '',
      'External [site](https://example.com) and [anchor](#usage) stay untouched.',
    ].join('\n');
    expect(rewriteGithubMarkdown(markdown, context)).toBe(
      [
        '# Tool',
        '',
        'See [docs](https://github.com/acme/tool/blob/main/docs/guide.md) and the [root file](https://github.com/acme/tool/blob/main/LICENSE).',
        '',
        '![architecture](https://raw.githubusercontent.com/acme/tool/main/assets/diagram.png)',
        '',
        'External [site](https://example.com) and [anchor](#usage) stay untouched.',
      ].join('\n'),
    );
  });

  it('resolves relative links from a nested README directory', () => {
    const markdown = '[guide](guide.md) ![logo](../logo.png)';
    expect(rewriteGithubMarkdown(markdown, { ...context, directory: 'docs/zh-CN' })).toBe(
      '[guide](https://github.com/acme/tool/blob/main/docs/zh-CN/guide.md) ![logo](https://raw.githubusercontent.com/acme/tool/main/docs/logo.png)',
    );
  });

  it('leaves fenced code and escaping destinations untouched', () => {
    const markdown = ['```md', '[code](relative.md)', '```', '', '[escape](../../outside.md)'].join(
      '\n',
    );
    const result = rewriteGithubMarkdown(markdown, context);
    expect(result).toContain('```md\n[code](relative.md)\n```');
    expect(result).toContain('[escape](../../outside.md)');
  });

  it('keeps data, mailto and protocol-relative destinations', () => {
    const markdown =
      '[img](data:image/png;base64,AA==) [mail](mailto:a@b.c) [cdn](//cdn.example/x)';
    expect(rewriteGithubMarkdown(markdown, context)).toBe(markdown);
  });

  it('rewrites relative HTML image sources without duplicating the branch', () => {
    expect(
      rewriteGithubMarkdown('<img src="./assets/example.jpg" width="32%" alt="Example">', context),
    ).toBe(
      '<img src="https://raw.githubusercontent.com/acme/tool/main/assets/example.jpg" width="32%" alt="Example">',
    );
  });

  it('repairs duplicated branches in absolute raw GitHub images', () => {
    const markdown = [
      '![Case 1](https://raw.githubusercontent.com/acme/tool/main/main/assets/case-1.jpg)',
      '<img src="https://raw.githubusercontent.com/acme/tool/main/main/assets/case-2.jpg" width="32%">',
    ].join('\n');
    expect(rewriteGithubMarkdown(markdown, context)).toBe(
      [
        '![Case 1](https://raw.githubusercontent.com/acme/tool/main/assets/case-1.jpg)',
        '<img src="https://raw.githubusercontent.com/acme/tool/main/assets/case-2.jpg" width="32%">',
      ].join('\n'),
    );
  });
});

describe('normalizeGithubMarkdownForObsidian', () => {
  it('removes wrapper HTML without flattening the Markdown inside it', () => {
    expect(
      normalizeGithubMarkdownForObsidian(
        '<div align="center">\n\n# Title\n\n<details>\n<summary>More</summary>\n\nBody\n\n</details>\n\n</div>',
      ),
    ).toBe('# Title\n\n**More**\n\nBody');
  });

  it('removes multiline HTML comments but preserves fenced examples', () => {
    const markdown = [
      'Visible body.',
      '',
      '<!--',
      '## Hidden source',
      'private footer text',
      '-->',
      '',
      '```md',
      '<!-- example -->',
      '```',
    ].join('\n');
    expect(normalizeGithubMarkdownForObsidian(markdown)).toBe(
      ['Visible body.', '', '```md', '<!-- example -->', '```'].join('\n'),
    );
  });

  it('converts standalone HTML images to stable Markdown images', () => {
    expect(
      normalizeGithubMarkdownForObsidian(
        '  <img src="https://raw.githubusercontent.com/acme/tool/main/assets/case-1.jpg" width="32%" alt="Case 1">',
      ),
    ).toBe('![Case 1](https://raw.githubusercontent.com/acme/tool/main/assets/case-1.jpg)');
  });
});
