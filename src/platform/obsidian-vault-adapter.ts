import {
  getFrontMatterInfo,
  parseYaml,
  TFile,
  TFolder,
  type FileManager,
  type Vault,
} from 'obsidian';
import { SelfGrowError } from '../domain';
import type { Frontmatter, FrontmatterPort, VaultStat, VaultTreePort } from './ports';

export class ObsidianVaultAdapter implements VaultTreePort {
  readonly #fileManager: FileManager;
  readonly #vault: Vault;

  constructor(vault: Vault, fileManager: FileManager) {
    this.#vault = vault;
    this.#fileManager = fileManager;
  }

  async create(path: string, content: string): Promise<void> {
    await this.#run(() => this.#vault.create(path, content));
  }

  async createFolder(path: string): Promise<void> {
    await this.#run(() => this.#vault.createFolder(path));
  }

  async delete(path: string): Promise<void> {
    const target = this.#vault.getAbstractFileByPath(path);
    if (target === null) throw apiError('Vault path does not exist.');
    await this.#run(() => this.#vault.delete(target, true));
  }

  async exists(path: string): Promise<boolean> {
    return (
      this.#vault.getAbstractFileByPath(path) !== null ||
      (await this.#run(() => this.#vault.adapter.exists(path)))
    );
  }

  async isFile(path: string): Promise<boolean> {
    return this.#vault.getAbstractFileByPath(path) instanceof TFile;
  }

  async isFolder(path: string): Promise<boolean> {
    return this.#vault.getAbstractFileByPath(path) instanceof TFolder;
  }

  async listFolders(rootPath: string): Promise<readonly string[]> {
    const root = this.#folder(rootPath);
    const folders: string[] = [];
    visitFolders(root, folders);
    return folders.sort();
  }

  async listMarkdownFiles(rootPath: string): Promise<readonly string[]> {
    const root = this.#folder(rootPath);
    const files: string[] = [];
    visitMarkdownFiles(root, files);
    return files.sort();
  }

  async move(from: string, to: string): Promise<void> {
    const source = this.#vault.getAbstractFileByPath(from);
    if (source === null) throw apiError('Vault path does not exist.');
    await this.#run(() => this.#fileManager.renameFile(source, to));
  }

  async process(path: string, update: (current: string) => string): Promise<string> {
    const file = this.#file(path);
    return this.#run(() => this.#vault.process(file, update));
  }

  async read(path: string): Promise<string> {
    const file = this.#file(path);
    return this.#run(() => this.#vault.read(file));
  }

  async stat(path: string): Promise<VaultStat> {
    const stat = this.#file(path).stat;
    return { ctime: stat.ctime, mtime: stat.mtime, size: stat.size };
  }

  #file(path: string): TFile {
    const value = this.#vault.getAbstractFileByPath(path);
    if (!(value instanceof TFile)) throw apiError('Vault file does not exist.');
    return value;
  }

  #folder(path: string): TFolder {
    const value = this.#vault.getAbstractFileByPath(path);
    if (!(value instanceof TFolder)) throw apiError('Vault folder does not exist.');
    return value;
  }

  async #run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw apiError('Obsidian Vault operation failed.');
    }
  }
}

export class ObsidianFrontmatterAdapter implements FrontmatterPort {
  readonly #fileManager: FileManager;
  readonly #vault: Vault;

  constructor(vault: Vault, fileManager: FileManager) {
    this.#vault = vault;
    this.#fileManager = fileManager;
  }

  async process(
    path: string,
    update: (current: Frontmatter) => Record<string, unknown>,
  ): Promise<void> {
    const file = this.#file(path);
    try {
      await this.#fileManager.processFrontMatter(file, (raw: unknown) => {
        if (!isRecord(raw)) throw apiError('Obsidian frontmatter is not an object.');
        const updated = update(structuredClone(raw));
        for (const key of Object.keys(raw)) delete raw[key];
        Object.assign(raw, structuredClone(updated));
      });
    } catch (error) {
      if (error instanceof SelfGrowError) throw error;
      throw apiError('Obsidian frontmatter update failed.');
    }
  }

  async read(path: string): Promise<Frontmatter | null> {
    try {
      // MetadataCache is updated asynchronously after processFrontMatter. Reading the
      // current Markdown avoids validating a new transition against stale state.
      const markdown = await this.#vault.read(this.#file(path));
      const info = getFrontMatterInfo(markdown);
      if (!info.exists) return null;
      const raw: unknown = parseYaml(info.frontmatter);
      return isRecord(raw) ? structuredClone(raw) : null;
    } catch (error) {
      if (error instanceof SelfGrowError) throw error;
      throw apiError('Obsidian frontmatter read failed.');
    }
  }

  #file(path: string): TFile {
    const value = this.#vault.getAbstractFileByPath(path);
    if (!(value instanceof TFile)) throw apiError('Vault file does not exist.');
    return value;
  }
}

function visitFolders(folder: TFolder, output: string[]): void {
  for (const child of folder.children) {
    if (child instanceof TFolder) {
      output.push(child.path);
      visitFolders(child, output);
    }
  }
}

function visitMarkdownFiles(folder: TFolder, output: string[]): void {
  for (const child of folder.children) {
    if (child instanceof TFolder) visitMarkdownFiles(child, output);
    else if (child instanceof TFile && child.extension === 'md') output.push(child.path);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function apiError(message: string): SelfGrowError {
  return new SelfGrowError('OBSIDIAN_API_FAILED', message);
}
