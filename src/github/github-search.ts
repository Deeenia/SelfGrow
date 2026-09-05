import type { HTTPTransport } from '../platform/ports';
import type { RawCategory } from '../domain';

export interface GitHubCandidate {
  archived: boolean;
  description: string;
  fullName: string;
  pushedAt: string;
  stars: number;
  url: string;
}

export type GitHubNameResolution =
  | { kind: 'multiple'; candidates: readonly GitHubCandidate[] }
  | { kind: 'none' }
  | { kind: 'unique'; candidate: GitHubCandidate };

const SEARCH_MAX_RESPONSE_BYTES = 524_288;
const SEARCH_TIMEOUT_MS = 15_000;
const README_MAX_RESPONSE_BYTES = 524_288;

/**
 * Searches GitHub for the official repository of a bare project/Skill name.
 * Uses the GitHub Search API (never page scraping) with bounded queries and
 * responses, ranks candidates by name/owner/description/README/archive
 * recency/star signals, and only auto-adopts a single high-confidence exact
 * match; otherwise it returns up to three candidates for the user to confirm.
 */
export async function resolveGitHubName(
  http: HTTPTransport,
  input: string,
  category: RawCategory,
): Promise<GitHubNameResolution> {
  const direct = directRepositoryCandidate(input);
  if (direct !== null) return { kind: 'unique', candidate: direct };
  const candidates = await searchGitHubRepositories(http, input, category);
  const ranked = await rankGitHubCandidates(http, candidates, input);
  const name = repositoryName(input).toLocaleLowerCase();
  const normalizedInput = input.trim().toLocaleLowerCase();
  const exact = ranked.filter(
    (candidate) =>
      candidate.candidate.fullName.toLocaleLowerCase() === normalizedInput ||
      repositoryName(candidate.candidate.fullName).toLocaleLowerCase() === name,
  );

  const top = ranked[0];
  if (top === undefined) return { kind: 'none' };
  if (exact.length === 1 && exact[0] === top && top.score >= 100) {
    return { kind: 'unique', candidate: top.candidate };
  }
  if (top.score >= 30) {
    return { kind: 'multiple', candidates: ranked.slice(0, 3).map((item) => item.candidate) };
  }
  return { kind: 'none' };
}

interface RankedCandidate {
  candidate: GitHubCandidate;
  score: number;
}

async function rankGitHubCandidates(
  http: HTTPTransport,
  candidates: readonly GitHubCandidate[],
  input: string,
): Promise<readonly RankedCandidate[]> {
  const name = repositoryName(input).toLocaleLowerCase();
  const fullName = input.trim().toLocaleLowerCase();
  const owner = fullName.includes('/') ? (fullName.split('/')[0] ?? '') : '';

  const ranked = candidates.map((candidate) => {
    const candidateName = repositoryName(candidate.fullName).toLocaleLowerCase();
    const candidateFullName = candidate.fullName.toLocaleLowerCase();
    const description = candidate.description.toLocaleLowerCase();
    let score = 0;
    if (candidateName === name) score += 100;
    if (candidateFullName === fullName) score += 40;
    if (description.includes(name) && name.length >= 3) score += 20;
    if (owner.length > 0 && candidateFullName.startsWith(`${owner}/`)) score += 15;
    if (candidate.archived) score -= 50;
    const months = monthsSince(candidate.pushedAt);
    if (months <= 3) score += 5;
    else if (months <= 12) score += 2;
    score += Math.min(Math.floor(Math.log10(candidate.stars + 1)), 4);
    return { candidate, score };
  });

  ranked.sort(
    (left, right) => right.score - left.score || right.candidate.stars - left.candidate.stars,
  );

  const top = ranked.slice(0, 3);
  for (const item of top) {
    if (await readmeContainsName(http, item.candidate, name)) item.score += 10;
  }
  return [...ranked].sort(
    (left, right) => right.score - left.score || right.candidate.stars - left.candidate.stars,
  );
}

async function readmeContainsName(
  http: HTTPTransport,
  candidate: GitHubCandidate,
  name: string,
): Promise<boolean> {
  if (name.length < 2) return false;
  const [owner, repo] = candidate.fullName.split('/');
  if (owner === undefined || repo === undefined) return false;
  const response = await http
    .request({
      maxResponseBytes: README_MAX_RESPONSE_BYTES,
      method: 'GET',
      timeoutMs: 10_000,
      url: `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`,
    })
    .catch(() => null);
  if (response === null || response.status < 200 || response.status >= 300) return false;
  return response.body.toLocaleLowerCase().includes(name);
}

async function searchGitHubRepositories(
  http: HTTPTransport,
  input: string,
  category: RawCategory,
): Promise<GitHubCandidate[]> {
  const byFullName = new Map<string, GitHubCandidate>();
  for (const query of searchQueries(input, category)) {
    const response = await http
      .request({
        headers: { Accept: 'application/vnd.github+json' },
        maxResponseBytes: SEARCH_MAX_RESPONSE_BYTES,
        method: 'GET',
        timeoutMs: SEARCH_TIMEOUT_MS,
        url: `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=10`,
      })
      .catch(() => null);
    if (response === null || response.status < 200 || response.status >= 300) continue;
    let parsed: { items?: unknown };
    try {
      parsed = JSON.parse(response.body) as { items?: unknown };
    } catch {
      continue;
    }
    if (!Array.isArray(parsed.items)) continue;
    for (const item of parsed.items) {
      const candidate = candidateFromSearchItem(item);
      if (candidate !== null) byFullName.set(candidate.fullName.toLocaleLowerCase(), candidate);
    }
  }
  return [...byFullName.values()];
}

function candidateFromSearchItem(item: unknown): GitHubCandidate | null {
  if (typeof item !== 'object' || item === null) return null;
  const value = item as Record<string, unknown>;
  if (typeof value.full_name !== 'string' || value.full_name.length === 0) return null;
  return {
    archived: value.archived === true,
    description: typeof value.description === 'string' ? value.description : '',
    fullName: value.full_name,
    pushedAt: typeof value.pushed_at === 'string' ? value.pushed_at : '',
    stars: typeof value.stargazers_count === 'number' ? value.stargazers_count : 0,
    url: `https://github.com/${value.full_name}`,
  };
}

function searchQueries(input: string, category: RawCategory): readonly string[] {
  const name = input.trim();
  const queries = [name, `repo:${name}`];
  if (name.includes('/')) {
    const repo = repositoryName(name);
    if (repo.length > 0 && repo !== name) queries.push(repo);
  }
  if (category === 'Skill' && !queries.includes(`${name} skill`)) {
    queries.push(`${name} skill`);
  }
  return queries.slice(0, 3);
}

function directRepositoryCandidate(input: string): GitHubCandidate | null {
  const name = input.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) return null;
  return {
    archived: false,
    description: '',
    fullName: name,
    pushedAt: '',
    stars: 0,
    url: `https://github.com/${name}`,
  };
}

function repositoryName(fullName: string): string {
  return fullName.trim().split('/').pop() ?? '';
}

function monthsSince(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return (Date.now() - timestamp) / (30 * 24 * 60 * 60 * 1000);
}
