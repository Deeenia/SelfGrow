import {
  CAPTURE_METHODS,
  PLATFORMS,
  PROCESSING_STATES,
  selfGrowID,
  vaultPath,
  type CaptureMethod,
  type InboxCapture,
  type ProcessingState,
  type SelfGrowID,
  type VaultPath,
} from '../domain';
import type { FrontmatterPort, TemporalContext, VaultPort } from '../platform/ports';
import { z } from '../schema/zod';
import type { NormalizedURL } from '../url';
import type { PathGuard } from '../vault';

const timestampSchema = z
  .string()
  .min(1)
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: 'Timestamp must be parseable.',
  });
const inboxFrontmatterSchema = z.strictObject({
  attempt_count: z.number().int().nonnegative().optional(),
  capture_method: z.enum(CAPTURE_METHODS).optional(),
  capture_images: z.array(z.string().min(1)).max(20).optional(),
  capture_attachments: z.array(z.string().min(1)).max(20).optional(),
  capture_folder: z.string().min(1).optional(),
  capture_note: z.string().optional(),
  capture_title: z.string().min(1).optional(),
  capture_token: z.string().optional(),
  checkpoint: z.string().optional(),
  cssclasses: z.literal('selfgrow-internal').optional(),
  extraction_route: z
    .enum([
      '',
      'captured_text',
      'local_article',
      'anonymous_platform',
      'third_party_provider',
      'visual_preview',
    ])
    .optional(),
  extractor_id: z.string().optional(),
  imported_at: timestampSchema.optional(),
  last_error_code: z.string().optional(),
  last_error_message: z.string().optional(),
  normalized_url: z.string().optional(),
  selfgrow_capture: z.literal(true),
  selfgrow_id: z.string().min(1).optional(),
  source_platform: z.enum(PLATFORMS).optional(),
  source_url: z.string().min(1).optional(),
  status: z.enum(PROCESSING_STATES).optional(),
});

export interface BookmarkQueueEntry {
  captureToken: string;
  line: string;
  lineNumber: number;
  sourceURL: string;
}

interface TextQueueEntry {
  captureToken: string;
  capturedText: string;
  header: string;
  lineNumber: number;
}

export interface CaptureIDFactory {
  next(): SelfGrowID;
}

export class RandomUUIDCaptureIDFactory implements CaptureIDFactory {
  next(): SelfGrowID {
    return selfGrowID(crypto.randomUUID());
  }
}

export interface KnowledgeURLLookup {
  findByNormalizedURL(url: string): Promise<VaultPath | null>;
}

export interface URLNormalizer {
  normalize(input: string): Promise<NormalizedURL>;
}

export interface ReconciledCapture extends InboxCapture {
  existingKnowledgePath: VaultPath | null;
  lastErrorCode?: string;
  reconciliationKind: 'new' | 'reimport';
}

export interface InboxReconcilerDependencies {
  clock: TemporalContext;
  frontmatter: FrontmatterPort;
  idFactory: CaptureIDFactory;
  knowledgeURLs: KnowledgeURLLookup;
  pathGuard: PathGuard;
  urls: URLNormalizer;
  vault: VaultPort;
}

export class InboxReconciler {
  readonly #clock: TemporalContext;
  readonly #frontmatter: FrontmatterPort;
  readonly #idFactory: CaptureIDFactory;
  readonly #inboxPath: VaultPath;
  readonly #knowledgeURLs: KnowledgeURLLookup;
  readonly #pathGuard: PathGuard;
  readonly #queuePaths: readonly VaultPath[];
  readonly #urls: URLNormalizer;
  readonly #vault: VaultPort;

