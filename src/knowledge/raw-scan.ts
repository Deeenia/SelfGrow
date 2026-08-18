import { isRawCategory, RAW_CATEGORIES, type RawCategory, type VaultPath } from '../domain';
import type { VaultTreePort } from '../platform/ports';
import type { RawCardState } from './raw-card';

export type RawScanSuggestion = RawCategory | 'conflict' | 'unknown';

export interface RawScanReport {
  beforeCount: number;
  categoryCounts: Readonly<Record<RawCategory, number>>;
  conflictCount: number;
  suggestions: ReadonlyArray<{ path: VaultPath; suggested: RawScanSuggestion }>;
  unknownCount: number;
}

export interface RawMigrationPlanItem {
  from: VaultPath;
  suggested: RawCategory;
  to: VaultPath;
}

const SKILL_SIGNALS = /\b(?:skill|agent|prompt|workflow|capabilit)\b|插件|技能|提示词|能力包/iu;
const PROJECT_SIGNALS =
  /\b(?:github|repo|repository|framework|library|project|app|tool|cli)\b|开源|项目|代码库/iu;
const EXPERIENCE_SIGNALS =
  /\b(?:tutorial|guide|method|how[- ]to|case|course|experience|route|playbook)\b|教程|方法|经验|案例|学习路线|复盘|过程|观点/iu;

/** Read-only classification of existing Raw cards by their destination folder. */
export async function scanRawFolders(cards: readonly RawCardState[]): Promise<RawScanReport> {
  const categoryCounts: Record<RawCategory, number> = { Project: 0, Skill: 0, Experience: 0 };
  let conflictCount = 0;
  let unknownCount = 0;
  const suggestions: Array<{ path: VaultPath; suggested: RawScanSuggestion }> = [];

  for (const card of cards) {
    const folder = rawFolderName(card.path);
    const inCategory = isRawCategory(folder);
    const suggested = inCategory ? folder : suggestRawCategory(card);
    if (inCategory) categoryCounts[folder] += 1;
    else if (suggested === 'conflict') conflictCount += 1;
    else if (suggested === 'unknown') unknownCount += 1;
    else categoryCounts[suggested] += 1;
    suggestions.push({ path: card.path, suggested });
  }

  return {
    beforeCount: cards.length,
    categoryCounts,
    conflictCount,
    suggestions,
    unknownCount,
  };
}

/** Builds a dry-run migration plan for cards living outside the three categories. */
export function planRawMigration(report: RawScanReport): RawMigrationPlanItem[] {
  const plan: RawMigrationPlanItem[] = [];
  for (const suggestion of report.suggestions) {
    if (!isRawCategory(suggestion.suggested)) continue;
    const folder = rawFolderName(suggestion.path);
    if (folder === suggestion.suggested) continue;
    plan.push({
      from: suggestion.path,
      suggested: suggestion.suggested,
      to: replaceRawFolder(suggestion.path, suggestion.suggested),
    });
  }
  return plan;
}

/**
 * Moves one Raw card into its suggested category folder, preserving the file,
 * its frontmatter and every attachment reference byte-for-byte. Callers decide
 * confirmation and rollback; this capability is never invoked automatically.
 */
export async function applyRawMigrationItem(
  vault: VaultTreePort,
  item: RawMigrationPlanItem,
): Promise<void> {
  if (await vault.exists(item.to)) {
    throw new Error(`Migration destination already exists: ${item.to}`);
  }
  await vault.move(item.from, item.to);
}

export function rawFolderName(path: VaultPath): string {
  const segments = path.split('/');
  return segments[segments.length - 2] ?? '';
}

export function suggestRawCategory(card: RawCardState): RawScanSuggestion {
  const probe = [card.title, card.previewMarkdown, card.sourceURL].join('\n');
  const signals = {
    Project: PROJECT_SIGNALS.test(probe),
    Skill: SKILL_SIGNALS.test(probe),
    Experience: EXPERIENCE_SIGNALS.test(probe),
  };
  const matched = RAW_CATEGORIES.filter((category) => signals[category]);
  if (matched.length === 1) return matched[0] ?? 'unknown';
  if (matched.length > 1) return 'conflict';
  return 'unknown';
}

function replaceRawFolder(path: VaultPath, category: RawCategory): VaultPath {
  const segments = path.split('/');
  segments[segments.length - 2] = category;
  return segments.join('/') as VaultPath;
}
