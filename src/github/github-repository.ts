import type { HTTPTransport } from '../platform/ports';
import type { Language } from '../domain';

export interface GitHubRepositoryRef {
  owner: string;
  repo: string;
}

export interface SelectedReadme {
  defaultUsed: boolean;
  language: Language | null;
  markdown: string;
  path: string;
}

interface GitHubContentEntry {
  path?: unknown;
}

const README_MAX_RESPONSE_BYTES = 5_000_000;
const README_TIMEOUT_MS = 10_000;
const GITHUB_USER_AGENT = 'SelfGrow/0.1';
const GITHUB_API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': GITHUB_USER_AGENT,
};

const LANGUAGE_CANDIDATES: Readonly<Record<Language, readonly string[]>> = {
  en: [
    'README.en.md',
    'README.en-US.md',
    'README.en-GB.md',
    'README_EN.md',
    'README-English.md',
    'docs/en/README.md',
    'docs/en/readme.md',
  ],
  'zh-CN': [
    'README.zh-CN.md',
    'README.zh_CN.md',
    'README.zh-Hans.md',
    'README.zh-hans.md',
    'README.zh.md',
    'README_CN.md',
    'README-CN.md',
    'README.cn.md',
    'README_zh.md',
    'README-zh.md',
    'README.chinese.md',
    'docs/zh-CN/README.md',
    'docs/zh/README.md',
  ],
};

const DEFAULT_README_CANDIDATES = ['README.md', 'README', 'readme.md', 'Readme.md'];

/** Accepts https://github.com/owner/repo[/tree/...] and bare owner/repo names. */
export function parseGitHubRepository(input: string): GitHubRepositoryRef | null {
  let value = input.trim();
  if (value.length === 0) return null;
  let bare = false;
  try {
    const url = new URL(value);
    if (
      (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') ||
      (url.protocol !== 'http:' && url.protocol !== 'https:')
    ) {
      return null;
    }
    value = url.pathname;
  } catch {
    bare = true;
  }
  const segments = value
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);
  if (segments.length < 2 || (bare && segments.length !== 2)) return null;
  const [owner, repo] = segments;
  if (owner === undefined || repo === undefined) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) return null;
  return { owner, repo };
}

export interface GitHubRepositoryMeta {
  defaultBranch: string;
  description: string;
}

export async function fetchGitHubRepositoryMeta(
  http: HTTPTransport,
  ref: GitHubRepositoryRef,
): Promise<GitHubRepositoryMeta | null> {
  try {
    const response = await http.request({
      headers: GITHUB_API_HEADERS,
      maxResponseBytes: 262_144,
      method: 'GET',
      timeoutMs: 5_000,
      url: `https://api.github.com/repos/${ref.owner}/${ref.repo}`,
    });
    if (response.status < 200 || response.status >= 300) return null;
    const parsed = JSON.parse(response.body) as {
      default_branch?: unknown;
      description?: unknown;
    };
    return {
      defaultBranch:
        typeof parsed.default_branch === 'string' && parsed.default_branch.length > 0
          ? parsed.default_branch
          : 'main',
      description: typeof parsed.description === 'string' ? parsed.description : '',
    };
  } catch {
    return null;
  }
}

export async function resolveGitHubDefaultBranch(
  http: HTTPTransport,
  ref: GitHubRepositoryRef,
): Promise<string> {
  const meta = await fetchGitHubRepositoryMeta(http, ref);
  return meta?.defaultBranch ?? 'main';
}

/**
 * Selects the README matching the user's language. Explicit target-language
 * filenames win, then the default README's in-repo language-switch links, then
 * the plain default README. All lookups stay inside the same repository and
 * are bounded; a missing target-language variant never fails the capture.
 */
export async function selectGitHubReadme(
  http: HTTPTransport,
  ref: GitHubRepositoryRef,
  branch: string,
  language: Language,
): Promise<SelectedReadme | null> {
  const availableRootPaths = await listGitHubRootPaths(http, ref, branch);
  if (availableRootPaths === null) {
    return selectReadmeWithoutAPI(http, ref, branch, language);
  }
  const candidates = (paths: readonly string[]) =>
    paths.filter(
      (path) =>
        availableRootPaths.has(path) || availableRootPaths.has(path.slice(0, path.indexOf('/'))),
    );

  for (const candidate of candidates(LANGUAGE_CANDIDATES[language])) {
    const markdown = await readRawFile(http, ref, branch, candidate);
    if (markdown !== null) {
      return { defaultUsed: false, language, markdown, path: candidate };
    }
  }

  for (const candidate of candidates(DEFAULT_README_CANDIDATES)) {
    const markdown = await readRawFile(http, ref, branch, candidate);
    if (markdown === null) continue;
    const switched = await readLanguageSwitch(http, ref, branch, candidate, markdown, language);
    if (switched !== null) return switched;
    return { defaultUsed: true, language: null, markdown, path: candidate };
  }
  return null;
}

