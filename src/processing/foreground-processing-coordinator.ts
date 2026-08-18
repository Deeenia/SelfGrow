import {
  isSelfGrowError,
  type GeneratedKnowledge,
  type InboxCapture,
  type Language,
  type ProcessingState,
  type VaultPath,
} from '../domain';
import type { ContentExtractor, ExtractedContent } from '../extraction';
import type { NormalizedURL } from '../url';

const STAGE_ORDER: Readonly<Partial<Record<ProcessingState, number>>> = {
  queued: 0,
  extracting: 1,
  generating: 2,
};

export interface ProcessingURLPort {
  normalize(input: string): Promise<NormalizedURL>;
}

export interface KnowledgeGenerationPort {
  generate(content: ExtractedContent, language: Language): Promise<GeneratedKnowledge>;
}

export interface KnowledgeNoteCommitPort {
  /** Implementations must make retries for the same capture ID idempotent. */
  commit(input: KnowledgeCommitInput): Promise<VaultPath>;
}

export interface ProcessingInboxPort {
  checkpoint(capture: InboxCapture, state: ProcessingState): Promise<void>;
  cleanupTemporary(capture: InboxCapture): Promise<void>;
  finish(capture: InboxCapture, result: ProcessingTerminalResult): Promise<void>;
  listEligible(): Promise<readonly InboxCapture[]>;
}

export interface ProcessingArtifact {
  capture: InboxCapture;
  content: ExtractedContent;
  generated: GeneratedKnowledge;
}

export type KnowledgeCommitInput = ProcessingArtifact;

export type ProcessingTerminalResult =
  | { knowledgePath: VaultPath; state: 'completed' }
  | { code: string; message: string; state: 'failed' | 'incomplete_extraction' };

export type ProcessNextResult =
  | { kind: 'busy' }
  | { kind: 'idle' }
  | { captureID: string; kind: 'processed'; state: ProcessingState };

export interface ForegroundProcessingCoordinatorDependencies {
  extractor: ContentExtractor;
  generator: KnowledgeGenerationPort;
  inbox: ProcessingInboxPort;
  language: Language;
  notes: KnowledgeNoteCommitPort;
  urls: ProcessingURLPort;
}

export class ForegroundProcessingCoordinator {
  readonly #dependencies: ForegroundProcessingCoordinatorDependencies;
  readonly #lockedURLs = new Set<string>();
  #running = false;

  constructor(dependencies: ForegroundProcessingCoordinatorDependencies) {
    this.#dependencies = dependencies;
  }

  async processNext(): Promise<ProcessNextResult> {
    if (this.#running) return { kind: 'busy' };
    this.#running = true;

    try {
      const capture = [...(await this.#dependencies.inbox.listEligible())].sort(
        (left, right) =>
          Date.parse(left.importedAt) - Date.parse(right.importedAt) ||
          left.path.localeCompare(right.path),
      )[0];
      if (capture === undefined) return { kind: 'idle' };
      if (this.#lockedURLs.has(capture.normalizedURL)) return { kind: 'busy' };

      this.#lockedURLs.add(capture.normalizedURL);
      try {
        return await this.#process(capture);
      } finally {
        this.#lockedURLs.delete(capture.normalizedURL);
      }
    } finally {
      this.#running = false;
    }
  }

  async #process(capture: InboxCapture): Promise<ProcessNextResult> {
    let terminal = false;
    let committed = false;
    try {
      const url = capture.sourceURL.startsWith('selfgrow:text:')
        ? {
            normalized: capture.sourceURL,
            platform: 'unknown' as const,
            received: capture.sourceURL,
          }
        : await this.#dependencies.urls.normalize(capture.sourceURL);
      await this.#advance(capture, 'extracting');
      const extraction = await this.#dependencies.extractor.extract({
        ...(capture.capturedText === undefined ? {} : { capturedText: capture.capturedText }),
        id: capture.id,
        ...(capture.imagePaths === undefined ? {} : { imagePaths: capture.imagePaths }),
        language: this.#dependencies.language,
        ...(capture.captureTitle === undefined ? {} : { suggestedTitle: capture.captureTitle }),
        url,
      });

      if (extraction.kind === 'incomplete') {
        await this.#dependencies.inbox.finish(capture, {
          code: extraction.code,
          message: extraction.message,
          state: 'incomplete_extraction',
        });
        terminal = true;
        return { captureID: capture.id, kind: 'processed', state: 'incomplete_extraction' };
      }

      await this.#advance(capture, 'generating');
      const generated = await this.#dependencies.generator.generate(
        extraction.content,
        this.#dependencies.language,
      );
      const artifact = { capture, content: extraction.content, generated };

      const knowledgePath = await this.#dependencies.notes.commit(artifact);
      committed = true;

      await this.#dependencies.inbox.finish(capture, { knowledgePath, state: 'completed' });
      terminal = true;
      return { captureID: capture.id, kind: 'processed', state: 'completed' };
    } catch (error) {
      // Once the canonical note exists, preserve the Inbox item and retry only the
      // idempotent commit/finalization boundary on the next run.
      if (committed) {
        return { captureID: capture.id, kind: 'processed', state: 'generating' };
      }
      const waitingState = waitingStateFor(error);
      if (waitingState !== null) {
        await this.#dependencies.inbox.checkpoint(capture, waitingState);
        return { captureID: capture.id, kind: 'processed', state: waitingState };
      }

      const failure = safeFailure(error);
      await this.#dependencies.inbox.finish(capture, { ...failure, state: 'failed' });
      terminal = true;
      return { captureID: capture.id, kind: 'processed', state: 'failed' };
    } finally {
      if (terminal) await this.#dependencies.inbox.cleanupTemporary(capture);
    }
  }

  async #advance(capture: InboxCapture, state: ProcessingState): Promise<void> {
    const currentOrder = STAGE_ORDER[capture.state];
    const nextOrder = STAGE_ORDER[state];
    if (nextOrder !== undefined && (currentOrder === undefined || nextOrder > currentOrder)) {
      await this.#dependencies.inbox.checkpoint(capture, state);
    }
  }
}

function waitingStateFor(error: unknown): 'waiting_ai_configuration' | 'waiting_network' | null {
  if (!isSelfGrowError(error)) return null;
  if (error.code === 'NETWORK_UNAVAILABLE') return 'waiting_network';
  if (
    error.code === 'AI_CONFIGURATION_MISSING' ||
    error.code === 'SECRET_NOT_FOUND' ||
    error.code === 'AI_AUTHENTICATION_FAILED' ||
    error.code === 'AI_MODEL_NOT_FOUND'
  ) {
    return 'waiting_ai_configuration';
  }
  return null;
}

function safeFailure(error: unknown): { code: string; message: string } {
  if (isSelfGrowError(error)) return { code: error.code, message: error.message };
  return { code: 'OBSIDIAN_API_FAILED', message: 'Foreground processing failed.' };
}
