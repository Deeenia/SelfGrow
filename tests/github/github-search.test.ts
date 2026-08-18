import { describe, expect, it } from 'vitest';
import { resolveGitHubName, type GitHubCandidate } from '../../src/github';
import { FixtureHTTPTransport } from '../harness';

function searchRoute(query: string, items: unknown[]) {
  return {
    method: 'GET' as const,
    outcome: {
      kind: 'response' as const,
      response: {
        body: JSON.stringify({ items }),
        headers: {},
        status: 200,
      },
    },
    url: `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=10`,
  };
}

function item(partial: Partial<GitHubCandidate> & { fullName: string }): Record<string, unknown> {
  return {
    archived: partial.archived ?? false,
    description: partial.description ?? '',
    full_name: partial.fullName,
    pushed_at: partial.pushedAt ?? '2026-07-01T00:00:00Z',
    stargazers_count: partial.stars ?? 0,
  };
}

describe('resolveGitHubName', () => {
  it('turns an explicit owner/repository name into a link without search', async () => {
    const resolution = await resolveGitHubName(
      new FixtureHTTPTransport([]),
      'acme/tool',
      'Project',
    );
    expect(resolution).toMatchObject({
      kind: 'unique',
      candidate: { fullName: 'acme/tool', url: 'https://github.com/acme/tool' },
    });
  });
  it('auto-adopts a single high-confidence exact-name match', async () => {
    const http = new FixtureHTTPTransport([
      searchRoute('OpenHands', [
        item({ fullName: 'All-Hands-AI/OpenHands', stars: 30000, description: 'software agent' }),
        item({ fullName: 'other/openhands-clone', stars: 2 }),
      ]),
    ]);
    const resolution = await resolveGitHubName(http, 'OpenHands', 'Project');
    expect(resolution).toMatchObject({
      kind: 'unique',
      candidate: { fullName: 'All-Hands-AI/OpenHands' },
    });
  });

  it('returns up to three candidates for confirmation when several match', async () => {
    const http = new FixtureHTTPTransport([
      searchRoute('langgraph', [
        item({ fullName: 'langchain-ai/langgraph', stars: 9000 }),
        item({ fullName: 'acme/langgraph', stars: 100 }),
        item({ fullName: 'bob/langgraph', stars: 50 }),
        item({ fullName: 'cde/langgraph', stars: 10 }),
      ]),
    ]);
    const resolution = await resolveGitHubName(http, 'langgraph', 'Project');
    expect(resolution.kind).toBe('multiple');
    if (resolution.kind !== 'multiple') return;
    expect(resolution.candidates.map((candidate) => candidate.fullName)).toEqual([
      'langchain-ai/langgraph',
      'acme/langgraph',
      'bob/langgraph',
    ]);
  });

  it('returns none without fabricating a URL when nothing plausible matches', async () => {
    const http = new FixtureHTTPTransport([
      searchRoute('zzyzz-unknown-thing', [item({ fullName: 'someone/unrelated-repo' })]),
    ]);
    const resolution = await resolveGitHubName(http, 'zzyzz-unknown-thing', 'Skill');
    expect(resolution.kind).toBe('none');
  });

  it('deprioritizes archived repositories', async () => {
    const http = new FixtureHTTPTransport([
      searchRoute('legacytool', [
        item({ fullName: 'org/legacytool', archived: true, stars: 500 }),
        item({ fullName: 'org/legacytool2', stars: 10 }),
      ]),
    ]);
    const resolution = await resolveGitHubName(http, 'legacytool', 'Project');
    expect(resolution.kind).toBe('multiple');
  });

  it('handles a repository offline without throwing', async () => {
    const http = new FixtureHTTPTransport([]);
    const resolution = await resolveGitHubName(http, 'anything', 'Skill');
    expect(resolution.kind).toBe('none');
  });

  it('appends a skill query for Skill category searches and ranks the Skill repo first', async () => {
    const http = new FixtureHTTPTransport([
      searchRoute('deep-research', [item({ fullName: 'org/deep-research', stars: 100 })]),
      searchRoute('deep-research skill', [
        item({ fullName: 'skills/deep-research', stars: 400, description: 'agent skill' }),
      ]),
    ]);
    const resolution = await resolveGitHubName(http, 'deep-research', 'Skill');
    expect(resolution.kind).toBe('multiple');
    if (resolution.kind !== 'multiple') return;
    expect(resolution.candidates[0]?.fullName).toBe('skills/deep-research');
  });

  it('keeps candidate fields for the confirmation list', async () => {
    const http = new FixtureHTTPTransport([
      searchRoute('sometool', [
        item({
          archived: false,
          description: 'A useful tool.',
          fullName: 'acme/sometool',
          pushedAt: '2026-08-01T00:00:00Z',
          stars: 42,
        }),
        item({ fullName: 'bob/sometool', stars: 1 }),
      ]),
    ]);
    const resolution = await resolveGitHubName(http, 'sometool', 'Project');
    expect(resolution.kind).toBe('multiple');
    if (resolution.kind !== 'multiple') return;
    expect(resolution.candidates[0]).toMatchObject({
      archived: false,
      description: 'A useful tool.',
      fullName: 'acme/sometool',
      pushedAt: '2026-08-01T00:00:00Z',
      stars: 42,
    });
  });
});
