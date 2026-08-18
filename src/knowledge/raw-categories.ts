import { RAW_CATEGORIES } from '../domain';
import type { VaultTreePort } from '../platform/ports';

/**
 * Idempotently ensures the three fixed Raw category folders exist below the
 * configured Raw root. Never touches or removes other folders.
 */
export async function ensureRawCategoryFolders(vault: VaultTreePort, root: string): Promise<void> {
  const normalized = root.replace(/^\/+|\/+$/g, '');
  for (const category of RAW_CATEGORIES) {
    const path = `${normalized}/${category}`;
    if (!(await vault.exists(path))) await vault.createFolder(path);
  }
}
