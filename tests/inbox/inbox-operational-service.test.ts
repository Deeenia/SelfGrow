import { describe, expect, it } from 'vitest';
import {
  PROCESSING_STATES,
  selfGrowID,
  vaultPath,
  type ProcessingState,
  type VaultPath,
} from '../../src/domain';
import {
  InboxOperationalService,
  inboxProgress,
  inboxStateText,
  type InboxReconciliationPort,
  type ReconciledCapture,
} from '../../src/inbox';
import { PathGuard } from '../../src/vault';
import { FixedTemporalContext, InMemoryFrontmatter, InMemoryVault } from '../harness';

const CAPTURE_PATH = 'SelfGrow/Inbox/capture.md';
const KNOWLEDGE_PATH = 'SelfGrow/Knowledge/Testing/Knowledge.md';

describe('InboxOperationalService', () => {
  it('provides honest localized labels for every operational state without percentages', () => {
    for (const state of PROCESSING_STATES) {
      expect(inboxStateText(state, 'zh-CN')).not.toBe('');
      expect(inboxStateText(state, 'en')).not.toBe('');
      expect(inboxStateText(state, 'zh-CN')).not.toContain('%');
      expect(inboxStateText(state, 'en')).not.toContain('%');
    }
  });

  it('maps durable stages to an honest visual ring and distinguishes success from failure', () => {
    expect([
      inboxProgress('queued').value,
      inboxProgress('extracting').value,
      inboxProgress('generating').value,
      inboxProgress('completed').value,
    ]).toEqual([0.08, 0.28, 0.72, 1]);
    expect(inboxProgress('completed')).toEqual({ kind: 'success', value: 1 });
    expect(inboxProgress('incomplete_extraction')).toEqual({ kind: 'failure', value: 1 });
    expect(inboxProgress('failed')).toEqual({ kind: 'failure', value: 1 });
  });

  it('lists safe status text and excludes completed captures', async () => {
    const fixture = fixtureFor('incomplete_extraction');
    await expect(fixture.service.list('zh-CN')).resolves.toMatchObject([
      {
        errorText: '未取得可用于生成知识卡片的内容。',
        label: 'example.com',
        progressText: '无法完整解析',
      },
    ]);
    await fixture.frontmatter.process(CAPTURE_PATH, (current) => ({
      ...current,
      status: 'completed',
    }));
    await expect(fixture.service.list('en')).resolves.toEqual([]);
  });

  it('purges a completed Inbox capture once its knowledge note is confirmed', async () => {
    const fixture = fixtureFor('completed');
    fixture.capture.existingKnowledgePath = vaultPath(KNOWLEDGE_PATH);
    await fixture.vault.create(KNOWLEDGE_PATH, '# Knowledge\n');

    await expect(fixture.service.list('zh-CN')).resolves.toEqual([]);

    expect(await fixture.vault.exists(CAPTURE_PATH)).toBe(false);
  });

  it('retries only recoverable states, increments attempts, and clears safe errors', async () => {
    const fixture = fixtureFor('waiting_network');
    await fixture.frontmatter.process(CAPTURE_PATH, (current) => ({
      ...current,
      attempt_count: 2,
      last_error_code: 'NETWORK_UNAVAILABLE',
      last_error_message: 'Safe network error.',
    }));

    await fixture.service.retry(selfGrowID('capture-1'));

    await expect(fixture.frontmatter.read(CAPTURE_PATH)).resolves.toMatchObject({
      attempt_count: 3,
      checkpoint: 'received',
      last_error_code: '',
      last_error_message: '',
      status: 'queued',
    });
    await expect(fixture.service.retry(selfGrowID('capture-1'))).rejects.toMatchObject({
      code: 'INBOX_NOTE_INVALID',
    });
  });

  it('does not remove the Inbox capture until the committed knowledge note exists', async () => {
    const fixture = fixtureFor('generating');
    await expect(
      fixture.service.finish(fixture.capture, {
        knowledgePath: vaultPath(KNOWLEDGE_PATH),
        state: 'completed',
      }),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_NOTE_INVALID' });
    expect(await fixture.vault.exists(CAPTURE_PATH)).toBe(true);

    await fixture.vault.create(KNOWLEDGE_PATH, '# Knowledge\n');
    await fixture.service.finish(fixture.capture, {
      knowledgePath: vaultPath(KNOWLEDGE_PATH),
      state: 'completed',
    });
    expect(await fixture.vault.exists(CAPTURE_PATH)).toBe(false);
  });

  it('opens the completed knowledge note only after removing its Inbox capture', async () => {
    const events: string[] = [];
    const fixture = fixtureFor('generating', vaultPath(CAPTURE_PATH), async (path, vault) => {
      events.push(`${(await vault.exists(CAPTURE_PATH)) ? 'present' : 'removed'}:${path}`);
    });
    await fixture.vault.create(KNOWLEDGE_PATH, '# Knowledge\n');

    await fixture.service.finish(fixture.capture, {
      knowledgePath: vaultPath(KNOWLEDGE_PATH),
      state: 'completed',
    });

    expect(events).toEqual([`removed:${KNOWLEDGE_PATH}`]);
  });

  it('cleans captured body only after a durable terminal state and preserves YAML plus URL', async () => {
    const fixture = fixtureFor('extracting');
    await fixture.service.cleanupTemporary(fixture.capture);
    expect(await fixture.vault.read(CAPTURE_PATH)).toContain('private captured article body');

    await fixture.service.finish(fixture.capture, {
      code: 'article_body_missing',
      message: 'Complete content unavailable.',
      state: 'incomplete_extraction',
    });
    await fixture.service.cleanupTemporary(fixture.capture);

    const markdown = await fixture.vault.read(CAPTURE_PATH);
    expect(markdown).toBe('---\nselfgrow_capture: true\n---\nhttps://example.com/article\n');
    expect(markdown).not.toContain('private captured article body');
  });

  it('permanently deletes only a reconciled Markdown capture inside Inbox', async () => {
    const fixture = fixtureFor('failed');
    await fixture.service.permanentlyDelete(selfGrowID('capture-1'));
    expect(await fixture.vault.exists(CAPTURE_PATH)).toBe(false);

    const escaped = fixtureFor('failed', vaultPath('SelfGrow/Knowledge/Testing/note.md'));
    await expect(escaped.service.permanentlyDelete(selfGrowID('capture-1'))).rejects.toMatchObject({
      code: 'INBOX_NOTE_INVALID',
    });
  });

  it('keeps capture images for retry and deletes them with a completed or deleted capture', async () => {
    const imagePath = vaultPath('SelfGrow/Inbox/Attachments/capture.png');
    const fixture = fixtureFor('incomplete_extraction');
    fixture.capture.imagePaths = [imagePath];
    fixture.capture.capturedText = '用户补充文字';
    await fixture.vault.create(imagePath, 'binary fixture');
    await fixture.service.cleanupTemporary(fixture.capture);
    expect(await fixture.vault.exists(imagePath)).toBe(true);
    await fixture.service.permanentlyDelete(selfGrowID('capture-1'));
    expect(await fixture.vault.exists(imagePath)).toBe(false);
  });
});

function fixtureFor(
  state: ProcessingState,
  path = vaultPath(CAPTURE_PATH),
  onCompleted?: (path: VaultPath, vault: InMemoryVault) => Promise<void>,
) {
  const clock = new FixedTemporalContext('2026-08-09T08:00:00.000Z', 'Asia/Shanghai');
  const vault = new InMemoryVault(clock, [
    {
      content:
        '---\nselfgrow_capture: true\n---\nprivate captured article body https://example.com/article\n',
      path,
    },
  ]);
  const frontmatter = new InMemoryFrontmatter({
    [path]: {
      imported_at: '2026-08-09T08:00:00.000Z',
      selfgrow_capture: true,
      selfgrow_id: 'capture-1',
      source_url: 'https://example.com/article',
      status: state,
    },
  });
  const capture: ReconciledCapture = {
    captureMethod: 'share_sheet',
    existingKnowledgePath: null,
    id: selfGrowID('capture-1'),
    importedAt: '2026-08-09T08:00:00.000Z',
    normalizedURL: 'https://example.com/article',
    path,
    reconciliationKind: 'new',
    sourceURL: 'https://example.com/article',
    state,
  };
  const reconciler: InboxReconciliationPort = {
    async reconcile() {
      const current = await frontmatter.read(path);
      return [{ ...capture, state: (current?.status as ProcessingState | undefined) ?? state }];
    },
  };
  return {
    capture,
    frontmatter,
    service: new InboxOperationalService({
      frontmatter,
      ...(onCompleted === undefined
        ? {}
        : { onCompleted: (knowledgePath: VaultPath) => onCompleted(knowledgePath, vault) }),
      pathGuard: new PathGuard('SelfGrow', (value) => value.replaceAll('\\', '/')),
      reconciler,
      vault,
    }),
    vault,
  };
}
