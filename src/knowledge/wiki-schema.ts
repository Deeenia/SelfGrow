import { SelfGrowError, type VaultPath } from '../domain';
import type { VaultTreePort } from '../platform/ports';
import type { PathGuard } from '../vault';
import { knowledgeNoteFileName } from './canonical-knowledge-note-committer';

export const WIKI_PAGE_TYPES = ['topic', 'concept', 'method', 'experience', 'question'] as const;

const TYPE_FOLDERS: Record<WikiPageType, string> = {
  topic: 'Topics',
  concept: 'Concepts',
  method: 'Methods',
  experience: 'Experiences',
  question: 'Questions',
};

export type WikiPageType = (typeof WIKI_PAGE_TYPES)[number];
export type WikiExperienceEvidence = 'user_note' | 'experience_raw' | 'user_confirmation';

export interface WikiPageDraft {
  createdAt: string;
  currentUnderstandingMarkdown: string;
  experienceEvidence: WikiExperienceEvidence | null;
  methodAndBoundaryMarkdown: string;
  personalExperienceMarkdown: string;
  relationMarkdown: string;
  sourceCount: number;
  title: string;
  type: WikiPageType;
  updatedAt: string;
}

export interface WikiAISections {
  currentUnderstandingMarkdown: string;
  methodAndBoundaryMarkdown: string;
  relationMarkdown: string;
}

const INDEX = `# SelfGrow Wiki

## 主题

## 概念

## 方法

## 经验

## 问题
`;

const LOG = `# SelfGrow Wiki Log
`;

export async function initializeWikiSchema(
  vault: VaultTreePort,
  pathGuard: PathGuard,
  allowCreate = true,
): Promise<void> {
  if (!allowCreate) return;
  const indexPath = pathGuard.join('Index.md');
  const logPath = pathGuard.join('Log.md');
  const wikiRoot = pathGuard.rootPath;
  if (!(await vault.exists(wikiRoot))) await vault.createFolder(wikiRoot);
  for (const folder of [...Object.values(TYPE_FOLDERS), 'Assets']) {
    const path = pathGuard.join(folder);
    if (!(await vault.exists(path))) await vault.createFolder(path);
  }
  for (const [path, content] of [
    [indexPath, INDEX],
    [logPath, LOG],
  ] as const) {
    if (!(await vault.exists(path))) await vault.create(path, content);
  }
}

export function wikiPagePath(pathGuard: PathGuard, type: WikiPageType, title: string): VaultPath {
  if (!WIKI_PAGE_TYPES.includes(type)) throw invalidWiki();
  return pathGuard.join(TYPE_FOLDERS[type], knowledgeNoteFileName(title));
}

export function serializeWikiPage(draft: WikiPageDraft): string {
  validateDraft(draft);
  return [
    '---',
    'selfgrow_wiki: true',
    'wiki_schema: 1',
    `wiki_type: ${draft.type}`,
    `created_at: ${JSON.stringify(draft.createdAt)}`,
    `updated_at: ${JSON.stringify(draft.updatedAt)}`,
    `source_count: ${draft.sourceCount}`,
    '---',
    '',
    `# ${singleLine(draft.title)}`,
    '',
    ...serializeAISections(draft),
    '## 我的经验',
    '',
    draft.personalExperienceMarkdown,
    '',
  ].join('\n');
}

export function updateWikiAISections(markdown: string, update: WikiAISections): string {
  validateAISections(update);
  const headings = ['当前认识', '方法与边界', '关联', '我的经验'].map((label) => {
    const matches = [...markdown.matchAll(new RegExp(`^## ${label}\\s*$`, 'gm'))];
    if (matches.length !== 1 || matches[0]?.index === undefined) throw sectionConflict();
    return matches[0].index;
  });
  if (!headings.every((offset, index) => index === 0 || offset > (headings[index - 1] ?? -1))) {
    throw sectionConflict();
  }
  const currentStart = headings[0];
  const personalStart = headings[3];
  if (currentStart === undefined || personalStart === undefined) throw sectionConflict();
  const lineBreak = markdown.includes('\r\n') ? '\r\n' : '\n';
  const replacement = serializeAISections(update).join(lineBreak);
  return `${markdown.slice(0, currentStart)}${replacement}${markdown.slice(personalStart)}`;
}

function serializeAISections(sections: WikiAISections): string[] {
  return [
    '## 当前认识',
    '',
    sections.currentUnderstandingMarkdown.trim(),
    '',
    '## 方法与边界',
    '',
    sections.methodAndBoundaryMarkdown.trim(),
    '',
    '## 关联',
    '',
    sections.relationMarkdown.trim(),
    '',
  ];
}

function validateDraft(draft: WikiPageDraft): void {
  if (
    !WIKI_PAGE_TYPES.includes(draft.type) ||
    singleLine(draft.title).length === 0 ||
    !Number.isInteger(draft.sourceCount) ||
    draft.sourceCount < 0 ||
    !Number.isFinite(Date.parse(draft.createdAt)) ||
    !Number.isFinite(Date.parse(draft.updatedAt))
  ) {
    throw invalidWiki();
  }
  validateAISections(draft);
  const hasPersonalExperience = draft.personalExperienceMarkdown.length > 0;
  const evidence = draft.experienceEvidence;
  if ((draft.type === 'experience' || hasPersonalExperience) && evidence === null) {
    throw invalidWiki();
  }
  if (
    evidence !== null &&
    !['user_note', 'experience_raw', 'user_confirmation'].includes(evidence)
  ) {
    throw invalidWiki();
  }
}

function validateAISections(sections: WikiAISections): void {
  if (
    sections.currentUnderstandingMarkdown.trim().length === 0 ||
    sections.methodAndBoundaryMarkdown.trim().length === 0 ||
    /^##\s+/m.test(sections.currentUnderstandingMarkdown) ||
    /^##\s+/m.test(sections.methodAndBoundaryMarkdown) ||
    /^##\s+/m.test(sections.relationMarkdown) ||
    /\[[^\]]+\]\([^)]+\)/.test(sections.relationMarkdown)
  ) {
    throw invalidWiki();
  }
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function invalidWiki(): SelfGrowError {
  return new SelfGrowError('KNOWLEDGE_NOTE_INVALID', 'Wiki page content is invalid.');
}

function sectionConflict(): SelfGrowError {
  return new SelfGrowError(
    'NOTE_SECTION_CONFLICT',
    'Wiki sections are missing, duplicated, or ambiguous.',
  );
}
