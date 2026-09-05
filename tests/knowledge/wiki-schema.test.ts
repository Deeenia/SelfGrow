import { describe, expect, it } from 'vitest';
import {
  initializeWikiSchema,
  serializeWikiPage,
  updateWikiAISections,
  wikiPagePath,
  WIKI_PAGE_TYPES,
  type WikiPageDraft,
} from '../../src/knowledge';
import { PathGuard } from '../../src/vault';
import { FixedTemporalContext, InMemoryVault } from '../harness';

describe('Task-049 Wiki schema and protected sections', () => {
  it('creates the contained Wiki layout without replacing Index or Log', async () => {
    const { guard, vault } = fixture();

    await initializeWikiSchema(vault, guard);
    await vault.process('Wiki/Index.md', () => '# My index\n');
    await initializeWikiSchema(vault, guard);

    expect(await vault.read('Wiki/Index.md')).toBe('# My index\n');
    expect(await vault.read('Wiki/Log.md')).toBe('# SelfGrow Wiki Log\n');
    await expect(vault.listFolders('Wiki')).resolves.toEqual([
      'Wiki/Assets',
      'Wiki/Concepts',
      'Wiki/Experiences',
      'Wiki/Methods',
      'Wiki/Questions',
      'Wiki/Topics',
    ]);
  });

  it('creates missing category folders beside an existing synced Index', async () => {
    const { guard, vault } = fixture([{ content: '# Synced index\n', path: 'Wiki/Index.md' }]);

    await initializeWikiSchema(vault, guard);

    expect(await vault.read('Wiki/Index.md')).toBe('# Synced index\n');
    expect(await vault.read('Wiki/Log.md')).toBe('# SelfGrow Wiki Log\n');
    await expect(vault.listFolders('Wiki')).resolves.toEqual([
      'Wiki/Assets',
      'Wiki/Concepts',
      'Wiki/Experiences',
      'Wiki/Methods',
      'Wiki/Questions',
      'Wiki/Topics',
    ]);
  });

  it('does not create Wiki paths on a mobile device while iCloud is still hydrating', async () => {
    const { guard, vault } = fixture();

    await initializeWikiSchema(vault, guard, false);

    await expect(vault.exists('Wiki')).resolves.toBe(false);
  });

  it('limits page types and serializes the stable section schema', () => {
    const { guard } = fixture();
    expect(WIKI_PAGE_TYPES).toEqual(['topic', 'concept', 'method', 'experience', 'question']);
    expect(wikiPagePath(guard, 'concept', 'RAG / 检索')).toBe('Wiki/Concepts/RAG - 检索.md');
    expect(serializeWikiPage(draft())).toContain(
      'wiki_type: concept\ncreated_at: "2026-08-11T10:00:00.000Z"',
    );
    expect(serializeWikiPage(draft())).toContain(
      '## 当前认识\n\n结论。\n\n## 方法与边界\n\n边界。\n\n## 关联\n\n上位主题：[[AI 工程]]\n\n## 我的经验',
    );
  });

  it('preserves the complete personal-experience suffix byte-for-byte on updates', () => {
    const original = serializeWikiPage(draft()).replaceAll('\n', '\r\n');
    const protectedSuffix = original.slice(original.indexOf('## 我的经验'));
    const updated = updateWikiAISections(original, {
      currentUnderstandingMarkdown: '新结论。',
      methodAndBoundaryMarkdown: '新边界。',
      relationMarkdown: '相关：[[知识管理]]',
    });

    expect(updated.slice(updated.indexOf('## 我的经验'))).toBe(protectedSuffix);
    expect(updated).toContain('## 当前认识\r\n\r\n新结论。');
  });

  it('rejects external-only experience and non-wikilink Markdown relations', () => {
    expect(() =>
      serializeWikiPage({
        ...draft(),
        experienceEvidence: null,
        personalExperienceMarkdown: '我这样做过。',
      }),
    ).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_NOTE_INVALID' }));
    expect(() =>
      serializeWikiPage({ ...draft(), relationMarkdown: '[外部关系](https://example.test)' }),
    ).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_NOTE_INVALID' }));
  });

  it('rejects ambiguous protected-section structure', () => {
    const duplicate = `${serializeWikiPage(draft())}\n## 我的经验\nchanged`;
    expect(() =>
      updateWikiAISections(duplicate, {
        currentUnderstandingMarkdown: '新结论。',
        methodAndBoundaryMarkdown: '新边界。',
        relationMarkdown: '[[关系]]',
      }),
    ).toThrow(expect.objectContaining({ code: 'NOTE_SECTION_CONFLICT' }));
  });
});

function fixture(entries: Array<{ content: string; path: string }> = []) {
  const clock = new FixedTemporalContext('2026-08-11T10:00:00.000Z', 'Asia/Shanghai');
  return {
    guard: new PathGuard('Wiki', (value) => value.replaceAll('\\', '/')),
    vault: new InMemoryVault(clock, entries),
  };
}

function draft(): WikiPageDraft {
  return {
    createdAt: '2026-08-11T10:00:00.000Z',
    currentUnderstandingMarkdown: '结论。',
    experienceEvidence: null,
    methodAndBoundaryMarkdown: '边界。',
    personalExperienceMarkdown: '',
    relationMarkdown: '上位主题：[[AI 工程]]',
    sourceCount: 1,
    title: 'RAG',
    type: 'concept',
    updatedAt: '2026-08-11T10:00:00.000Z',
  };
}
