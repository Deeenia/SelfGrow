import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Heading, PhrasingContent, RootContent } from 'mdast';
import {
  SelfGrowError,
  vaultPath,
  type CoreKnowledgeItem,
  type Language,
  type VaultPath,
} from '../domain';

const SECTION_LABELS = {
  en: {
    coreKnowledge: 'Source Material',
    personalNote: 'My Notes',
    source: 'Source',
    sourceDirect: 'Direct paste',
    sourceLink: 'Open source',
    summary: 'Selection Preview',
  },
  'zh-CN': {
    coreKnowledge: '原始材料',
    personalNote: '我的笔记',
    source: '来源',
    sourceDirect: '直接粘贴',
    sourceLink: '打开原文',
    summary: '筛选预览',
  },
} as const;

const LEGACY_SECTION_LABELS = {
  en: { coreKnowledge: 'Core Knowledge', summary: 'AI Summary' },
  'zh-CN': { coreKnowledge: '核心知识', summary: 'AI 摘要' },
} as const;

export interface KnowledgeNoteContent {
  attachmentPaths?: readonly VaultPath[];
  coreKnowledge: readonly CoreKnowledgeItem[];
  imagePaths: readonly VaultPath[];
  outputLanguage: Language;
  personalNoteMarkdown: string;
  sourceURL: string;
  summaryMarkdown: string;
  title: string;
}

interface LocatedHeading {
  end: number;
  node: Heading;
  start: number;
  text: string;
}

export function parseKnowledgeNoteContent(
  markdown: string,
  language: Language,
): KnowledgeNoteContent {
  const tree = fromMarkdown(markdown);
  const headings = tree.children.filter(isHeading).map(locateHeading);
  const labels = SECTION_LABELS[language];
  const legacy = LEGACY_SECTION_LABELS[language];
  const currentLabels = [labels.summary, labels.coreKnowledge, labels.personalNote, labels.source];
  const legacyLabels = [legacy.summary, legacy.coreKnowledge, labels.personalNote, labels.source];
  const sectionHeadings =
    locateSections(headings, currentLabels) ?? locateSections(headings, legacyLabels);
  const summaryHeading = sectionHeadings?.[0];
  const titleHeadings = headings.filter(
    (heading) =>
      heading.node.depth === 1 &&
      (summaryHeading === undefined || heading.start < summaryHeading.start),
  );
  const titleHeading = titleHeadings[0];

  if (
    titleHeadings.length !== 1 ||
    titleHeading === undefined ||
    titleHeading.text.length === 0 ||
    sectionHeadings === undefined ||
    hasSectionConflict(headings, sectionHeadings, [...currentLabels, ...legacyLabels])
  ) {
    throw sectionConflict();
  }

  const [resolvedSummaryHeading, coreHeading, personalHeading, sourceHeading] = sectionHeadings;
  if (
    resolvedSummaryHeading === undefined ||
    coreHeading === undefined ||
    personalHeading === undefined ||
    sourceHeading === undefined
  ) {
    throw sectionConflict();
  }
  if (titleHeading.start >= resolvedSummaryHeading.start) throw sectionConflict();

  const summaryMarkdown = sectionContent(markdown, resolvedSummaryHeading.end, coreHeading.start);
  const attachmentPaths = parseAttachmentPaths(
    sectionContent(markdown, titleHeading.end, resolvedSummaryHeading.start),
  );
  const personalNoteMarkdown = sectionContent(markdown, personalHeading.end, sourceHeading.start);
  const coreKnowledge = parseCoreKnowledge(markdown, headings, coreHeading, personalHeading);
  const sourceMarkdown = sectionContent(markdown, sourceHeading.end, markdown.length);
  const sourceURL =
    /^\[[^\]\n]+\]\(<([^>\n]+)>\)$/.exec(sourceMarkdown.trim())?.[1] ??
    (sourceMarkdown.trim() === labels.sourceDirect ? 'selfgrow:direct' : undefined);

  if (
    summaryMarkdown.trim().length === 0 ||
    coreKnowledge.length === 0 ||
    sourceURL === undefined
  ) {
    throw sectionConflict();
  }

  return {
    coreKnowledge,
    attachmentPaths,
    imagePaths: attachmentPaths.filter(isImagePath),
    outputLanguage: language,
    personalNoteMarkdown,
    sourceURL,
    summaryMarkdown,
    title: titleHeading.text,
  };
}

