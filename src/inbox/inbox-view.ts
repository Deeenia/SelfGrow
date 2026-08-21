import { ItemView, Modal, Notice, Setting, setIcon, type WorkspaceLeaf } from 'obsidian';
import {
  isSelfGrowError,
  isRawCategory,
  RAW_CATEGORIES,
  type Language,
  type RawCategory,
  type SelfGrowID,
} from '../domain';
import type { GitHubCandidate, GitHubNameResolution } from '../github';
import type { InboxOperationalItem, InboxProgress } from './inbox-operational-service';
import { analyzeManualCapture, looksLikeGitHubName } from './manual-capture';

export const INBOX_VIEW_TYPE = 'selfgrow-inbox';

export interface RecognitionSuggestion {
  category: RawCategory;
  fallback: boolean;
  githubQueries: readonly string[];
  preview: string;
  title: string;
}

export interface InboxViewService {
  createFolder(name: string): Promise<string>;
  listFolders(): Promise<readonly string[]>;
  list(language: Language): Promise<InboxOperationalItem[]>;
  permanentlyDelete(id: SelfGrowID): Promise<void>;
  resolveGitHubName(name: string, category: RawCategory): Promise<GitHubNameResolution>;
  retry(id: SelfGrowID): Promise<void>;
  submitCapture(input: ManualCaptureInput): Promise<void>;
  suggestRecognition(input: {
    note: string;
    title: string;
    url: string;
  }): Promise<RecognitionSuggestion | null>;
}

export interface ManualCaptureInput {
  files: readonly File[];
  folder: string;
  note: string;
  title: string;
  url: string;
}

export interface InboxViewDependencies {
  language(): Language;
  openReview(): Promise<void>;
  service: InboxViewService;
}

const SUGGESTION_DEBOUNCE_MS = 800;

export class InboxView extends ItemView {
  readonly #dependencies: InboxViewDependencies;
  readonly #draftFiles: File[] = [];
  #categorySelect: HTMLSelectElement | null = null;
  #categoryTouched = false;
  #draftCategory: string = 'Project';
  #draftNote = '';
  #draftTitle = '';
  #draftURL = '';
  #lastSuggestion: RecognitionSuggestion | null = null;
  #submitting = false;
  #suggestionGeneration = 0;
  #suggestionHint: HTMLElement | null = null;
  #suggestionTimer: number | undefined;
  #titleInput: HTMLInputElement | null = null;
  #titleTouched = false;

  constructor(leaf: WorkspaceLeaf, dependencies: InboxViewDependencies) {
    super(leaf);
    this.#dependencies = dependencies;
  }

  override getViewType(): string {
    return INBOX_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return 'SelfGrow Queue';
  }

  override getIcon(): string {
    return 'inbox';
  }

  override async onOpen(): Promise<void> {
    await this.refresh();
  }

