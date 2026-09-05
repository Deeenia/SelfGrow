import { SelfGrowError } from '../domain';
import type { HTTPTransport } from '../platform/ports';
import { validateCompleteContent } from './completeness';
import type { ArticleDocumentProcessor } from './article-document-processor';
import type {
  ContentExtractor,
  ExtractedContent,
  ExtractionOutcome,
  ExtractionRequest,
} from './types';

const ARTICLE_TIMEOUT_MS = 15_000;
const ARTICLE_MAX_RESPONSE_BYTES = 2_000_000;
const GITHUB_PAGE_MAX_RESPONSE_BYTES = 5_000_000;
const WECHAT_ARTICLE_MAX_RESPONSE_BYTES = 5_000_000;

export class CapturedTextAndGenericExtractor implements ContentExtractor {
  readonly id = 'captured-text-generic-v1';
  readonly #articles: ArticleDocumentProcessor;
  readonly #github: ContentExtractor | null;
  readonly #http: HTTPTransport;
  readonly #platforms: ContentExtractor | null;

  constructor(
    http: HTTPTransport,
    articles: ArticleDocumentProcessor,
    platforms: ContentExtractor | null = null,
    github: ContentExtractor | null = null,
  ) {
    this.#http = http;
    this.#articles = articles;
    this.#platforms = platforms;
    this.#github = github;
  }

  canHandle(url: URL): boolean {
    return url.protocol === 'http:' || url.protocol === 'https:';
  }

  async extract(request: ExtractionRequest): Promise<ExtractionOutcome> {
    let githubPageFallback = false;
    const captured = request.capturedText;
    if (captured !== undefined) {
      if (request.url.normalized.startsWith('selfgrow:text:') && captured.trim().length >= 20) {
        return completeContent(request, { body: captured.trim(), route: 'captured_text' });
      }
      const completeness = validateCompleteContent(captured);
      if (completeness.kind === 'complete') {
        return completeContent(request, {
          body: completeness.normalized,
          route: 'captured_text',
        });
      }
    }

    if (this.#github !== null && this.#github.canHandle(new URL(request.url.normalized))) {
      const outcome = await this.#github.extract(request);
      if (outcome.kind === 'complete') return outcome;
      // GitHub's API and raw-content hosts are not reachable on every network.
      // The repository page still contains the rendered README, so let the
      // existing bounded HTML article path recover it instead of failing here.
      githubPageFallback = true;
    }

    if (
      request.url.platform !== 'generic_web' &&
      request.url.platform !== 'wechat_official_account'
    ) {
      return this.#platforms?.extract(request) ?? incomplete('platform_adapter_required');
    }

    const response = await this.#http.request({
      headers: { Accept: 'text/html,application/xhtml+xml' },
      maxResponseBytes: githubPageFallback
        ? GITHUB_PAGE_MAX_RESPONSE_BYTES
        : request.url.platform === 'wechat_official_account'
          ? WECHAT_ARTICLE_MAX_RESPONSE_BYTES
          : ARTICLE_MAX_RESPONSE_BYTES,
      method: 'GET',
      timeoutMs: ARTICLE_TIMEOUT_MS,
      url: request.url.normalized,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new SelfGrowError('EXTRACTION_FAILED', 'The article request failed.', {
        status: response.status,
      });
    }
    if (!isHTMLResponse(response.headers)) {
      return incomplete('unsupported_content_type');
    }

    const processed = this.#articles.process(response.body, request.url.normalized);
    if (processed.kind === 'incomplete') {
      if (request.url.platform === 'wechat_official_account' && this.#platforms !== null) {
        return this.#platforms.extract(request);
      }
      return incomplete(processed.reason);
    }
    return completeContent(request, {
      ...processed.article,
      route: 'local_article',
    });
  }
}

type ContentFields = Pick<ExtractedContent, 'body' | 'route'> &
  Partial<
    Pick<ExtractedContent, 'author' | 'canonicalURL' | 'publishedAt' | 'sourceLanguage' | 'title'>
  >;

function completeContent(request: ExtractionRequest, fields: ContentFields): ExtractionOutcome {
  return {
    content: {
      bodyKind: 'article',
      finalURL: request.url.normalized,
      platform: request.url.platform,
      ...fields,
    },
    kind: 'complete',
  };
}

function incomplete(code: string): ExtractionOutcome {
  return {
    code,
    kind: 'incomplete',
    message: 'Complete article text or transcript was not available.',
  };
}

function isHTMLResponse(headers: Readonly<Record<string, string>>): boolean {
  const value = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === 'content-type',
  )?.[1];
  return (
    value === undefined || /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(value.trim())
  );
}
