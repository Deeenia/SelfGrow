import { SelfGrowError } from '../domain';
import type { HTTPTransport } from '../platform/ports';
import { z } from '../schema/zod';
import { validateCompleteContent } from './completeness';
import type {
  ContentExtractor,
  ExtractedContent,
  ExtractionOutcome,
  ExtractionRequest,
} from './types';

const PLATFORM_TIMEOUT_MS = 15_000;
const PLATFORM_MAX_RESPONSE_BYTES = 2_000_000;

export interface PlatformProviderPort {
  extract(request: ExtractionRequest): Promise<ExtractionOutcome>;
}

const youtubeTrackSchema = z.object({
  baseUrl: z.url(),
  languageCode: z.string().min(1).optional(),
});

const youtubeTranscriptSchema = z.object({
  events: z.array(
    z.object({
      segs: z.array(z.object({ utf8: z.string() })).optional(),
    }),
  ),
});

const youtubeVideoDetailsSchema = z.object({
  author: z.string().optional(),
  lengthSeconds: z.string().regex(/^\d+$/),
  shortDescription: z.string().optional(),
  title: z.string().min(1),
});

const bilibiliViewSchema = z.object({
  code: z.number(),
  data: z
    .object({
      bvid: z.string().min(1),
      cid: z.number().int().positive(),
      desc: z.string().optional(),
      duration: z.number().int().nonnegative().optional(),
      owner: z.object({ name: z.string().min(1) }).optional(),
      pubdate: z.number().int().optional(),
      title: z.string().min(1),
    })
    .optional(),
});

const bilibiliPlayerSchema = z.object({
  code: z.number(),
  data: z
    .object({
      subtitle: z
        .object({
          subtitles: z.array(
            z.object({
              lan: z.string().optional(),
              subtitle_url: z.string().min(1),
            }),
          ),
        })
        .optional(),
    })
    .optional(),
});

const bilibiliSubtitleSchema = z.object({
  body: z.array(z.object({ content: z.string() })),
});

export class PriorityPlatformExtractor implements ContentExtractor {
  readonly id = 'priority-platform-v1';
  readonly #http: HTTPTransport;
  readonly #provider: PlatformProviderPort | null;

  constructor(http: HTTPTransport, provider: PlatformProviderPort | null = null) {
    this.#http = http;
    this.#provider = provider;
  }

  canHandle(url: URL): boolean {
    return url.protocol === 'http:' || url.protocol === 'https:';
  }