  override async onClose(): Promise<void> {
    if (this.#suggestionTimer !== undefined) window.clearTimeout(this.#suggestionTimer);
  }

  async refresh(): Promise<void> {
    const language = this.#dependencies.language();
    const copy = COPY[language];
    const [items, folders] = await Promise.all([
      this.#dependencies.service.list(language),
      this.#dependencies.service.listFolders(),
    ]);
    this.contentEl.empty();
    this.contentEl.addClass('selfgrow-inbox');
    const header = this.contentEl.createDiv({ cls: 'selfgrow-inbox-header' });
    header.createDiv({ cls: 'selfgrow-brand', text: 'SelfGrow' });
    const navigation = header.createDiv({ cls: 'selfgrow-section-navigation' });
    navigation.createEl('button', {
      attr: { 'aria-current': 'page' },
      cls: 'is-active',
      text: copy.collect,
    });
    const review = navigation.createEl('button', { text: copy.openReview });
    review.addEventListener('click', () => void this.#run(() => this.#dependencies.openReview()));
    this.#renderComposer(language, folders);
    const activeItem =
      items.find((item) => item.state === 'extracting' || item.state === 'generating') ??
      items.find((item) => item.state === 'queued');
    if (activeItem !== undefined) this.#renderProgressOverlay(activeItem);
    if (items.length === 0) {
      this.contentEl.createEl('p', { cls: 'selfgrow-inbox-empty', text: copy.empty });
      return;
    }
    for (const item of items) this.#renderItem(item, language, item === activeItem);
  }

  #renderComposer(language: Language, folders: readonly string[]): void {
    const copy = COPY[language];
    const composer = this.contentEl.createDiv({ cls: 'selfgrow-capture-composer' });
    const fields = composer.createDiv({ cls: 'selfgrow-capture-fields' });
    const titleField = fields.createDiv({ cls: 'selfgrow-capture-field' });
    titleField.createEl('label', { text: copy.titleLabel });
    const title = titleField.createEl('input', {
      attr: { placeholder: copy.titlePlaceholder, type: 'text' },
      cls: 'selfgrow-capture-title',
    });
    title.value = this.#draftTitle;
    title.addEventListener('input', () => {
      this.#draftTitle = title.value;
      this.#titleTouched = true;
      this.#scheduleSuggestion();
    });
    this.#titleInput = title;

    const categoryField = fields.createDiv({ cls: 'selfgrow-capture-field' });
    categoryField.createEl('label', { text: copy.categoryLabel });
    const category = categoryField.createEl('select', {
      cls: 'selfgrow-capture-category',
    });
    const options = [...new Set([...RAW_CATEGORIES, ...folders])];
    for (const value of options) category.createEl('option', { text: value, value });
    category.value = this.#draftCategory;
    category.addEventListener('change', () => {
      this.#draftCategory = category.value;
      this.#categoryTouched = true;
    });
    this.#categorySelect = category;
    const createFolder = categoryField.createEl('button', {
      attr: { 'aria-label': copy.createFolder, title: copy.createFolder },
      cls: 'selfgrow-capture-create-folder',
    });
    setIcon(createFolder, 'plus');
    createFolder.addEventListener('click', () => {
      new CreateFolderModal(this.app, language, async (name) => {
        const created = await this.#dependencies.service.createFolder(name);
        this.#draftCategory = created;
        this.#categoryTouched = true;
        await this.refresh();
      }).open();
    });
    const suggestionHint = categoryField.createEl('p', { cls: 'selfgrow-capture-suggestion' });
    this.#suggestionHint = suggestionHint;
    this.#renderSuggestionHint(copy);

    const linkField = fields.createDiv({ cls: 'selfgrow-capture-field' });
    linkField.createEl('label', { text: copy.linkLabel });
    const url = linkField.createEl('input', {
      attr: { placeholder: copy.linkPlaceholder, type: 'text' },
      cls: 'selfgrow-capture-title',
    });
    url.value = this.#draftURL;
    const noteField = fields.createDiv({ cls: 'selfgrow-capture-field' });
    noteField.createEl('label', { text: copy.noteLabel });
    const note = noteField.createEl('textarea', {
      attr: { placeholder: copy.notePlaceholder, rows: '7' },
      cls: 'selfgrow-capture-share',
    });
    note.value = this.#draftNote;
    const routeHint = noteField.createSpan({ cls: 'selfgrow-capture-route' });
    const updateRouteHint = (): void => {
      const analysis = analyzeManualCapture({
        imageCount: this.#draftFiles.filter((file) => file.type.startsWith('image/')).length,
        note: note.value,
        shareText: url.value,
      });
      routeHint.setText(
        analysis.route === 'ai'
          ? copy.routeAI
          : analysis.sourceURL === null
            ? copy.routeDirectNoLink
            : copy.routeDirect,
      );
    };
    url.addEventListener('input', () => {
      this.#draftURL = url.value;
      updateRouteHint();
      this.#scheduleSuggestion();
    });
    note.addEventListener('input', () => {
      this.#draftNote = note.value;
      updateRouteHint();
      this.#scheduleSuggestion();
    });
    note.addEventListener('paste', (event) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length > 0) this.#addFiles(files);
    });
    updateRouteHint();
    const fileRow = fields.createDiv({ cls: 'selfgrow-capture-images' });
    const picker = fileRow.createEl('input', {
      attr: { multiple: '', type: 'file' },
    });
    picker.addEventListener('change', () => this.#addFiles([...(picker.files ?? [])]));
    fileRow.createSpan({ text: copy.fileHelp });
    if (this.#draftFiles.length > 0) {
      const list = fields.createEl('ul', { cls: 'selfgrow-capture-image-list' });
      for (const [index, file] of this.#draftFiles.entries()) {
        const item = list.createEl('li');
        item.createSpan({ text: file.name || `${copy.file} ${index + 1}` });
        const remove = item.createEl('button', { text: copy.removeImage });
        remove.addEventListener('click', () => {
          this.#draftFiles.splice(index, 1);
          void this.refresh();
        });
      }
    }
    const footer = composer.createDiv({ cls: 'selfgrow-capture-footer' });
    const submit = footer.createEl('button', {
      cls: 'mod-cta selfgrow-capture-submit',
      text: this.#submitting ? copy.submitting : copy.submit,
    });
    submit.disabled = this.#submitting;
    submit.addEventListener('click', () => void this.#submitCapture());
  }

  #renderSuggestionHint(copy: (typeof COPY)[Language]): void {
    const suggestion = this.#lastSuggestion;
    if (suggestion === null || this.#suggestionHint === null) return;
    const label = suggestion.fallback ? copy.suggestionLocal : copy.suggestionAI;
    this.#suggestionHint.setText(
      suggestion.preview.length > 0 ? `${label} ${suggestion.preview}` : label,
    );
  }