async function selectReadmeWithoutAPI(
  http: HTTPTransport,
  ref: GitHubRepositoryRef,
  branch: string,
  language: Language,
): Promise<SelectedReadme | null> {
  const localizedPath = LANGUAGE_CANDIDATES[language][0];
  const defaultPath = DEFAULT_README_CANDIDATES[0];
  if (localizedPath === undefined || defaultPath === undefined) return null;

  // The root API already failed. Probe only the two common raw paths and do so
  // concurrently; never repeat the former many-candidate serial timeout loop.
  const [localizedMarkdown, defaultMarkdown] = await Promise.all([
    readRawGitHubFile(http, ref, branch, localizedPath),
    readRawGitHubFile(http, ref, branch, defaultPath),
  ]);
  if (localizedMarkdown !== null) {
    return {
      defaultUsed: false,
      language,
      markdown: localizedMarkdown,
      path: localizedPath,
    };
  }
  if (defaultMarkdown === null) return null;
  return { defaultUsed: true, language: null, markdown: defaultMarkdown, path: defaultPath };
}

async function listGitHubRootPaths(
  http: HTTPTransport,
  ref: GitHubRepositoryRef,
  branch: string,
): Promise<ReadonlySet<string> | null> {
  const url = `https://api.github.com/repos/${ref.owner}/${ref.repo}/contents?ref=${encodeURIComponent(branch)}`;
  try {
    const response = await http.request({
      headers: GITHUB_API_HEADERS,
      maxResponseBytes: 512_000,
      method: 'GET',
      timeoutMs: 5_000,
      url,
    });
    if (response.status < 200 || response.status >= 300) return null;
    const entries = JSON.parse(response.body) as unknown;
    if (!Array.isArray(entries)) return null;
    const paths = new Set<string>();
    for (const entry of entries as GitHubContentEntry[]) {
      if (typeof entry.path === 'string') paths.add(entry.path);
    }
    return paths;
  } catch {
    return null;
  }
}

async function readLanguageSwitch(
  http: HTTPTransport,
  ref: GitHubRepositoryRef,
  branch: string,
  defaultPath: string,
  defaultMarkdown: string,
  language: Language,
): Promise<SelectedReadme | null> {
  const directory = parentDirectory(defaultPath);
  const targetLanguage =
    language === 'zh-CN'
      ? /(?:^|[^a-z])(?:zh(?:[-_]?(?:cn|hans))?|cn|chinese|中文|简体)(?:[^a-z]|$)/iu
      : /(?:^|[^a-z])(?:en(?:[-_]?(?:us|gb))?|english|英文)(?:[^a-z]|$)/iu;
  const candidates: string[] = [];
  const pattern = /\[([^\]]*)\]\(\s*<?([^)>\s]+)>?(?:\s+['"][^'"]*['"])?\s*\)/g;
  for (const match of defaultMarkdown.matchAll(pattern)) {
    const label = match[1]?.trim() ?? '';
    const raw = match[2]?.trim() ?? '';
    if (raw.length === 0 || raw.startsWith('#') || /^(?:https?:|\/\/|data:)/i.test(raw)) continue;
    const path = raw.startsWith('/')
      ? raw.slice(1)
      : `${directory.length === 0 ? '' : `${directory}/`}${raw.replace(/^\.\//, '')}`;
    if (path.includes('..') || !/(?:^|\/)(?:readme(?:[._-][^/]*)?)(?:\.md)?$/i.test(path)) {
      continue;
    }
    if ((targetLanguage.test(path) || targetLanguage.test(label)) && !candidates.includes(path)) {
      candidates.push(path);
    }
    if (candidates.length >= 3) break;
  }
  for (const candidate of candidates) {
    const markdown = await readRawFile(http, ref, branch, candidate);
    if (markdown !== null) {
      return {
        defaultUsed: false,
        language,
        markdown,
        path: candidate,
      };
    }
  }
  return null;
}

function readRawFile(
  http: HTTPTransport,
  ref: GitHubRepositoryRef,
  branch: string,
  path: string,
): Promise<string | null> {
  return readGitHubContentsFile(http, ref, branch, path).then(
    (markdown) => markdown ?? readRawGitHubFile(http, ref, branch, path),
  );
}

function readRawGitHubFile(
  http: HTTPTransport,
  ref: GitHubRepositoryRef,
  branch: string,
  path: string,
): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${branch}/${path}`;
  return http
    .request({
      headers: { 'User-Agent': GITHUB_USER_AGENT },
      maxResponseBytes: README_MAX_RESPONSE_BYTES,
      method: 'GET',
      timeoutMs: README_TIMEOUT_MS,
      url,
    })
    .then((response) => {
      if (response.status < 200 || response.status >= 300) return null;
      return response.body.replace(/\r\n?/g, '\n');
    })
    .catch(() => null);
}

async function readGitHubContentsFile(
  http: HTTPTransport,
  ref: GitHubRepositoryRef,
  branch: string,
  path: string,
): Promise<string | null> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${ref.owner}/${ref.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  try {
    const response = await http.request({
      headers: GITHUB_API_HEADERS,
      maxResponseBytes: README_MAX_RESPONSE_BYTES,
      method: 'GET',
      timeoutMs: README_TIMEOUT_MS,
      url,
    });
    if (response.status < 200 || response.status >= 300) return null;
    const payload = JSON.parse(response.body) as {
      content?: unknown;
      encoding?: unknown;
      type?: unknown;
    };
    if (
      payload.type !== 'file' ||
      payload.encoding !== 'base64' ||
      typeof payload.content !== 'string'
    ) {
      return null;
    }
    const binary = atob(payload.content.replace(/\s+/g, ''));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes).replace(/\r\n?/g, '\n');
  } catch {
    return null;
  }
}

function parentDirectory(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}
