import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from 'obsidian';
import { SelfGrowError, isSelfGrowError } from '../domain';
import { parseSafeHTTPURL } from '../url/url-service';
import {
  assertResponseWithinLimit,
  assertSafeVisibleRedirect,
  validateHTTPRequestLimits,
} from './http-safety';
import type { HTTPRequest, HTTPResponse, HTTPTransport } from './ports';

export type ObsidianRequestURL = (request: RequestUrlParam) => Promise<RequestUrlResponse>;

export class ObsidianHTTPTransport implements HTTPTransport {
  readonly #requestUrl: ObsidianRequestURL;

  constructor(requestURL: ObsidianRequestURL = requestUrl) {
    this.#requestUrl = requestURL;
  }

  async request(request: HTTPRequest): Promise<HTTPResponse> {
    validateHTTPRequestLimits(request);
    const requestURL = parseSafeHTTPURL(request.url);
    const requestPromise = Promise.resolve().then(() =>
      this.#requestUrl({
        ...(request.body === undefined ? {} : { body: request.body }),
        ...(request.headers === undefined ? {} : { headers: { ...request.headers } }),
        method: request.method,
        throw: false,
        url: requestURL.toString(),
      }),
    );

    let timeoutHandle: number | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = window.setTimeout(() => {
        reject(
          new SelfGrowError('NETWORK_UNAVAILABLE', 'The HTTP request timed out.', {
            reason: 'timeout',
          }),
        );
      }, request.timeoutMs);
    });

    let response: RequestUrlResponse;
    try {
      // requestUrl has no cancellation API. Promise.race bounds the caller wait and keeps a
      // rejection handler attached so a late request failure is safely discarded.
      response = await Promise.race([requestPromise, timeoutPromise]);
    } catch (error) {
      if (isSelfGrowError(error)) throw error;
      throw new SelfGrowError('NETWORK_UNAVAILABLE', 'The HTTP request failed.', {
        reason: 'request_failed',
      });
    } finally {
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
    }

    try {
      assertResponseWithinLimit(response.arrayBuffer.byteLength, request.maxResponseBytes);
      assertSafeVisibleRedirect(response, requestURL);
      return {
        body: response.text,
        headers: { ...response.headers },
        status: response.status,
      };
    } catch (error) {
      if (isSelfGrowError(error)) throw error;
      throw new SelfGrowError('OBSIDIAN_API_FAILED', 'The HTTP response is invalid.', {
        reason: 'invalid_response',
      });
    }
  }
}
