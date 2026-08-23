import {
  SelfGrowError,
  selfGrowID,
  type PreferenceRecommendation,
  type SelfGrowID,
  type VaultPath,
} from '../domain';
import type { Frontmatter, FrontmatterPort, VaultTreePort } from '../platform/ports';
import { z } from '../schema/zod';
import type { PathGuard } from '../vault';

export const DISTILLATION_STATUSES = [
  'not_started',
  'queued',
  'processing',
  'completed',
  'needs_update',
  'failed',
] as const;

export type DistillationStatus = (typeof DISTILLATION_STATUSES)[number];

export interface RawCardState {
  attachmentPaths: readonly VaultPath[];
  contentHash: string;
  distillationApprovedHash: string | null;
  distillationError: string | null;
  distillationStatus: DistillationStatus;
  distilledAt: string | null;
  distilledHash: string | null;
  id: SelfGrowID;
  imagePaths: readonly VaultPath[];
  modifiedAt: string;
  path: VaultPath;
  platform: string;
  previewMarkdown: string;
  recommendation: PreferenceRecommendation | null;
  sourceURL: string;
  title: string;
  wikiSelected: boolean;
  wikiTargets: readonly VaultPath[];
}

const identitySchema = z.object({
  selfgrow: z.literal(true),
  selfgrow_id: z.string().min(1),
  status: z.literal('completed'),
});

const rawV2Schema = identitySchema.extend({
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  distillation_approved_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  distillation_error: z.string().min(1).nullable(),
  distillation_status: z.enum(DISTILLATION_STATUSES),
  distilled_at: z.string().min(1).nullable(),
  distilled_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  preference_protocol_version: z.string().min(1).nullable().optional(),
  preference_profile_version: z.string().min(1).nullable().optional(),
  recommendation_interested_keywords: z
    .array(z.string().min(1).max(40))
    .max(30)
    .nullable()
    .optional(),
  recommendation_reason: z.string().min(1).nullable().optional(),
  recommendation_preference_signals: z
    .array(z.string().min(1).max(40))
    .max(40)
    .nullable()
    .optional(),
  recommendation_score: z.number().int().min(0).max(100).nullable().optional(),
  recommendation_uninterested_keywords: z
    .array(z.string().min(1).max(40))
    .max(30)
    .nullable()
    .optional(),
  selfgrow_layer: z.literal('raw'),
  selfgrow_schema: z.literal(2),
  wiki_selected: z.boolean(),
  wiki_targets: z.array(z.string().min(1)),
});

export interface RawCardServiceDependencies {
  frontmatter: FrontmatterPort;
  onDeleted?(path: VaultPath): Promise<void>;
  pathGuard: PathGuard;
  vault: VaultTreePort;
  wikiPathGuard: PathGuard;
}

export class RawCardService {
  readonly #frontmatter: FrontmatterPort;
  readonly #rawRoot: VaultPath;
  readonly #onDeleted: ((path: VaultPath) => Promise<void>) | undefined;
  readonly #pathGuard: PathGuard;
  readonly #vault: VaultTreePort;
  readonly #wikiPathGuard: PathGuard;
  readonly #wikiRoot: VaultPath;

  constructor(dependencies: RawCardServiceDependencies) {
    this.#frontmatter = dependencies.frontmatter;
    this.#onDeleted =
      dependencies.onDeleted === undefined
        ? undefined
        : async (path) => {
            await dependencies.onDeleted?.(path);
          };
    this.#pathGuard = dependencies.pathGuard;
    this.#wikiPathGuard = dependencies.wikiPathGuard;
    this.#vault = dependencies.vault;
    this.#rawRoot = dependencies.pathGuard.rootPath;
    this.#wikiRoot = dependencies.wikiPathGuard.rootPath;
  }

