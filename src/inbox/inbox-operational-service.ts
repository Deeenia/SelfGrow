import {
  SelfGrowError,
  canTransition,
  type InboxCapture,
  type Language,
  type ProcessingState,
  type SelfGrowID,
  type VaultPath,
} from '../domain';
import type { FrontmatterPort, VaultTreePort } from '../platform/ports';
import type { ProcessingInboxPort, ProcessingTerminalResult } from '../processing';
import type { PathGuard } from '../vault';
import type { ReconciledCapture } from './inbox-reconciler';

const ACTIVE_STATES = new Set<ProcessingState>(['queued', 'extracting', 'generating']);
const RETRYABLE_STATES = new Set<ProcessingState>([
  'waiting_network',
  'waiting_ai_configuration',
  'incomplete_extraction',
  'failed',
]);
const TERMINAL_STATES = new Set<ProcessingState>(['completed', 'incomplete_extraction', 'failed']);

export interface InboxOperationalItem extends InboxCapture {
  errorText: string | null;
  label: string;
  progress: InboxProgress;
  progressText: string;
}

export interface InboxProgress {
  kind: 'active' | 'failure' | 'success' | 'waiting';
  value: number;
}

export interface InboxOperationalServiceDependencies {
  frontmatter: FrontmatterPort;
  onCompleted?: (path: VaultPath) => Promise<void>;
  onStateChanged?: () => Promise<void>;
  pathGuard: PathGuard;
  reconciler: InboxReconciliationPort;
  vault: VaultTreePort;
}

export interface InboxReconciliationPort {
  reconcile(): Promise<ReconciledCapture[]>;
}

export class InboxOperationalService implements ProcessingInboxPort {
  readonly #frontmatter: FrontmatterPort;
  readonly #inboxRoot: VaultPath;
  readonly #onCompleted: ((path: VaultPath) => Promise<void>) | undefined;
  readonly #onStateChanged: (() => Promise<void>) | undefined;
  readonly #pathGuard: PathGuard;
  readonly #reconciler: InboxReconciliationPort;
  readonly #vault: VaultTreePort;

  constructor(dependencies: InboxOperationalServiceDependencies) {
    this.#frontmatter = dependencies.frontmatter;
    this.#onCompleted = dependencies.onCompleted;
    this.#onStateChanged = dependencies.onStateChanged;
    this.#pathGuard = dependencies.pathGuard;
    this.#reconciler = dependencies.reconciler;
    this.#vault = dependencies.vault;
    this.#inboxRoot = dependencies.pathGuard.join('Inbox');
  }

  async list(language: Language): Promise<InboxOperationalItem[]> {
    const captures = await this.#reconcilePending();
    return captures.map((capture) => ({
      ...capture,
      errorText: safeErrorText(capture.state, language, capture.lastErrorCode),
      label: captureLabel(capture.sourceURL),
      progress: inboxProgress(capture.state),
      progressText: inboxStateText(capture.state, language),
    }));
  }

  async listEligible(): Promise<readonly InboxCapture[]> {
    return (await this.#reconcilePending()).filter((capture) => ACTIVE_STATES.has(capture.state));
  }

  async checkpoint(capture: InboxCapture, state: ProcessingState): Promise<void> {
    await this.#setState(capture, state, {});
  }

  async finish(capture: InboxCapture, result: ProcessingTerminalResult): Promise<void> {
    if (result.state === 'completed') {
      if (!(await this.#vault.exists(result.knowledgePath))) {
        throw new SelfGrowError(
          'KNOWLEDGE_NOTE_INVALID',
          'The completed knowledge note was not committed.',
        );
      }
      await this.#assertCapturePath(capture.path);
      await this.#deleteCaptureImages(capture);
      await this.#vault.delete(capture.path);
      try {
        await this.#onCompleted?.(result.knowledgePath);
      } catch {
        // Opening the completed note is presentation-only; durable completion must stand.
      }
      return;
    }

    await this.#setState(capture, result.state, {
      last_error_code: result.code,
      last_error_message: result.message,
    });
  }

