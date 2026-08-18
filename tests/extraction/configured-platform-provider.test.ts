import { describe, expect, it } from 'vitest';
import { ConfiguredPlatformProvider } from '../../src/extraction';
import { selfGrowID } from '../../src/domain';
import type { ExtractionProviderSettings } from '../../src/settings';
import type { NormalizedURL } from '../../src/url';
import { FakeSecretResolver, FixtureHTTPTransport } from '../harness';

function settings(patch: Partial<ExtractionProviderSettings> = {}): ExtractionProviderSettings {
  return {
    baseURL: 'https://extract.example/v1',
    connectionTest: {
      capabilities: { articleBody: true, platformDetail: true, subtitles: true },
      configurationFingerprint: 'fixture',
      testedAt: '2026-08-09T00:00:00.000Z',
    },
    disclosureAccepted: true,
    preset: 'custom',
    secretName: 'Extraction Secret',
    ...patch,
  };
}

describe('ConfiguredPlatformProvider', () => {
  it('sends only disclosed identifiers and accepts complete provider content', async () => {
    const url = 'https://www.douyin.com/video/123456789';
    const http = new FixtureHTTPTransport([
      {
        method: 'POST',
        outcome: {
          kind: 'response',
          response: {
            body: JSON.stringify({
              author: 'creator',
              body: '这是一段完整视频字幕。'.repeat(20),
              bodyKind: 'transcript',
              durationSeconds: 240,
              finalURL: url,
              platform: 'douyin',
              title: '技术视频',
            }),
            headers: {},
            status: 200,
          },
        },
        url: 'https://extract.example/v1/extract',
      },
    ]);
    const result = await new ConfiguredPlatformProvider({
      configuration: () => settings(),
      http,
      secretResolver: new FakeSecretResolver({ 'Extraction Secret': 'fixture-secret' }),
    }).extract({
      id: selfGrowID('capture'),
      language: 'zh-CN',
      url: { normalized: url, platform: 'douyin', received: url } satisfies NormalizedURL,
    });
    expect(result).toMatchObject({
      content: { bodyKind: 'transcript', platform: 'douyin', route: 'third_party_provider' },
      kind: 'complete',
    });
    expect(http.calls[0]?.body).toBe(
      JSON.stringify({
        language: 'zh-CN',
        platform: 'douyin',
        protocol: 'selfgrow-extraction-v1',
        url,
      }),
    );
    expect(JSON.stringify(http.calls)).not.toContain('fixture-secret');
  });

  it('does not transmit anything without accepted, tested custom configuration', async () => {
    const http = new FixtureHTTPTransport([]);
    const result = await new ConfiguredPlatformProvider({
      configuration: () => settings({ connectionTest: null }),
      http,
      secretResolver: new FakeSecretResolver({ 'Extraction Secret': 'fixture-secret' }),
    }).extract({
      id: selfGrowID('capture'),
      language: 'zh-CN',
      url: {
        normalized: 'https://www.douyin.com/video/123456789',
        platform: 'douyin',
        received: 'https://www.douyin.com/video/123456789',
      } satisfies NormalizedURL,
    });
    expect(result).toMatchObject({ code: 'provider_not_configured', kind: 'incomplete' });
    expect(http.calls).toHaveLength(0);
  });
});