export function serializeKnowledgeNoteContent(content: KnowledgeNoteContent): string {
  const labels = SECTION_LABELS[content.outputLanguage];
  const core = content.coreKnowledge
    .map(
      (item) =>
        `### ${singleLine(item.title)}\n\n${item.explanationMarkdown.replace(/^\n+|\n+$/g, '')}`,
    )
    .join('\n\n');
  const images = (content.attachmentPaths ?? content.imagePaths)
    .map((path) => `![[${path}]]`)
    .join('\n\n');

  if (
    singleLine(content.title).length === 0 ||
    content.summaryMarkdown.trim().length === 0 ||
    content.coreKnowledge.length === 0 ||
    content.coreKnowledge.some(
      (item) => singleLine(item.title).length === 0 || item.explanationMarkdown.trim().length === 0,
    )
  ) {
    throw new SelfGrowError('KNOWLEDGE_NOTE_INVALID', 'Knowledge note content is incomplete.');
  }

  return [
    `# ${singleLine(content.title)}`,
    ...(images.length === 0 ? [] : [images]),
    `## ${labels.summary}\n\n${withoutBoundaryNewlines(content.summaryMarkdown)}`,
    `## ${labels.coreKnowledge}\n\n${core}`,
    `## ${labels.personalNote}\n\n${withoutBoundaryNewlines(content.personalNoteMarkdown)}`,
    `## ${labels.source}\n\n${content.sourceURL.startsWith('selfgrow:text:') ? labels.sourceDirect : `[${labels.sourceLink}](<${content.sourceURL}>)`}`,
  ]
    .join('\n\n')
    .concat('\n');
}

function parseAttachmentPaths(markdown: string): VaultPath[] {
  if (markdown.trim().length === 0) return [];
  return markdown
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const match = /^!\[\[([^\]\n]+)\]\]$/.exec(line.trim());
      if (match?.[1] === undefined) throw sectionConflict();
      return vaultPath(match[1]);
    });
}

function isImagePath(path: string): boolean {
  return /\.(?:gif|jpe?g|png|webp)$/i.test(path);
}

function parseCoreKnowledge(
  markdown: string,
  headings: readonly LocatedHeading[],
  coreHeading: LocatedHeading,
  personalHeading: LocatedHeading,
): CoreKnowledgeItem[] {
  const itemHeadings = headings
    .filter(
      (heading) =>
        heading.node.depth === 3 &&
        heading.start > coreHeading.end &&
        heading.start < personalHeading.start,
    )
    .slice(0, 1);

  return itemHeadings.map((heading, index) => {
    const next = itemHeadings[index + 1];
    const explanationMarkdown = sectionContent(
      markdown,
      heading.end,
      next?.start ?? personalHeading.start,
    );
    if (heading.text.length === 0 || explanationMarkdown.trim().length === 0) {
      throw sectionConflict();
    }
    return { explanationMarkdown, title: heading.text };
  });
}

function locateSections(
  headings: readonly LocatedHeading[],
  labels: readonly string[],
): [LocatedHeading, LocatedHeading, LocatedHeading, LocatedHeading] | undefined {
  const result: LocatedHeading[] = [];
  let cursor = -1;
  for (const label of labels) {
    const heading = headings.find(
      (candidate) =>
        candidate.node.depth === 2 && candidate.text === label && candidate.start > cursor,
    );
    if (heading === undefined) return undefined;
    result.push(heading);
    cursor = heading.start;
  }
  return result as [LocatedHeading, LocatedHeading, LocatedHeading, LocatedHeading];
}

function hasSectionConflict(
  headings: readonly LocatedHeading[],
  sections: readonly LocatedHeading[],
  labels: readonly string[],
): boolean {
  const known = new Set(labels);
  const occurrences = headings.filter(
    (heading) => heading.node.depth === 2 && known.has(heading.text),
  );
  if (occurrences.length !== 4) return true;
  const personal = sections[2];
  const source = sections[3];
  if (personal === undefined || source === undefined) return true;
  return headings.some(
    (heading) =>
      heading.node.depth === 2 && heading.start > personal.start && heading.start < source.start,
  );
}

function sectionContent(markdown: string, rawStart: number, rawEnd: number): string {
  let start = rawStart;
  let end = rawEnd;
  const opening = markdown.slice(start, end).match(/^(?:\r?\n){2}/)?.[0];
  if (opening !== undefined) start += opening.length;
  const closing = markdown.slice(start, end).match(/(?:\r?\n){2}$/)?.[0];
  if (closing !== undefined) end -= closing.length;
  return markdown.slice(start, end);
}

function isHeading(node: RootContent): node is Heading {
  return node.type === 'heading';
}

function locateHeading(node: Heading): LocatedHeading {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) throw sectionConflict();
  return { end, node, start, text: headingText(node.children).trim() };
}

function headingText(children: readonly PhrasingContent[]): string {
  return children
    .map((child) => {
      if ('value' in child && typeof child.value === 'string') return child.value;
      if ('children' in child) return headingText(child.children);
      return '';
    })
    .join('');
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function withoutBoundaryNewlines(value: string): string {
  return value.replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, '');
}

function sectionConflict(): SelfGrowError {
  return new SelfGrowError(
    'NOTE_SECTION_CONFLICT',
    'Knowledge note sections are missing, duplicated, or ambiguous.',
  );
}
