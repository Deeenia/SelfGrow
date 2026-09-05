import { fromMarkdown } from 'mdast-util-from-markdown';
import type { RootContent } from 'mdast';

interface MarkdownEdit {
  end: number;
  replacement: string;
  start: number;
}

/**
 * Demotes every source heading so the fixed Raw structure (H1 title, H2
 * sections, H3 core items) always wins: H1→H4, H2→H5, deeper headings stay
 * within H4–H6. Code fences and indented code never change, and setext
 * headings are converted to ATX form.
 */
export function demoteHeadings(markdown: string, shift: number): string {
  if (shift <= 0) return markdown;
  const edits: MarkdownEdit[] = [];
  collectHeadingEdits(fromMarkdown(markdown).children, markdown, shift, edits);
  if (edits.length === 0) return markdown;

  edits.sort((left, right) => left.start - right.start);
  let result = '';
  let cursor = 0;
  for (const edit of edits) {
    result += markdown.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  return result + markdown.slice(cursor);
}

function collectHeadingEdits(
  children: readonly RootContent[],
  markdown: string,
  shift: number,
  edits: MarkdownEdit[],
): void {
  for (const node of children) {
    if (
      node.type === 'heading' &&
      node.position?.start.offset !== undefined &&
      node.position?.end.offset !== undefined
    ) {
      const start = node.position.start.offset;
      const end = node.position.end.offset;
      const newDepth = Math.min(node.depth + shift, 6);
      if (markdown.slice(start, end).includes('\n')) {
        // Setext heading (text line + === or --- underline) → ATX form.
        const firstNewline = markdown.indexOf('\n', start);
        const text = markdown.slice(start, firstNewline).trimEnd();
        edits.push({ start, end, replacement: `${'#'.repeat(newDepth)} ${text}` });
      } else {
        const lineStart = markdown.lastIndexOf('\n', start - 1) + 1;
        const line = markdown.slice(lineStart, end);
        const markerIndex = line.indexOf('#');
        const marker = markerIndex < 0 ? null : /^#{1,6}/.exec(line.slice(markerIndex));
        if (marker !== null) {
          edits.push({
            start: lineStart + markerIndex,
            end: lineStart + markerIndex + marker[0].length,
            replacement: '#'.repeat(newDepth),
          });
        }
      }
    }
    if ('children' in node && Array.isArray(node.children)) {
      collectHeadingEdits(node.children, markdown, shift, edits);
    }
  }
}

export interface GithubMarkdownContext {
  branch: string;
  directory: string;
  owner: string;
  repo: string;
}

/**
 * Rewrites relative link/image destinations inside a GitHub README to absolute
 * GitHub URLs (blob for links, raw for images). Fenced code blocks are left
 * untouched, destinations escaping the repository are left as written, and
 * anchors, absolute URLs and data/mailto/tel targets are preserved.
 */
export function rewriteGithubMarkdown(markdown: string, context: GithubMarkdownContext): string {
  const directory = context.directory.replace(/^\/+|\/+$/g, '');
  const prefix = directory.length === 0 ? '' : `${directory}/`;
  const rawBase = `https://raw.githubusercontent.com/${context.owner}/${context.repo}/${
    context.branch
  }/${prefix}`;
  const repoPathPrefix = `/${context.owner}/${context.repo}/`;
  const destinationPattern = /(!?)\[([^\]]*)\]\(([^)\n]*)\)/g;

  const lines = markdown.split('\n');
  let fence: string | null = null;
  const rewritten = lines.map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      fence = fence === null ? trimmed.slice(0, 3) : null;
      return line;
    }
    if (fence !== null) return line;
    const rewrittenLine = line.replace(
      destinationPattern,
      (match: string, bang: string, label: string, destination: string) => {
        const target = destination.trim();
        if (target.length === 0) return match;
        const normalizedRaw = normalizeDuplicatedRawBranch(target, context);
        if (normalizedRaw !== target) return `${bang}[${label}](${normalizedRaw})`;
        if (
          target.startsWith('#') ||
          target.startsWith('//') ||
          /^(?:https?:|data:|mailto:|tel:)/i.test(target)
        ) {
          return match;
        }
        const repoRelative = target.startsWith('/') ? target.slice(1) : target;
        let resolved: URL;
        try {
          resolved = new URL(repoRelative, rawBase);
        } catch {
          return match;
        }
        if (!resolved.pathname.startsWith(repoPathPrefix)) return match;
        if (bang.length > 0) {
          return `![${label}](${resolved.toString()})`;
        }
        const blobPath = resolved.pathname.slice(repoPathPrefix.length - 1);
        return `[${label}](https://github.com/${context.owner}/${context.repo}/blob${blobPath}${resolved.search}${resolved.hash})`;
      },
    );
    return rewrittenLine.replace(
      /(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'][^>]*>)/gi,
      (match, prefix: string, source: string, suffix: string) => {
        const target = source.trim();
        const normalizedRaw = normalizeDuplicatedRawBranch(target, context);
        if (normalizedRaw !== target) return `${prefix}${normalizedRaw}${suffix}`;
        if (
          target.length === 0 ||
          target.startsWith('#') ||
          target.startsWith('//') ||
          /^(?:https?:|data:|mailto:|tel:)/i.test(target)
        ) {
          return match;
        }
        try {
          const resolved = new URL(target.startsWith('/') ? target.slice(1) : target, rawBase);
          if (!resolved.pathname.startsWith(repoPathPrefix)) return match;
          return `${prefix}${resolved.toString()}${suffix}`;
        } catch {
          return match;
        }
      },
    );
  });
  return rewritten.join('\n');
}

