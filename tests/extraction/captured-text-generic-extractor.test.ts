import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { selfGrowID } from '../../src/domain';
import {
  ArticleDocumentProcessor,
  CapturedTextAndGenericExtractor,
  MAX_COMPLETE_CONTENT_CHARS,
  MIN_COMPLETE_CONTENT_CHARS,
  type ArticleDocumentTools,
  type ExtractionRequest,
} from '../../src/extraction';
import type { NormalizedURL } from '../../src/url';
import { FixtureHTTPTransport } from '../harness';

const ARTICLE_URL = 'https://example.test/articles/one';

function request(
  overrides: Partial<ExtractionRequest> = {},
  urlOverrides: Partial<NormalizedURL> = {},
): ExtractionRequest {
  return {
    id: selfGrowID('fixture-extraction-id'),
    language: 'en',
    url: {
      normalized: ARTICLE_URL,
      platform: 'generic_web',
      received: ARTICLE_URL,
      ...urlOverrides,
    },
    ...overrides,
  };
}

function longText(marker = 'complete article'): string {
  return `${marker} ${'Evidence grounded sentence with useful context. '.repeat(12)}`;
}

function articleHTML(): string {
  return `<!doctype html><html lang="en"><head>
    <title>Fixture page</title>
    <link rel="canonical" href="/canonical/article">
  </head><body><nav>Navigation only</nav><article>
    <h1>Fixture article title</h1>
    <p>${longText('Opening paragraph.')}</p>
    <h2>Important heading</h2>
    <p>${longText('Second paragraph.')}</p>
    <ul><li>First retained item</li><li>Second retained item</li></ul>
    <pre><code>const answer = 42;</code></pre>
    <script>globalThis.__selfgrowExecuted = true</script>
    <p onclick="steal()">${longText('Closing paragraph.')}</p>
  </article></body></html>`;
}

function testProcessor(observedSanitizedHTML: string[] = []): ArticleDocumentProcessor {
  const tools: ArticleDocumentTools = {
    htmlToMarkdown: (fragment) => renderChildren(fragment),
    parseHTML: (html) => new JSDOM(html, { url: ARTICLE_URL }).window.document,
    sanitizeHTML: (html) => {
      observedSanitizedHTML.push(html);
      const dom = new JSDOM(`<body>${html}</body>`, { url: ARTICLE_URL });
      dom.window.document.querySelectorAll('script,style,iframe').forEach((node) => node.remove());
      dom.window.document.querySelectorAll('*').forEach((element) => {
        for (const attribute of [...element.attributes]) {
          if (attribute.name.toLowerCase().startsWith('on')) {
            element.removeAttribute(attribute.name);
          }
        }
      });
      const fragment = dom.window.document.createRange().createContextualFragment('');
      fragment.append(...dom.window.document.body.childNodes);
      return fragment;
    },
  };
  return new ArticleDocumentProcessor(tools);
}

