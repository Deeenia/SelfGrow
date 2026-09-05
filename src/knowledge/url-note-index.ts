import { SelfGrowError, selfGrowID, type SelfGrowID, type VaultPath } from '../domain';
import type { Frontmatter, FrontmatterPort, VaultPort } from '../platform/ports';
import { z } from '../schema/zod';
import type { PathGuard } from '../vault';

const identitySchema = z.object({
  normalized_url: z.string().min(1),
  selfgrow: z.literal(true),
  selfgrow_id: z.string().min(1),
  status: z.literal('completed'),
});

const snapshotSchema = z.strictObject({
  byNormalizedURL: z.record(z.string(), z.string().min(1)),
  bySelfGrowID: z.record(z.string(), z.string().min(1)),
  schemaVersion: z.literal(1),
});

export interface URLIndexSnapshot {
  byNormalizedURL: Record<string, string>;
  bySelfGrowID: Record<string, string>;
  schemaVersion: 1;
}

interface IndexedIdentity {
  id: SelfGrowID;
  normalizedURL: string;
  path: VaultPath;
}

export class URLNoteIndex {
  readonly #byID = new Map<SelfGrowID, VaultPath>();
  readonly #byPath = new Map<VaultPath, IndexedIdentity>();
  readonly #byURL = new Map<string, VaultPath>();
  readonly #frontmatter: FrontmatterPort;
  readonly #rawRoot: VaultPath;
  readonly #pathGuard: PathGuard;
  readonly #vault: VaultPort;

  constructor(vault: VaultPort, frontmatter: FrontmatterPort, pathGuard: PathGuard) {
    this.#vault = vault;
    this.#frontmatter = frontmatter;
    this.#pathGuard = pathGuard;
    this.#rawRoot = pathGuard.rootPath;
  }

  get size(): number {
    return this.#byPath.size;
  }

