import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Language } from '../../src/domain';
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
});
