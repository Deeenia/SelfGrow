import { Readability } from '@mozilla/readability';
import { parseSafeHTTPURL } from '../url/url-service';
import { validateCompleteContent } from './completeness';

const MAX_DOCUMENT_ELEMENTS = 10_000;

export interface ArticleDocumentTools {
  htmlToMarkdown(node: DocumentFragment): string;
  parseHTML(html: string): Document | null;
  sanitizeHTML(html: string): DocumentFragment;
}

export interface ProcessedArticle {
  author?: string;
  body: string;
  canonicalURL?: string;
  publishedAt?: string;
  sourceLanguage?: string;
  title?: string;
}

export type ArticleProcessingResult =
  | { article: ProcessedArticle; kind: 'complete' }
  | {
      kind: 'incomplete';
      reason: 'content_too_large' | 'document_too_complex' | 'main_text_missing';
    };

export class ArticleDocumentProcessor {
  readonly #tools: ArticleDocumentTools;

  constructor(tools: ArticleDocumentTools) {
    this.#tools = tools;
  }

  process(html: string, sourceURL: string): ArticleProcessingResult {
    const parsedDocument = this.#tools.parseHTML(html);
    if (parsedDocument === null) return { kind: 'incomplete', reason: 'main_text_missing' };
    const document = isolateGitHubReadme(parsedDocument, sourceURL);
    if (document.getElementsByTagName('*').length > MAX_DOCUMENT_ELEMENTS) {
      return { kind: 'incomplete', reason: 'document_too_complex' };
    }

    ensureDocumentBase(document, sourceURL);
    const canonicalURL = readCanonicalURL(document, sourceURL);
    const clone = document.cloneNode(true) as Document;
    const parsed = new Readability(clone, {
      charThreshold: MIN_READABILITY_CHARS,
      maxElemsToParse: MAX_DOCUMENT_ELEMENTS,
    }).parse();
    if (parsed?.content === null || parsed?.content === undefined) {
      return { kind: 'incomplete', reason: 'main_text_missing' };
    }

    const sanitized = this.#tools.sanitizeHTML(parsed.content);
    const completeness = validateCompleteContent(this.#tools.htmlToMarkdown(sanitized));
    if (completeness.kind === 'incomplete') return completeness;

    return {
      article: {
        body: completeness.normalized,
        ...optionalTrimmed('author', parsed.byline),
        ...optionalTrimmed('publishedAt', parsed.publishedTime),
        ...optionalTrimmed('sourceLanguage', parsed.lang),
        ...optionalTrimmed('title', parsed.title),
        ...(canonicalURL === null ? {} : { canonicalURL }),
      },
      kind: 'complete',
    };
  }
}

function isolateGitHubReadme(document: Document, sourceURL: string): Document {
  let url: URL;
  try {
    url = new URL(sourceURL);
  } catch {
    return document;
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return document;
  const readme = document.querySelector('article.markdown-body');
  if (readme === null) return document;

  const isolated = document.implementation.createHTMLDocument(document.title);
  isolated.documentElement.lang = document.documentElement.lang;
  isolated.body.append(readme.cloneNode(true));
  const canonical = document.querySelector<HTMLLinkElement>('link[rel~="canonical"]');
  if (canonical !== null) isolated.head.append(canonical.cloneNode(true));
  return isolated;
}

const MIN_READABILITY_CHARS = 140;

function ensureDocumentBase(document: Document, sourceURL: string): void {
  const base = document.createElementNS('http://www.w3.org/1999/xhtml', 'base');
  base.setAttribute('href', sourceURL);
  document.head.prepend(base);
}

function readCanonicalURL(document: Document, sourceURL: string): string | null {
  const href = document.querySelector<HTMLLinkElement>('link[rel~="canonical"]')?.href;
  if (href === undefined || href.length === 0) return null;
  try {
    return parseSafeHTTPURL(new URL(href, sourceURL).toString()).toString();
  } catch {
    return null;
  }
}

function optionalTrimmed<Key extends 'author' | 'publishedAt' | 'sourceLanguage' | 'title'>(
  key: Key,
  value: string | null | undefined,
): Partial<Record<Key, string>> {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0
    ? {}
    : ({ [key]: trimmed } as Record<Key, string>);
}
