import { describe, expect, it } from 'vitest';
import { selfGrowID, vaultPath } from '../../src/domain';
import { URLNoteIndex } from '../../src/knowledge';
import { PathGuard } from '../../src/vault';
import { FixedTemporalContext, InMemoryFrontmatter, InMemoryVault } from '../harness';

function normalizePath(path: string): string {
  const output: string[] = [];
  for (const segment of path.replaceAll('\\', '/').split('/')) {
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') output.pop();
    else output.push(segment);
  }
  return output.join('/');
}

function identity(id: string, url: string): Record<string, unknown> {
  return { normalized_url: url, selfgrow: true, selfgrow_id: id, status: 'completed' };
}

function harness() {
  const clock = new FixedTemporalContext('2026-08-09T09:30:00+08:00', 'Asia/Shanghai');
  const vault = new InMemoryVault(clock, [
    { content: 'body one', path: 'SelfGrow/Knowledge/one.md' },
    { content: 'body two', path: 'SelfGrow/Knowledge/two.md' },
    { content: 'legacy nested', path: 'SelfGrow/Knowledge/Legacy/nested.md' },
    { content: 'unrelated', path: 'Other/Knowledge/outside.md' },
    { content: 'inbox', path: 'SelfGrow/Inbox/capture.md' },
  ]);
  const frontmatter = new InMemoryFrontmatter({
    'Other/Knowledge/outside.md': identity('outside', 'https://example.test/outside'),
    'SelfGrow/Inbox/capture.md': identity('inbox', 'https://example.test/inbox'),
    'SelfGrow/Knowledge/Legacy/nested.md': identity(
      'legacy-nested',
      'https://example.test/legacy-nested',
    ),
    'SelfGrow/Knowledge/one.md': {
      ...identity('note-one', 'https://example.test/one'),
      imported_at: '2026-08-08T00:00:00Z',
    },
    'SelfGrow/Knowledge/two.md': identity('note-two', 'https://example.test/two'),
  });
  const index = new URLNoteIndex(vault, frontmatter, new PathGuard('SelfGrow', normalizePath));
  return { frontmatter, index, vault };
}