  #addFiles(files: readonly File[]): void {
    for (const file of files) {
      if (this.#draftFiles.length >= 20) break;
      const currentBytes = this.#draftFiles.reduce((total, item) => total + item.size, 0);
      if (file.size > 0 && file.size <= 25_000_000 && currentBytes + file.size <= 100_000_000) {
        this.#draftFiles.push(file);
      }
    }
    void this.refresh();
  }

  #scheduleSuggestion(): void {
    if (this.#suggestionTimer !== undefined) window.clearTimeout(this.#suggestionTimer);
    this.#suggestionTimer = window.setTimeout(
      () => void this.#runSuggestion(),
      SUGGESTION_DEBOUNCE_MS,
    );
  }

  async #runSuggestion(): Promise<void> {
    if (this.#submitting) return;
    const material = [this.#draftURL, this.#draftNote].join('\n').trim();
    if (material.length === 0) return;
    const generation = ++this.#suggestionGeneration;
    try {
      const suggestion = await this.#dependencies.service.suggestRecognition({
        note: this.#draftNote,
        title: this.#draftTitle,
        url: this.#draftURL,
      });
      if (suggestion === null || generation !== this.#suggestionGeneration) return;
      this.#lastSuggestion = suggestion;
      if (!this.#categoryTouched && this.#categorySelect !== null) {
        this.#draftCategory = suggestion.category;
        if (this.#categorySelect.isConnected) this.#categorySelect.value = suggestion.category;
      }
      if (
        !this.#titleTouched &&
        this.#titleInput !== null &&
        this.#draftTitle.trim().length === 0
      ) {
        this.#draftTitle = suggestion.title;
        if (this.#titleInput.isConnected) this.#titleInput.value = suggestion.title;
      }
      this.#renderSuggestionHint(COPY[this.#dependencies.language()]);
    } catch {
      // A recognition suggestion is advisory and must never block capture.
    }
  }

  async #submitCapture(): Promise<void> {
    const copy = COPY[this.#dependencies.language()];
    const analysis = analyzeManualCapture({
      imageCount: this.#draftFiles.filter((file) => file.type.startsWith('image/')).length,
      note: this.#draftNote,
      shareText: this.#draftURL,
    });
    const urlField = this.#draftURL.trim();
    if (urlField.length > 0 && analysis.sourceURL === null && !looksLikeGitHubName(urlField)) {
      new Notice(copy.invalidLink);
      return;
    }
    if (
      analysis.sourceURL === null &&
      analysis.materialText.length === 0 &&
      this.#draftFiles.length === 0
    ) {
      new Notice(copy.contentRequired);
      return;
    }
    this.#submitting = true;
    await this.refresh();
    let url = urlField;
    try {
      if (
        analysis.sourceURL === null &&
        looksLikeGitHubName(url) &&
        isRawCategory(this.#draftCategory) &&
        this.#draftCategory !== 'Experience'
      ) {
        const resolution = await this.#dependencies.service.resolveGitHubName(
          url,
          this.#draftCategory,
        );
        if (resolution.kind === 'unique') {
          url = resolution.candidate.url;
        } else if (resolution.kind === 'multiple') {
          const modal = new GitHubCandidateModal(
            this.app,
            resolution.candidates,
            this.#dependencies.language(),
          );
          modal.open();
          const picked = await modal.choose();
          if (picked === null) {
            this.#submitting = false;
            await this.refresh();
            return;
          }
          this.#draftURL = picked.url;
          this.#submitting = false;
          new Notice(copy.repositorySelected);
          await this.refresh();
          return;
        } else {
          new Notice(copy.githubNotFound);
          this.#submitting = false;
          await this.refresh();
          return;
        }
      }
      await this.#dependencies.service.submitCapture({
        files: [...this.#draftFiles],
        folder: this.#draftCategory,
        note: this.#draftNote.trim(),
        title: this.#draftTitle.trim(),
        url,
      });
      this.#draftURL = '';
      this.#draftTitle = '';
      this.#draftNote = '';
      this.#draftFiles.splice(0);
      this.#categoryTouched = false;
      this.#titleTouched = false;
      this.#lastSuggestion = null;
      this.#suggestionGeneration += 1;
    } catch (error) {
      new Notice(captureActionError(error, this.#dependencies.language()));
    } finally {
      this.#submitting = false;
      await this.refresh();
    }
  }

  showCompleted(label: string): void {
    void label;
    void this.refresh();
  }

  #renderItem(item: InboxOperationalItem, language: Language, hasOverlay: boolean): void {
    const copy = COPY[language];
    const row = this.contentEl.createDiv({
      cls: `selfgrow-inbox-row${hasOverlay ? ' has-progress-overlay' : ''}`,
    });
    row.createEl('h3', { text: item.label });
    this.#renderProgress(row, item.progress, item.progressText);
    row.createEl('time', {
      attr: { datetime: item.importedAt },
      text: new Intl.DateTimeFormat(language, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(item.importedAt)),
    });
    if (item.errorText !== null) {
      row.createEl('p', { cls: 'selfgrow-inbox-error', text: item.errorText });
    }
    const actions = row.createDiv({ cls: 'selfgrow-inbox-actions' });
    if (isRetryable(item.state)) {
      const retry = actions.createEl('button', { text: copy.retry });
      retry.setAttribute('aria-label', `${copy.retry}: ${item.label}`);
      retry.addEventListener('click', () => {
        void this.#run(async () => {
          await this.#dependencies.service.retry(item.id);
          await this.refresh();
        });
      });
    }
    const remove = actions.createEl('button', { cls: 'mod-warning', text: copy.delete });
    remove.setAttribute('aria-label', `${copy.delete}: ${item.label}`);
    remove.addEventListener('click', () => {
      new PermanentInboxDeleteModal(this.app, language, item.label, async () => {
        await this.#dependencies.service.permanentlyDelete(item.id);
        await this.refresh();
      }).open();
    });
  }

  #renderProgressOverlay(item: InboxOperationalItem): void {
    const overlay = this.contentEl.createDiv({
      attr: { 'aria-atomic': 'true', 'aria-live': 'polite' },
      cls: 'selfgrow-inbox-progress-overlay',
    });
    this.#renderProgress(overlay, item.progress, item.progressText, true);
  }

  #renderProgress(
    container: HTMLElement,
    progress: InboxProgress,
    text: string,
    showValue = false,
  ): void {
    const line = container.createDiv({ cls: 'selfgrow-inbox-progress-line' });
    const ring = line.createDiv({ cls: `selfgrow-progress-ring is-${progress.kind}` });
    ring.style.setProperty('--selfgrow-progress', `${progress.value * 360}deg`);
    ring.setAttribute('role', 'progressbar');
    ring.setAttribute('aria-label', text);
    ring.setAttribute('aria-valuemin', '0');
    ring.setAttribute('aria-valuemax', '100');
    ring.setAttribute('aria-valuenow', String(Math.round(progress.value * 100)));
    if (progress.kind === 'failure') ring.createSpan({ text: '!' });
    if (progress.kind === 'success') ring.createSpan({ text: '✓' });
    if (showValue && progress.kind !== 'failure' && progress.kind !== 'success') {
      ring.createSpan({ text: `${Math.round(progress.value * 100)}%` });
    }
    line.createEl('p', { cls: 'selfgrow-inbox-state', text });
  }

  async #run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch {
      new Notice(COPY[this.#dependencies.language()].actionFailed);
    }
  }
}