  constructor(dependencies: InboxReconcilerDependencies) {
    this.#clock = dependencies.clock;
    this.#frontmatter = dependencies.frontmatter;
    this.#idFactory = dependencies.idFactory;
    this.#knowledgeURLs = dependencies.knowledgeURLs;
    this.#pathGuard = dependencies.pathGuard;
    this.#urls = dependencies.urls;
    this.#vault = dependencies.vault;
    this.#inboxPath = dependencies.pathGuard.join('Inbox');
    this.#queuePaths = [
      siblingQueuePath(dependencies.pathGuard.rootPath),
      dependencies.pathGuard.join('Inbox Queue.md'),
      dependencies.pathGuard.join('Inbox', 'Inbox Queue.md'),
    ];
  }

  async reconcile(): Promise<ReconciledCapture[]> {
    await this.#materializeQueue();
    const paths = await this.#vault.listMarkdownFiles(this.#inboxPath);
    const captures: ReconciledCapture[] = [];

    for (const rawPath of paths) {
      const path = this.#pathGuard.assertDescendant(rawPath);
      if (!path.startsWith(`${this.#inboxPath}/`)) continue;
      if (this.#queuePaths.includes(path)) continue;
      const capture = await this.#adopt(path);
      if (capture !== null) captures.push(capture);
    }

    captures.sort(
      (left, right) =>
        Date.parse(left.importedAt) - Date.parse(right.importedAt) ||
        left.path.localeCompare(right.path),
    );

    const seenIDs = new Set<SelfGrowID>();
    return captures.filter((capture) => {
      if (seenIDs.has(capture.id)) return false;
      seenIDs.add(capture.id);
      return true;
    });
  }

  async #materializeQueue(): Promise<void> {
    for (const queuePath of this.#queuePaths) {
      if (!(await this.#vault.exists(queuePath))) continue;
      await this.#materializeQueuePath(queuePath);
    }
  }

  async #materializeQueuePath(queuePath: VaultPath): Promise<void> {
    let queueMarkdown = await this.#vault.read(queuePath);
    const captureToken = captureTokenAt(this.#clock.now(), this.#clock.timeZone());
    const canonical = canonicalizeBareBookmarkQueue(queueMarkdown, captureToken);
    if (canonical !== queueMarkdown) {
      queueMarkdown = await this.#vault.process(queuePath, (current) =>
        canonicalizeBareBookmarkQueue(current, captureToken),
      );
    }

    for (const entry of parseBookmarkQueue(queueMarkdown)) {
      const normalized = await this.#safeNormalize(entry.sourceURL);
      if (normalized === null) continue;
      const targetPath = this.#pathGuard.assertDescendant(
        `${this.#inboxPath}/${entry.captureToken}-${await stableURLToken(
          normalized.normalized,
        )}.md`,
      );

      if (!(await this.#vault.exists(targetPath))) {
        await this.#vault.create(targetPath, `${entry.sourceURL}\n`);
      }

      const existing = await this.#frontmatter.read(targetPath);
      const existingID =
        typeof existing?.selfgrow_id === 'string' && existing.selfgrow_id.length > 0
          ? existing.selfgrow_id
          : null;
      const id = existingID === null ? this.#idFactory.next() : selfGrowID(existingID);
      await this.#frontmatter.process(targetPath, (current) => ({
        ...current,
        capture_method: 'clipboard_shortcut',
        capture_token: entry.captureToken,
        cssclasses: 'selfgrow-internal',
        imported_at: localCaptureTokenToISO(entry.captureToken, this.#clock.timeZone()),
        normalized_url: normalized.normalized,
        selfgrow_capture: true,
        selfgrow_id: id,
        source_platform: normalized.platform,
        source_url: entry.sourceURL,
        status: 'queued',
      }));

      await this.#acknowledge(queuePath, entry);
    }
    for (const entry of parseTextQueue(queueMarkdown)) {
      const identity = `selfgrow:text:${await stableURLToken(entry.capturedText)}`;
      const targetPath = this.#pathGuard.assertDescendant(
        `${this.#inboxPath}/${entry.captureToken}-${await stableURLToken(identity)}.md`,
      );
      if (!(await this.#vault.exists(targetPath))) {
        await this.#vault.create(targetPath, `${entry.capturedText}\n`);
      }
      const existing = await this.#frontmatter.read(targetPath);
      const id =
        typeof existing?.selfgrow_id === 'string' && existing.selfgrow_id.length > 0
          ? selfGrowID(existing.selfgrow_id)
          : this.#idFactory.next();
      await this.#frontmatter.process(targetPath, (current) => ({
        ...current,
        capture_method: 'shared_text',
        capture_token: entry.captureToken,
        cssclasses: 'selfgrow-internal',
        imported_at: localCaptureTokenToISO(entry.captureToken, this.#clock.timeZone()),
        normalized_url: identity,
        selfgrow_capture: true,
        selfgrow_id: id,
        source_platform: 'unknown',
        source_url: identity,
        status: 'queued',
      }));
      await this.#acknowledgeText(queuePath, entry);
    }
  }

  async #acknowledge(queuePath: VaultPath, entry: BookmarkQueueEntry): Promise<void> {
    await this.#vault.process(queuePath, (current) => {
      const lines = current.split(/\r?\n/);
      if (lines[entry.lineNumber - 1] === entry.line) {
        lines[entry.lineNumber - 1] = entry.line.replace('- [ ] ', '- [x] ');
      }
      return lines.join(current.includes('\r\n') ? '\r\n' : '\n');
    });
  }

  async #acknowledgeText(queuePath: VaultPath, entry: TextQueueEntry): Promise<void> {
    await this.#vault.process(queuePath, (current) => {
      const lines = current.split(/\r?\n/);
      if (lines[entry.lineNumber - 1] === entry.header) {
        lines[entry.lineNumber - 1] = entry.header.replace('- [ ] ', '- [x] ');
      }
      return lines.join(current.includes('\r\n') ? '\r\n' : '\n');
    });
  }

  async #adopt(path: VaultPath): Promise<ReconciledCapture | null> {
    const markdown = await this.#vault.read(path);
    const rawFrontmatter = await this.#frontmatter.read(path);
    const parsed = inboxFrontmatterSchema.safeParse(rawFrontmatter);
    const sharedURL = exactlyOneHTTPURL(markdown);

    if (rawFrontmatter !== null && !parsed.success) return null;
    if (!parsed.success && sharedURL === null) return null;

    const sourceURL = parsed.success ? (parsed.data.source_url ?? sharedURL) : sharedURL;
    if (sourceURL === null || sourceURL === undefined) return null;
    const normalized = isTextSource(sourceURL)
      ? { normalized: sourceURL, platform: 'unknown' as const, received: sourceURL }
      : await this.#safeNormalize(sourceURL);
    if (normalized === null) return null;

    const stat = await this.#vault.stat(path);
    const id =
      parsed.success && parsed.data.selfgrow_id !== undefined
        ? selfGrowID(parsed.data.selfgrow_id)
        : this.#idFactory.next();
    const importedAt =
      parsed.success && parsed.data.imported_at !== undefined
        ? parsed.data.imported_at
        : new Date(stat.ctime).toISOString();
    const captureMethod: CaptureMethod = parsed.success
      ? (parsed.data.capture_method ?? 'share_sheet')
      : 'shared_text';
    const state: ProcessingState = parsed.success ? (parsed.data.status ?? 'queued') : 'queued';

    await this.#frontmatter.process(path, (current) => ({
      ...current,
      capture_method: captureMethod,
      cssclasses: 'selfgrow-internal',
      imported_at: importedAt,
      normalized_url: normalized.normalized,
      selfgrow_capture: true,
      selfgrow_id: id,
      source_platform: normalized.platform,
      source_url: sourceURL,
      status: state,
    }));

    const existingKnowledgePath = await this.#knowledgeURLs.findByNormalizedURL(
      normalized.normalized,
    );
    return {
      ...(parsed.success && parsed.data.capture_attachments !== undefined
        ? { attachmentPaths: parsed.data.capture_attachments.map((value) => value as VaultPath) }
        : {}),
      captureMethod,
      ...(parsed.success && parsed.data.capture_folder !== undefined
        ? { collectionFolder: parsed.data.capture_folder }
        : {}),
      ...(parsed.success && parsed.data.capture_title !== undefined
        ? { captureTitle: parsed.data.capture_title }
        : {}),
      existingKnowledgePath,
      id,
      ...(parsed.success && parsed.data.capture_images !== undefined
        ? { imagePaths: parsed.data.capture_images.map((value) => value as VaultPath) }
        : {}),
      importedAt,
      ...(parsed.success && parsed.data.last_error_code !== undefined
        ? { lastErrorCode: parsed.data.last_error_code }
        : {}),
      normalizedURL: normalized.normalized,
      path,
      reconciliationKind: existingKnowledgePath === null ? 'new' : 'reimport',
      sourceURL,
      state,
      ...(parsed.success && parsed.data.capture_note !== undefined
        ? { capturedText: parsed.data.capture_note }
        : captureMethod === 'clipboard_shortcut'
          ? {}
          : { capturedText: markdown }),
    };
  }

  async #safeNormalize(sourceURL: string): Promise<NormalizedURL | null> {
    try {
      return await this.#urls.normalize(sourceURL);
    } catch {
      return null;
    }
  }
}

