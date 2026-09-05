import { JSDOM } from 'jsdom';
import { htmlToMarkdown, sanitizeHTMLToDom } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createObsidianArticleDocumentProcessor } from '../../src/extraction/obsidian-article-document-processor';

vi.mock('obsidian', () => ({
  htmlToMarkdown: vi.fn((fragment: DocumentFragment) => fragment.textContent ?? ''),
  sanitizeHTMLToDom: vi.fn((html: string) => {
    const dom = new JSDOM(`<body>${html}</body>`);
    dom.window.document.querySelectorAll('script').forEach((node) => node.remove());
    const fragment = dom.window.document.createRange().createContextualFragment('');
    fragment.append(...dom.window.document.body.childNodes);
    return fragment;
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'DOMParser',
    class {
      parseFromString(html: string): Document {
        return new JSDOM(html, { url: 'https://example.test/article' }).window.document;
      }
    },
  );
});

describe('Task-018 Obsidian article document boundary', () => {
  it('wires native DOMParser through Readability, sanitizer, and Markdown conversion', () => {
    const body = 'Grounded article sentence with enough useful detail. '.repeat(12);
    const outcome = createObsidianArticleDocumentProcessor().process(
      `<html><head><title>Boundary title</title></head><body><article><h1>Boundary title</h1><p>${body}</p><script>danger()</script></article></body></html>`,
      'https://example.test/article',
    );

    expect(outcome.kind).toBe('complete');
    expect(sanitizeHTMLToDom).toHaveBeenCalledOnce();
    expect(htmlToMarkdown).toHaveBeenCalledOnce();
    expect(JSON.stringify(outcome)).not.toContain('danger()');
  });
});