describe('Task-012 URL and note indexes', () => {
  it('rebuilds only from the Knowledge root', async () => {
    const { index, vault } = harness();

    expect(await index.rebuild()).toBe(2);
    expect(vault.listMarkdownCallCount).toBe(1);
    await expect(index.findByNormalizedURL('https://example.test/one')).resolves.toBe(
      'SelfGrow/Knowledge/one.md',
    );
    expect(index.findBySelfGrowID(selfGrowID('note-two'))).toBe('SelfGrow/Knowledge/two.md');
    await expect(index.findByNormalizedURL('https://example.test/outside')).resolves.toBeNull();
    await expect(
      index.findByNormalizedURL('https://example.test/legacy-nested'),
    ).resolves.toBeNull();
  });

  it('does not block startup on duplicate Markdown identities during rebuild', async () => {
    const { frontmatter, index, vault } = harness();
    await vault.create('SelfGrow/Knowledge/duplicate-copy.md', 'user-preserved copy');
    await frontmatter.process('SelfGrow/Knowledge/duplicate-copy.md', () =>
      identity('note-one', 'https://example.test/one'),
    );

    await expect(index.rebuild()).resolves.toBe(2);
    await expect(index.findByNormalizedURL('https://example.test/one')).resolves.toBe(
      'SelfGrow/Knowledge/duplicate-copy.md',
    );
    expect(await vault.exists('SelfGrow/Knowledge/one.md')).toBe(true);
    expect(await vault.exists('SelfGrow/Knowledge/duplicate-copy.md')).toBe(true);
  });

  it('updates root-level create, rename, and delete events without rescanning', async () => {
    const { index, vault } = harness();
    await index.rebuild();
    await vault.create('SelfGrow/Knowledge/three.md', 'body three');
    await index.indexNote(
      'SelfGrow/Knowledge/three.md',
      identity('note-three', 'https://example.test/three'),
    );
    await vault.move('SelfGrow/Knowledge/three.md', 'SelfGrow/Knowledge/renamed-three.md');
    index.movePath('SelfGrow/Knowledge/three.md', 'SelfGrow/Knowledge/renamed-three.md');

    await expect(index.findByNormalizedURL('https://example.test/three')).resolves.toBe(
      'SelfGrow/Knowledge/renamed-three.md',
    );
    await expect(index.findByNormalizedURL('https://example.test/two')).resolves.toBe(
      'SelfGrow/Knowledge/two.md',
    );
    index.removePath('SelfGrow/Knowledge/renamed-three.md');
    expect(index.size).toBe(2);
    expect(vault.listMarkdownCallCount).toBe(1);
  });

  it('forgets a deleted knowledge file before duplicate lookup or replacement indexing', async () => {
    const { index, vault } = harness();
    await index.rebuild();
    await vault.delete('SelfGrow/Knowledge/one.md');

    await expect(index.findByNormalizedURL('https://example.test/one')).resolves.toBeNull();
    expect(index.findBySelfGrowID(selfGrowID('note-one'))).toBeNull();
    expect(index.size).toBe(1);

    await vault.create('SelfGrow/Knowledge/recreated.md', 'newly generated card');
    await expect(
      index.indexNote(
        'SelfGrow/Knowledge/recreated.md',
        identity('new-note-one', 'https://example.test/one'),
      ),
    ).resolves.toBeUndefined();
    await expect(index.findByNormalizedURL('https://example.test/one')).resolves.toBe(
      'SelfGrow/Knowledge/recreated.md',
    );
  });

  it('prunes a missing conflicting identity when replacement indexing happens first', async () => {
    const { index, vault } = harness();
    await index.rebuild();
    await vault.delete('SelfGrow/Knowledge/one.md');
    await vault.create('SelfGrow/Knowledge/recreated.md', 'newly generated card');

    await expect(
      index.indexNote(
        'SelfGrow/Knowledge/recreated.md',
        identity('new-note-one', 'https://example.test/one'),
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects duplicate normalized URLs and IDs', async () => {
    const { index } = harness();
    await index.rebuild();

    await expect(
      index.indexNote(
        'SelfGrow/Knowledge/duplicate.md',
        identity('different-id', 'https://example.test/one'),
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE_URL' });
    await expect(
      index.indexNote(
        'SelfGrow/Knowledge/duplicate-id.md',
        identity('note-one', 'https://example.test/different'),
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE_URL' });
    await expect(
      index.indexNote(
        'SelfGrow/Knowledge/one.md',
        identity('note-one', 'https://example.test/two'),
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE_URL' });
    await expect(index.findByNormalizedURL('https://example.test/one')).resolves.toBe(
      'SelfGrow/Knowledge/one.md',
    );
  });

  it('updates re-import time without changing body, path, or index identity', async () => {
    const { frontmatter, index, vault } = harness();
    await index.rebuild();
    const path = vaultPath('SelfGrow/Knowledge/one.md');
    const beforeBody = await vault.read(path);
    const beforeCount = index.size;

    await expect(
      index.updateImportTimeForURL('https://example.test/one', '2026-08-09T10:00:00+08:00'),
    ).resolves.toBe(path);

    expect(await vault.read(path)).toBe(beforeBody);
    expect(index.size).toBe(beforeCount);
    expect(await frontmatter.read(path)).toMatchObject({
      imported_at: '2026-08-09T10:00:00+08:00',
    });
    await expect(index.findByNormalizedURL('https://example.test/one')).resolves.toBe(path);
  });

  it('serializes deterministically and validates loaded derived data', async () => {
    const { frontmatter, index, vault } = harness();
    await index.rebuild();
    const snapshot = index.snapshot();
    const restored = new URLNoteIndex(vault, frontmatter, new PathGuard('SelfGrow', normalizePath));

    restored.load(JSON.parse(JSON.stringify(snapshot)));
    expect(restored.snapshot()).toEqual(snapshot);
    expect(() => restored.load({ ...snapshot, secret: 'must-not-be-accepted' })).toThrow();
  });
});
