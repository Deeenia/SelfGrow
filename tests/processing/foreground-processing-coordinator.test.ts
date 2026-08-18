import { describe, expect, it } from 'vitest';
import {
  SelfGrowError,
  selfGrowID,
  vaultPath,
  type GeneratedKnowledge,
  type InboxCapture,
  type ProcessingState,
  type VaultPath,
} from '../../src/domain';
import type { ContentExtractor, ExtractedContent, ExtractionOutcome } from '../../src/extraction';
import { parseKnowledgeNoteContent, serializeKnowledgeNoteContent } from '../../src/knowledge';
import {
  ForegroundProcessingCoordinator,
  type ForegroundProcessingCoordinatorDependencies,
  type KnowledgeCommitInput,
  type ProcessingInboxPort,
  type ProcessingTerminalResult,
} from '../../src/processing';

const CONTENT: ExtractedContent = {
  body: 'A complete fixture article. '.repeat(20),
  bodyKind: 'article',
  finalURL: 'https://example.com/article',
  platform: 'generic_web',
  route: 'captured_text',
  sourceLanguage: 'en',
  title: 'Fixture source',
};

const GENERATED: GeneratedKnowledge = {
  category: 'Project',
  coreKnowledge: [{ explanationMarkdown: 'A durable explanation.', title: 'Key idea' }],
  githubQueries: [],
  outputLanguage: 'en',
  recognitionSource: 'local',
  sourceLanguage: 'en',
  summaryMarkdown: 'A concise generated summary.',
  title: 'Fixture knowledge',
};

describe('ForegroundProcessingCoordinator', () => {
  it('runs the full fixture pipeline and commits canonical Markdown before Inbox cleanup', async () => {
    const events: string[] = [];
    let committedMarkdown = '';
    const capture = captureFixture();
    const dependencies = dependenciesFixture([capture], events);
    dependencies.notes = {
      commit(input) {
        events.push('commit');
        committedMarkdown = canonicalMarkdown(input);
        return Promise.resolve(vaultPath('SelfGrow/Knowledge/Fixture knowledge.md'));
      },
    };

    const result = await new ForegroundProcessingCoordinator(dependencies).processNext();

    expect(result).toEqual({ captureID: capture.id, kind: 'processed', state: 'completed' });
    expect(events).toEqual([
      'list',
      'checkpoint:extracting',
      'extract',
      'checkpoint:generating',
      'generate',
      'commit',
      'finish:completed',
      'cleanup',
    ]);
    expect(parseKnowledgeNoteContent(committedMarkdown, 'en')).toMatchObject({
      sourceURL: capture.sourceURL,
      summaryMarkdown: GENERATED.summaryMarkdown,
      title: GENERATED.title,
    });
  });

  it('allows only one foreground run and chooses the oldest eligible capture', async () => {
    const events: string[] = [];
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const newer = captureFixture({ id: 'newer', importedAt: '2026-08-09T02:00:00.000Z' });
    const older = captureFixture({ id: 'older', importedAt: '2026-08-09T01:00:00.000Z' });
    const dependencies = dependenciesFixture([newer, older], events);
    dependencies.extractor = {
      id: 'blocking-fixture',
      canHandle: () => true,
      async extract(request) {
        events.push(`extract:${request.id}`);
        await blocked;
        return { content: CONTENT, kind: 'complete' };
      },
    };
    const coordinator = new ForegroundProcessingCoordinator(dependencies);

    const first = coordinator.processNext();
    await until(() => events.some((event) => event.startsWith('extract:')));
    await expect(coordinator.processNext()).resolves.toEqual({ kind: 'busy' });
    release?.();
    await expect(first).resolves.toMatchObject({ captureID: older.id, state: 'completed' });
  });

  it('safely reconstructs earlier artifacts after reload and advances from its durable stage', async () => {
    const events: string[] = [];
    const resumed = captureFixture({ state: 'generating' });
    const coordinatorAfterReload = new ForegroundProcessingCoordinator(
      dependenciesFixture([resumed], events),
    );

    await expect(coordinatorAfterReload.processNext()).resolves.toMatchObject({
      state: 'completed',
    });
    expect(events).toContain('extract');
    expect(events).toContain('generate');
    expect(events.filter((event) => event.startsWith('checkpoint:'))).toEqual([]);
  });

  it.each([
    ['NETWORK_UNAVAILABLE', 'waiting_network'],
    ['AI_CONFIGURATION_MISSING', 'waiting_ai_configuration'],
    ['SECRET_NOT_FOUND', 'waiting_ai_configuration'],
  ] as const)('preserves temporary input for recoverable %s states', async (code, state) => {
    const events: string[] = [];
    const dependencies = dependenciesFixture([captureFixture()], events);
    dependencies.generator = {
      generate() {
        throw new SelfGrowError(code, 'Safe recoverable failure.');
      },
    };

    await expect(
      new ForegroundProcessingCoordinator(dependencies).processNext(),
    ).resolves.toMatchObject({ state });
    expect(events).toContain(`checkpoint:${state}`);
    expect(events).not.toContain('cleanup');
  });

  it('keeps incomplete extraction visible and cleans terminal temporary content', async () => {
    const events: string[] = [];
    const dependencies = dependenciesFixture([captureFixture()], events);
    dependencies.extractor = extractionFixture(
      {
        code: 'article_body_missing',
        kind: 'incomplete',
        message: 'Complete text was unavailable.',
      },
      events,
    );

    await expect(
      new ForegroundProcessingCoordinator(dependencies).processNext(),
    ).resolves.toMatchObject({ state: 'incomplete_extraction' });
    expect(events.slice(-2)).toEqual(['finish:incomplete_extraction', 'cleanup']);
  });

  it('uses a safe failure record and cleans temporary content on terminal failure', async () => {
    const events: string[] = [];
    const dependencies = dependenciesFixture([captureFixture()], events);
    dependencies.notes = {
      commit() {
        throw new Error('raw provider detail must not be retained');
      },
    };

    await expect(
      new ForegroundProcessingCoordinator(dependencies).processNext(),
    ).resolves.toMatchObject({ state: 'failed' });
    expect(events.slice(-2)).toEqual(['finish:failed', 'cleanup']);
  });

  it('preserves the Inbox input when finalization fails after the note commit', async () => {
    const events: string[] = [];
    const capture = captureFixture();
    const dependencies = dependenciesFixture([capture], events);
    const baseInbox = dependencies.inbox;
    dependencies.inbox = {
      checkpoint: (item, state) => baseInbox.checkpoint(item, state),
      cleanupTemporary: (item) => baseInbox.cleanupTemporary(item),
      finish(item, result) {
        if (result.state === 'completed') {
          events.push('finish:completed:failed');
          throw new SelfGrowError('OBSIDIAN_API_FAILED', 'Inbox finalization failed.');
        }
        return baseInbox.finish(item, result);
      },
      listEligible: () => baseInbox.listEligible(),
    };

    await expect(new ForegroundProcessingCoordinator(dependencies).processNext()).resolves.toEqual({
      captureID: capture.id,
      kind: 'processed',
      state: 'generating',
    });
    expect(events).toContain('commit');
    expect(events).toContain('finish:completed:failed');
    expect(events).not.toContain('cleanup');
    expect(events).not.toContain('finish:failed');
  });
});

