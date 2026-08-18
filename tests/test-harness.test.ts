import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FakeSecretResolver,
  FixedTemporalContext,
  FixtureHTTPError,
  FixtureHTTPTransport,
  InMemoryFrontmatter,
  InMemoryVault,
  OBVIOUSLY_FAKE_SECRET,
  loadFixtureVault,
} from './harness';

const testsRoot = dirname(fileURLToPath(import.meta.url));
const fixtureVaultRoot = resolve(testsRoot, 'fixtures', 'vault');
const fixedTime = '2026-08-09T09:30:00+08:00';

describe('Task-006 test harness', () => {
  it('loads a sample plugin Vault without a live Obsidian instance', async () => {
    const clock = new FixedTemporalContext(fixedTime, 'Asia/Shanghai');
    const entries = await loadFixtureVault(fixtureVaultRoot);
    const vault = new InMemoryVault(clock, entries);

    expect(await vault.listMarkdownFiles('SelfGrow')).toEqual([
      'SelfGrow/Inbox Queue.md',
      'SelfGrow/Inbox/synthetic-capture.md',
    ]);
    expect(await vault.read('.obsidian/plugins/selfgrow/manifest.json')).toContain(
      '"isDesktopOnly": false',
    );
    expect(await vault.read('SelfGrow/Inbox Queue.md')).toContain('https://example.test/article');
  });

  it('supports deterministic Vault reads, creates, and atomic transforms', async () => {
    const clock = new FixedTemporalContext(fixedTime, 'Asia/Shanghai');
    const vault = new InMemoryVault(clock);

    await vault.create('SelfGrow/Inbox/item.md', 'queued');
    const transformed = await vault.process(
      'SelfGrow/Inbox/item.md',
      (current) => `${current}\nprocessed`,
    );

    expect(transformed).toBe('queued\nprocessed');
    expect(await vault.read('SelfGrow/Inbox/item.md')).toBe(transformed);
    expect(vault.timestamps('SelfGrow/Inbox/item.md')).toEqual({
      createdAt: new Date(fixedTime).getTime(),
      modifiedAt: new Date(fixedTime).getTime(),
    });
  });

  it('isolates frontmatter copies between reads and transforms', async () => {
    const frontmatter = new InMemoryFrontmatter({
      'SelfGrow/Inbox/item.md': { nested: { state: 'queued' }, status: 'queued' },
    });
    const first = await frontmatter.read('SelfGrow/Inbox/item.md');

    expect(first).not.toBeNull();
    (first?.nested as { state: string }).state = 'mutated outside adapter';
    await frontmatter.process('SelfGrow/Inbox/item.md', (current) => ({
      ...current,
      status: 'extracting',
    }));

    expect(await frontmatter.read('SelfGrow/Inbox/item.md')).toEqual({
      nested: { state: 'queued' },
      status: 'extracting',
    });
    expect(await frontmatter.read('missing.md')).toBeNull();
  });

  it('resolves only obviously fake test secrets', () => {
    const secrets = new FakeSecretResolver({
      'SelfGrow Chat API Key': OBVIOUSLY_FAKE_SECRET,
    });

    expect(secrets.get({ name: 'SelfGrow Chat API Key' })).toBe(OBVIOUSLY_FAKE_SECRET);
    expect(secrets.get({ name: 'missing' })).toBeNull();
    expect(OBVIOUSLY_FAKE_SECRET).toContain('not-valid');
  });

  it('returns defensive time copies and an injected timezone', () => {
    const clock = new FixedTemporalContext(fixedTime, 'Asia/Shanghai');
    const first = clock.now();
    first.setUTCFullYear(1999);

    expect(clock.now().toISOString()).toBe('2026-08-09T01:30:00.000Z');
    expect(clock.timeZone()).toBe('Asia/Shanghai');
  });

  it('serves immutable HTTP fixtures and records redacted calls in order', async () => {
    const transport = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: {
          kind: 'response',
          response: {
            body: 'fixture body',
            headers: { location: 'https://example.test/final' },
            status: 302,
          },
        },
        url: 'https://example.test/redirect',
      },
    ]);
    const request = {
      headers: {
        Authorization: `Bearer ${OBVIOUSLY_FAKE_SECRET}`,
        Cookie: `fixture=${OBVIOUSLY_FAKE_SECRET}`,
        'X-Test': 'visible',
      },
      maxResponseBytes: 1024,
      method: 'GET' as const,
      timeoutMs: 100,
      url: 'https://example.test/redirect',
    };
    const first = await transport.request(request);
    first.headers.location = 'mutated';
    const second = await transport.request(request);

    expect(second).toEqual({
      body: 'fixture body',
      headers: { location: 'https://example.test/final' },
      status: 302,
    });
    expect(transport.calls.map((call) => call.url)).toEqual([request.url, request.url]);
    expect(transport.calls[0]?.headers).toEqual({
      Authorization: '[REDACTED]',
      Cookie: '[REDACTED]',
      'X-Test': 'visible',
    });
  });

  it.each([
    ['timeout', 'TIMEOUT'],
    ['oversized', 'OVERSIZED_BODY'],
  ] as const)('models the %s HTTP fixture case', async (kind, code) => {
    const transport = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: { kind },
        url: `https://example.test/${kind}`,
      },
    ]);

    await expect(
      transport.request({
        maxResponseBytes: 1,
        method: 'GET',
        timeoutMs: 1,
        url: `https://example.test/${kind}`,
      }),
    ).rejects.toMatchObject({ code } satisfies Partial<FixtureHTTPError>);
  });

  it('applies real UTF-8 body bounds in fixtures, not only synthetic outcomes', async () => {
    const transport = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: {
          kind: 'response',
          response: { body: 'é', headers: {}, status: 200 },
        },
        url: 'https://example.test/utf8',
      },
    ]);

    await expect(
      transport.request({
        maxResponseBytes: 1,
        method: 'GET',
        timeoutMs: 100,
        url: 'https://example.test/utf8',
      }),
    ).rejects.toMatchObject({
      code: 'OBSIDIAN_API_FAILED',
      diagnostics: { reason: 'response_too_large' },
    });
  });

  it('fails closed for every unregistered HTTP request', async () => {
    const transport = new FixtureHTTPTransport([]);

    await expect(
      transport.request({
        maxResponseBytes: 1024,
        method: 'POST',
        timeoutMs: 100,
        url: 'https://example.test/unregistered',
      }),
    ).rejects.toMatchObject({
      code: 'UNREGISTERED_REQUEST',
    } satisfies Partial<FixtureHTTPError>);
  });
});
