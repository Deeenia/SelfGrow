import { SelfGrowError, type VaultPath } from '../domain';
import type { FrontmatterPort, TemporalContext, VaultTreePort } from '../platform/ports';
import type { KnowledgeCommitInput, KnowledgeNoteCommitPort } from '../processing';
import type { PathGuard } from '../vault';
import { serializeKnowledgeNoteContent } from './knowledge-note';
import { rawContentHash } from './raw-card';

export interface KnowledgeCommitIndexPort {
  indexNote(path: string): Promise<void>;
}

export interface CanonicalKnowledgeNoteCommitterDependencies {
  clock: TemporalContext;
  frontmatter: FrontmatterPort;
  index: KnowledgeCommitIndexPort;
  pathGuard: PathGuard;
  vault: VaultTreePort;
}

export class CanonicalKnowledgeNoteCommitter implements KnowledgeNoteCommitPort {
  readonly #clock: TemporalContext;
  readonly #frontmatter: FrontmatterPort;
  readonly #index: KnowledgeCommitIndexPort;
  readonly #pathGuard: PathGuard;
  readonly #vault: VaultTreePort;

  constructor(dependencies: CanonicalKnowledgeNoteCommitterDependencies) {
    this.#clock = dependencies.clock;
    this.#frontmatter = dependencies.frontmatter;
    this.#index = dependencies.index;
    this.#pathGuard = dependencies.pathGuard;
    this.#vault = dependencies.vault;
  }

  async commit(input: KnowledgeCommitInput): Promise<VaultPath> {
    const attachmentMoves = this.#attachmentMoves(
      input.capture.attachmentPaths ?? input.capture.imagePaths ?? [],
    );
    const markdown = serializeKnowledgeNoteContent({
      coreKnowledge: input.generated.coreKnowledge,
      attachmentPaths: attachmentMoves.map((move) => move.destination),
      imagePaths: attachmentMoves
        .filter((move) => isImagePath(move.destination))
        .map((move) => move.destination),
      outputLanguage: input.generated.outputLanguage,
      personalNoteMarkdown: '',
      sourceURL: input.capture.sourceURL,
      summaryMarkdown: input.generated.summaryMarkdown,
      title: input.generated.title,
    });
    const collectionRoot = this.#pathGuard.join(input.capture.collectionFolder ?? 'Project');
    const notePath = this.#pathGuard.assertDescendant(
      `${collectionRoot}/${knowledgeNoteFileName(input.generated.title)}`,
    );
    const noteExists = await this.#vault.exists(notePath);
    if (noteExists) {
      const existing = await this.#frontmatter.read(notePath);
      if (
        (existing?.selfgrow_id !== undefined && existing.selfgrow_id !== input.capture.id) ||
        (await this.#vault.read(notePath)) !== markdown
      ) {
        throw new SelfGrowError('DUPLICATE_URL', 'The knowledge note destination is occupied.');
      }
      if (existing?.selfgrow_id === input.capture.id) {
        await this.#index.indexNote(notePath);
        return notePath;
      }
    }

    for (const move of attachmentMoves) {
      if (await this.#vault.exists(move.source)) {
        if (await this.#vault.exists(move.destination)) {
          throw new SelfGrowError(
            'KNOWLEDGE_NOTE_INVALID',
            'A retained attachment already exists.',
          );
        }
        await this.#vault.move(move.source, move.destination);
      } else if (!(await this.#vault.exists(move.destination))) {
        throw new SelfGrowError('KNOWLEDGE_NOTE_INVALID', 'A capture attachment is missing.');
      }
    }
    if (!noteExists) {
      await this.#vault.create(notePath, markdown);
    }

    const completedAt = validNow(this.#clock);
    const contentHash = await rawContentHash(markdown);
    const github = input.content.github;
    await this.#frontmatter.process(notePath, (current) => ({
      ...current,
      ...(input.content.author === undefined ? {} : { source_author: input.content.author }),
      ...(input.content.canonicalURL === undefined
        ? {}
        : { canonical_url: input.content.canonicalURL }),
      ...(input.content.publishedAt === undefined
        ? {}
        : { source_published_at: input.content.publishedAt }),
      completed_at: completedAt,
      content_hash: contentHash,
      distillation_approved_hash: null,
      distillation_error: null,
      distillation_status: 'not_started',
      distilled_at: null,
      distilled_hash: null,
      ...(github === undefined
        ? {}
        : {
            github_readme_language: github.readmeLanguage,
            github_readme_path: github.readmePath,
            source_github_owner: github.owner,
            source_github_repo: github.repo,
          }),
      imported_at: input.capture.importedAt,
      normalized_url: input.capture.normalizedURL,
      output_language: input.generated.outputLanguage,
      recommendation_interested_keywords:
        input.generated.recommendation?.matchedInterestedKeywords ?? null,
      recommendation_preference_signals:
        input.generated.recommendation?.matchedPreferenceSignals ?? null,
      preference_profile_version: input.generated.recommendation?.profileVersion ?? null,
      preference_protocol_version: input.generated.recommendation?.protocolVersion ?? null,
      recommendation_reason: input.generated.recommendation?.reason ?? null,
      recommendation_score: input.generated.recommendation?.score ?? null,
      recommendation_status: input.generated.recommendationIssue ?? null,
      recommendation_uninterested_keywords:
        input.generated.recommendation?.matchedUninterestedKeywords ?? null,
      recognition_source: input.generated.recognitionSource,
      selfgrow: true,
      selfgrow_category: collectionFolderName(input.capture.collectionFolder),
      selfgrow_id: input.capture.id,
      selfgrow_layer: 'raw',
      selfgrow_schema: 2,
      source_language: input.generated.sourceLanguage,
      source_platform: input.content.platform,
      source_url: input.capture.sourceURL,
      status: 'completed',
      user_edited_at: null,
      wiki_selected: false,
      wiki_targets: [],
    }));
    await this.#index.indexNote(notePath);
    return notePath;
  }

  #attachmentMoves(paths: readonly VaultPath[]): Array<{
    destination: VaultPath;
    source: VaultPath;
  }> {
    const inboxAttachments = `${this.#pathGuard.join('Inbox', 'Attachments')}/`;
    return paths.map((rawPath) => {
      const source = this.#pathGuard.assertDescendant(rawPath);
      if (
        !source.startsWith(inboxAttachments) ||
        source.slice(inboxAttachments.length).includes('/')
      ) {
        throw new SelfGrowError('KNOWLEDGE_NOTE_INVALID', 'A capture attachment path is invalid.');
      }
      return {
        destination: this.#pathGuard.join('Attachments', source.slice(inboxAttachments.length)),
        source,
      };
    });
  }
}

function isImagePath(path: string): boolean {
  return /\.(?:gif|jpe?g|png|webp)$/i.test(path);
}

export function knowledgeNoteFileName(title: string): string {
  const safeTitle = replaceControlCharacters(title.normalize('NFKC'))
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[ .]+$/g, '')
    .trim()
    .slice(0, 100)
    .replace(/[ .]+$/g, '');
  return `${safeTitle || 'Knowledge'}.md`;
}

function replaceControlCharacters(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f ? '-' : character;
    })
    .join('');
}

function validNow(clock: TemporalContext): string {
  const now = clock.now();
  if (!Number.isFinite(now.getTime())) {
    throw new SelfGrowError('OBSIDIAN_API_FAILED', 'The completion time is invalid.');
  }
  return now.toISOString();
}

function collectionFolderName(value: string | undefined): string {
  const folder = value?.trim();
  return folder !== undefined && folder.length > 0 ? folder : 'Project';
}