  async cleanupTemporary(capture: InboxCapture): Promise<void> {
    if (
      capture.capturedText !== undefined ||
      (capture.attachmentPaths?.length ?? capture.imagePaths?.length ?? 0) > 0
    )
      return;
    const path = await this.#assertCapturePath(capture.path);
    if (!(await this.#vault.exists(path))) return;
    const frontmatter = await this.#frontmatter.read(path);
    const state = readState(frontmatter?.status);
    if (state === null || !TERMINAL_STATES.has(state)) return;
    await this.#vault.process(path, (current) =>
      preserveFrontmatterWithURL(current, capture.sourceURL),
    );
  }

  async retry(id: SelfGrowID): Promise<void> {
    const capture = await this.#find(id);
    if (!RETRYABLE_STATES.has(capture.state)) {
      throw new SelfGrowError('INBOX_NOTE_INVALID', 'This Inbox item cannot be retried.');
    }
    const raw = await this.#frontmatter.read(capture.path);
    const attemptCount = readAttemptCount(raw?.attempt_count);
    await this.#setState(capture, 'queued', {
      attempt_count: attemptCount + 1,
      checkpoint: 'received',
      last_error_code: '',
      last_error_message: '',
    });
  }

  async permanentlyDelete(id: SelfGrowID): Promise<void> {
    const capture = await this.#find(id);
    const path = await this.#assertCapturePath(capture.path);
    await this.#deleteCaptureImages(capture);
    await this.#vault.delete(path);
  }

  async #deleteCaptureImages(capture: InboxCapture): Promise<void> {
    const attachmentRoot = `${this.#inboxRoot}/Attachments/`;
    for (const rawPath of capture.attachmentPaths ?? capture.imagePaths ?? []) {
      const path = this.#pathGuard.assertDescendant(rawPath);
      if (!path.startsWith(attachmentRoot) || !(await this.#vault.isFile(path))) continue;
      await this.#vault.delete(path);
    }
  }

  async #reconcilePending(): Promise<ReconciledCapture[]> {
    const pending: ReconciledCapture[] = [];
    for (const capture of await this.#reconciler.reconcile()) {
      if (capture.state !== 'completed') {
        pending.push(capture);
        continue;
      }
      if (capture.existingKnowledgePath === null) continue;
      await this.#assertCapturePath(capture.path);
      await this.#deleteCaptureImages(capture);
      if (await this.#vault.exists(capture.path)) await this.#vault.delete(capture.path);
    }
    return pending;
  }

  async #find(id: SelfGrowID): Promise<InboxCapture> {
    const capture = (await this.#reconciler.reconcile()).find((item) => item.id === id);
    if (capture === undefined) {
      throw new SelfGrowError('INBOX_CAPTURE_NOT_FOUND', 'The Inbox item was not found.');
    }
    return capture;
  }

  async #setState(
    capture: InboxCapture,
    next: ProcessingState,
    patch: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const path = await this.#assertCapturePath(capture.path);
    const frontmatter = await this.#frontmatter.read(path);
    const current = readState(frontmatter?.status) ?? capture.state;
    if (current !== next && !canTransition(current, next)) {
      throw new SelfGrowError('INBOX_NOTE_INVALID', 'The Inbox state transition is invalid.');
    }
    await this.#frontmatter.process(path, (value) => ({
      ...value,
      checkpoint: next,
      status: next,
      ...patch,
    }));
    try {
      await this.#onStateChanged?.();
    } catch {
      // Progress presentation must not interrupt durable processing.
    }
  }

  async #assertCapturePath(path: string): Promise<VaultPath> {
    const normalized = this.#pathGuard.assertDescendant(path);
    if (!normalized.startsWith(`${this.#inboxRoot}/`) || !normalized.endsWith('.md')) {
      throw new SelfGrowError('INBOX_NOTE_INVALID', 'The Inbox capture path is invalid.');
    }
    return normalized;
  }
}

export function inboxStateText(state: ProcessingState, language: Language): string {
  return STATE_COPY[language][state];
}

export function inboxProgress(state: ProcessingState): InboxProgress {
  switch (state) {
    case 'queued':
      return { kind: 'waiting', value: 0.08 };
    case 'extracting':
      return { kind: 'active', value: 0.28 };
    case 'generating':
      return { kind: 'active', value: 0.72 };
    case 'completed':
      return { kind: 'success', value: 1 };
    case 'waiting_network':
    case 'waiting_ai_configuration':
      return { kind: 'waiting', value: 0.12 };
    case 'incomplete_extraction':
    case 'failed':
      return { kind: 'failure', value: 1 };
  }
}

