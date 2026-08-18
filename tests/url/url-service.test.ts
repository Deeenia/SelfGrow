import { describe, expect, it } from 'vitest';
import { SelfGrowError } from '../../src/domain';
import { URLService } from '../../src/url';
import { FixtureHTTPTransport } from '../harness';

describe('Task-009 URL normalization', () => {
  it('normalizes identity without deleting content parameters', async () => {
    const service = new URLService(new FixtureHTTPTransport([]));
    const first = await service.normalize(
      ' HTTPS://Example.COM:443/article?id=42&utm_source=share&fbclid=fake#section ',
    );
    const repeated = await service.normalize('https://example.com/article?id=42');

    expect(first).toEqual({
      normalized: 'https://example.com/article?id=42',
      platform: 'generic_web',
      received: ' HTTPS://Example.COM:443/article?id=42&utm_source=share&fbclid=fake#section ',
    });
    expect(repeated.normalized).toBe(first.normalized);
  });

  it.each([
    ['https://www.youtube.com/watch?v=abc', 'youtube'],
    ['https://www.bilibili.com/video/BV1xx', 'bilibili'],
    ['https://www.xiaohongshu.com/explore/abc', 'xiaohongshu'],
    ['https://www.douyin.com/video/123', 'douyin'],
    ['https://mp.weixin.qq.com/s/example', 'wechat_official_account'],
    ['https://example.test/article', 'generic_web'],
  ] as const)('classifies %s as %s', async (url, platform) => {
    const service = new URLService(new FixtureHTTPTransport([]));
    await expect(service.normalize(url)).resolves.toMatchObject({ platform });
  });

  it('resolves an approved short link through exact HTTP fixtures', async () => {
    const transport = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: {
          kind: 'response',
          response: {
            body: '',
            headers: {
              Location: 'https://www.bilibili.com/video/BV1fixture?spm_id_from=share&cid=7#reply',
            },
            status: 302,
          },
        },
        url: 'https://b23.tv/fixture',
      },
    ]);
    const result = await new URLService(transport).normalize('https://b23.tv/fixture');

    expect(result).toMatchObject({
      normalized: 'https://www.bilibili.com/video/BV1fixture?cid=7',
      platform: 'bilibili',
    });
    expect(transport.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET https://b23.tv/fixture',
    ]);
  });

  it('keeps an approved short link when its auto-followed response is too large', async () => {
    const transport = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: { kind: 'oversized' },
        url: 'https://xhslink.cn/o/fixture?utm_source=share#reply',
      },
    ]);

    await expect(
      new URLService(transport).normalize('https://xhslink.cn/o/fixture?utm_source=share#reply'),
    ).resolves.toEqual({
      normalized: 'https://xhslink.cn/o/fixture',
      platform: 'xiaohongshu',
      received: 'https://xhslink.cn/o/fixture?utm_source=share#reply',
    });
  });

  it('keeps an already-safe approved short link when resolution is offline', async () => {
    const transport = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: { kind: 'timeout' },
        url: 'https://v.douyin.com/offline/',
      },
    ]);

    await expect(
      new URLService(transport).normalize('https://v.douyin.com/offline/'),
    ).resolves.toEqual({
      normalized: 'https://v.douyin.com/offline/',
      platform: 'douyin',
      received: 'https://v.douyin.com/offline/',
    });
  });

  it.each(['mailto:test@example.com', 'not a URL', 'file:///private/note'])(
    'rejects a non-HTTP(S) input: %s',
    async (url) => {
      await expect(
        new URLService(new FixtureHTTPTransport([])).normalize(url),
      ).rejects.toBeInstanceOf(SelfGrowError);
    },
  );

  it.each([
    'http://localhost/private',
    'http://127.0.0.1/private',
    'http://10.0.0.1/private',
    'http://192.168.1.1/private',
    'http://[::1]/private',
    'https://user:password@example.test/private',
  ])('rejects an unsafe target: %s', async (url) => {
    await expect(
      new URLService(new FixtureHTTPTransport([])).assertSafe(url),
    ).rejects.toMatchObject({
      code: 'UNSAFE_URL',
    });
  });

  it('rejects a short-link redirect to a private target', async () => {
    const transport = new FixtureHTTPTransport([
      {
        method: 'GET',
        outcome: {
          kind: 'response',
          response: { body: '', headers: { location: 'http://127.0.0.1/private' }, status: 301 },
        },
        url: 'https://youtu.be/unsafe',
      },
    ]);

    await expect(
      new URLService(transport).normalize('https://youtu.be/unsafe'),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
  });
});
