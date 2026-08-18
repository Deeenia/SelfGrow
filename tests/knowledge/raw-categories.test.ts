import { describe, expect, it } from 'vitest';
import { ensureRawCategoryFolders } from '../../src/knowledge/raw-categories';
import { FixedTemporalContext, InMemoryVault } from '../harness';

describe('ensureRawCategoryFolders', () => {
  it('idempotently creates Project, Skill and Experience below the Raw root', async () => {
    const vault = new InMemoryVault(new FixedTemporalContext('2026-08-09T08:00:00.000Z', 'UTC'));
    await vault.createFolder('Raw');
    await vault.createFolder('Raw/Knowledge');

    await ensureRawCategoryFolders(vault, 'Raw');
    expect(await vault.isFolder('Raw/Project')).toBe(true);
    expect(await vault.isFolder('Raw/Skill')).toBe(true);
    expect(await vault.isFolder('Raw/Experience')).toBe(true);

    await ensureRawCategoryFolders(vault, 'Raw');
    expect(await vault.isFolder('Raw/Project')).toBe(true);
    expect(await vault.isFolder('Raw/Skill')).toBe(true);
    expect(await vault.isFolder('Raw/Experience')).toBe(true);
  });

  it('never removes legacy folders or files', async () => {
    const vault = new InMemoryVault(new FixedTemporalContext('2026-08-09T08:00:00.000Z', 'UTC'));
    await vault.createFolder('Raw');
    await vault.createFolder('Raw/Knowledge');
    await vault.create('Raw/Knowledge/legacy-card.md', '# Legacy\n');

    await ensureRawCategoryFolders(vault, 'Raw');

    expect(await vault.isFolder('Raw/Knowledge')).toBe(true);
    expect(await vault.read('Raw/Knowledge/legacy-card.md')).toBe('# Legacy\n');
  });
});
