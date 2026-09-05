import type { HTTPRequest, HTTPResponse, HTTPTransport } from '../../src/platform/ports';
import {
  assertResponseWithinLimit,
  assertSafeVisibleRedirect,
  redactHTTPHeaders,
  validateHTTPRequestLimits,
} from '../../src/platform/http-safety';
import { parseSafeHTTPURL } from '../../src/url/url-service';

export type FixtureHTTPOutcome =
  { kind: 'oversized' } | { kind: 'response'; response: HTTPResponse } | { kind: 'timeout' };

export interface FixtureHTTPRoute {
  method: HTTPRequest['method'];
  outcome: FixtureHTTPOutcome | readonly FixtureHTTPOutcome[];
  url: string;
}

export class FixtureHTTPError extends Error {
  constructor(readonly code: 'OVERSIZED_BODY' | 'TIMEOUT' | 'UNREGISTERED_REQUEST') {
    super(`Fixture HTTP transport: ${code}`);
  }
}

function key(method: HTTPRequest['method'], url: string): string {
  return `${method} ${url}`;
}

export class FixtureHTTPTransport implements HTTPTransport {
  readonly #calls: HTTPRequest[] = [];
  readonly #routes: ReadonlyMap<string, FixtureHTTPOutcome[]>;

  constructor(routes: readonly FixtureHTTPRoute[]) {
    this.#routes = new Map(
      routes.map((route): [string, FixtureHTTPOutcome[]] => [
        key(route.method, route.url),
        Array.isArray(route.outcome)
          ? (route.outcome as readonly FixtureHTTPOutcome[]).slice()
          : [route.outcome as FixtureHTTPOutcome],
      ]),
    );
  }

  get calls(): readonly HTTPRequest[] {
    return structuredClone(this.#calls);
  }

  async request(request: HTTPRequest): Promise<HTTPResponse> {
    validateHTTPRequestLimits(request);
    const requestURL = parseSafeHTTPURL(request.url);
    this.#calls.push({
      ...structuredClone(request),
      headers: redactHTTPHeaders(request.headers),
    });
    const outcomes = this.#routes.get(key(request.method, request.url));
    // A single-outcome route repeats its response; a multi-outcome route is
    // consumed in registration order, which models repair retries.
    const outcome =
      outcomes === undefined ? undefined : outcomes.length > 1 ? outcomes.shift() : outcomes[0];

    if (outcome === undefined) {
      throw new FixtureHTTPError('UNREGISTERED_REQUEST');
    }
    if (outcome.kind === 'timeout') {
      throw new FixtureHTTPError('TIMEOUT');
    }
    if (outcome.kind === 'oversized') {
      throw new FixtureHTTPError('OVERSIZED_BODY');
    }

    const response = structuredClone(outcome.response);
    assertResponseWithinLimit(
      new TextEncoder().encode(response.body).byteLength,
      request.maxResponseBytes,
    );
    assertSafeVisibleRedirect(response, requestURL);
    return response;
  }
}