  async extract(request: ExtractionRequest): Promise<ExtractionOutcome> {
    let direct: ExtractionOutcome;
    switch (request.url.platform) {
      case 'youtube':
        direct = await this.#youtube(request);
        break;
      case 'bilibili':
        direct = await this.#bilibili(request);
        break;
      case 'xiaohongshu':
        direct = await this.#xiaohongshu(request);
        break;
      case 'douyin':
        direct = await this.#douyin(request);
        break;
      case 'wechat_official_account':
        direct = incomplete('main_text_missing', 'The article body was not available.');
        break;
      default:
        direct = incomplete('platform_adapter_required', 'A platform adapter is required.');
    }

    if (direct.kind === 'complete' || this.#provider === null) return direct;
    const provided = await this.#provider.extract(request);
    return provided.kind === 'incomplete' && provided.code === 'provider_not_configured'
      ? direct
      : provided;
  }

  async #youtube(request: ExtractionRequest): Promise<ExtractionOutcome> {
    const videoID = youtubeVideoID(request.url.normalized);
    if (videoID === null) return incomplete('source_unreachable', 'The video URL is unsupported.');
    const watchURL = `https://www.youtube.com/watch?v=${encodeURIComponent(videoID)}`;
    const watch = await this.#get(watchURL, 'text/html');
    const videoDetails = youtubeVideoDetailsSchema.safeParse(
      parseJSONObjectAfterMarker(watch.body, '"videoDetails":'),
    );
    if (!videoDetails.success) {
      return incomplete('video_duration_unknown', 'Open the original link to view this video.');
    }
    const description = videoDescriptionOutcome(request, {
      author: videoDetails.data.author,
      description: videoDetails.data.shortDescription,
      finalURL: watchURL,
      title: videoDetails.data.title,
    });
    if (description !== null) return description;
    if (Number(videoDetails.data.lengthSeconds) > 300) {
      return incomplete(
        'video_too_long',
        'Videos over five minutes are not parsed. Open the original link.',
      );
    }
    const tracks = parseJSONArrayAfterMarker(watch.body, '"captionTracks":');
    const parsedTracks = z.array(youtubeTrackSchema).safeParse(tracks);
    if (!parsedTracks.success || parsedTracks.data.length === 0) {
      return incomplete('transcript_missing', 'The video has no usable transcript.');
    }
    const preferredLanguage = request.language === 'zh-CN' ? /^zh(?:-|$)/i : /^en(?:-|$)/i;
    const track =
      parsedTracks.data.find((candidate) => preferredLanguage.test(candidate.languageCode ?? '')) ??
      parsedTracks.data[0];
    if (track === undefined) {
      return incomplete('transcript_missing', 'The video has no usable transcript.');
    }
    const transcriptURL = new URL(track.baseUrl);
    transcriptURL.searchParams.set('fmt', 'json3');
    const transcript = youtubeTranscriptSchema.safeParse(
      parseJSON((await this.#get(transcriptURL.toString(), 'application/json')).body),
    );
    if (!transcript.success) {
      return incomplete('provider_response_invalid', 'The transcript response was invalid.');
    }
    const body = transcript.data.events
      .flatMap((event) => event.segs ?? [])
      .map((segment) => segment.utf8)
      .join(' ');
    return transcriptOutcome(request, body, { finalURL: watchURL });
  }

  async #bilibili(request: ExtractionRequest): Promise<ExtractionOutcome> {
    const bvid = bilibiliVideoID(request.url.normalized);
    if (bvid === null) return incomplete('source_unreachable', 'The video URL is unsupported.');
    const viewURL = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
    const view = bilibiliViewSchema.safeParse(parseJSON((await this.#get(viewURL)).body));
    if (!view.success || view.data.code !== 0 || view.data.data === undefined) {
      return incomplete('provider_response_invalid', 'The video detail response was invalid.');
    }
    const detail = view.data.data;
    const description = videoDescriptionOutcome(request, {
      author: detail.owner?.name,
      description: detail.desc,
      publishedAt:
        detail.pubdate === undefined ? undefined : new Date(detail.pubdate * 1000).toISOString(),
      title: detail.title,
    });
    if (description !== null) return description;
    if (detail.duration === undefined) {
      return incomplete('video_duration_unknown', 'Open the original link to view this video.');
    }
    if (detail.duration > 300) {
      return incomplete(
        'video_too_long',
        'Videos over five minutes are not parsed. Open the original link.',
      );
    }
    const playerURL =
      `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(detail.bvid)}` +
      `&cid=${encodeURIComponent(String(detail.cid))}`;
    const player = bilibiliPlayerSchema.safeParse(parseJSON((await this.#get(playerURL)).body));
    const subtitles =
      player.success && player.data.code === 0 ? (player.data.data?.subtitle?.subtitles ?? []) : [];
    const preferredLanguage = request.language === 'zh-CN' ? /^zh(?:-|$)/i : /^en(?:-|$)/i;
    const selected =
      subtitles.find((candidate) => preferredLanguage.test(candidate.lan ?? '')) ?? subtitles[0];
    if (selected === undefined) {
      return incomplete('transcript_missing', 'The video has no usable transcript.');
    }
    const subtitleURL = selected.subtitle_url.startsWith('//')
      ? `https:${selected.subtitle_url}`
      : selected.subtitle_url;
    const subtitle = bilibiliSubtitleSchema.safeParse(
      parseJSON((await this.#get(subtitleURL)).body),
    );
    if (!subtitle.success) {
      return incomplete('provider_response_invalid', 'The subtitle response was invalid.');
    }
    return transcriptOutcome(
      request,
      subtitle.data.body.map((segment) => segment.content).join(' '),
      {
        author: detail.owner?.name,
        publishedAt:
          detail.pubdate === undefined ? undefined : new Date(detail.pubdate * 1000).toISOString(),
        title: detail.title,
      },
    );
  }

  async #xiaohongshu(request: ExtractionRequest): Promise<ExtractionOutcome> {
    const response = await this.#get(request.url.normalized, 'text/html');
    const state = parseJSONObjectAfterMarker(response.body, 'window.__INITIAL_STATE__=');
    const note = findXiaohongshuNote(state);
    if (note === null) {
      return incomplete('main_text_missing', 'The note body was not available.');
    }
    const completeness = validateCompleteContent(note.body);
    if (completeness.kind === 'incomplete') {
      return incomplete(completeness.reason, 'The complete note body was not available.');
    }
    return complete(request, {
      body: completeness.normalized,
      bodyKind: 'article',
      ...(note.author === undefined ? {} : { author: note.author }),
      ...(note.title === undefined ? {} : { title: note.title }),
    });
  }

  async #douyin(request: ExtractionRequest): Promise<ExtractionOutcome> {
    const response = await this.#get(request.url.normalized, 'text/html');
    if (/\bWAFJS\b|_wafchallengeid|Please wait\.\.\./i.test(response.body)) {
      return incomplete(
        'platform_access_blocked',
        'Douyin blocked anonymous access. Open the original link.',
      );
    }
    const description =
      htmlMetaContent(response.body, 'og:description') ??
      htmlMetaContent(response.body, 'description');
    if (description !== null) {
      const body = description.replace(/\s+/g, ' ').trim();
      if (body.length >= 20) {
        return complete(request, { body, bodyKind: 'article', title: body });
      }
    }
    return incomplete(
      'video_duration_unknown',
      'No readable description or confirmed duration was available. Open the original link.',
    );
  }

  async #get(url: string, accept = 'application/json'): Promise<{ body: string }> {
    const response = await this.#http.request({
      headers: { Accept: accept },
      maxResponseBytes: PLATFORM_MAX_RESPONSE_BYTES,
      method: 'GET',
      timeoutMs: PLATFORM_TIMEOUT_MS,
      url,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new SelfGrowError('EXTRACTION_FAILED', 'The platform request failed.', {
        status: response.status,
      });
    }
    return { body: response.body };
  }
}

function videoDescriptionOutcome(
  request: ExtractionRequest,
  metadata: {
    author?: string;
    description?: string;
    finalURL?: string;
    publishedAt?: string;
    title: string;
  },
): ExtractionOutcome | null {
  const description = metadata.description?.replace(/\s+/g, ' ').trim() ?? '';
  if (description.length < 20) return null;
  return complete(request, {
    body: `${metadata.title}\n\n${description}`,
    bodyKind: 'article',
    ...(metadata.author === undefined ? {} : { author: metadata.author }),
    ...(metadata.finalURL === undefined ? {} : { finalURL: metadata.finalURL }),
    ...(metadata.publishedAt === undefined ? {} : { publishedAt: metadata.publishedAt }),
    title: metadata.title,
  });
}

function transcriptOutcome(
  request: ExtractionRequest,
  body: string,
  metadata: Partial<Pick<ExtractedContent, 'author' | 'finalURL' | 'publishedAt' | 'title'>> = {},
): ExtractionOutcome {
  const completeness = validateCompleteContent(body);
  if (completeness.kind === 'incomplete') {
    return incomplete('transcript_missing', 'The video has no usable transcript.');
  }
  return complete(request, {
    body: completeness.normalized,
    bodyKind: 'transcript',
    ...metadata,
  });
}

function complete(
  request: ExtractionRequest,
  fields: Pick<ExtractedContent, 'body' | 'bodyKind'> &
    Partial<Pick<ExtractedContent, 'author' | 'finalURL' | 'publishedAt' | 'title'>>,
): ExtractionOutcome {
  return {
    content: {
      finalURL: request.url.normalized,
      platform: request.url.platform,
      route: 'anonymous_platform',
      ...fields,
    },
    kind: 'complete',
  };
}

function incomplete(code: string, message: string): ExtractionOutcome {
  return { code, kind: 'incomplete', message };
}

function youtubeVideoID(input: string): string | null {
  const url = new URL(input);
  if (url.hostname === 'youtu.be') return validID(url.pathname.split('/')[1]);
  if (url.pathname === '/watch') return validID(url.searchParams.get('v'));
  const match = /^\/(?:shorts|embed)\/([^/?#]+)/.exec(url.pathname);
  return validID(match?.[1] ?? null);
}

function bilibiliVideoID(input: string): string | null {
  const match = /\/(BV[0-9A-Za-z]+)/i.exec(new URL(input).pathname);
  return match?.[1] ?? null;
}

function validID(value: string | null | undefined): string | null {
  return value !== null && value !== undefined && /^[0-9A-Za-z_-]{6,20}$/.test(value)
    ? value
    : null;
}

function parseJSON(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}

function parseJSONArrayAfterMarker(input: string, marker: string): unknown {
  return parseBalancedJSONAfterMarker(input, marker, '[', ']');
}

function parseJSONObjectAfterMarker(input: string, marker: string): unknown {
  return parseBalancedJSONAfterMarker(input, marker, '{', '}');
}

function parseBalancedJSONAfterMarker(
  input: string,
  marker: string,
  opening: '[' | '{',
  closing: ']' | '}',
): unknown {
  const markerIndex = input.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = input.indexOf(opening, markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let escaped = false;
  let quoted = false;
  for (let index = start; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === opening) depth += 1;
    else if (character === closing) {
      depth -= 1;
      if (depth === 0) return parseJSON(input.slice(start, index + 1));
    }
  }
  return null;
}

interface XiaohongshuNote {
  author?: string;
  body: string;
  title?: string;
}

function findXiaohongshuNote(value: unknown): XiaohongshuNote | null {
  if (typeof value !== 'object' || value === null) return null;
  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const body = firstString(record, ['desc', 'description', 'content']);
    if (body !== undefined) {
      const authorObject = record.user;
      const author =
        typeof authorObject === 'object' && authorObject !== null
          ? firstString(authorObject as Record<string, unknown>, ['nickname', 'name'])
          : undefined;
      return {
        body,
        ...(author === undefined ? {} : { author }),
        ...(firstString(record, ['title']) === undefined
          ? {}
          : { title: firstString(record, ['title']) }),
      };
    }
  }
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    const found = findXiaohongshuNote(child);
    if (found !== null) return found;
  }
  return null;
}

function firstString(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function htmlMetaContent(html: string, property: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = htmlAttribute(tag, 'property') ?? htmlAttribute(tag, 'name');
    if (name?.toLowerCase() !== property.toLowerCase()) continue;
    const content = htmlAttribute(tag, 'content');
    if (content !== null && content.trim().length > 0) return decodeBasicEntities(content.trim());
  }
  return null;
}

function htmlAttribute(tag: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\s${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(
    tag,
  );
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function decodeBasicEntities(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}