class GitHubCandidateModal extends Modal {
  readonly #candidates: readonly GitHubCandidate[];
  readonly #language: Language;
  #resolve: ((candidate: GitHubCandidate | null) => void) | null = null;

  constructor(app: InboxView['app'], candidates: readonly GitHubCandidate[], language: Language) {
    super(app);
    this.#candidates = candidates;
    this.#language = language;
  }

  override onOpen(): void {
    const copy = COPY[this.#language];
    this.contentEl.addClass('selfgrow-candidate-modal');
    this.contentEl.createEl('h2', { text: copy.chooseRepository });
    this.contentEl.createEl('p', { text: copy.chooseRepositoryBody });
    for (const candidate of this.#candidates) {
      const button = this.contentEl.createEl('button', { cls: 'selfgrow-candidate' });
      const name = button.createDiv({ cls: 'selfgrow-candidate-name' });
      name.createSpan({ text: candidate.fullName });
      if (candidate.archived) {
        name.createSpan({ cls: 'selfgrow-candidate-archived', text: copy.archived });
      }
      if (candidate.description.length > 0) {
        button.createDiv({ cls: 'selfgrow-candidate-desc', text: candidate.description });
      }
      button.createDiv({
        cls: 'selfgrow-candidate-meta',
        text: `${candidate.stars}★ · ${formatTime(candidate.pushedAt, this.#language)}`,
      });
      button.addEventListener('click', () => {
        this.#resolve?.(candidate);
        this.close();
      });
    }
    new Setting(this.contentEl).addButton((button) =>
      button.setButtonText(copy.cancel).onClick(() => {
        this.#resolve?.(null);
        this.close();
      }),
    );
  }

  override onClose(): void {
    this.#resolve?.(null);
    this.contentEl.empty();
  }

  choose(): Promise<GitHubCandidate | null> {
    return new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }
}

class CreateFolderModal extends Modal {
  readonly #action: (name: string) => Promise<void>;
  readonly #language: Language;

