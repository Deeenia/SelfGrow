import { htmlToMarkdown, sanitizeHTMLToDom } from 'obsidian';
import { ArticleDocumentProcessor } from './article-document-processor';

export function createObsidianArticleDocumentProcessor(): ArticleDocumentProcessor {
  return new ArticleDocumentProcessor({
    htmlToMarkdown: (node) => htmlToMarkdown(node),
    parseHTML: (html) => new DOMParser().parseFromString(html, 'text/html'),
    sanitizeHTML: (html) => sanitizeHTMLToDom(html),
  });
}