  async migrateAll(): Promise<number> {
    let migrated = 0;
    for (const rawPath of await this.#vault.listMarkdownFiles(this.#rawRoot)) {
      const path = this.#pathGuard.assertDescendant(rawPath);
      if (!isCollectionNote(path, this.#rawRoot)) continue;
      const frontmatter = await this.#frontmatter.read(path);
      if (!identitySchema.safeParse(frontmatter).success) continue;
      if (frontmatter?.selfgrow_schema !== 2) migrated += 1;
      await this.recompute(path);
    }
    return migrated;
  }

  async read(path: VaultPath): Promise<RawCardState> {
    return this.#load(path, false);
  }

  async list(): Promise<RawCardState[]> {
    const cards: RawCardState[] = [];
    for (const rawPath of await this.#vault.listMarkdownFiles(this.#rawRoot)) {
      const path = this.#pathGuard.assertDescendant(rawPath);
      if (!isCollectionNote(path, this.#rawRoot)) continue;
      const frontmatter = await this.#frontmatter.read(path);
      if (!identitySchema.safeParse(frontmatter).success) continue;
      cards.push(await this.recompute(path));
    }
    return cards.sort(
      (left, right) =>
        Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt) ||
        left.path.localeCompare(right.path),
    );
  }

  async recompute(path: VaultPath): Promise<RawCardState> {
    return this.#load(path, true);
  }

  async select(path: VaultPath): Promise<RawCardState> {
    const current = await this.recompute(path);
    return this.#update(path, {
      ...current,
      distillationApprovedHash: current.contentHash,
      distillationError: null,
      distillationStatus: 'queued',
      wikiSelected: true,
    });
  }

  async cancelSelection(path: VaultPath): Promise<RawCardState> {
    const current = await this.recompute(path);
    return this.#update(path, {
      ...current,
      distillationApprovedHash:
        current.distilledHash === null ? null : current.distillationApprovedHash,
      distillationError: null,
      distillationStatus: current.distilledHash === null ? 'not_started' : 'completed',
      wikiSelected: false,
    });
  }

  async confirmUpdate(path: VaultPath): Promise<RawCardState> {
    const current = await this.recompute(path);
    if (!current.wikiSelected || current.distillationStatus !== 'needs_update') {
      throw new SelfGrowError(
        'RAW_SELECTION_INVALID',
        'Only a selected changed Raw card can be approved again.',
      );
    }
    return this.#update(path, {
      ...current,
      distillationApprovedHash: current.contentHash,
      distillationError: null,
      distillationStatus: 'queued',
    });
  }

  async deleteRaw(path: VaultPath, confirmed: boolean): Promise<void> {
    if (!confirmed) {
      throw new SelfGrowError(
        'PERMANENT_DELETION_NOT_CONFIRMED',
        'Raw deletion requires confirmation.',
      );
    }
    const raw = await this.recompute(path);
    await this.#vault.delete(raw.path);
    await this.#onDeleted?.(raw.path);

    const remaining = await this.#vault.listMarkdownFiles(this.#rawRoot);
    for (const attachmentPath of raw.attachmentPaths) {
      if (!(await this.#vault.isFile(attachmentPath))) continue;
      let referenced = false;
      for (const candidate of remaining) {
        if ((await this.#vault.read(candidate)).includes(`![[${attachmentPath}`)) {
          referenced = true;
          break;
        }
      }
      if (!referenced) await this.#vault.delete(attachmentPath);
    }
  }

  async eligible(): Promise<RawCardState[]> {
    const eligible: RawCardState[] = [];
    for (const rawPath of await this.#vault.listMarkdownFiles(this.#rawRoot)) {
      const path = this.#pathGuard.assertDescendant(rawPath);
      if (!isCollectionNote(path, this.#rawRoot)) continue;
      const frontmatter = await this.#frontmatter.read(path);
      if (!identitySchema.safeParse(frontmatter).success) continue;
      const raw = await this.recompute(path);
      if (
        raw.wikiSelected &&
        raw.distillationStatus === 'queued' &&
        raw.distillationApprovedHash === raw.contentHash
      ) {
        eligible.push(raw);
      }
    }
    return eligible;
  }

  async #load(path: VaultPath, persist: boolean): Promise<RawCardState> {
    const safePath = this.#assertRawPath(path);
    const frontmatter = await this.#frontmatter.read(safePath);
    const identity = identitySchema.safeParse(frontmatter);
    if (!identity.success || frontmatter === null) throw invalidRaw(identity.error?.issues.length);

    const markdown = await this.#vault.read(safePath);
    const contentHash = await rawContentHash(markdown);
    const presentation = rawPresentation(
      markdown,
      frontmatter,
      safePath,
      this.#pathGuard,
      new Date((await this.#vault.stat(safePath)).mtime).toISOString(),
    );
    const parsed = rawV2Schema.safeParse(frontmatter);
    let state: RawCardState;
    if (!parsed.success) {
      if (frontmatter.selfgrow_schema === 2) throw invalidRaw(parsed.error.issues.length);
      state = {
        contentHash,
        distillationApprovedHash: null,
        distillationError: null,
        distillationStatus: 'not_started',
        distilledAt: null,
        distilledHash: null,
        id: selfGrowID(identity.data.selfgrow_id),
        ...presentation,
        path: safePath,
        recommendation: readRecommendation(frontmatter),
        wikiSelected: false,
        wikiTargets: [],
      };
    } else {
      const changed = parsed.data.content_hash !== contentHash;
      state = {
        contentHash,
        distillationApprovedHash: parsed.data.distillation_approved_hash,
        distillationError: parsed.data.distillation_error,
        distillationStatus:
          changed &&
          (parsed.data.distillation_approved_hash !== null || parsed.data.distilled_hash !== null)
            ? 'needs_update'
            : parsed.data.distillation_status,
        distilledAt: parsed.data.distilled_at,
        distilledHash: parsed.data.distilled_hash,
        id: selfGrowID(parsed.data.selfgrow_id),
        ...presentation,
        path: safePath,
        recommendation: readRecommendation(parsed.data),
        wikiSelected: parsed.data.wiki_selected,
        wikiTargets: parsed.data.wiki_targets.map((target) => this.#assertWikiTarget(target)),
      };
    }

    if (persist && (!parsed.success || !samePersistedState(parsed.data, state))) {
      await this.#write(safePath, frontmatter, state);
    }
    return state;
  }

  async #update(path: VaultPath, state: RawCardState): Promise<RawCardState> {
    const frontmatter = await this.#frontmatter.read(this.#assertRawPath(path));
    if (frontmatter === null) throw invalidRaw();
    await this.#write(path, frontmatter, state);
    return state;
  }

  async #write(path: VaultPath, current: Frontmatter, state: RawCardState): Promise<void> {
    await this.#frontmatter.process(path, () => ({
      ...current,
      content_hash: state.contentHash,
      distillation_approved_hash: state.distillationApprovedHash,
      distillation_error: state.distillationError,
      distillation_status: state.distillationStatus,
      distilled_at: state.distilledAt,
      distilled_hash: state.distilledHash,
      selfgrow_layer: 'raw',
      selfgrow_schema: 2,
      ...(current.selfgrow_schema === 2 && current.content_hash !== state.contentHash
        ? { user_edited_at: state.modifiedAt }
        : {}),
      wiki_selected: state.wikiSelected,
      wiki_targets: state.wikiTargets.map((target) => this.#portableWikiTarget(target)),
    }));
  }

  #assertRawPath(path: string): VaultPath {
    const safePath = this.#pathGuard.assertDescendant(path);
    if (!isCollectionNote(safePath, this.#rawRoot)) {
      throw invalidRaw();
    }
    return safePath;
  }

  #assertWikiTarget(path: string): VaultPath {
    const safePath = path.startsWith('Wiki/')
      ? this.#wikiPathGuard.join(path.slice('Wiki/'.length))
      : this.#wikiPathGuard.assertDescendant(path);
    if (!safePath.startsWith(`${this.#wikiRoot}/`) || !safePath.endsWith('.md')) {
      throw invalidRaw();
    }
    return safePath;
  }

  #portableWikiTarget(path: VaultPath): string {
    const safePath = this.#assertWikiTarget(path);
    return `Wiki/${safePath.slice(`${this.#wikiRoot}/`.length)}`;
  }
}

function isCollectionNote(path: VaultPath, root: VaultPath): boolean {
  const [folder, file, extra] = path.slice(root.length + 1).split('/');
  return (
    extra === undefined &&
    folder !== undefined &&
    file !== undefined &&
    folder !== 'Inbox' &&
    folder !== 'Attachments' &&
    file.endsWith('.md')
  );
}

export type RawReviewGroup = 'unselected' | 'queued' | 'completed' | 'needs_update' | 'failed';

export function rawReviewGroup(raw: RawCardState): RawReviewGroup {
  if (raw.distillationStatus === 'queued' || raw.distillationStatus === 'processing') {
    return 'queued';
  }
  if (raw.distillationStatus === 'completed') return 'completed';
  if (raw.distillationStatus === 'needs_update') return 'needs_update';
  if (raw.distillationStatus === 'failed') return 'failed';
  return 'unselected';
}

export async function rawContentHash(markdown: string): Promise<string> {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/, '');
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.replaceAll('\r\n', '\n'))),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function rawPresentation(
  markdown: string,
  frontmatter: Frontmatter,
  path: VaultPath,
  pathGuard: PathGuard,
  modifiedAt: string,
): Pick<
  RawCardState,
  | 'attachmentPaths'
  | 'imagePaths'
  | 'modifiedAt'
  | 'platform'
  | 'previewMarkdown'
  | 'sourceURL'
  | 'title'