function siblingQueuePath(rootPath: VaultPath): VaultPath {
  const segments = rootPath.split('/');
  segments.pop();
  return vaultPath([...segments, 'SelfGrow.md'].join('/'));
}

export function parseBookmarkQueue(markdown: string): BookmarkQueueEntry[] {
  const entries: BookmarkQueueEntry[] = [];
  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    const match = /^- \[ \] (\d{8}-\d{6}) (https?:\/\/\S+)$/.exec(line);
    if (match === null || match[1] === undefined || match[2] === undefined) continue;
    if (!validCaptureToken(match[1])) continue;
    entries.push({ captureToken: match[1], line, lineNumber: index + 1, sourceURL: match[2] });
  }
  return entries;
}

export function canonicalizeBareBookmarkQueue(markdown: string, captureToken: string): string {
  if (!validCaptureToken(captureToken)) throw new RangeError('Invalid capture token.');
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      if (/^- \[ \] 文字\s*$/.test(line)) return `- [ ] ${captureToken} 文字`;
      const match = /^(?:- \[ \] )?(https?:\/\/\S+)$/.exec(line);
      return match?.[1] === undefined ? line : `- [ ] ${captureToken} ${match[1]}`;
    })
    .join(newline);
}

function parseTextQueue(markdown: string): TextQueueEntry[] {
  const lines = markdown.split(/\r?\n/);
  const entries: TextQueueEntry[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index] ?? '';
    const match = /^- \[ \] (\d{8}-\d{6}) 文字\s*$/.exec(header);
    if (match?.[1] === undefined || !validCaptureToken(match[1])) continue;
    const body: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? '';
      if (/^- \[[ xX]\] /.test(line)) break;
      if (/^(?: {2}|\t)/.test(line)) body.push(line.replace(/^(?: {2,4}|\t)/, ''));
      else if (line.trim().length === 0 && body.length > 0) body.push('');
      else break;
    }
    const capturedText = body.join('\n').trim();
    if (capturedText.length < 20) continue;
    entries.push({ captureToken: match[1], capturedText, header, lineNumber: index + 1 });
  }
  return entries;
}

