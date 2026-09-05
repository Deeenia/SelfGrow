import { SelfGrowError } from '../domain';
import type { ContentExtractor, ExtractionOutcome, ExtractionRequest } from './types';

const MIN_PDF_TEXT_CHARACTERS = 40;

export interface LocalDocumentReader {
  readBinary(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
}

export interface PDFTextItem {
  hasEOL?: boolean;
  str?: string;
}

export interface PDFPageLike {
  getTextContent(): Promise<{ items: readonly PDFTextItem[] }>;
}

export interface PDFDocumentLike {
  cleanup?(): void;
  destroy?(): Promise<void>;
  getMetadata?(): Promise<{ info?: Readonly<Record<string, unknown>> }>;
  getPage(pageNumber: number): Promise<PDFPageLike>;
  numPages: number;
}

export interface PDFJSLike {
  getDocument(input: { data: Uint8Array }): { promise: Promise<PDFDocumentLike> };
}

export type PDFJSLoader = () => Promise<PDFJSLike>;

interface ExtractedDocument {
  body: string;
  title?: string;
}

export class LocalDocumentExtractor implements ContentExtractor {
  readonly id = 'local-document-v1';
  readonly #base: ContentExtractor;
  readonly #loadPDFJS: PDFJSLoader;
  readonly #reader: LocalDocumentReader;

  constructor(base: ContentExtractor, reader: LocalDocumentReader, loadPDFJS: PDFJSLoader) {
    this.#base = base;
    this.#reader = reader;
    this.#loadPDFJS = loadPDFJS;
  }

  canHandle(url: URL): boolean {
    return this.#base.canHandle(url);
  }

  async extract(request: ExtractionRequest): Promise<ExtractionOutcome> {
    const paths = (request.attachmentPaths ?? []).filter(isSupportedDocumentPath);
    if (paths.length === 0) return this.#base.extract(request);
    if (request.documentAIAuthorized !== true) {
      return {
        code: 'document_ai_authorization_required',
        kind: 'incomplete',
        message: 'Document AI processing requires explicit authorization for this capture.',
      };
    }

    const extracted: ExtractedDocument[] = [];
    for (const path of paths) {
      try {
        extracted.push(
          isPDFPath(path)
            ? await extractPDF(await this.#reader.readBinary(path), this.#loadPDFJS)
            : extractMarkdown(await this.#reader.readText(path)),
        );
      } catch (error) {
        if (error instanceof SelfGrowError && error.code === 'EXTRACTION_FAILED') {
          return {
            code: 'document_text_unavailable',
            kind: 'incomplete',
            message: error.message,
          };
        }
        throw error;
      }
    }

    const note = request.capturedText?.trim() ?? '';
    const body = [note, ...extracted.map((document) => document.body)]
      .filter((value) => value.length > 0)
      .join('\n\n')
      .trim();
    if (body.length === 0) {
      throw new SelfGrowError('EXTRACTION_FAILED', 'The local document did not contain text.');
    }

    return {
      content: {
        body,
        bodyKind: 'article',
        documentKind: paths.some(isPDFPath) ? classifyPDFDocument(body) : 'markdown',
        finalURL: request.url.normalized,
        platform: request.url.platform,
        route: 'local_document',
        title:
          extracted.find((document) => document.title !== undefined)?.title ??
          request.suggestedTitle,
      },
      kind: 'complete',
    };
  }
}

export function isSupportedDocumentPath(path: string): boolean {
  return /\.(?:pdf|md|markdown)$/iu.test(path);
}

export function classifyPDFDocument(text: string): 'academic_paper' | 'general_document' {
  const normalized = text;
  const signals = [
    /\bdoi\s*:\s*10\.\d{4,9}\//iu,
    /(?:^|\n)\s*(?:abstract|摘要)(?:\s|[.:：]|$)/iu,
    /(?:^|\n)\s*(?:references|bibliography|参考文献)(?:\s|[.:：]|$)/iu,
    /(?:^|\n)\s*(?:materials?\s+and\s+methods?|methodology|methods?|材料与方法|研究方法)(?:\s|[.:：]|$)/iu,
    /(?:^|\n)\s*(?:results?|结果)(?:\s|[.:：]|$)/iu,
    /(?:^|\n)\s*(?:discussion|conclusions?|讨论|结论)(?:\s|[.:：]|$)/iu,
  ].filter((pattern) => pattern.test(normalized)).length;
  return signals >= 3 ? 'academic_paper' : 'general_document';
}

async function extractPDF(bytes: Uint8Array, loadPDFJS: PDFJSLoader): Promise<ExtractedDocument> {
  let document: PDFDocumentLike | null = null;
  try {
    const pdfjs = await loadPDFJS();
    document = await pdfjs.getDocument({ data: bytes }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = textItems(content.items);
      if (text.length > 0) pages.push(text);
    }
    const body = pages.join('\n\n').trim();
    if (body.length < MIN_PDF_TEXT_CHARACTERS) {
      throw new SelfGrowError(
        'EXTRACTION_FAILED',
        'The PDF has no usable text layer. A scanned document requires OCR.',
      );
    }
    const metadata = await document.getMetadata?.().catch(() => undefined);
    const title = metadataTitle(metadata?.info);
    return { body, ...(title === undefined ? {} : { title }) };
  } catch (error) {
    if (error instanceof SelfGrowError) throw error;
    throw new SelfGrowError('EXTRACTION_FAILED', 'The PDF text could not be extracted.');
  } finally {
    document?.cleanup?.();
    await document?.destroy?.().catch(() => undefined);
  }
}

function extractMarkdown(markdown: string): ExtractedDocument {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/, '').trim();
  if (body.length === 0) {
    throw new SelfGrowError('EXTRACTION_FAILED', 'The Markdown document is empty.');
  }
  const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  return { body, ...(title === undefined || title.length === 0 ? {} : { title }) };
}

function textItems(items: readonly PDFTextItem[]): string {
  let output = '';
  for (const item of items) {
    const value = item.str?.replace(/\s+/gu, ' ').trim() ?? '';
    if (value.length > 0)
      output += `${output.endsWith('\n') || output.length === 0 ? '' : ' '}${value}`;
    if (item.hasEOL === true && !output.endsWith('\n')) output += '\n';
  }
  return output
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function metadataTitle(info: Readonly<Record<string, unknown>> | undefined): string | undefined {
  const title = info?.Title;
  return typeof title === 'string' && title.trim().length > 0 ? title.trim() : undefined;
}

function isPDFPath(path: string): boolean {
  return /\.pdf$/iu.test(path);
}