  constructor(app: InboxView['app'], language: Language, action: (name: string) => Promise<void>) {
    super(app);
    this.#action = action;
    this.#language = language;
  }

  override onOpen(): void {
    const copy = COPY[this.#language];
    this.contentEl.createEl('h2', { text: copy.createFolder });
    const input = this.contentEl.createEl('input', {
      attr: { placeholder: copy.folderPlaceholder, type: 'text' },
    });
    input.focus();
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(copy.cancel).onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText(copy.createFolder)
          .setCta()
          .onClick(() => {
            const name = input.value.trim();
            if (name.length === 0) return;
            void this.#create(name);
          }),
      );
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void this.#create(input.value.trim());
    });
  }

  async #create(name: string): Promise<void> {
    try {
      await this.#action(name);
      this.close();
    } catch (error) {
      new Notice(captureActionError(error, this.#language));
    }
  }
}

class PermanentInboxDeleteModal extends Modal {
  readonly #action: () => Promise<void>;
  readonly #label: string;
  readonly #language: Language;

  constructor(
    app: InboxView['app'],
    language: Language,
    label: string,
    action: () => Promise<void>,
  ) {
    super(app);
    this.#action = action;
    this.#label = label;
    this.#language = language;
  }

  override onOpen(): void {
    const copy = COPY[this.#language];
    this.contentEl.createEl('h2', { text: copy.confirmTitle });
    this.contentEl.createEl('p', { text: `${copy.confirmBody} ${this.#label}` });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(copy.cancel).onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText(copy.delete)
          .setDestructive()
          .onClick(() => {
            void this.#confirm();
          }),
      );
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  async #confirm(): Promise<void> {
    try {
      await this.#action();
      this.close();
    } catch {
      new Notice(COPY[this.#language].actionFailed);
    }
  }
}

function isRetryable(state: InboxOperationalItem['state']): boolean {
  return (
    state === 'waiting_network' ||
    state === 'waiting_ai_configuration' ||
    state === 'incomplete_extraction' ||
    state === 'failed'
  );
}

function formatTime(value: string, language: Language): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(timestamp);
}

function captureActionError(error: unknown, language: Language): string {
  const chinese = language === 'zh-CN';
  if (!isSelfGrowError(error)) {
    return chinese
      ? '保存失败，请重新加载插件后重试。'
      : 'Save failed. Reload the plugin and retry.';
  }
  switch (error.code) {
    case 'INVALID_URL':
      return chinese ? '没有识别到有效的 HTTP(S) 链接。' : 'No valid HTTP(S) link was found.';
    case 'UNSAFE_URL':
      return chinese ? '该链接不安全，未保存。' : 'The link is unsafe and was not saved.';
    case 'KNOWLEDGE_NOTE_INVALID':
    case 'DUPLICATE_URL':
      return chinese
        ? '同名或相同来源的知识记录已存在。'
        : 'A knowledge record with the same title or source already exists.';
    case 'NETWORK_UNAVAILABLE':
      return chinese ? '当前网络不可用，请稍后重试。' : 'Network is unavailable. Retry later.';
    case 'OBSIDIAN_API_FAILED':
      return chinese
        ? 'Obsidian 无法写入收集内容，请重新加载插件后重试。'
        : 'Obsidian could not write the capture. Reload the plugin and retry.';
    default:
      return chinese
        ? '保存失败，请重新加载插件后重试。'
        : 'Save failed. Reload the plugin and retry.';
  }
}

const COPY = {
  en: {
    actionFailed: 'The Inbox action failed.',
    archived: 'archived',
    cancel: 'Cancel',
    categoryLabel: 'Category',
    createFolder: 'New folder',
    chooseRepository: 'Choose a GitHub repository',
    chooseRepositoryBody:
      'Several repositories match. Pick the official one, or cancel to keep your original input.',
    collect: 'Collect',
    confirmBody: 'This permanently deletes the Inbox capture. SelfGrow cannot restore it:',
    confirmTitle: 'Permanently delete capture?',
    contentRequired: 'Add a link, body, or local file.',
    delete: 'Permanently delete',
    empty: 'No pending captures.',
    file: 'File',
    fileHelp: 'Add up to 20 images or local files · 25 MB each · 100 MB total.',
    githubNotFound: 'No reliable GitHub repository was found; your original input is kept.',
    repositorySelected: 'Repository selected. Press Save again to capture it.',
    githubSearchFailed: 'The GitHub search failed. Check the network and retry.',
    invalidLink: 'Paste text containing one valid HTTP(S) link or a repository name.',
    linkLabel: 'Link, share text, or repository name · optional',
    linkPlaceholder:
      'Paste a link, a full platform share message, or a GitHub project/Skill name; the first link is extracted',
    noteLabel: 'Body · optional',
    notePlaceholder: 'Paste or write the source text',
    openReview: 'Review',
    removeImage: 'Remove',
    retry: 'Retry',
    routeAI: 'Raw evidence · text/link, or visual preview · image only',
    routeDirect: 'Direct Raw · files and source link preserved',
    routeDirectNoLink: 'Direct Raw · local files preserved',
    submit: 'Save',
    submitting: 'Saving…',
    suggestionAI: 'AI suggestion:',
    suggestionLocal: 'Local recognition (AI unavailable):',
    titleLabel: 'Title · optional',
    titlePlaceholder: 'Document title (optional; otherwise derived from the text or image name)',
    folderPlaceholder: 'Folder name',
  },
  'zh-CN': {
    actionFailed: 'Inbox 操作失败。',
    archived: '已归档',
    cancel: '取消',
    categoryLabel: '分类',
    createFolder: '新建文件夹',
    chooseRepository: '选择 GitHub 仓库',
    chooseRepositoryBody: '找到多个匹配的仓库。请选择官方仓库，或取消以保留原始输入。',
    collect: '收集',
    confirmBody: '此操作会永久删除该 Inbox 捕获，SelfGrow 无法恢复：',
    confirmTitle: '永久删除捕获？',
    contentRequired: '请添加链接、正文或本地文件。',
    delete: '永久删除',
    empty: '没有待处理的捕获。',
    file: '文件',
    fileHelp: '最多添加 20 张图片或本地文件 · 单个 25 MB · 总计 100 MB。',
    githubNotFound: '未找到可靠 GitHub 仓库，已保留原始输入。',
    repositorySelected: '已选择仓库，请再次点击“保存”完成收集。',
    githubSearchFailed: 'GitHub 搜索失败，请检查网络后重试。',
    invalidLink: '请粘贴包含有效 HTTP(S) 链接的文字或仓库名称。',
    linkLabel: '链接、分享文案或仓库名 · 可选',
    linkPlaceholder: '粘贴链接、完整平台分享文案，或 GitHub 项目/Skill 名称；自动提取第一个链接',
    noteLabel: '正文 · 可选',
    notePlaceholder: '粘贴或输入原始正文',
    openReview: '筛选',
    removeImage: '移除',
    retry: '重试',
    routeAI: 'Raw 原始材料 · 文字/链接；视觉预览 · 仅图片',
    routeDirect: '直接保存 Raw · 保留文件和来源链接',
    routeDirectNoLink: '直接保存 Raw · 保留本地文件',
    submit: '保存',
    submitting: '正在保存…',
    suggestionAI: 'AI 建议：',
    suggestionLocal: '本地识别（AI 不可用）：',
    titleLabel: '标题 · 可选',
    titlePlaceholder: '文档标题（可选；留空时从文字或图片名获取）',
    folderPlaceholder: '输入文件夹名称',
  },
} as const;
