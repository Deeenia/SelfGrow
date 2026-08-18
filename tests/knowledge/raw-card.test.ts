import { describe, expect, it } from 'vitest';
import { vaultPath } from '../../src/domain';
import { rawContentHash, rawReviewGroup, RawCardService } from '../../src/knowledge';
import { PathGuard } from '../../src/vault';
import { FixedTemporalContext, InMemoryFrontmatter, InMemoryVault } from '../harness';

describe('Task-046 Raw schema and selection state', () => {
  it('migrates existing cards to unselected schema v2 without changing Markdown', async () => {
    const fixture = await createFixture();
    const before = await fixture.vault.read(fixture.path);

    await expect(fixture.service.migrateAll()).resolves.toBe(1);

    expect(await fixture.vault.read(fixture.path)).toBe(before);
    const migrated = await fixture.frontmatter.read(fixture.path);
    expect(migrated).toMatchObject({
      distillation_approved_hash: null,
      distillation_status: 'not_started',
      selfgrow_layer: 'raw',
      selfgrow_schema: 2,
      wiki_selected: false,
      wiki_targets: [],
    });
    expect(migrated?.content_hash).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
  });

  it('queues only the exact user-approved content hash', async () => {
    const fixture = await createFixture();
    const selected = await fixture.service.select(fixture.path);

    expect(selected.distillationApprovedHash).toBe(selected.contentHash);
    await expect(fixture.service.eligible()).resolves.toEqual([selected]);

    await fixture.vault.process(fixture.path, (markdown) =>
      markdown.replace('Grounded summary.', 'User changed the summary.'),
    );

    await expect(fixture.service.eligible()).resolves.toEqual([]);
    const changed = await fixture.frontmatter.read(fixture.path);
    expect(changed).toMatchObject({
      distillation_approved_hash: selected.contentHash,
      distillation_status: 'needs_update',
    });
    expect(changed?.content_hash).not.toBe(selected.contentHash);

    const approved = await fixture.service.confirmUpdate(fixture.path);
    expect(approved.distillationApprovedHash).toBe(approved.contentHash);
    await expect(fixture.service.eligible()).resolves.toEqual([approved]);
  });

  it('cancels queue eligibility while preserving completed Wiki metadata', async () => {
    const fixture = await createFixture();
    const selected = await fixture.service.select(fixture.path);
    await fixture.frontmatter.process(fixture.path, (current) => ({
      ...current,
      distillation_status: 'completed',
      distilled_at: '2026-08-10T12:00:00.000Z',
      distilled_hash: selected.contentHash,
      wiki_targets: ['Wiki/Concepts/Test.md'],
    }));

    const cancelled = await fixture.service.cancelSelection(fixture.path);

    expect(cancelled).toMatchObject({
      distillationStatus: 'completed',
      distilledAt: '2026-08-10T12:00:00.000Z',
      distilledHash: selected.contentHash,
      wikiSelected: false,
      wikiTargets: ['Wiki/Concepts/Test.md'],
    });
    expect(await fixture.frontmatter.read(fixture.path)).toMatchObject({
      wiki_targets: ['Wiki/Concepts/Test.md'],
    });
    await expect(fixture.service.eligible()).resolves.toEqual([]);
  });

  it('maps portable Wiki targets to the configured Vault root', async () => {
    const fixture = await createFixture();
    await fixture.service.migrateAll();
    await fixture.frontmatter.process(fixture.path, (current) => ({
      ...current,
      wiki_targets: ['Wiki/Concepts/Portable.md'],
    }));

    await expect(fixture.service.read(fixture.path)).resolves.toMatchObject({
      wikiTargets: ['Wiki/Concepts/Portable.md'],
    });
  });

  it('rejects update confirmation until a selected card actually changed', async () => {
    const fixture = await createFixture();
    await fixture.service.select(fixture.path);

    await expect(fixture.service.confirmUpdate(fixture.path)).rejects.toMatchObject({
      code: 'RAW_SELECTION_INVALID',
    });
  });

  it('excludes operational frontmatter and line-ending differences from the content hash', async () => {
    const first = await rawContentHash('---\nwiki_selected: false\n---\n# Raw\r\nBody\r\n');
    const second = await rawContentHash('---\nwiki_selected: true\n---\n# Raw\nBody\n');

    expect(first).toBe(second);
  });

  it('lists display metadata and maps every Review group', async () => {
    const fixture = await createFixture();
    const [raw] = await fixture.service.list();

    expect(raw).toMatchObject({
      imagePaths: [],
      platform: 'generic_web',
      previewMarkdown: 'Grounded summary.',
      sourceURL: 'https://example.test/raw',
      title: 'Test',
    });
    if (raw === undefined) throw new Error('Expected Raw card.');
    expect(rawReviewGroup(raw)).toBe('unselected');
    expect(rawReviewGroup({ ...raw, distillationStatus: 'processing' })).toBe('queued');
    expect(rawReviewGroup({ ...raw, distillationStatus: 'completed' })).toBe('completed');
    expect(rawReviewGroup({ ...raw, distillationStatus: 'needs_update' })).toBe('needs_update');
    expect(rawReviewGroup({ ...raw, distillationStatus: 'failed' })).toBe('failed');
  });

  it('deletes Raw only after confirmation and removes only unreferenced attachments', async () => {
    const deleted: string[] = [];
    const fixture = await createFixture((path) => {
      deleted.push(path);
      return Promise.resolve();
    });
    const image = vaultPath('SelfGrow/Attachments/shared.png');
    const wikiPage = vaultPath('Wiki/Concepts/Durable.md');
    const promotedAsset = vaultPath('Wiki/Assets/promoted.png');
    await fixture.vault.create(image, 'binary fixture');
    await fixture.vault.create(wikiPage, '# Durable Wiki knowledge\n');
    await fixture.vault.create(promotedAsset, 'promoted fixture');
    await fixture.vault.process(fixture.path, (markdown) =>
      markdown.replace('# Test\n', `# Test\n\n![[${image}]]\n`),
    );
    await expect(fixture.service.deleteRaw(fixture.path, false)).rejects.toMatchObject({
      code: 'PERMANENT_DELETION_NOT_CONFIRMED',
    });

    const second = vaultPath('SelfGrow/Knowledge/Second.md');
    await fixture.vault.create(
      second,
      `# Second\n\n![[${image}|thumbnail]]\n\n## AI Summary\n\nSecond.\n`,
    );
    await fixture.frontmatter.process(second, () => ({
      imported_at: '2026-08-10T09:30:00.000Z',
      normalized_url: 'https://example.test/second',
      output_language: 'en',
      selfgrow: true,
      selfgrow_id: 'raw-2',
      selfgrow_schema: 1,
      source_platform: 'generic_web',
      source_url: 'https://example.test/second',
      status: 'completed',
    }));

    await fixture.service.deleteRaw(fixture.path, true);
    expect(await fixture.vault.exists(image)).toBe(true);
    await fixture.service.deleteRaw(second, true);
    expect(await fixture.vault.exists(image)).toBe(false);
    expect(await fixture.vault.read(wikiPage)).toBe('# Durable Wiki knowledge\n');
    expect(await fixture.vault.read(promotedAsset)).toBe('promoted fixture');
    expect(deleted).toEqual([fixture.path, second]);
  });
});