const STATE_COPY: Record<Language, Record<ProcessingState, string>> = {
  en: {
    queued: 'Queued',
    waiting_network: 'Waiting for network',
    waiting_ai_configuration: 'Waiting for AI configuration',
    extracting: 'Extracting',
    generating: 'Preparing Raw material',
    completed: 'Completed',
    incomplete_extraction: 'Could not extract complete content',
    failed: 'Processing failed',
  },
  'zh-CN': {
    queued: '等待处理',
    waiting_network: '等待联网',
    waiting_ai_configuration: '等待 AI 配置',
    extracting: '正在提取',
    generating: '正在整理原始材料',
    completed: '已完成',
    incomplete_extraction: '无法完整解析',
    failed: '处理失败',
  },
};

function safeErrorText(
  state: ProcessingState,
  language: Language,
  errorCode: string | undefined,
): string | null {
  if (state === 'incomplete_extraction') {
    return localizedExtractionError(errorCode, language);
  }
  if (state === 'failed') {
    return localizedProcessingError(errorCode, language);
  }
  return null;
}

function localizedProcessingError(code: string | undefined, language: Language): string {
  const chinese = language === 'zh-CN';
  switch (code) {
    case 'OBSIDIAN_API_FAILED':
      return chinese
        ? '页面数据超过当前安全读取上限，或 Obsidian 无法读取响应。可更新插件后重试。'
        : 'The page exceeded the safe read limit or Obsidian could not read it. Update and retry.';
    case 'DUPLICATE_URL':
      return chinese
        ? '该链接已有知识卡片，无需重复生成。'
        : 'A knowledge card already exists for this link.';
    case 'EXTRACTION_FAILED':
      return chinese
        ? '来源页面访问失败，请稍后重试。'
        : 'The source page request failed. Retry later.';
    case 'AI_OUTPUT_INVALID':
      return chinese
        ? 'AI 标题或筛选预览无效，请重试。'
        : 'The AI title or selection preview was invalid. Retry.';
    case 'AI_CONNECTION_TEST_FAILED':
      return chinese
        ? 'AI 标题与预览生成失败，请检查连接后重试。'
        : 'AI title and preview generation failed. Check the connection and retry.';
    case 'AI_REQUEST_TIMEOUT':
      return chinese
        ? 'AI 模型响应超时。请重试，或改用响应更快的模型。'
        : 'The AI model timed out. Retry or use a faster model.';
    default:
      return chinese
        ? '处理未完成，可重试或永久删除。'
        : 'Processing did not finish. Retry or permanently delete it.';
  }
}

function localizedExtractionError(code: string | undefined, language: Language): string {
  const chinese = language === 'zh-CN';
  switch (code) {
    case 'platform_adapter_required':
      return chinese
        ? '平台公开页面没有返回可读取的正文或简介。请重新加载插件后重试。'
        : 'The public platform page returned no readable text or description. Reload the plugin and retry.';
    case 'provider_not_configured':
      return chinese
        ? '公开页面未提供可读取内容，且没有可用的第三方提取服务。'
        : 'The public page exposed no readable content and no extraction provider is available.';
    case 'video_too_long':
      return chinese
        ? '视频超过五分钟，不自动解析；请打开原链接查看。'
        : 'The video is over five minutes. Open the original link to view it.';
    case 'video_duration_unknown':
      return chinese
        ? '无法确认视频时长，不自动解析；请打开原链接查看。'
        : 'The video duration could not be confirmed. Open the original link to view it.';
    case 'transcript_missing':
      return chinese
        ? '简介不足，并且没有取得可用字幕。'
        : 'The description was insufficient and no usable subtitles were available.';
    case 'main_text_missing':
      return chinese ? '页面没有提供可读取的正文。' : 'The page exposed no readable main text.';
    case 'platform_access_blocked':
      return chinese
        ? '平台阻止了匿名公开访问；请打开原链接查看。插件不会读取账号或绕过验证。'
        : 'The platform blocked anonymous access. Open the original link; SelfGrow will not bypass verification.';
    default:
      return chinese
        ? '未取得可用于生成知识卡片的内容。'
        : 'No content suitable for a knowledge card was available.';
  }
}

function captureLabel(sourceURL: string): string {
  if (sourceURL.startsWith('selfgrow:text:')) return '粘贴文字';
  try {
    return new URL(sourceURL).hostname;
  } catch {
    return 'Inbox capture';
  }
}

function readState(value: unknown): ProcessingState | null {
  return typeof value === 'string' && value in STATE_COPY.en ? (value as ProcessingState) : null;
}

function readAttemptCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function preserveFrontmatterWithURL(markdown: string, sourceURL: string): string {
  const frontmatter = /^(---\r?\n[\s\S]*?\r?\n---\r?\n)/.exec(markdown)?.[1] ?? '';
  return `${frontmatter}${sourceURL}\n`;
}
