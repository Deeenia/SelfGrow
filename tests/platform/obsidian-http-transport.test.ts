import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from 'obsidian';
import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from 'node:timers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelfGrowError } from '../../src/domain';
import {
  ObsidianHTTPTransport,
  type ObsidianRequestURL,
} from '../../src/platform/obsidian-http-transport';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));

const baseRequest = {
  maxResponseBytes: 1024,
  method: 'GET' as const,
  timeoutMs: 100,
  url: 'https://example.test/article',
};
const nodeTimers = new Map<number, ReturnType<typeof setNodeTimeout>>();
let nextTimerID = 1;

function response(
  text: string,
  { headers = {}, status = 200 }: { headers?: Record<string, string>; status?: number } = {},
): RequestUrlResponse {
  return {
    arrayBuffer: new TextEncoder().encode(text).buffer,
    headers,
    json: null,
    status,
    text,
  };
}

beforeEach(() => {
  vi.stubGlobal('window', {
    clearTimeout(timerID: number) {
      const handle = nodeTimers.get(timerID);
      if (handle !== undefined) clearNodeTimeout(handle);
      nodeTimers.delete(timerID);
    },
    setTimeout(callback: () => void, delay: number) {
      const timerID = nextTimerID;
      nextTimerID += 1;
      nodeTimers.set(
        timerID,
        setNodeTimeout(() => {
          nodeTimers.delete(timerID);
          callback();
        }, delay),
      );
      return timerID;
    },
  });
});

