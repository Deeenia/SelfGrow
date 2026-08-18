import { describe, expect, it } from 'vitest';
import { selfGrowID, vaultPath } from '../../src/domain';
import { CanonicalKnowledgeNoteCommitter, parseKnowledgeNoteContent } from '../../src/knowledge';
import { PathGuard } from '../../src/vault';
import { FixedTemporalContext, InMemoryFrontmatter, InMemoryVault } from '../harness';

describe('CanonicalKnowledgeNoteCommitter', () => {
  it('writes canonical Markdown/frontmatter and indexes the final note', async () => {
    const fixture = await createFixture();
    const path = await fixture.committer.commit(fixture.input);

    expect(path).toBe('SelfGrow/Project/Unsafe - title.md');
    const markdown = await fixture.vault.read(path);
    const frontmatter = await fixture.frontmatter.read(path);
    expect(parseKnowledgeNoteContent(markdown, 'en')).toMatchObject({
      sourceURL: 'https://example.com/article',
      title: 'Unsafe / title',
    });
    expect(markdown).toMatch(/## My Notes\n\s*## Source/);
    expect(markdown).toContain('Grounded explanation.');
    expect(frontmatter).toMatchObject({
      recognition_source: 'local',
      selfgrow_category: 'Project',
      selfgrow_layer: 'raw',
      selfgrow_schema: 2,
      status: 'completed',
      wiki_selected: false,
    });
    expect(frontmatter?.content_hash).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(fixture.indexed).toEqual([path]);
  });

  it('routes new Raw cards into Skill and Experience category folders', async () => {
    const fixture = await createFixture();
    const skill = await fixture.committer.commit({
      ...fixture.input,
      capture: { ...fixture.input.capture, collectionFolder: 'Skill' },
    });
    const experience = await fixture.committer.commit({
      ...fixture.input,
      capture: {
        ...fixture.input.capture,
        collectionFolder: 'Experience',
        id: selfGrowID('capture-2'),
        sourceURL: 'https://example.com/other',
        normalizedURL: 'https://example.com/other',
      },
    });
    expect(skill).toBe('SelfGrow/Skill/Unsafe - title.md');
    expect(experience).toBe('SelfGrow/Experience/Unsafe - title.md');
    expect((await fixture.frontmatter.read(skill))?.selfgrow_category).toBe('Skill');
    expect((await fixture.frontmatter.read(experience))?.selfgrow_category).toBe('Experience');
  });

  it('defaults a capture without a folder to Project and records GitHub README diagnostics', async () => {
    const fixture = await createFixture();
    const path = await fixture.committer.commit({
      ...fixture.input,
      capture: { ...fixture.input.capture, collectionFolder: undefined },
      content: {
        ...fixture.input.content,
        github: {
          owner: 'acme',
          readmeLanguage: 'zh-CN',
          readmePath: 'README.zh-CN.md',
          repo: 'tool',
        },
      },
    });
    expect(path).toBe('SelfGrow/Project/Unsafe - title.md');
    expect(await fixture.frontmatter.read(path)).toMatchObject({
      github_readme_language: 'zh-CN',
      github_readme_path: 'README.zh-CN.md',
      source_github_owner: 'acme',
      source_github_repo: 'tool',
    });
  });

  it('is idempotent for the same capture and rejects an occupied destination', async () => {
    const fixture = await createFixture();
    const first = await fixture.committer.commit(fixture.input);
    await expect(fixture.committer.commit(fixture.input)).resolves.toBe(first);

    await fixture.frontmatter.process(first, (current) => ({
      ...current,
      selfgrow_id: 'different-capture',
    }));
    await expect(fixture.committer.commit(fixture.input)).rejects.toMatchObject({
      code: 'DUPLICATE_URL',
    });
  });

  it('moves every successful AI-route image into persistent Raw attachments', async () => {
    const fixture = await createFixture();
    const source = vaultPath('SelfGrow/Inbox/Attachments/capture-1.png');
    const destination = vaultPath('SelfGrow/Attachments/capture-1.png');
    await fixture.vault.create(source, 'binary fixture');

    const path = await fixture.committer.commit({
      ...fixture.input,
      capture: { ...fixture.input.capture, imagePaths: [source] },
    });

    expect(await fixture.vault.exists(source)).toBe(false);
    expect(await fixture.vault.exists(destination)).toBe(true);
    expect(await fixture.vault.read(path)).toContain(`![[${destination}]]`);
    expect(parseKnowledgeNoteContent(await fixture.vault.read(path), 'en').imagePaths).toEqual([
      destination,
    ]);
  });

  it('commits into the selected first-level Raw folder', async () => {
    const fixture = await createFixture();
    await fixture.vault.createFolder('SelfGrow/Reading');
    const path = await fixture.committer.commit({
      ...fixture.input,
      capture: { ...fixture.input.capture, collectionFolder: 'Reading' },
    });
    expect(path).toBe('SelfGrow/Reading/Unsafe - title.md');
  });
});

async function createFixture() {
  const clock = new FixedTemporalContext('2026-08-09T08:00:00.000Z', 'Asia/Shanghai');
  const vault = new InMemoryVault(clock);
  await vault.createFolder('SelfGrow');
  await vault.createFolder('SelfGrow/Knowledge');
  const frontmatter = new InMemoryFrontmatter();
  const indexed: string[] = [];
  const committer = new CanonicalKnowledgeNoteCommitter({
    clock,
    frontmatter,
    index: {
      indexNote(path) {
        indexed.push(path);
        return Promise.resolve();
      },
    },
    pathGuard: new PathGuard('SelfGrow', (value) => value.replaceAll('\\', '/')),
    vault,
  });
  const input = {
    capture: {
      captureMethod: 'share_sheet' as const,
      collectionFolder: 'Project',
      id: selfGrowID('capture-1'),
      importedAt: '2026-08-09T07:30:00.000Z',
      normalizedURL: 'https://example.com/article',
      path: vaultPath('SelfGrow/Inbox/capture.md'),
      sourceURL: 'https://example.com/article',
      state: 'generating' as const,
    },
    content: {
      body: 'Complete source body. '.repeat(20),
      bodyKind: 'article' as const,
      finalURL: 'https://example.com/article',
      platform: 'generic_web' as const,
      route: 'local_article' as const,
    },
    generated: {
      category: 'Project' as const,
      coreKnowledge: [{ explanationMarkdown: 'Grounded explanation.', title: 'Key idea' }],
      githubQueries: [] as readonly string[],
      outputLanguage: 'en' as const,
      recognitionSource: 'local' as const,
      sourceLanguage: 'en',
      summaryMarkdown: 'Grounded summary.',
      title: 'Unsafe / title',
    },
  };
  return { committer, frontmatter, indexed, input, vault };
}
