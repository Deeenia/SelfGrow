import { describe, expect, it } from 'vitest';
import { selfGrowID, vaultPath, type SelfGrowID, type VaultPath } from '../../src/domain';
import {
  InboxReconciler,
  canonicalizeBareBookmarkQueue,
  captureTokenAt,
  localCaptureTokenToISO,
  parseBookmarkQueue,
  type CaptureIDFactory,
  type KnowledgeURLLookup,
} from '../../src/inbox';
import { URLService } from '../../src/url';
import { PathGuard } from '../../src/vault';
import {
  FixedTemporalContext,
  FixtureHTTPTransport,
  InMemoryFrontmatter,
  InMemoryVault,
} from '../harness';

function normalizePath(path: string): string {
  const output: string[] = [];
  for (const segment of path.replaceAll('\\', '/').split('/')) {
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') output.pop();
    else output.push(segment);
  }
  return output.join('/');
}

class SequenceIDFactory implements CaptureIDFactory {
  #next = 1;

  next(): SelfGrowID {
    return selfGrowID(`fixture-capture-${this.#next++}`);
  }
}

class FixtureKnowledgeURLs implements KnowledgeURLLookup {
  constructor(readonly byURL: Readonly<Record<string, VaultPath>> = {}) {}

  async findByNormalizedURL(url: string): Promise<VaultPath | null> {
    return this.byURL[url] ?? null;
  }
}

function createHarness(
  entries: readonly { content: string; path: string }[],
  frontmatter: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {},
  knowledgeURLs: KnowledgeURLLookup = new FixtureKnowledgeURLs(),
) {
  const clock = new FixedTemporalContext('2026-08-09T09:30:00+08:00', 'Asia/Shanghai');
  const vault = new InMemoryVault(clock, entries);
  const metadata = new InMemoryFrontmatter(frontmatter);
  const reconciler = new InboxReconciler({
    clock,
    frontmatter: metadata,
    idFactory: new SequenceIDFactory(),
    knowledgeURLs,
    pathGuard: new PathGuard('SelfGrow', normalizePath),
    urls: new URLService(new FixtureHTTPTransport([])),
    vault,
  });
  return { metadata, reconciler, vault };
}

describe('Task-011 bookmark queue grammar', () => {
  it('accepts only exact unchecked tasks with valid timestamps and one HTTP(S) URL', () => {
    const markdown = [
      '# Queue',
      '- [ ] 20260809-090000 https://example.test/valid',
      '- [x] 20260809-090001 https://example.test/checked',
      '- [ ] 20260230-090000 https://example.test/date',
      '- [ ] 20260809-090002 mailto:test@example.test',
      '- [ ] 20260809-090003 https://example.test/one https://example.test/two',
      '- [ ] 20260809-090004 https://example.test/one trailing',
      '- [ ]20260809-090005 https://example.test/spacing',
    ].join('\n');

    expect(parseBookmarkQueue(markdown)).toEqual([
      {
        captureToken: '20260809-090000',
        line: '- [ ] 20260809-090000 https://example.test/valid',
        lineNumber: 2,
        sourceURL: 'https://example.test/valid',
      },
    ]);
  });

  it('converts local queue time using the injected device timezone', () => {
    expect(localCaptureTokenToISO('20260809-090000', 'Asia/Shanghai')).toBe(
      '2026-08-09T09:00:00+08:00',
    );
    expect(localCaptureTokenToISO('20260115-090000', 'America/New_York')).toBe(
      '2026-01-15T09:00:00-05:00',
    );
  });

  it('canonicalizes desktop bare URLs without changing checked, ambiguous, or timestamped lines', () => {
    const markdown = [
      '# Queue',
      'https://example.test/bare',
      '- [ ] https://example.test/task',
      '- [ ] 20260809-090000 https://example.test/timestamped',
      '- [x] https://example.test/checked',
      'https://example.test/one https://example.test/two',
    ].join('\n');

    expect(canonicalizeBareBookmarkQueue(markdown, '20260809-093000')).toBe(
      [
        '# Queue',
        '- [ ] 20260809-093000 https://example.test/bare',
        '- [ ] 20260809-093000 https://example.test/task',
        '- [ ] 20260809-090000 https://example.test/timestamped',
        '- [x] https://example.test/checked',
        'https://example.test/one https://example.test/two',
      ].join('\n'),
    );
    expect(captureTokenAt(new Date('2026-08-09T01:30:00Z'), 'Asia/Shanghai')).toBe(
      '20260809-093000',
    );
  });
});