> {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/, '');
  const segments = path.split('/');
  const title =
    /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ??
    segments[segments.length - 1]?.replace(/\.md$/i, '') ??
    path;
  const preview =
    sectionByHeading(body, ['Selection Preview', '筛选预览', 'AI Summary', 'AI 摘要']) ||
    sectionByHeading(body, ['Content', '内容']);
  const attachmentRoot = `${pathGuard.join('Attachments')}/`;
  const attachmentPaths = [...body.matchAll(/!\[\[([^|#\]\n]+)(?:[|#][^\]\n]*)?\]\]/g)]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined && value.startsWith(attachmentRoot))
    .map((value) => pathGuard.assertDescendant(value));
  const recordedTime = [
    frontmatter.user_edited_at,
    frontmatter.completed_at,
    frontmatter.imported_at,
  ].find(
    (value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)),
  );
  return {
    attachmentPaths,
    imagePaths: attachmentPaths.filter((path) => /\.(?:gif|jpe?g|png|webp)$/i.test(path)),
    modifiedAt: recordedTime ?? modifiedAt,
    platform: typeof frontmatter.source_platform === 'string' ? frontmatter.source_platform : '',
    previewMarkdown: preview.replace(/!\[\[[^\]\n]+\]\]/g, '').trim(),
    sourceURL: typeof frontmatter.source_url === 'string' ? frontmatter.source_url : '',
    title,
  };
}

function sectionByHeading(markdown: string, labels: readonly string[]): string {
  for (const label of labels) {
    const heading = new RegExp(`^##\\s+${label.replace(' ', '\\s+')}\\s*$`, 'm').exec(markdown);
    if (heading === null) continue;
    const rest = markdown.slice(heading.index + heading[0].length);
    const next = /^##\s+/m.exec(rest);
    return rest.slice(0, next?.index ?? rest.length).trim();
  }
  return '';
}

function samePersistedState(persisted: z.infer<typeof rawV2Schema>, state: RawCardState): boolean {
  return (
    persisted.content_hash === state.contentHash &&
    persisted.distillation_status === state.distillationStatus
  );
}

function readRecommendation(frontmatter: Frontmatter): PreferenceRecommendation | null {
  const version = frontmatter.preference_protocol_version;
  const reason = frontmatter.recommendation_reason;
  const score = frontmatter.recommendation_score;
  if (
    typeof version !== 'string' ||
    version.length === 0 ||
    typeof reason !== 'string' ||
    reason.length === 0 ||
    typeof score !== 'number' ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > 100
  ) {
    return null;
  }
  return {
    matchedInterestedKeywords: readKeywordMatches(frontmatter.recommendation_interested_keywords),
    matchedPreferenceSignals: readKeywordMatches(frontmatter.recommendation_preference_signals),
    matchedUninterestedKeywords: readKeywordMatches(
      frontmatter.recommendation_uninterested_keywords,
    ),
    profileVersion:
      typeof frontmatter.preference_profile_version === 'string'
        ? frontmatter.preference_profile_version
        : null,
    protocolVersion: version,
    reason,
    score,
  };
}

function readKeywordMatches(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (keyword): keyword is string =>
      typeof keyword === 'string' && keyword.length > 0 && keyword.length <= 40,
  );
}

function invalidRaw(issueCount?: number): SelfGrowError {
  return new SelfGrowError('KNOWLEDGE_NOTE_INVALID', 'Raw card metadata is invalid.', {
    ...(issueCount === undefined ? {} : { issueCount }),
  });
}
