import { describe, expect, it } from 'vitest';
import { ExtractionCapabilityService } from '../../src/extraction';
import type { ExtractionProviderSettings } from '../../src/settings';
import {
  FakeSecretResolver,
  FixedTemporalContext,
  FixtureHTTPTransport,
  OBVIOUSLY_FAKE_SECRET,
} from '../harness';

const ENDPOINT = 'https://extractor.example.test/v1/capabilities';

describe('ExtractionCapabilityService', () => {
  it('requires representative body, platform-detail, and subtitle schemas', async () => {
    const http = transportFor({
      articleBody: { body: 'Representative complete article. '.repeat(10) },
      platformDetail: { platform: 'youtube', title: 'Representative video' },
      provider: 'fixture-provider',
      subtitles: { segments: [{ text: 'Representative transcript segment.' }] },
    });
    const result = await service(http).test(configuration());

    expect(result).toEqual({
      capabilities: { articleBody: true, platformDetail: true, subtitles: true },
      provider: 'fixture-provider',
      testedAt: '2026-08-09T08:00:00.000Z',
    });
    expect(http.calls[0]?.headers?.Authorization).toBe('[REDACTED]');
    expect(JSON.parse(http.calls[0]?.body ?? '{}')).toEqual({
      probes: ['article_body', 'platform_detail', 'subtitles'],
      protocol: 'selfgrow-capabilities-v1',
    });
  });

  it('rejects a health-only response as unsupported', async () => {
    await expect(service(transportFor({ ok: true })).test(configuration())).rejects.toMatchObject({
      code: 'AI_PROTOCOL_UNSUPPORTED',
    });
  });

  it('does not transmit before disclosure acceptance', async () => {
    const http = transportFor({ ok: true });
    await expect(
      service(http).test(configuration({ disclosureAccepted: false })),
    ).rejects.toMatchObject({ code: 'AI_CONFIGURATION_MISSING' });
    expect(http.calls).toEqual([]);
  });
});

function configuration(
  patch: Partial<ExtractionProviderSettings> = {},
): ExtractionProviderSettings {
  return {
    baseURL: 'https://extractor.example.test/v1',
    connectionTest: null,
    disclosureAccepted: true,
    preset: 'custom',
    secretName: 'fixture-extraction',
    ...patch,
  };
}

function service(http: FixtureHTTPTransport): ExtractionCapabilityService {
  return new ExtractionCapabilityService({
    clock: new FixedTemporalContext('2026-08-09T08:00:00.000Z', 'Asia/Shanghai'),
    http,
    secretResolver: new FakeSecretResolver({
      'fixture-extraction': OBVIOUSLY_FAKE_SECRET,
    }),
  });
}

function transportFor(body: unknown): FixtureHTTPTransport {
  return new FixtureHTTPTransport([
    {
      method: 'POST',
      outcome: {
        kind: 'response',
        response: {
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      },
      url: ENDPOINT,
    },
  ]);
}
