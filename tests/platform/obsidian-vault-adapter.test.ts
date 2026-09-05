import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileManager, Vault } from 'obsidian';

class MockTFile {
  constructor(readonly path: string) {}
}

class MockTFolder {}

vi.mock('obsidian', () => ({
  getFrontMatterInfo(markdown: string) {
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(markdown);
    return {
      contentStart: match?.[0].length ?? 0,
      exists: match !== null,
      from: 4,
      frontmatter: match?.[1] ?? '',
      to: (match?.[1] ?? '').length,
    };
  },
  parseYaml(yaml: string) {
    return Object.fromEntries(
      yaml.split('\n').map((line) => {
        const separator = line.indexOf(':');
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
    );
  },
  TFile: MockTFile,
  TFolder: MockTFolder,
}));

describe('ObsidianFrontmatterAdapter', () => {
  beforeEach(() => vi.resetModules());

  it('reads the current Markdown instead of an asynchronously updated metadata cache', async () => {
    const file = new MockTFile('SelfGrow/Inbox/capture.md');
    let markdown = '---\nstatus: queued\n---\nhttps://example.com\n';
    const cachedRead = vi.fn(async () => '---\nstatus: stale\n---\n');
    const read = vi.fn(async () => markdown);
    const vault = {
      cachedRead,
      getAbstractFileByPath: vi.fn(() => file),
      read,
    } as unknown as Vault;
    const fileManager = {} as FileManager;
    const { ObsidianFrontmatterAdapter } =
      await import('../../src/platform/obsidian-vault-adapter');
    const adapter = new ObsidianFrontmatterAdapter(vault, fileManager);

    await expect(adapter.read(file.path)).resolves.toMatchObject({ status: 'queued' });
    markdown = '---\nstatus: extracting\n---\nhttps://example.com\n';
    await expect(adapter.read(file.path)).resolves.toMatchObject({ status: 'extracting' });
    expect(cachedRead).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('ObsidianVaultAdapter', () => {
  beforeEach(() => vi.resetModules());

  it('checks the underlying adapter when the synchronized Vault cache misses a path', async () => {
    const exists = vi.fn(async () => true);
    const vault = {
      adapter: { exists },
      getAbstractFileByPath: vi.fn(() => null),
    } as unknown as Vault;
    const { ObsidianVaultAdapter } = await import('../../src/platform/obsidian-vault-adapter');
    const adapter = new ObsidianVaultAdapter(vault, {} as FileManager);

    await expect(adapter.exists('Wiki/Concepts/Page.md')).resolves.toBe(true);
    expect(exists).toHaveBeenCalledWith('Wiki/Concepts/Page.md');
  });
});