function dependenciesFixture(
  captures: readonly InboxCapture[],
  events: string[],
): ForegroundProcessingCoordinatorDependencies {
  return {
    extractor: extractionFixture({ content: CONTENT, kind: 'complete' }, events),
    generator: {
      generate() {
        events.push('generate');
        return Promise.resolve(GENERATED);
      },
    },
    inbox: new FixtureInbox(captures, events),
    language: 'en',
    notes: {
      commit(input) {
        events.push('commit');
        return Promise.resolve(vaultPath('SelfGrow/Knowledge/Fixture knowledge.md'));
      },
    },
    urls: {
      normalize(input) {
        return Promise.resolve({ normalized: input, platform: 'generic_web', received: input });
      },
    },
  };
}

class FixtureInbox implements ProcessingInboxPort {
  readonly #captures: readonly InboxCapture[];
  readonly #events: string[];

  constructor(captures: readonly InboxCapture[], events: string[]) {
    this.#captures = captures;
    this.#events = events;
  }

  checkpoint(_capture: InboxCapture, state: ProcessingState): Promise<void> {
    this.#events.push(`checkpoint:${state}`);
    return Promise.resolve();
  }

  cleanupTemporary(): Promise<void> {
    this.#events.push('cleanup');
    return Promise.resolve();
  }

  finish(_capture: InboxCapture, result: ProcessingTerminalResult): Promise<void> {
    this.#events.push(`finish:${result.state}`);
    return Promise.resolve();
  }

  listEligible(): Promise<readonly InboxCapture[]> {
    this.#events.push('list');
    return Promise.resolve(this.#captures);
  }
}

function extractionFixture(outcome: ExtractionOutcome, events: string[]): ContentExtractor {
  return {
    id: 'fixture-extractor',
    canHandle: () => true,
    extract() {
      events.push('extract');
      return Promise.resolve(outcome);
    },
  };
}

function captureFixture(
  patch: Partial<Omit<InboxCapture, 'id' | 'path'>> & { id?: string; path?: VaultPath } = {},
): InboxCapture {
  const { id, path, ...fields } = patch;
  return {
    capturedText: CONTENT.body,
    captureMethod: 'share_sheet',
    id: selfGrowID(id ?? 'capture-1'),
    importedAt: '2026-08-09T01:00:00.000Z',
    normalizedURL: CONTENT.finalURL,
    path: path ?? vaultPath('SelfGrow/Inbox/capture-1.md'),
    sourceURL: CONTENT.finalURL,
    state: 'queued',
    ...fields,
  };
}

function canonicalMarkdown(input: KnowledgeCommitInput): string {
  return serializeKnowledgeNoteContent({
    coreKnowledge: input.generated.coreKnowledge,
    imagePaths: input.capture.imagePaths ?? [],
    outputLanguage: input.generated.outputLanguage,
    personalNoteMarkdown: '',
    sourceURL: input.capture.sourceURL,
    summaryMarkdown: input.generated.summaryMarkdown,
    title: input.generated.title,
  });
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) {
    await Promise.resolve();
  }
  if (!predicate()) throw new Error('Fixture condition was not reached.');
}