function renderChildren(node: Node): string {
  return [...node.childNodes]
    .map(renderNode)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderNode(node: Node): string {
  if (node.nodeType === node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== node.ELEMENT_NODE) return renderChildren(node);
  const element = node as Element;
  const content = renderChildren(element);
  switch (element.tagName.toLowerCase()) {
    case 'h1':
      return `# ${content}\n\n`;
    case 'h2':
      return `## ${content}\n\n`;
    case 'h3':
      return `### ${content}\n\n`;
    case 'p':
      return `${content}\n\n`;
    case 'li':
      return `- ${content}\n`;
    case 'pre':
      return `\`\`\`\n${element.textContent ?? ''}\n\`\`\`\n\n`;
    default:
      return content;
  }
}

describe('Task-018 captured text and generic article extraction', () => {
  it('uses complete captured Markdown without making an HTTP request', async () => {
    const transport = new FixtureHTTPTransport([]);
    const extractor = new CapturedTextAndGenericExtractor(transport, testProcessor());
    const capturedText = `# Shared article\n\n${longText().repeat(2)}`;

    const outcome = await extractor.extract(request({ capturedText }));

    expect(outcome).toMatchObject({
      content: { body: capturedText.trim(), bodyKind: 'article', route: 'captured_text' },
      kind: 'complete',
    });
    expect(transport.calls).toHaveLength(0);
  });

  it('falls back from metadata-only captured text to bounded generic HTML extraction', async () => {
    const transport = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: {
          kind: 'response',
          response: {
            body: articleHTML(),
            headers: { 'content-type': 'text/html; charset=utf-8' },
            status: 200,
          },
        },
        url: ARTICLE_URL,
      },
    ]);
    const observedHTML: string[] = [];
    const extractor = new CapturedTextAndGenericExtractor(transport, testProcessor(observedHTML));

    const outcome = await extractor.extract(
      request({ capturedText: 'Title and description only' }),
    );

    expect(outcome.kind).toBe('complete');
    if (outcome.kind !== 'complete') throw new Error('Expected complete extraction.');
    expect(outcome.content).toMatchObject({
      bodyKind: 'article',
      canonicalURL: 'https://example.test/canonical/article',
      finalURL: ARTICLE_URL,
      platform: 'generic_web',
      route: 'local_article',
      title: 'Fixture page',
    });
    expect(outcome.content.body).toContain('## Important heading');
    expect(outcome.content.body).toContain('- First retained item');
    expect(outcome.content.body).toContain('```\nconst answer = 42;');
    expect(outcome.content.body).not.toContain('__selfgrowExecuted');
    expect(outcome.content.body).not.toContain('onclick');
    expect(observedHTML).toHaveLength(1);
    expect(transport.calls[0]).toMatchObject({
      headers: { Accept: 'text/html,application/xhtml+xml' },
      maxResponseBytes: 2_000_000,
      method: 'GET',
      timeoutMs: 15_000,
      url: ARTICLE_URL,
    });
  });

  it('falls back to the rendered GitHub repository page when README APIs fail', async () => {
    const repositoryURL = 'https://github.com/acme/tool';
    const repositoryHTML = articleHTML().replace(
      '<article>',
      `${'<span></span>'.repeat(10_001)}<article class="markdown-body">`,
    );
    const transport = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: {
          kind: 'response',
          response: {
            body: repositoryHTML,
            headers: { 'content-type': 'text/html; charset=utf-8' },
            status: 200,
          },
        },
        url: repositoryURL,
      },
    ]);
    const unavailableGitHubExtractor = {
      canHandle: () => true,
      extract: async () => ({
        code: 'main_text_missing',
        kind: 'incomplete' as const,
        message: 'The repository exposes no readable README.',
      }),
      id: 'github-fixture',
    };
    const extractor = new CapturedTextAndGenericExtractor(
      transport,
      testProcessor(),
      null,
      unavailableGitHubExtractor,
    );

    const outcome = await extractor.extract(
      request({}, { normalized: repositoryURL, platform: 'generic_web', received: repositoryURL }),
    );

    expect(outcome).toMatchObject({
      content: { route: 'local_article', title: 'Fixture page' },
      kind: 'complete',
    });
    expect(outcome.kind === 'complete' && outcome.content.body).toContain('Important heading');
    expect(transport.calls.map((call) => call.url)).toEqual([repositoryURL]);
    expect(transport.calls[0]?.maxResponseBytes).toBe(5_000_000);
  });

  it('uses the generic article path for a representative WeChat Official Account page', async () => {
    const wechatURL = 'https://mp.weixin.qq.com/s/fixture';
    const transport = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: {
          kind: 'response',
          response: {
            body: articleHTML(),
            headers: { 'content-type': 'text/html; charset=utf-8' },
            status: 200,
          },
        },
        url: wechatURL,
      },
    ]);
    const outcome = await new CapturedTextAndGenericExtractor(transport, testProcessor()).extract(
      request(
        {},
        {
          normalized: wechatURL,
          platform: 'wechat_official_account',
          received: wechatURL,
        },
      ),
    );
    expect(outcome).toMatchObject({
      content: { bodyKind: 'article', platform: 'wechat_official_account', route: 'local_article' },
      kind: 'complete',
    });
    expect(transport.calls[0]).toMatchObject({ maxResponseBytes: 5_000_000 });
  });

  it('does not mislabel metadata-only or unsupported platform content as complete', async () => {
    const extractor = new CapturedTextAndGenericExtractor(
      new FixtureHTTPTransport([]),
      testProcessor(),
    );
    const outcome = await extractor.extract(
      request({ capturedText: 'A video title and short description.' }, { platform: 'bilibili' }),
    );

    expect(outcome).toEqual({
      code: 'platform_adapter_required',
      kind: 'incomplete',
      message: 'Complete article text or transcript was not available.',
    });
  });

  it.each([
    [{ 'content-type': 'application/pdf' }, 200, 'unsupported_content_type'],
    [{ 'content-type': 'text/html' }, 200, 'main_text_missing'],
  ] as const)(
    'returns an honest incomplete result for unusable responses',
    async (headers, status, code) => {
      const transport = new FixtureHTTPTransport([
        {
          method: 'GET',
          outcome: {
            kind: 'response',
            response: { body: '<html><title>Metadata only</title></html>', headers, status },
          },
          url: ARTICLE_URL,
        },
      ]);
      const outcome = await new CapturedTextAndGenericExtractor(transport, testProcessor()).extract(
        request(),
      );

      expect(outcome).toMatchObject({ code, kind: 'incomplete' });
    },
  );

  it('rejects non-success HTTP without including the response body', async () => {
    const secretBody = 'raw-provider-body-must-not-escape';
    const transport = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: {
          kind: 'response',
          response: { body: secretBody, headers: { 'content-type': 'text/html' }, status: 503 },
        },
        url: ARTICLE_URL,
      },
    ]);
    const error = await new CapturedTextAndGenericExtractor(transport, testProcessor())
      .extract(request())
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'EXTRACTION_FAILED', diagnostics: { status: 503 } });
    expect(JSON.stringify(error)).not.toContain(secretBody);
  });

  it('enforces document complexity and final Markdown size without truncation', () => {
    const processor = testProcessor();
    const complex = `<html><body><article>${'<span>x</span>'.repeat(10_001)}</article></body></html>`;
    expect(processor.process(complex, ARTICLE_URL)).toEqual({
      kind: 'incomplete',
      reason: 'document_too_complex',
    });

    const tools: ArticleDocumentTools = {
      htmlToMarkdown: () => 'x'.repeat(MAX_COMPLETE_CONTENT_CHARS + 1),
      parseHTML: (html) => new JSDOM(html, { url: ARTICLE_URL }).window.document,
      sanitizeHTML: (html) => {
        const dom = new JSDOM(`<body>${html}</body>`);
        const fragment = dom.window.document.createRange().createContextualFragment('');
        fragment.append(...dom.window.document.body.childNodes);
        return fragment;
      },
    };
    expect(new ArticleDocumentProcessor(tools).process(articleHTML(), ARTICLE_URL)).toEqual({
      kind: 'incomplete',
      reason: 'content_too_large',
    });
  });

  it('uses a concrete completeness threshold', () => {
    expect(MIN_COMPLETE_CONTENT_CHARS).toBe(200);
  });
});