async function createFixture(onDeleted?: (path: string) => Promise<void>) {
  const clock = new FixedTemporalContext('2026-08-10T10:00:00.000Z', 'Asia/Shanghai');
  const path = vaultPath('SelfGrow/Knowledge/Test.md');
  const markdown = [
    '# Test',
    '',
    '## AI Summary',
    '',
    'Grounded summary.',
    '',
    '## Core Knowledge',
    '',
    '### Point',
    '',
    'Boundary.',
    '',
    '## My Notes',
    '',
    'Personal note.',
    '',
    '## Source',
    '',
    '[Open source](<https://example.test/raw>)',
    '',
  ].join('\n');
  const vault = new InMemoryVault(clock, [{ content: markdown, path }]);
  const frontmatter = new InMemoryFrontmatter({
    [path]: {
      imported_at: '2026-08-10T09:00:00.000Z',
      normalized_url: 'https://example.test/raw',
      output_language: 'en',
      selfgrow: true,
      selfgrow_id: 'raw-1',
      selfgrow_schema: 1,
      source_platform: 'generic_web',
      source_url: 'https://example.test/raw',
      status: 'completed',
    },
  });
  const service = new RawCardService({
    frontmatter,
    ...(onDeleted === undefined ? {} : { onDeleted }),
    pathGuard: new PathGuard('SelfGrow', (value) => value.replaceAll('\\', '/')),
    vault,
    wikiPathGuard: new PathGuard('Wiki', (value) => value.replaceAll('\\', '/')),
  });
  return { frontmatter, path, service, vault };
}
