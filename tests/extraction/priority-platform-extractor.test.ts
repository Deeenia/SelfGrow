import { describe, expect, it } from 'vitest';
import { selfGrowID, type Platform } from '../../src/domain';
import {
  PriorityPlatformExtractor,
  type ExtractionRequest,
  type PlatformProviderPort,
} from '../../src/extraction';
import type { NormalizedURL } from '../../src/url';
import { FixtureHTTPTransport } from '../harness';

function request(platform: Platform, normalized: string): ExtractionRequest {
  const url: NormalizedURL = { normalized, platform, received: normalized };
  return { id: selfGrowID('platform-fixture'), language: 'zh-CN', url };
}

function response(body: string, contentType = 'application/json') {
  return {
    kind: 'response' as const,
    response: { body, headers: { 'content-type': contentType }, status: 200 },
  };
}

function longTranscript(marker: string): string {
  return `${marker} ${'这是用于验证完整字幕内容的可靠句子。'.repeat(20)}`;
}

describe('Phase D remainder priority platform extraction', () => {
  it('uses a public YouTube caption only when the description is insufficient and video is within five minutes', async () => {
    const source = 'https://www.youtube.com/watch?v=abc123XYZ_0';
    const watch = source;
    const subtitleBase = 'https://www.youtube.com/api/timedtext?v=abc123XYZ_0&lang=zh-CN';
    const subtitle = `${subtitleBase}&fmt=json3`;
    const body = longTranscript('YouTube transcript');
    const transport = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: response(
          `<script>var player={"videoDetails":{"author":"Fixture","lengthSeconds":"240","shortDescription":"短简介","title":"Fixture video"},"captionTracks":[{"baseUrl":"${subtitleBase.replaceAll('&', '\\u0026')}","languageCode":"zh-CN"}]};</script>`,
          'text/html',
        ),
        url: watch,
      },
      {
        method: 'GET',
        outcome: response(JSON.stringify({ events: [{ segs: [{ utf8: body }] }] })),
        url: subtitle,
      },
    ]);

    const outcome = await new PriorityPlatformExtractor(transport).extract(
      request('youtube', source),
    );

    expect(outcome).toMatchObject({
      content: {
        body,
        bodyKind: 'transcript',
        platform: 'youtube',
        route: 'anonymous_platform',
      },
      kind: 'complete',
    });
  });

  it('prefers a useful YouTube title and description without downloading captions', async () => {
    const source = 'https://www.youtube.com/watch?v=abc123XYZ_0';
    const description = '这是足够说明视频主题、用途和关键限制的简介内容。';
    const transport = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: response(
          `<script>var player={"videoDetails":{"author":"Fixture","lengthSeconds":"900","shortDescription":"${description}","title":"技术简介"}};</script>`,
          'text/html',
        ),
        url: source,
      },
    ]);
    await expect(
      new PriorityPlatformExtractor(transport).extract(request('youtube', source)),
    ).resolves.toMatchObject({
      content: { body: `技术简介\n\n${description}`, bodyKind: 'article', title: '技术简介' },
      kind: 'complete',
    });
    expect(transport.calls).toHaveLength(1);
  });

  it('does not parse a video over five minutes when its description is insufficient', async () => {
    const source = 'https://www.youtube.com/watch?v=abc123XYZ_0';
    const transport = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: response(
          '<script>var player={"videoDetails":{"lengthSeconds":"301","shortDescription":"短简介","title":"Long video"}};</script>',
          'text/html',
        ),
        url: source,
      },
    ]);
    await expect(
      new PriorityPlatformExtractor(transport).extract(request('youtube', source)),
    ).resolves.toMatchObject({ code: 'video_too_long', kind: 'incomplete' });
  });

  it('keeps a YouTube video with no public captions incomplete', async () => {
    const source = 'https://www.youtube.com/watch?v=abc123XYZ_0';
    const transport = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: response(
          '<script>var player={"videoDetails":{"lengthSeconds":"120","shortDescription":"","title":"No captions"}};</script>',
          'text/html',
        ),
        url: source,
      },
    ]);

    await expect(
      new PriorityPlatformExtractor(transport).extract(request('youtube', source)),
    ).resolves.toMatchObject({ code: 'transcript_missing', kind: 'incomplete' });
  });

  it('extracts Bilibili subtitles through public detail, player, and subtitle responses', async () => {
    const source = 'https://www.bilibili.com/video/BV1fixture99';
    const detailURL = 'https://api.bilibili.com/x/web-interface/view?bvid=BV1fixture99';
    const playerURL = 'https://api.bilibili.com/x/player/v2?bvid=BV1fixture99&cid=12345';
    const subtitleURL = 'https://aisubtitle.hdslb.com/fixture.json';
    const body = longTranscript('Bilibili transcript');
    const transport = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: response(
          JSON.stringify({
            code: 0,
            data: {
              bvid: 'BV1fixture99',
              cid: 12345,
              desc: '',
              duration: 240,
              owner: { name: 'Fixture UP' },
              pubdate: 1_700_000_000,
              title: 'Fixture video',
            },
          }),
        ),
        url: detailURL,
      },
      {
        method: 'GET',
        outcome: response(
          JSON.stringify({
            code: 0,
            data: {
              subtitle: {
                subtitles: [{ lan: 'zh-CN', subtitle_url: '//aisubtitle.hdslb.com/fixture.json' }],
              },
            },
          }),
        ),
        url: playerURL,
      },
      {
        method: 'GET',
        outcome: response(JSON.stringify({ body: [{ content: body }] })),
        url: subtitleURL,
      },
    ]);

    const outcome = await new PriorityPlatformExtractor(transport).extract(
      request('bilibili', source),
    );

    expect(outcome).toMatchObject({
      content: {
        author: 'Fixture UP',
        body,
        bodyKind: 'transcript',
        platform: 'bilibili',
        title: 'Fixture video',
      },
      kind: 'complete',
    });
  });

  it('extracts a complete Xiaohongshu image-note caption from isolated public page state', async () => {
    const source = 'https://www.xiaohongshu.com/explore/fixture-note';
    const body = longTranscript('小红书图文正文');
    const state = {
      note: {
        noteDetail: {
          desc: body,
          title: 'Fixture note',
          user: { nickname: 'Fixture author' },
        },
      },
    };
    const transport = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: response(
          `<script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script>`,
          'text/html',
        ),
        url: source,
      },
    ]);

    const outcome = await new PriorityPlatformExtractor(transport).extract(
      request('xiaohongshu', source),
    );

    expect(outcome).toMatchObject({
      content: {
        author: 'Fixture author',
        body,
        bodyKind: 'article',
        platform: 'xiaohongshu',
        title: 'Fixture note',
      },
      kind: 'complete',
    });
  });

  it('uses a disclosed provider fallback for a Douyin video and otherwise stays incomplete', async () => {
    const source = 'https://www.douyin.com/video/123456789';
    const blockedPage =
      '<script>window.WAFJS={};const key="_wafchallengeid";</script>Please wait...';
    const provider: PlatformProviderPort = {
      extract: (incoming) =>
        Promise.resolve({
          content: {
            body: longTranscript('Provider transcript'),
            bodyKind: 'transcript',
            finalURL: incoming.url.normalized,
            platform: incoming.url.platform,
            route: 'third_party_provider',
          },
          kind: 'complete',
        }),
    };

    await expect(
      new PriorityPlatformExtractor(
        new FixtureHTTPTransport([
          { method: 'GET', outcome: response(blockedPage, 'text/html'), url: source },
        ]),
      ).extract(request('douyin', source)),
    ).resolves.toMatchObject({ code: 'platform_access_blocked', kind: 'incomplete' });
    await expect(
      new PriorityPlatformExtractor(
        new FixtureHTTPTransport([
          { method: 'GET', outcome: response(blockedPage, 'text/html'), url: source },
        ]),
        provider,
      ).extract(request('douyin', source)),
    ).resolves.toMatchObject({
      content: { platform: 'douyin', route: 'third_party_provider' },
      kind: 'complete',
    });
  });

  it('discards Douyin share-copy titles and keeps only the meaningful description', async () => {
    const source = 'https://www.douyin.com/video/123456789';
    const description = '这是公开页面提供的技术内容简介，足以生成一张简短知识卡片。';
    const html = `<html><head><meta content="抖音技术介绍" property="og:title"><meta property="og:description" content="${description}"></head></html>`;
    const outcome = await new PriorityPlatformExtractor(
      new FixtureHTTPTransport([
        { method: 'GET', outcome: response(html, 'text/html'), url: source },
      ]),
    ).extract(request('douyin', source));
    expect(outcome).toMatchObject({
      content: {
        body: description,
        bodyKind: 'article',
        platform: 'douyin',
        title: description,
      },
      kind: 'complete',
    });
  });
});
