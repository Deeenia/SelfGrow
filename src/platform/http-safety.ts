import { SelfGrowError } from '../domain';
import { parseSafeHTTPURL } from '../url/url-service';
import type { HTTPRequest, HTTPResponse } from './ports';

const SENSITIVE_HEADER = /^(authorization|cookie)$/i;

export function redactHTTPHeaders(
  headers: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADER.test(name) ? '[REDACTED]' : value,
    ]),
  );
}

export function validateHTTPRequestLimits(
  request: Pick<HTTPRequest, 'maxResponseBytes' | 'timeoutMs'>,
): void {
  if (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0) {
    throw new SelfGrowError('OBSIDIAN_API_FAILED', 'The HTTP timeout is invalid.', {
      reason: 'invalid_timeout',
    });
  }
  if (
    !Number.isFinite(request.maxResponseBytes) ||
    !Number.isInteger(request.maxResponseBytes) ||
    request.maxResponseBytes <= 0
  ) {
    throw new SelfGrowError('OBSIDIAN_API_FAILED', 'The HTTP response limit is invalid.', {
      reason: 'invalid_response_limit',
    });
  }
}

export function assertResponseWithinLimit(byteLength: number, maxResponseBytes: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new SelfGrowError('OBSIDIAN_API_FAILED', 'The HTTP response is invalid.', {
      reason: 'invalid_response_size',
    });
  }
  if (byteLength > maxResponseBytes) {
    throw new SelfGrowError('OBSIDIAN_API_FAILED', 'The HTTP response is too large.', {
      maxResponseBytes,
      reason: 'response_too_large',
    });
  }
}

export function assertSafeVisibleRedirect(
  response: Pick<HTTPResponse, 'headers' | 'status'>,
  requestURL: URL,
): void {
  if (response.status < 300 || response.status >= 400) return;

  const location = Object.entries(response.headers).find(
    ([name]) => name.toLowerCase() === 'location',
  )?.[1];
  if (location === undefined) return;

  let resolved: string;
  try {
    resolved = new URL(location, requestURL).toString();
  } catch {
    throw new SelfGrowError('INVALID_URL', 'The redirect URL is invalid.');
  }
  parseSafeHTTPURL(resolved);
}
