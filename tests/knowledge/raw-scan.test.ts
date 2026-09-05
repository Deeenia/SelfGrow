import { describe, expect, it } from 'vitest';
import { selfGrowID, vaultPath } from '../../src/domain';
import {
  applyRawMigrationItem,
  planRawMigration,
  rawFolderName,
  scanRawFolders,
  suggestRawCategory,
  type RawScanReport,
} from '../../src/knowledge/raw-scan';
import { RawCardService } from '../../src/knowledge/raw-card';
import { PathGuard } from '../../src/vault';
import { FixedTemporalContext, InMemoryFrontmatter, InMemoryVault } from '../harness';

function card(path: string, fields: { preview?: string; sourceURL?: string; title?: string } = {}) {
  return {
    attachmentPaths: [],
    contentHash: 'a'.repeat(64),
    distillationApprovedHash: null,
    distillationError: null,
    distillationStatus: 'not_started' as const,
    distilledAt: null,
    distilledHash: null,
    id: selfGrowID(`id-${path}`),
    imagePaths: [],
    modifiedAt: '2026-08-09T08:00:00.000Z',
    path: vaultPath(path),
    platform: 'generic_web',
    previewMarkdown: fields.preview ?? '',
    recommendation: null,
    sourceURL: fields.sourceURL ?? '',
    title: fields.title ?? 'Card',
    wikiSelected: false,
    wikiTargets: [],
  };
}

describe('raw scan and migration capability', () => {
  it('reports before-count, per-category suggestions, unknown and conflict counts', async () => {
    const report: RawScanReport = await scanRawFolders([
      card('Raw/Project/kept.md', { title: 'A runnable tool' }),
      card('Raw/Skill/kept.md', { title: 'An agent skill pack' }),
      card('Raw/Knowledge/github-project.md', {
        sourceURL: 'https://github.com/acme/tool',
      }),
      card('Raw/Knowledge/tutorial.md', {
        title: 'How to build a thing 教程',
        preview: '分步教程，包含方法和案例复盘。',
      }),
      card('Raw/Legacy/plain.md', { title: '一个没有任何信号的标题' }),
      card('Raw/Legacy/mixed.md', {
        title: '开源项目教程与案例复盘',
        sourceURL: 'https://github.com/acme/tool',
      }),
    ]);

    expect(report.beforeCount).toBe(6);
    expect(report.categoryCounts.Project).toBe(2);
    expect(report.categoryCounts.Skill).toBe(1);
    expect(report.categoryCounts.Experience).toBe(1);
    expect(report.unknownCount).toBe(1);
    expect(report.conflictCount).toBe(1);
  });

  it('plans migration only for cards outside the three categories and never moves them', async () => {
    const report: RawScanReport = await scanRawFolders([
      card('Raw/Project/kept.md'),
      card('Raw/Knowledge/github.md', { sourceURL: 'https://github.com/acme/tool' }),
    ]);
    const plan = planRawMigration(report);
    expect(plan).toEqual([
      {
        from: vaultPath('Raw/Knowledge/github.md'),
        suggested: 'Project',
        to: vaultPath('Raw/Project/github.md'),
      },
    ]);

    // The plan itself must not touch the vault.
    const clock = new FixedTemporalContext('2026-08-09T08:00:00.000Z', 'UTC');
    const vault = new InMemoryVault(clock);
    await vault.createFolder('Raw');
    await vault.create('Raw/Knowledge/github.md', '# Tool\n');
    expect(await vault.exists('Raw/Project/github.md')).toBe(false);
    await applyRawMigrationItem(vault, plan[0]!);
    expect(await vault.exists('Raw/Knowledge/github.md')).toBe(false);
    expect(await vault.read('Raw/Project/github.md')).toBe('# Tool\n');
  });

  it('fails safely when the migration destination is occupied', async () => {
    const clock = new FixedTemporalContext('2026-08-09T08:00:00.000Z', 'UTC');
    const vault = new InMemoryVault(clock);
    await vault.createFolder('Raw');
    await vault.create('Raw/Knowledge/github.md', '# Tool\n');
    await vault.create('Raw/Project/github.md', '# Occupied\n');
    await expect(
      applyRawMigrationItem(vault, {
        from: vaultPath('Raw/Knowledge/github.md'),
        suggested: 'Project',
        to: vaultPath('Raw/Project/github.md'),
      }),
    ).rejects.toThrow('Migration destination already exists');
    expect(await vault.read('Raw/Knowledge/github.md')).toBe('# Tool\n');
  });
});