export function captureTokenAt(date: Date, timeZone: string): string {
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid capture time.');
  const parts = datePartsAt(date.getTime(), timeZone);
  return `${String(parts.year).padStart(4, '0')}${String(parts.month).padStart(2, '0')}${String(
    parts.day,
  ).padStart(2, '0')}-${String(parts.hour).padStart(2, '0')}${String(parts.minute).padStart(
    2,
    '0',
  )}${String(parts.second).padStart(2, '0')}`;
}

export function localCaptureTokenToISO(captureToken: string, timeZone: string): string {
  if (!validCaptureToken(captureToken)) throw new RangeError('Invalid capture token.');
  const parts = tokenParts(captureToken);
  const localUTC = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let instant = localUTC;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    instant = localUTC - offsetMinutesAt(instant, timeZone) * 60_000;
  }
  const actual = datePartsAt(instant, timeZone);
  if (!sameTokenParts(parts, actual))
    throw new RangeError('Capture time does not exist in timezone.');
  const offset = offsetMinutesAt(instant, timeZone);
  return `${tokenAsLocalISO(captureToken)}${formatOffset(offset)}`;
}

function exactlyOneHTTPURL(markdown: string): string | null {
  const matches = markdown.match(/https?:\/\/[^\s<>]+/gi) ?? [];
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function isTextSource(value: string): boolean {
  return /^selfgrow:text:[0-9a-f]{32}$/.test(value);
}

async function stableURLToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

interface DateParts {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  year: number;
}

function validCaptureToken(token: string): boolean {
  if (!/^\d{8}-\d{6}$/.test(token)) return false;
  const parts = tokenParts(token);
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second),
  );
  return (
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() + 1 === parts.month &&
    date.getUTCDate() === parts.day &&
    date.getUTCHours() === parts.hour &&
    date.getUTCMinutes() === parts.minute &&
    date.getUTCSeconds() === parts.second
  );
}

function tokenParts(token: string): DateParts {
  return {
    day: Number(token.slice(6, 8)),
    hour: Number(token.slice(9, 11)),
    minute: Number(token.slice(11, 13)),
    month: Number(token.slice(4, 6)),
    second: Number(token.slice(13, 15)),
    year: Number(token.slice(0, 4)),
  };
}

function datePartsAt(instant: number, timeZone: string): DateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric',
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    month: values.month ?? 0,
    second: values.second ?? 0,
    year: values.year ?? 0,
  };
}

function offsetMinutesAt(instant: number, timeZone: string): number {
  const parts = datePartsAt(instant, timeZone);
  return Math.round(
    (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
      instant) /
      60_000,
  );
}

function sameTokenParts(left: DateParts, right: DateParts): boolean {
  return Object.keys(left).every(
    (key) => left[key as keyof DateParts] === right[key as keyof DateParts],
  );
}

function tokenAsLocalISO(token: string): string {
  return `${token.slice(0, 4)}-${token.slice(4, 6)}-${token.slice(6, 8)}T${token.slice(
    9,
    11,
  )}:${token.slice(11, 13)}:${token.slice(13, 15)}`;
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(
    absolute % 60,
  ).padStart(2, '0')}`;
}
