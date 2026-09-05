import { SelfGrowError, vaultPath, type VaultPath } from '../domain';

export type PathNormalizer = (path: string) => string;

export class PathGuard {
  readonly rootPath: VaultPath;
  readonly #normalizePath: PathNormalizer;

  constructor(rootPath: string, normalizePath: PathNormalizer) {
    this.#normalizePath = normalizePath;
    this.rootPath = this.normalize(rootPath);
  }

  normalize(path: string): VaultPath {
    const normalized = this.#normalizePath(path);
    try {
      return vaultPath(normalized);
    } catch {
      throw new SelfGrowError('TOPIC_PATH_INVALID', 'The Vault path is invalid.');
    }
  }

  assertWithinRoot(path: string): VaultPath {
    const normalized = this.normalize(path);
    if (normalized !== this.rootPath && !normalized.startsWith(`${this.rootPath}/`)) {
      throw new SelfGrowError('TOPIC_PATH_INVALID', 'The Vault path is outside the SelfGrow root.');
    }
    return normalized;
  }

  assertDescendant(path: string): VaultPath {
    const normalized = this.assertWithinRoot(path);
    if (normalized === this.rootPath) {
      throw new SelfGrowError(
        'TOPIC_PATH_INVALID',
        'The Vault path must be below the SelfGrow root.',
      );
    }
    return normalized;
  }

  join(...segments: readonly string[]): VaultPath {
    return this.assertWithinRoot([this.rootPath, ...segments].join('/'));
  }

  contains(path: string): boolean {
    try {
      this.assertWithinRoot(path);
      return true;
    } catch {
      return false;
    }
  }
}
