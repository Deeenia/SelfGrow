import { SelfGrowError } from '../domain';
import { normalizeGithubMarkdownForObsidian, rewriteGithubMarkdown } from '../extraction/markdown';
import type {
  ContentExtractor,
  ExtractedContent,
  ExtractionOutcome,
  ExtractionRequest,
} from '../extraction/types';
import type { HTTPTransport } from '../platform/ports';
import {
  parseGitHubRepository,
  resolveGitHubDefaultBranch,
  selectGitHubReadme,
} from './github-repository';

export class GitHubRepositoryExtractor implements ContentExtractor {
  readonly id = 'github-repository-v1';
  readonly #http: HTTPTransport;

  constructor(http: HTTPTransport) {
    this.#http = http;
  }

  canHandle(url: URL): boolean {
    return (
      (url.hostname === 'github.com' || url.hostname === 'www.github.com') &&
      parseGitHubRepository(url.toString()) !== null
    );
  }

  async extract(request: ExtractionRequest): Promise<ExtractionOutcome> {
    const ref = parseGitHubRepository(request.url.normalized);
    if (ref === null)
      throw new SelfGrowError('EXTRACTION_FAILED', 'The GitHub repository is invalid.');
    const branch = await resolveGitHubDefaultBranch(this.#http, ref);
    const readme = await selectGitHubReadme(this.#http, ref, branch, request.language);
    if (readme === null) {
      return {
        code: 'main_text_missing',
        kind: 'incomplete',
        message: 'The repository exposes no readable README.',
      };
    }
    const directory = readme.path.includes('/')
      ? readme.path.slice(0, readme.path.lastIndexOf('/'))
      : '';
    // Preserve the README's Markdown semantics while removing only GitHub HTML
    // layout wrappers that make Obsidian treat nested Markdown as plain text.
    const body = normalizeGithubMarkdownForObsidian(
      rewriteGithubMarkdown(readme.markdown, {
        branch,
        directory,
        owner: ref.owner,
        repo: ref.repo,
      }),
    );
    const title = readmeTitle(readme.markdown) ?? ref.repo;
    return {
      content: {
        body,
        bodyKind: 'article',
        finalURL: `https://github.com/${ref.owner}/${ref.repo}`,
        github: {
          owner: ref.owner,
          readmeLanguage: readme.language,
          readmePath: readme.path,
          repo: ref.repo,
        },
        platform: 'generic_web',
        route: 'local_article',
        sourceLanguage: readme.language ?? request.language,
        title,
      },
      kind: 'complete',
    };
  }
}

function readmeTitle(markdown: string): string | null {
  const match = /^#\s+(.+)$/m.exec(markdown);
  return match?.[1]?.trim() ?? null;
}

export function isGitHubURL(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === 'github.com' || url.hostname === 'www.github.com';
  } catch {
    return false;
  }
}

export function isGitHubExtracted(content: ExtractedContent): boolean {
  return content.github !== undefined;
}
