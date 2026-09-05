import { SelfGrowError, isSelfGrowError, type Platform } from '../domain';
import type { HTTPResponse, HTTPTransport } from '../platform/ports';

export interface NormalizedURL {
  normalized: string;
  platform: Platform;
  received: string;
}

const TRACKING_PARAMETERS = new Set([
  '_hsenc',
  '_hsmi',
  'dclid',
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  'spm_id_from',
  'vd_source',
]);

const SHORT_LINK_HOSTS = new Set([
  'b23.tv',
  'v.douyin.com',
  'xhslink.cn',
  'xhslink.com',
  'youtu.be',
]);

const MAX_REDIRECTS = 5;

export class URLService {
  readonly #transport: HTTPTransport;

  constructor(transport: HTTPTransport) {
    this.#transport = transport;
  }

  async assertSafe(input: string): Promise<void> {
    assertSafeURL(parseURL(input));
  }

  async normalize(input: string): Promise<NormalizedURL> {
    const received = input;
    const initial = parseSafeHTTPURL(input);
    let resolved = initial;
    if (SHORT_LINK_HOSTS.has(initial.hostname)) {
      try {
        resolved = await this.#resolveShortLink(initial);
      } catch (error) {
        // Capture must remain available offline. The initial allowlisted short URL is
        // already safety-checked, so transport/API failures may retain it as the stable
        // identity. Unsafe redirect targets and malformed URLs still fail closed.
        if (!canKeepSafeShortLink(error)) throw error;
      }
    }
    removeTracking(resolved);
    resolved.hash = '';

    return {
      normalized: resolved.toString(),
      platform: platformFor(resolved.hostname),
      received,
    };
  }

  async #resolveShortLink(initial: URL): Promise<URL> {
    let current = initial;
    const visited = new Set<string>();

    for (let redirectCount = 0; redirectCount < MAX_REDIRECTS; redirectCount += 1) {
      const currentURL = current.toString();
      if (visited.has(currentURL)) {
        throw new SelfGrowError('UNSAFE_URL', 'The short URL contains a redirect loop.');
      }
      visited.add(currentURL);

      const response = await this.#transport.request({
        maxResponseBytes: 65_536,
        method: 'GET',
        timeoutMs: 10_000,
        url: currentURL,
      });
      const location = redirectLocation(response);
      if (location === null) {
        return current;
      }

      current = parseSafeHTTPURL(new URL(location, current).toString());
      if (!SHORT_LINK_HOSTS.has(current.hostname)) {
        return current;
      }
    }

    throw new SelfGrowError('UNSAFE_URL', 'The short URL has too many redirects.');
  }
}

function canKeepSafeShortLink(error: unknown): boolean {
  if (isSelfGrowError(error)) {
    return error.code === 'NETWORK_UNAVAILABLE' || error.code === 'OBSIDIAN_API_FAILED';
  }

  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'OVERSIZED_BODY' || error.code === 'TIMEOUT')
  );
}

export function parseSafeHTTPURL(input: string): URL {
  const url = parseURL(input);
  assertSafeURL(url);
  return url;
}

function parseURL(input: string): URL {
  try {
    return new URL(input.trim());
  } catch {
    throw new SelfGrowError('INVALID_URL', 'The URL is invalid.');
  }
}

function assertSafeURL(url: URL): void {
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname.length === 0) {
    throw new SelfGrowError('INVALID_URL', 'Only HTTP and HTTPS URLs are supported.');
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new SelfGrowError('UNSAFE_URL', 'URLs containing credentials are not allowed.');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isLocalHostname(hostname) || isUnsafeIPv4(hostname) || isUnsafeIPv6(hostname)) {
    throw new SelfGrowError('UNSAFE_URL', 'Local and private network URLs are not allowed.');
  }
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local');
}

function isUnsafeIPv4(hostname: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    return false;
  }
  const octets = hostname.split('.').map(Number);
  if (octets.some((octet) => octet > 255)) {
    return true;
  }
  const [first = 0, second = 0] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isUnsafeIPv6(hostname: string): boolean {
  if (!hostname.includes(':')) {
    return false;
  }
  const compact = hostname.toLowerCase();
  return (
    compact === '::' ||
    compact === '::1' ||
    compact.startsWith('fc') ||
    compact.startsWith('fd') ||
    /^fe[89ab]/.test(compact) ||
    compact.startsWith('::ffff:127.') ||
    compact.startsWith('::ffff:10.') ||
    compact.startsWith('::ffff:192.168.')
  );
}

function removeTracking(url: URL): void {
  const keys = [...url.searchParams.keys()];
  for (const key of keys) {
    const normalized = key.toLowerCase();
    if (normalized.startsWith('utm_') || TRACKING_PARAMETERS.has(normalized)) {
      url.searchParams.delete(key);
    }
  }
}

function platformFor(hostname: string): Platform {
  const host = hostname.toLowerCase();
  if (host === 'youtu.be' || matchesDomain(host, 'youtube.com')) return 'youtube';
  if (host === 'b23.tv' || matchesDomain(host, 'bilibili.com')) return 'bilibili';
  if (host === 'xhslink.cn' || host === 'xhslink.com' || matchesDomain(host, 'xiaohongshu.com')) {
    return 'xiaohongshu';
  }
  if (matchesDomain(host, 'douyin.com')) return 'douyin';
  if (host === 'mp.weixin.qq.com') return 'wechat_official_account';
  return 'generic_web';
}

function matchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function redirectLocation(response: HTTPResponse): string | null {
  if (response.status < 300 || response.status >= 400) {
    return null;
  }
  const entry = Object.entries(response.headers).find(
    ([name]) => name.toLowerCase() === 'location',
  );
  return entry?.[1] ?? null;
}
