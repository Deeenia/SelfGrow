import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { vaultPath, type Language } from '../../src/domain';
import { parseKnowledgeNoteContent, serializeKnowledgeNoteContent } from '../../src/knowledge';

const fixturesRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'knowledge',
);

function fixture(language: Language): string {
  return readFileSync(resolve(fixturesRoot, `${language}.md`), 'utf8').replaceAll('\r\n', '\n');
}

describe('Task-010 knowledge note parser and serializer', () => {
  it.each(['zh-CN', 'en'] as const)('reads the legacy %s fixture', (language) => {
    const markdown = fixture(language);
    const parsed = parseKnowledgeNoteContent(markdown, language);
    expect(parsed.title.length).toBeGreaterThan(0);
  });

  it.each(['zh-CN', 'en'] as const)('round trips the current %s Raw format', (language) => {
    const parsed = parseKnowledgeNoteContent(fixture(language), language);
    const markdown = serializeKnowledgeNoteContent(parsed);
    expect(parseKnowledgeNoteContent(markdown, language)).toEqual(parsed);
    expect(markdown).toContain(language === 'zh-CN' ? '## 筛选预览' : '## Selection Preview');
  });

  it('ignores canonical-looking headings inside fenced code', () => {
    expect(() => parseKnowledgeNoteContent(fixture('en'), 'en')).not.toThrow();
  });

  it.each([
    [
      'duplicate section',
      fixture('en').replace(
        '\n## Source\n\n[Open source]',
        '\n## AI Summary\n\nDuplicate\n\n## Source\n\n[Open source]',
      ),
    ],
    [
      'raw source section',
      fixture('en').replace(
        '\n## Source\n\n[Open source]',
        '\n## Raw Source\n\nraw\n\n## Source\n\n[Open source]',
      ),
    ],
    ['missing section', fixture('en').replace(/## My Notes[\s\S]*?(?=## Source)/, '')],
  ])('rejects a %s conflict without rewriting', (_name, markdown) => {
    expect(() => parseKnowledgeNoteContent(markdown, 'en')).toThrow(
      expect.objectContaining({ code: 'NOTE_SECTION_CONFLICT' }),
    );
  });

  it('preserves personal Markdown byte-for-byte within canonical boundaries', () => {
    const parsed = parseKnowledgeNoteContent(fixture('en'), 'en');

    expect(parsed.personalNoteMarkdown).toBe(
      '- Keep this user list unchanged.\n\n```markdown\n## Source\nThis fenced heading is user text.\n```',
    );
  });

  it('places non-image source files after the summary and technical material', () => {
    const markdown = serializeKnowledgeNoteContent({
      attachmentPaths: [
        vaultPath('Raw/Attachments/figure.png'),
        vaultPath('Raw/Attachments/paper.pdf'),
      ],
      coreKnowledge: [{ explanationMarkdown: 'Methods and results.', title: 'Technical details' }],
      imagePaths: [vaultPath('Raw/Attachments/figure.png')],
      outputLanguage: 'en',
      personalNoteMarkdown: '',
      sourceURL: 'selfgrow:text:fixture',
      summaryMarkdown: 'A concise paper summary.',
      title: 'Fixture paper',
    });

    expect(markdown.indexOf('## Selection Preview')).toBeLessThan(
      markdown.indexOf('### Technical details'),
    );
    expect(markdown.indexOf('### Technical details')).toBeLessThan(
      markdown.indexOf('## Original Files'),
    );
    expect(markdown.indexOf('## Original Files')).toBeLessThan(
      markdown.indexOf('![[Raw/Attachments/paper.pdf]]'),
    );
    expect(parseKnowledgeNoteContent(markdown, 'en').attachmentPaths).toEqual([
      vaultPath('Raw/Attachments/figure.png'),
      vaultPath('Raw/Attachments/paper.pdf'),
    ]);
  });

  it('round trips every generated technical section in order', () => {
    const markdown = serializeKnowledgeNoteContent({
      attachmentPaths: [vaultPath('Raw/Attachments/paper.pdf')],
      coreKnowledge: [
        { explanationMarkdown: 'Question and evidence.', title: 'Research question' },
        { explanationMarkdown: 'Sampling and analysis.', title: 'Data and methods' },
        { explanationMarkdown: 'Findings and limits.', title: 'Results and limitations' },
      ],
      imagePaths: [],
      outputLanguage: 'en',
      personalNoteMarkdown: '',
      sourceURL: 'selfgrow:text:fixture',
      summaryMarkdown: 'A concise paper summary.',
      title: 'Fixture paper',
    });

    expect(parseKnowledgeNoteContent(markdown, 'en').coreKnowledge).toHaveLength(3);
    expect(markdown.indexOf('### Research question')).toBeLessThan(
      markdown.indexOf('### Data and methods'),
    );
    expect(markdown.indexOf('### Data and methods')).toBeLessThan(
      markdown.indexOf('### Results and limitations'),
    );
  });
});