function normalizeDuplicatedRawBranch(target: string, context: GithubMarkdownContext): string {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return target;
  }
  if (url.hostname !== 'raw.githubusercontent.com') return target;
  const segments = url.pathname.split('/');
  if (
    segments[1] !== context.owner ||
    segments[2] !== context.repo ||
    segments[3] !== context.branch ||
    segments[4] !== context.branch
  ) {
    return target;
  }
  segments.splice(4, 1);
  url.pathname = segments.join('/');
  return url.toString();
}

/**
 * Makes common GitHub README wrapper HTML renderable by Obsidian's Markdown
 * renderer. Markdown inside a raw <div>/<details> block is treated as literal
 * text by Obsidian, so only presentation wrappers are removed; the source
 * wording and Markdown structure remain intact.
 */
export function normalizeGithubMarkdownForObsidian(markdown: string): string {
  const lines = markdown.split('\n');
  let fence: string | null = null;
  let comment = false;
  return lines
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
        fence = fence === null ? trimmed.slice(0, 3) : null;
        return line;
      }
      if (fence !== null) return line;
      let visible = '';
      let cursor = 0;
      while (cursor < line.length) {
        if (comment) {
          const end = line.indexOf('-->', cursor);
          if (end < 0) return visible;
          comment = false;
          cursor = end + 3;
          continue;
        }
        const start = line.indexOf('<!--', cursor);
        if (start < 0) {
          visible += line.slice(cursor);
          break;
        }
        visible += line.slice(cursor, start);
        comment = true;
        cursor = start + 4;
      }
      visible = visible.replace(
        /https:\/\/raw\.githubusercontent\.com\/([^/\s"'()<>]+)\/([^/\s"'()<>]+)\/([^/\s"'()<>]+)\/\3\//giu,
        'https://raw.githubusercontent.com/$1/$2/$3/',
      );
      const image = /^\s*<img\b([^>]*)\/?\s*>\s*$/iu.exec(visible);
      if (image !== null) {
        const attributes = image[1] ?? '';
        const source = /\bsrc\s*=\s*["']([^"']+)["']/iu.exec(attributes)?.[1];
        if (source !== undefined) {
          const alt = /\balt\s*=\s*["']([^"']*)["']/iu.exec(attributes)?.[1] ?? '';
          return `![${alt}](${source})`;
        }
      }
      return visible
        .replace(/^\s*<\/?(?:div|p|details|\/details|\/p)(?:\s[^>]*)?>\s*$/gi, '')
        .replace(/^\s*<summary(?:\s[^>]*)?>\s*(.*?)\s*<\/summary>\s*$/gi, '**$1**')
        .replace(/^\s*<br\s*\/?>\s*$/gi, '');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
