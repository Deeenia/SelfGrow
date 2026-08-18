import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { TemporalContext, VaultStat, VaultTreePort } from '../../src/platform/ports';

export interface FixtureVaultEntry {
  content: string;
  path: string;
}

interface StoredFile extends FixtureVaultEntry {
  createdAt: number;
  modifiedAt: number;
}

function vaultPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
}

export async function loadFixtureVault(fixtureRoot: string): Promise<FixtureVaultEntry[]> {
  const root = resolve(fixtureRoot);
  const entries: FixtureVaultEntry[] = [];

  async function visit(directory: string): Promise<void> {
    const children = await readdir(directory, { withFileTypes: true });

    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = resolve(directory, child.name);
      if (child.isDirectory()) {
        await visit(absolutePath);
      } else if (child.isFile()) {
        entries.push({
          content: await readFile(absolutePath, 'utf8'),
          path: vaultPath(relative(root, absolutePath)),
        });
      }
    }
  }

  await visit(root);
  return entries;
}

export class InMemoryVault implements VaultTreePort {
  readonly #clock: TemporalContext;
  readonly #files = new Map<string, StoredFile>();
  readonly #folders = new Set<string>();
  listMarkdownCallCount = 0;

  constructor(clock: TemporalContext, entries: readonly FixtureVaultEntry[] = []) {
    this.#clock = clock;
    const timestamp = clock.now().getTime();

    for (const entry of entries) {
      const path = vaultPath(entry.path);
      this.#addParentFolders(path);
      this.#files.set(path, {
        content: entry.content,
        createdAt: timestamp,
        modifiedAt: timestamp,
        path,
      });
    }
  }

  async create(path: string, content: string): Promise<void> {
    const normalizedPath = vaultPath(path);
    if (await this.exists(normalizedPath)) {
      throw new Error(`Fixture Vault file already exists: ${normalizedPath}`);
    }

    const timestamp = this.#clock.now().getTime();
    this.#addParentFolders(normalizedPath);
    this.#files.set(normalizedPath, {
      content,
      createdAt: timestamp,
      modifiedAt: timestamp,
      path: normalizedPath,
    });
  }

  async exists(path: string): Promise<boolean> {
    const normalizedPath = vaultPath(path);
    return this.#files.has(normalizedPath) || this.#folders.has(normalizedPath);
  }

  async createFolder(path: string): Promise<void> {
    const normalizedPath = vaultPath(path);
    if (await this.exists(normalizedPath)) {
      throw new Error(`Fixture Vault path already exists: ${normalizedPath}`);
    }
    this.#addParentFolders(`${normalizedPath}/placeholder`);
    this.#folders.add(normalizedPath);
  }

  async delete(path: string): Promise<void> {
    const normalizedPath = vaultPath(path);
    if (this.#files.delete(normalizedPath)) return;
    if (!this.#folders.has(normalizedPath)) {
      throw new Error(`Fixture Vault path not found: ${normalizedPath}`);
    }
    for (const filePath of [...this.#files.keys()]) {
      if (filePath.startsWith(`${normalizedPath}/`)) this.#files.delete(filePath);
    }
    for (const folderPath of [...this.#folders]) {
      if (folderPath === normalizedPath || folderPath.startsWith(`${normalizedPath}/`)) {
        this.#folders.delete(folderPath);
      }
    }
  }

  async isFile(path: string): Promise<boolean> {
    return this.#files.has(vaultPath(path));
  }

  async isFolder(path: string): Promise<boolean> {
    return this.#folders.has(vaultPath(path));
  }

  async listFolders(rootPath: string): Promise<readonly string[]> {
    const root = vaultPath(rootPath);
    return [...this.#folders].filter((path) => path.startsWith(`${root}/`)).sort();
  }

  async listMarkdownFiles(rootPath: string): Promise<readonly string[]> {
    this.listMarkdownCallCount += 1;
    const root = vaultPath(rootPath);
    const prefix = root.length === 0 ? '' : `${root}/`;

    return [...this.#files.keys()]
      .filter((path) => path.startsWith(prefix) && path.endsWith('.md'))
      .sort();
  }

  async process(path: string, update: (current: string) => string): Promise<string> {
    const file = this.#require(path);
    const updated = update(file.content);
    file.content = updated;
    file.modifiedAt = this.#clock.now().getTime();
    return updated;
  }

  async read(path: string): Promise<string> {
    return this.#require(path).content;
  }

  async move(from: string, to: string): Promise<void> {
    const source = vaultPath(from);
    const destination = vaultPath(to);
    if (await this.exists(destination)) {
      throw new Error(`Fixture Vault destination already exists: ${destination}`);
    }
    const file = this.#files.get(source);
    if (file !== undefined) {
      this.#files.delete(source);
      this.#addParentFolders(destination);
      this.#files.set(destination, { ...file, path: destination });
      return;
    }
    if (!this.#folders.has(source)) {
      throw new Error(`Fixture Vault path not found: ${source}`);
    }

    const folders = [...this.#folders].filter(
      (path) => path === source || path.startsWith(`${source}/`),
    );
    const files = [...this.#files.entries()].filter(([path]) => path.startsWith(`${source}/`));
    for (const path of folders) this.#folders.delete(path);
    for (const [path] of files) this.#files.delete(path);
    this.#addParentFolders(`${destination}/placeholder`);
    for (const path of folders) this.#folders.add(`${destination}${path.slice(source.length)}`);
    for (const [path, stored] of files) {
      const movedPath = `${destination}${path.slice(source.length)}`;
      this.#files.set(movedPath, { ...stored, path: movedPath });
    }
  }

  async stat(path: string): Promise<VaultStat> {
    const file = this.#require(path);
    return {
      ctime: file.createdAt,
      mtime: file.modifiedAt,
      size: new TextEncoder().encode(file.content).byteLength,
    };
  }

  timestamps(path: string): Readonly<{ createdAt: number; modifiedAt: number }> {
    const file = this.#require(path);
    return { createdAt: file.createdAt, modifiedAt: file.modifiedAt };
  }

  #require(path: string): StoredFile {
    const normalizedPath = vaultPath(path);
    const file = this.#files.get(normalizedPath);
    if (file === undefined) {
      throw new Error(`Fixture Vault file not found: ${normalizedPath}`);
    }
    return file;
  }

  #addParentFolders(path: string): void {
    const segments = vaultPath(path).split('/');
    segments.pop();
    for (let length = 1; length <= segments.length; length += 1) {
      this.#folders.add(segments.slice(0, length).join('/'));
    }
  }
}
