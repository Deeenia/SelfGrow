import { describe, expect, it, vi } from 'vitest';
import { classifyPDFDocument, LocalDocumentExtractor, type PDFJSLike } from '../../src/extraction';
import type { ContentExtractor, ExtractionRequest } from '../../src/extraction';
import { selfGrowID } from '../../src/domain';

const REQUEST: ExtractionRequest = {
  attachmentPaths: ['Raw/Inbox/Attachments/paper.pdf'],
  documentAIAuthorized: true,
  id: selfGrowID('fixture'),
  language: 'zh-CN',
  suggestedTitle: 'paper',
  url: {
    normalized: 'selfgrow:text:fixture',
    platform: 'unknown',
    received: 'selfgrow:text:fixture',
  },
};

const BASE: ContentExtractor = {
  id: 'base',
  canHandle: () => true,
  extract: () => Promise.resolve({ code: 'unused', kind: 'incomplete', message: 'unused' }),
};

describe('LocalDocumentExtractor', () => {
  it('does not read a document before this capture is explicitly authorized', async () => {
    const readBinary = vi.fn(() => Promise.resolve(new Uint8Array([1])));
    const extractor = new LocalDocumentExtractor(
      BASE,
      { readBinary, readText: () => Promise.resolve('') },
      () => Promise.reject(new Error('must not load')),
    );

    await expect(
      extractor.extract({ ...REQUEST, documentAIAuthorized: false }),
    ).resolves.toMatchObject({
      code: 'document_ai_authorization_required',
      kind: 'incomplete',
    });
    expect(readBinary).not.toHaveBeenCalled();
  });

  it('extracts a PDF text layer and metadata before card generation', async () => {
    const loadPDFJS = vi.fn<() => Promise<PDFJSLike>>(() =>
      Promise.resolve({
        getDocument: () => ({
          promise: Promise.resolve({
            getMetadata: () => Promise.resolve({ info: { Title: 'Mycorrhizal traits' } }),
            getPage: () =>
              Promise.resolve({
                getTextContent: () =>
                  Promise.resolve({
                    items: [
                      { str: 'Environmental modulation', hasEOL: true },
                      { str: 'Methods and global results are reported.' },
                    ],
                  }),
              }),
            numPages: 1,
          }),
        }),
      }),
    );
    const extractor = new LocalDocumentExtractor(
      BASE,
      {
        readBinary: () => Promise.resolve(new Uint8Array([1, 2, 3])),
        readText: () => Promise.resolve(''),
      },
      loadPDFJS,
    );

    await expect(extractor.extract(REQUEST)).resolves.toMatchObject({
      content: {
        body: 'Environmental modulation\nMethods and global results are reported.',
        route: 'local_document',
        title: 'Mycorrhizal traits',
      },
      kind: 'complete',
    });
  });

  it('reads Markdown source and uses its first heading as the document title', async () => {
    const extractor = new LocalDocumentExtractor(
      BASE,
      {
        readBinary: () => Promise.resolve(new Uint8Array()),
        readText: () =>
          Promise.resolve('---\ntag: test\n---\n# Reproducible workflow\n\nDetailed steps.'),
      },
      () => Promise.reject(new Error('PDF loader must not run')),
    );

    await expect(
      extractor.extract({ ...REQUEST, attachmentPaths: ['Raw/Inbox/Attachments/workflow.md'] }),
    ).resolves.toMatchObject({
      content: {
        body: '# Reproducible workflow\n\nDetailed steps.',
        route: 'local_document',
        title: 'Reproducible workflow',
      },
    });
  });

  it('rejects a scanned PDF without a usable text layer', async () => {
    const extractor = new LocalDocumentExtractor(
      BASE,
      {
        readBinary: () => Promise.resolve(new Uint8Array([1])),
        readText: () => Promise.resolve(''),
      },
      () =>
        Promise.resolve({
          getDocument: () => ({
            promise: Promise.resolve({
              getPage: () =>
                Promise.resolve({ getTextContent: () => Promise.resolve({ items: [] }) }),
              numPages: 1,
            }),
          }),
        }),
    );

    await expect(extractor.extract(REQUEST)).resolves.toMatchObject({
      code: 'document_text_unavailable',
      kind: 'incomplete',
    });
  });

  it('distinguishes academic papers from ordinary PDF documents', () => {
    expect(
      classifyPDFDocument(
        'DOI: 10.1111/example\nAbstract\nQuestion\nMethods\nSampling\nResults\nEvidence\nReferences\nSources',
      ),
    ).toBe('academic_paper');
    expect(
      classifyPDFDocument('摘要\n研究问题\n研究方法\n样方调查\n结果\n主要发现\n参考文献\n文献列表'),
    ).toBe('academic_paper');
    expect(classifyPDFDocument('Quarterly project report\nMilestones\nBudget\nNext actions')).toBe(
      'general_document',
    );
  });
});