describe('rawFolderName and suggestRawCategory', () => {
  it('reads the parent folder of a Raw card', () => {
    expect(rawFolderName(vaultPath('Raw/Skill/abc.md'))).toBe('Skill');
  });

  it('classifies by content signals with conflict and unknown outcomes', () => {
    expect(suggestRawCategory(card('Raw/Knowledge/a.md', { title: 'Agent skill 技能包' }))).toBe(
      'Skill',
    );
    expect(
      suggestRawCategory(card('Raw/Knowledge/b.md', { sourceURL: 'https://github.com/x/y' })),
    ).toBe('Project');
    expect(suggestRawCategory(card('Raw/Knowledge/c.md', { title: '学习路线与教程方法' }))).toBe(
      'Experience',
    );
    expect(suggestRawCategory(card('Raw/Knowledge/d.md', { title: '开源项目教程复盘' }))).toBe(
      'conflict',
    );
    expect(suggestRawCategory(card('Raw/Knowledge/e.md', { title: '没有任何关键词' }))).toBe(
      'unknown',
    );
  });
});

describe('RawCardService legacy folder readability', () => {
  it('still lists cards from legacy folders next to the three categories', async () => {
    const clock = new FixedTemporalContext('2026-08-09T08:00:00.000Z', 'UTC');
    const vault = new InMemoryVault(clock);
    await vault.createFolder('Raw');
    const pathGuard = new PathGuard('Raw', (value) => value.replaceAll('\\', '/'));
    const frontmatter = new InMemoryFrontmatter({
      'Raw/Knowledge/card.md': {
        content_hash: 'c'.repeat(64),
        distillation_approved_hash: null,
        distillation_error: null,
        distillation_status: 'not_started',
        distilled_at: null,
        distilled_hash: null,
        selfgrow: true,
        selfgrow_id: 'card-knowledge',
        selfgrow_layer: 'raw',
        selfgrow_schema: 2,
        status: 'completed',
        wiki_selected: false,
        wiki_targets: [],
      },
      'Raw/Project/card.md': {
        content_hash: 'd'.repeat(64),
        distillation_approved_hash: null,
        distillation_error: null,
        distillation_status: 'not_started',
        distilled_at: null,
        distilled_hash: null,
        selfgrow: true,
        selfgrow_id: 'card-project',
        selfgrow_layer: 'raw',
        selfgrow_schema: 2,
        status: 'completed',
        wiki_selected: false,
        wiki_targets: [],
      },
    });
    for (const folder of ['Knowledge', 'Project']) {
      await vault.createFolder(`Raw/${folder}`);
      await vault.create(
        `Raw/${folder}/card.md`,
        [
          '---',
          'selfgrow: true',
          'selfgrow_id: card-1',
          'selfgrow_layer: raw',
          'selfgrow_schema: 2',
          'status: completed',
          '---',
          '# Card',
          '',
          '## 筛选预览',
          '',
          'Preview text.',
          '',
          '## 原始材料',
          '',
          '### 提取正文',
          '',
          'Body text.',
          '',
          '## 我的笔记',
          '',
          '',
          '## 来源',
          '',
          '[打开原文](<https://example.com>)',
          '',
        ].join('\n'),
      );
    }
    const service = new RawCardService({
      frontmatter,
      pathGuard,
      vault,
      wikiPathGuard: new PathGuard('Wiki', (value) => value.replaceAll('\\', '/')),
    });
    const cards = await service.list();
    expect(cards.map((item) => item.path).sort()).toEqual([
      'Raw/Knowledge/card.md',
      'Raw/Project/card.md',
    ]);
  });
});