describe('Task-011 Inbox reconciliation', () => {
  it('materializes before acknowledging and is idempotent on restart', async () => {
    const queue = [
      '# SelfGrow Inbox Queue',
      '',
      '- [ ] 20260809-090000 https://example.test/article?utm_source=share',
    ].join('\n');
    const { metadata, reconciler, vault } = createHarness([
      { content: queue, path: 'SelfGrow/Inbox Queue.md' },
    ]);
    const beforeCount = (await vault.listMarkdownFiles('SelfGrow/Inbox')).length;
    const first = await reconciler.reconcile();
    const afterCount = (await vault.listMarkdownFiles('SelfGrow/Inbox')).length;
    const second = await reconciler.reconcile();

    expect({ afterCount, beforeCount }).toEqual({ afterCount: 1, beforeCount: 0 });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]?.id).toBe(first[0]?.id);
    expect(first[0]).toMatchObject({
      captureMethod: 'clipboard_shortcut',
      importedAt: '2026-08-09T09:00:00+08:00',
      normalizedURL: 'https://example.test/article',
      reconciliationKind: 'new',
      state: 'queued',
    });
    expect(await vault.read('SelfGrow/Inbox Queue.md')).toContain('- [x] 20260809-090000');
    expect(await metadata.read(first[0]?.path ?? '')).toMatchObject({
      selfgrow_capture: true,
      source_platform: 'generic_web',
    });
  });

  it('timestamps, materializes, and acknowledges a desktop-pasted bare URL', async () => {
    const { metadata, reconciler, vault } = createHarness([
      {
        content: '# SelfGrow Inbox Queue\n\nhttps://example.test/desktop\n',
        path: 'SelfGrow/Inbox Queue.md',
      },
    ]);

    const captures = await reconciler.reconcile();

    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({
      importedAt: '2026-08-09T09:30:00+08:00',
      sourceURL: 'https://example.test/desktop',
    });
    expect(await vault.read('SelfGrow/Inbox Queue.md')).toContain(
      '- [x] 20260809-093000 https://example.test/desktop',
    );
    await expect(metadata.read(captures[0]?.path ?? '')).resolves.toMatchObject({
      cssclasses: 'selfgrow-internal',
    });
  });

  it('supports the synced Vault layout with Inbox Queue inside Inbox without adopting it', async () => {
    const queuePath = 'SelfGrow/Inbox/Inbox Queue.md';
    const { reconciler, vault } = createHarness([
      {
        content: '- [ ] 20260809-090000 https://example.test/synced\n',
        path: queuePath,
      },
    ]);

    const captures = await reconciler.reconcile();

    expect(captures).toHaveLength(1);
    expect(captures[0]?.path).not.toBe(queuePath);
    expect(captures[0]).toMatchObject({
      captureMethod: 'clipboard_shortcut',
      sourceURL: 'https://example.test/synced',
    });
    expect(await vault.read(queuePath)).toContain('- [x] 20260809-090000');
  });

  it('adopts structured and constrained shared-text captures oldest first', async () => {
    const { metadata, reconciler } = createHarness(
      [
        { content: 'Shared https://example.test/shared', path: 'SelfGrow/Inbox/shared.md' },
        { content: 'https://example.test/structured\n', path: 'SelfGrow/Inbox/structured.md' },
      ],
      {
        'SelfGrow/Inbox/structured.md': {
          capture_method: 'share_sheet',
          imported_at: '2026-08-08T08:00:00Z',
          selfgrow_capture: true,
          selfgrow_id: 'existing-structured-id',
          source_url: 'https://example.test/structured',
          status: 'waiting_network',
        },
      },
    );
    const captures = await reconciler.reconcile();

    expect(captures.map((capture) => capture.path)).toEqual([
      'SelfGrow/Inbox/structured.md',
      'SelfGrow/Inbox/shared.md',
    ]);
    expect(captures[0]).toMatchObject({ id: 'existing-structured-id', state: 'waiting_network' });
    expect(captures[1]).toMatchObject({ captureMethod: 'shared_text', state: 'queued' });
    expect(await metadata.read('SelfGrow/Inbox/shared.md')).toMatchObject({
      selfgrow_capture: true,
      source_url: 'https://example.test/shared',
    });
  });

  it('leaves unrelated, ambiguous, and malformed Inbox notes untouched', async () => {
    const entries = [
      { content: 'ordinary personal note', path: 'SelfGrow/Inbox/personal.md' },
      {
        content: 'https://example.test/one and https://example.test/two',
        path: 'SelfGrow/Inbox/ambiguous.md',
      },
      { content: 'https://example.test/should-not-adopt', path: 'SelfGrow/Inbox/malformed.md' },
    ];
    const { metadata, reconciler, vault } = createHarness(entries, {
      'SelfGrow/Inbox/malformed.md': { selfgrow_capture: true, source_url: 'mailto:bad' },
    });

    expect(await reconciler.reconcile()).toEqual([]);
    for (const entry of entries) {
      expect(await vault.read(entry.path)).toBe(entry.content);
    }
    expect(await metadata.read('SelfGrow/Inbox/personal.md')).toBeNull();
    expect(await metadata.read('SelfGrow/Inbox/ambiguous.md')).toBeNull();
  });

  it('deduplicates a repeated capture ID and marks an indexed URL as re-import', async () => {
    const knowledgePath = vaultPath('SelfGrow/Knowledge/Existing/note.md');
    const { reconciler } = createHarness(
      [
        { content: 'https://example.test/repeat', path: 'SelfGrow/Inbox/one.md' },
        { content: 'https://example.test/repeat', path: 'SelfGrow/Inbox/two.md' },
      ],
      {
        'SelfGrow/Inbox/one.md': {
          imported_at: '2026-08-08T08:00:00Z',
          selfgrow_capture: true,
          selfgrow_id: 'same-id',
          source_url: 'https://example.test/repeat',
        },
        'SelfGrow/Inbox/two.md': {
          imported_at: '2026-08-09T08:00:00Z',
          selfgrow_capture: true,
          selfgrow_id: 'same-id',
          source_url: 'https://example.test/repeat',
        },
      },
      new FixtureKnowledgeURLs({ 'https://example.test/repeat': knowledgePath }),
    );

    const captures = await reconciler.reconcile();
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({
      existingKnowledgePath: knowledgePath,
      path: 'SelfGrow/Inbox/one.md',
      reconciliationKind: 'reimport',
    });
  });
});