  async rebuild(): Promise<number> {
    const next: IndexedIdentity[] = [];
    for (const rawPath of await this.#vault.listMarkdownFiles(this.#rawRoot)) {
      const candidate = this.#pathGuard.assertDescendant(rawPath);
      if (!isCollectionNote(candidate, this.#rawRoot)) continue;
      const path = this.#assertKnowledgeNotePath(rawPath);
      const frontmatter = await this.#frontmatter.read(path);
      if (frontmatter === null) continue;
      const parsed = identitySchema.safeParse(frontmatter);
      if (!parsed.success) continue;
      next.push({
        id: selfGrowID(parsed.data.selfgrow_id),
        normalizedURL: parsed.data.normalized_url,
        path,
      });
    }

    this.#replaceAll(deduplicateRebuildIdentities(next));
    return this.size;
  }

  async indexNote(path: string, frontmatter?: Frontmatter): Promise<void> {
    const normalizedPath = this.#assertKnowledgeNotePath(path);
    const source = frontmatter ?? (await this.#frontmatter.read(normalizedPath));
    const parsed = identitySchema.safeParse(source);
    if (!parsed.success) {
      throw new SelfGrowError('KNOWLEDGE_NOTE_INVALID', 'Knowledge note identity is invalid.', {
        issueCount: parsed.error.issues.length,
      });
    }
    const identity = {
      id: selfGrowID(parsed.data.selfgrow_id),
      normalizedURL: parsed.data.normalized_url,
      path: normalizedPath,
    };
    await this.#removeMissingConflicts(identity);
    this.#assertInsertable(identity, new Set([normalizedPath]));
    this.#removeExact(normalizedPath);
    this.#insert(identity);
  }

  async findByNormalizedURL(url: string): Promise<VaultPath | null> {
    const path = this.#byURL.get(url) ?? null;
    if (path === null) return null;
    if (await this.#vault.exists(path)) return path;
    this.#removeExact(path);
    return null;
  }

  findBySelfGrowID(id: SelfGrowID): VaultPath | null {
    return this.#byID.get(id) ?? null;
  }

  movePath(from: string, to: string): void {
    const source = this.#assertKnowledgeNotePath(from);
    const destination = this.#assertKnowledgeNotePath(to);
    if (source === destination) return;
    const identity = this.#byPath.get(source);
    if (identity === undefined) return;
    const moved = { ...identity, path: destination };
    this.#assertInsertable(moved, new Set([source]));
    this.#removeExact(source);
    this.#insert(moved);
  }

  moveSubtree(from: string, to: string): void {
    const source = this.#assertKnowledgeFolderPath(from);
    const destination = this.#assertKnowledgeFolderPath(to);
    if (source === destination) return;
    const moves = [...this.#byPath.values()]
      .filter((identity) => identity.path.startsWith(`${source}/`))
      .map((identity) => ({
        from: identity.path,
        identity,
        to: this.#assertKnowledgeNotePath(`${destination}${identity.path.slice(source.length)}`),
      }));
    const replacing = new Set(moves.map((move) => move.from));
    for (const move of moves) {
      this.#assertInsertable({ ...move.identity, path: move.to }, replacing);
    }
    for (const move of moves) this.#removeExact(move.from);
    for (const move of moves) this.#insert({ ...move.identity, path: move.to });
  }

  removePath(path: string): void {
    this.#removeExact(this.#assertKnowledgeNotePath(path));
  }

  removeSubtree(path: string): void {
    const root = this.#assertKnowledgeFolderPath(path);
    for (const indexedPath of [...this.#byPath.keys()]) {
      if (indexedPath.startsWith(`${root}/`)) this.#removeExact(indexedPath);
    }
  }

  async updateImportTimeForURL(url: string, importedAt: string): Promise<VaultPath | null> {
    const path = await this.findByNormalizedURL(url);
    if (path === null) return null;
    if (!Number.isFinite(Date.parse(importedAt))) {
      throw new SelfGrowError('KNOWLEDGE_NOTE_INVALID', 'Re-import time is invalid.');
    }
    await this.#frontmatter.process(path, (current) => ({ ...current, imported_at: importedAt }));
    return path;
  }

  snapshot(): URLIndexSnapshot {
    return {
      byNormalizedURL: Object.fromEntries([...this.#byURL.entries()].sort()),
      bySelfGrowID: Object.fromEntries(
        [...this.#byID.entries()]
          .map(([id, path]) => [id as string, path as string] as const)
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
      schemaVersion: 1,
    };
  }

  load(input: unknown): void {
    const result = snapshotSchema.safeParse(input);
    if (!result.success) {
      throw new SelfGrowError('OBSIDIAN_API_FAILED', 'Stored URL index is invalid.', {
        issueCount: result.error.issues.length,
      });
    }
    const identities: IndexedIdentity[] = [];
    for (const [rawID, rawPath] of Object.entries(result.data.bySelfGrowID)) {
      const path = this.#assertKnowledgeNotePath(rawPath);
      const normalizedURL = Object.entries(result.data.byNormalizedURL).find(
        ([, urlPath]) => urlPath === rawPath,
      )?.[0];
      if (normalizedURL === undefined) {
        throw new SelfGrowError('OBSIDIAN_API_FAILED', 'Stored URL index maps are inconsistent.');
      }
      identities.push({ id: selfGrowID(rawID), normalizedURL, path });
    }
    if (identities.length !== Object.keys(result.data.byNormalizedURL).length) {
      throw new SelfGrowError('OBSIDIAN_API_FAILED', 'Stored URL index maps are inconsistent.');
    }
    this.#replaceAll(identities);
  }

  #insert(identity: IndexedIdentity): void {
    this.#assertInsertable(identity, new Set());
    this.#byPath.set(identity.path, identity);
    this.#byURL.set(identity.normalizedURL, identity.path);
    this.#byID.set(identity.id, identity.path);
  }

  async #removeMissingConflicts(identity: IndexedIdentity): Promise<void> {
    const paths = new Set(
      [
        this.#byURL.get(identity.normalizedURL),
        this.#byID.get(identity.id),
        this.#byPath.get(identity.path)?.path,
      ].filter((path): path is VaultPath => path !== undefined),
    );
    for (const path of paths) {
      if (!(await this.#vault.exists(path))) this.#removeExact(path);
    }
  }

  #assertInsertable(identity: IndexedIdentity, replacing: ReadonlySet<VaultPath>): void {
    const urlPath = this.#byURL.get(identity.normalizedURL);
    const idPath = this.#byID.get(identity.id);
    const pathIdentity = this.#byPath.get(identity.path);
    if (
      (urlPath !== undefined && !replacing.has(urlPath)) ||
      (idPath !== undefined && !replacing.has(idPath)) ||
      (pathIdentity !== undefined && !replacing.has(identity.path))
    ) {
      throw new SelfGrowError('DUPLICATE_URL', 'Knowledge note identity is duplicated.');
    }
  }

  #removeExact(path: VaultPath): void {
    const identity = this.#byPath.get(path);
    if (identity === undefined) return;
    this.#byPath.delete(path);
    this.#byURL.delete(identity.normalizedURL);
    this.#byID.delete(identity.id);
  }

  #clear(): void {
    this.#byID.clear();
    this.#byPath.clear();
    this.#byURL.clear();
  }

  #replaceAll(identities: readonly IndexedIdentity[]): void {
    const paths = new Set<VaultPath>();
    const ids = new Set<SelfGrowID>();
    const urls = new Set<string>();
    for (const identity of identities) {
      if (paths.has(identity.path) || ids.has(identity.id) || urls.has(identity.normalizedURL)) {
        throw new SelfGrowError('DUPLICATE_URL', 'Knowledge note identity is duplicated.');
      }
      paths.add(identity.path);
      ids.add(identity.id);
      urls.add(identity.normalizedURL);
    }
    this.#clear();
    for (const identity of identities) this.#insert(identity);
  }

  #assertKnowledgeFolderPath(path: string): VaultPath {
    const normalized = this.#pathGuard.assertDescendant(path);
    if (normalized === this.#rawRoot || !normalized.startsWith(`${this.#rawRoot}/`)) {
      throw new SelfGrowError('TOPIC_PATH_INVALID', 'Path is outside the Raw root.');
    }
    return normalized;
  }

  #assertKnowledgeNotePath(path: string): VaultPath {
    const normalized = this.#assertKnowledgeFolderPath(path);
    if (!isCollectionNote(normalized, this.#rawRoot)) {
      throw new SelfGrowError(
        'KNOWLEDGE_NOTE_INVALID',
        'A completed Raw note must be a Markdown file in a first-level collection folder.',
      );
    }
    return normalized;
  }
}

function isCollectionNote(path: VaultPath, root: VaultPath): boolean {
  const relative = path.slice(root.length + 1);
  const [folder, file, extra] = relative.split('/');
  return (
    extra === undefined &&
    folder !== undefined &&
    file !== undefined &&
    folder !== 'Inbox' &&
    folder !== 'Attachments' &&
    file.endsWith('.md')
  );
}

function deduplicateRebuildIdentities(identities: readonly IndexedIdentity[]): IndexedIdentity[] {
  const ids = new Set<SelfGrowID>();
  const urls = new Set<string>();
  const unique: IndexedIdentity[] = [];
  for (const identity of [...identities].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    if (ids.has(identity.id) || urls.has(identity.normalizedURL)) continue;
    ids.add(identity.id);
    urls.add(identity.normalizedURL);
    unique.push(identity);
  }
  return unique;
}