afterEach(() => {
  for (const handle of nodeTimers.values()) clearNodeTimeout(handle);
  nodeTimers.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('Task-014 Obsidian HTTP transport', () => {
  it('defaults to requestUrl and forwards a defensive request with throw disabled', async () => {
    const originalHeaders = {
      Authorization: 'Bearer obviously-not-valid-secret',
      'X-Test': 'visible',
    };
    const requestURLMock = vi.mocked(requestUrl);
    requestURLMock.mockResolvedValue(response('ok'));

    const result = await new ObsidianHTTPTransport().request({
      ...baseRequest,
      body: '{"fixture":true}',
      headers: originalHeaders,
      method: 'POST',
    });
    const forwarded = requestURLMock.mock.calls[0]?.[0] as RequestUrlParam;
    expect(forwarded).toEqual({
      body: '{"fixture":true}',
      headers: originalHeaders,
      method: 'POST',
      throw: false,
      url: baseRequest.url,
    });
    forwarded.headers!['X-Test'] = 'changed by request implementation';
    expect(originalHeaders).toEqual({
      Authorization: 'Bearer obviously-not-valid-secret',
      'X-Test': 'visible',
    });
    expect(result).toEqual({ body: 'ok', headers: {}, status: 200 });
  });

  it('accepts an exact UTF-8 byte limit and checks an oversized buffer before text', async () => {
    const exact = vi.fn<ObsidianRequestURL>().mockResolvedValue(response('é'));
    await expect(
      new ObsidianHTTPTransport(exact).request({ ...baseRequest, maxResponseBytes: 2 }),
    ).resolves.toMatchObject({ body: 'é' });

    let textReads = 0;
    const oversizedResponse = {
      arrayBuffer: new Uint8Array(3).buffer,
      headers: {},
      json: null,
      status: 200,
      get text() {
        textReads += 1;
        return 'secret response body';
      },
    } satisfies RequestUrlResponse;
    const oversized = vi.fn<ObsidianRequestURL>().mockResolvedValue(oversizedResponse);

    await expect(
      new ObsidianHTTPTransport(oversized).request({ ...baseRequest, maxResponseBytes: 2 }),
    ).rejects.toMatchObject({
      code: 'OBSIDIAN_API_FAILED',
      diagnostics: { maxResponseBytes: 2, reason: 'response_too_large' },
    } satisfies Partial<SelfGrowError>);
    expect(textReads).toBe(0);
  });

  it.each([
    [{ timeoutMs: 0 }, 'invalid_timeout'],
    [{ timeoutMs: Number.NaN }, 'invalid_timeout'],
    [{ maxResponseBytes: 0 }, 'invalid_response_limit'],
    [{ maxResponseBytes: 1.5 }, 'invalid_response_limit'],
  ] as const)('rejects invalid limits before dispatch: %o', async (override, reason) => {
    const requestURLMock = vi.fn<ObsidianRequestURL>();

    await expect(
      new ObsidianHTTPTransport(requestURLMock).request({ ...baseRequest, ...override }),
    ).rejects.toMatchObject({
      code: 'OBSIDIAN_API_FAILED',
      diagnostics: { reason },
    } satisfies Partial<SelfGrowError>);
    expect(requestURLMock).not.toHaveBeenCalled();
  });

  it.each([
    'file:///private/note',
    'https://user:password@example.test/private',
    'http://127.0.0.1/admin',
    'https://192.168.1.2/admin',
  ])('rejects an unsafe initial target before dispatch: %s', async (url) => {
    const requestURLMock = vi.fn<ObsidianRequestURL>();

    await expect(
      new ObsidianHTTPTransport(requestURLMock).request({ ...baseRequest, url }),
    ).rejects.toBeInstanceOf(SelfGrowError);
    expect(requestURLMock).not.toHaveBeenCalled();
  });

  it('accepts safe relative redirects and rejects unsafe visible redirects', async () => {
    const relative = vi
      .fn<ObsidianRequestURL>()
      .mockResolvedValue(response('', { headers: { Location: '/final' }, status: 302 }));
    await expect(new ObsidianHTTPTransport(relative).request(baseRequest)).resolves.toMatchObject({
      status: 302,
    });

    const unsafe = vi
      .fn<ObsidianRequestURL>()
      .mockResolvedValue(
        response('', { headers: { location: 'http://127.0.0.1/private' }, status: 307 }),
      );
    await expect(new ObsidianHTTPTransport(unsafe).request(baseRequest)).rejects.toMatchObject({
      code: 'UNSAFE_URL',
    } satisfies Partial<SelfGrowError>);

    const invalid = vi
      .fn<ObsidianRequestURL>()
      .mockResolvedValue(response('', { headers: { location: 'http://[' }, status: 301 }));
    await expect(new ObsidianHTTPTransport(invalid).request(baseRequest)).rejects.toMatchObject({
      code: 'INVALID_URL',
    } satisfies Partial<SelfGrowError>);
  });

  it('times out safely and absorbs a late request rejection', async () => {
    let rejectLate: ((reason: unknown) => void) | undefined;
    const pending = new Promise<RequestUrlResponse>((_resolve, reject) => {
      rejectLate = reject;
    });
    const result = new ObsidianHTTPTransport(() => pending).request({
      ...baseRequest,
      timeoutMs: 10,
    });
    const timeoutExpectation = expect(result).rejects.toMatchObject({
      code: 'NETWORK_UNAVAILABLE',
      diagnostics: { reason: 'timeout' },
    } satisfies Partial<SelfGrowError>);

    await timeoutExpectation;
    rejectLate?.(new Error('late secret-bearing failure'));
    await Promise.resolve();
  });

  it('maps request failures without leaking external messages, headers, bodies, or URLs', async () => {
    const transport = new ObsidianHTTPTransport(() =>
      Promise.reject(
        new Error(
          'Bearer obviously-not-valid-secret Cookie=session-secret body-secret https://example.test/?token=secret',
        ),
      ),
    );

    const caught = await transport
      .request({
        ...baseRequest,
        body: 'body-secret',
        headers: {
          Authorization: 'Bearer obviously-not-valid-secret',
          Cookie: 'session-secret',
        },
        url: 'https://example.test/?token=secret',
      })
      .catch((error: unknown) => error);

    expect(caught).toMatchObject({
      code: 'NETWORK_UNAVAILABLE',
      diagnostics: { reason: 'request_failed' },
      message: 'The HTTP request failed.',
    });
    const serialized = JSON.stringify(caught);
    expect(serialized).not.toContain('obviously-not-valid-secret');
    expect(serialized).not.toContain('session-secret');
    expect(serialized).not.toContain('body-secret');
    expect(serialized).not.toContain('token=secret');
  });
});
