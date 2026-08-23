import { ItemView, Modal, Notice, Setting, setIcon, TFile, type WorkspaceLeaf } from 'obsidian';
import type { Language, VaultPath } from '../domain';
import { rawReviewGroup, type RawCardState, type RawReviewGroup } from './raw-card';

export const RAW_REVIEW_VIEW_TYPE = 'selfgrow-raw-review';

export interface RawReviewViewService {
  cancelSelection(path: VaultPath): Promise<void>;
  confirmUpdate(path: VaultPath): Promise<void>;
  deleteRaw(path: VaultPath, confirmed: boolean): Promise<void>;
  listFolders(): Promise<readonly string[]>;
  list(): Promise<RawCardState[]>;
  open(path: VaultPath): Promise<void>;
  select(path: VaultPath): Promise<void>;
}

export interface RawReviewViewDependencies {
  language(): Language;
  openInbox(): Promise<void>;
  service: RawReviewViewService;
}

const GROUPS: readonly RawReviewGroup[] = [
  'unselected',
  'queued',
  'completed',
  'needs_update',
  'failed',
];

const LONG_PRESS_MS = 500;
const DOUBLE_TAP_MS = 300;
const PAGE_SIZE = 10;

export class RawReviewView extends ItemView {
  readonly #dependencies: RawReviewViewDependencies;
  readonly #selected = new Set<VaultPath>();
  #folder = '';
  #group: RawReviewGroup = 'unselected';
  #page = 0;
  #selectionMode = false;

  constructor(leaf: WorkspaceLeaf, dependencies: RawReviewViewDependencies) {
    super(leaf);
    this.#dependencies = dependencies;
    this.navigation = true;
  }

  override getViewType(): string {
    return RAW_REVIEW_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return this.#dependencies.language() === 'zh-CN' ? '知识筛选' : 'SelfGrow Review';
  }

  override getIcon(): string {
    return 'list-checks';
  }

  override async onOpen(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const language = this.#dependencies.language();
    const copy = COPY[language];
    const [allCards, folders] = await Promise.all([
      this.#dependencies.service.list(),
      this.#dependencies.service.listFolders(),
    ]);
    if (this.#folder.length > 0 && !folders.includes(this.#folder)) this.#folder = '';
    const folderCards = allCards.filter(
      (card) => this.#folder.length === 0 || rawFolderName(card.path) === this.#folder,
    );
    const paths = new Set(allCards.map((card) => card.path));
    for (const path of this.#selected) if (!paths.has(path)) this.#selected.delete(path);

    this.contentEl.empty();
    this.contentEl.addClass('selfgrow-review');
    const header = this.contentEl.createDiv({ cls: 'selfgrow-review-header' });
    header.createDiv({ cls: 'selfgrow-brand', text: 'SelfGrow' });
    const navigation = header.createDiv({ cls: 'selfgrow-section-navigation' });
    const collect = navigation.createEl('button', { text: copy.collect });
    collect.addEventListener(
      'click',
      () => void this.#run(() => this.#dependencies.openInbox(), collect),
    );
    navigation.createEl('button', {
      attr: { 'aria-current': 'page' },
      cls: 'is-active',
      text: copy.review,
    });
    const folderFilter = this.contentEl.createDiv({ cls: 'selfgrow-review-folder-filter' });
    folderFilter.createEl('label', { text: copy.folderFilter });
    const folder = folderFilter.createEl('select');
    folder.createEl('option', { text: copy.allFolders, value: '' });
    for (const name of folders) folder.createEl('option', { text: name, value: name });
    folder.value = this.#folder;
    folder.addEventListener('change', () => {
      this.#folder = folder.value;
      this.#page = 0;
      this.#selected.clear();
      this.#selectionMode = false;
      void this.refresh();
    });

    const tabs = this.contentEl.createDiv({
      attr: { 'aria-label': copy.statusFilter, role: 'navigation' },
      cls: 'selfgrow-review-tabs',
    });
    for (const group of GROUPS) {
      const active = group === this.#group;
      const tab = tabs.createEl('button', {
        attr: active ? { 'aria-current': 'page' } : undefined,
        cls: active ? 'is-active' : '',
      });
      tab.createSpan({ text: copy.groups[group] });
      tab.createSpan({
        cls: 'selfgrow-review-tab-count',
        text: String(folderCards.filter((card) => rawReviewGroup(card) === group).length),
      });
      if (active) {
        window.requestAnimationFrame(() =>
          tab.scrollIntoView({ block: 'nearest', inline: 'center' }),
        );
      }
      tab.addEventListener('click', () => {
        this.#group = group;
        this.#page = 0;
        this.#selected.clear();
        this.#selectionMode = false;
        void this.refresh();
      });
    }

    if (folderCards.length === 0) {
      this.contentEl.createEl('p', { cls: 'selfgrow-review-empty', text: copy.empty });
      return;
    }

    const groupCards = folderCards.filter((card) => rawReviewGroup(card) === this.#group);
    const pageCount = Math.max(1, Math.ceil(groupCards.length / PAGE_SIZE));
    this.#page = Math.min(this.#page, pageCount - 1);
    const pageCards = groupCards.slice(this.#page * PAGE_SIZE, (this.#page + 1) * PAGE_SIZE);
    const page = this.contentEl.createDiv({ cls: 'selfgrow-review-page' });
    let updateBatch = (): void => undefined;
    if (pageCards.length === 0) {
      page.createEl('p', { cls: 'selfgrow-review-empty', text: copy.emptyGroup });
    } else {
      for (const card of pageCards) {
        this.#renderCard(page, card, language, () => updateBatch());
      }
    }

    if (pageCount > 1) {
      const pagination = this.contentEl.createDiv({
        attr: { 'aria-label': copy.pagination },
        cls: 'selfgrow-review-pagination',
      });
      const previous = pagination.createEl('button', {
        attr: { 'aria-label': copy.previousPage },
      });
      setIcon(previous, 'chevron-left');
      previous.disabled = this.#page === 0;
      pagination.createSpan({ text: copy.page(this.#page + 1, pageCount) });
      const next = pagination.createEl('button', { attr: { 'aria-label': copy.nextPage } });
      setIcon(next, 'chevron-right');
      next.disabled = this.#page === pageCount - 1;
      const changePage = (value: number): void => {
        this.#page = value;
        this.#selected.clear();
        this.#selectionMode = false;
        void this.refresh();
      };
      previous.addEventListener('click', () => changePage(this.#page - 1));
      next.addEventListener('click', () => changePage(this.#page + 1));
    }

    const batch = this.contentEl.createDiv({ cls: 'selfgrow-review-batch' });
    const count = batch.createSpan();
    const select = batch.createEl('button', { text: copy.select });
    const cancel = batch.createEl('button', { text: copy.cancelDeposit });
    const remove = batch.createEl('button', { cls: 'mod-warning', text: copy.delete });
    const done = batch.createEl('button', { text: copy.finishSelection });
    updateBatch = (): void => {
      const selectedCount = this.#selected.size;
      if (this.#selectionMode && selectedCount === 0) {
        this.#selectionMode = false;
        void this.refresh();
        return;
      }
      count.setText(copy.batchCount(selectedCount));
      select.hidden = !pageCards.some(
        (card) => this.#selected.has(card.path) && !card.wikiSelected,
      );
      cancel.hidden = !pageCards.some((card) => this.#selected.has(card.path) && card.wikiSelected);
      batch.hidden = !this.#selectionMode || selectedCount === 0;
    };
    select.addEventListener('click', () => {
      void this.#run(async () => {
        for (const card of pageCards) {
          if (this.#selected.has(card.path) && !card.wikiSelected) {
            await this.#dependencies.service.select(card.path);
          }
        }
        this.#selected.clear();
        this.#selectionMode = false;
        await this.refresh();
      }, select);
    });
    cancel.addEventListener('click', () => {
      void this.#run(async () => {
        for (const card of pageCards) {
          if (this.#selected.has(card.path) && card.wikiSelected) {
            await this.#dependencies.service.cancelSelection(card.path);
          }
        }
        this.#selected.clear();
        this.#selectionMode = false;
        await this.refresh();
      }, cancel);
    });
    done.addEventListener('click', () => {
      this.#selectionMode = false;
      this.#selected.clear();
      void this.refresh();
    });
    remove.addEventListener('click', () => {
      const selected = pageCards.filter((card) => this.#selected.has(card.path));
      if (selected.length === 0) return;
      new RawDeleteModal(this.app, language, selected.length, async () => {
        for (const card of selected) await this.#dependencies.service.deleteRaw(card.path, true);
        this.#selected.clear();
        this.#selectionMode = false;
        await this.refresh();
      }).open();
    });
    updateBatch();
  }

  #renderCard(
    container: HTMLElement,
    card: RawCardState,
    language: Language,
    updateBatch: () => void,
  ): void {
    const copy = COPY[language];
    const group = rawReviewGroup(card);
    const swipe = container.createDiv({ cls: 'selfgrow-review-swipe' });
    if (group !== 'completed') {
      swipe.createSpan({
        cls: 'selfgrow-review-swipe-select',
        text:
          group === 'needs_update'
            ? copy.swipeConfirmUpdate
            : card.wikiSelected
              ? copy.swipeCancel
              : copy.swipeSelect,
      });
    }
    swipe.createSpan({ cls: 'selfgrow-review-swipe-delete', text: copy.swipeDelete });
    const article = swipe.createEl('article', {
      cls: `selfgrow-review-card${this.#selectionMode ? ' is-selecting' : ''}${
        this.#selected.has(card.path) ? ' is-selected' : ''
      }`,
    });
    this.#bindGestures(article, card, language, updateBatch);
    if (this.#selectionMode) {
      const selectionTarget = article.createEl('label', {
        cls: 'selfgrow-review-checkbox-target',
      });
      const selection = selectionTarget.createEl('input', {
        attr: { 'aria-label': `${copy.batchSelect}: ${card.title}`, type: 'checkbox' },
        cls: 'selfgrow-review-checkbox',
      });
      selection.checked = this.#selected.has(card.path);
      selection.addEventListener('change', () => {
        if (selection.checked) this.#selected.add(card.path);
        else this.#selected.delete(card.path);
        article.toggleClass('is-selected', selection.checked);
        updateBatch();
      });
    }

    const body = article.createDiv({ cls: 'selfgrow-review-card-body' });
    const top = body.createDiv({ cls: 'selfgrow-review-card-top' });
    top.createEl('h4', { text: card.title });
    const more = top.createEl('details', { cls: 'selfgrow-review-more' });
    const moreToggle = more.createEl('summary', { attr: { 'aria-label': copy.more } });
    setIcon(moreToggle, 'ellipsis');
    const moreActions = more.createDiv();
    const toggleDeposit = moreActions.createEl('button', {
      text: card.wikiSelected ? copy.cancelDeposit : copy.select,
    });
    toggleDeposit.addEventListener('click', () => {
      more.removeAttribute('open');
      void this.#run(async () => {
        if (card.wikiSelected) await this.#dependencies.service.cancelSelection(card.path);
        else await this.#dependencies.service.select(card.path);
        await this.refresh();
      }, toggleDeposit);
    });
    const remove = moreActions.createEl('button', { cls: 'mod-warning', text: copy.delete });
    remove.addEventListener('click', () => {
      more.removeAttribute('open');
      new RawDeleteModal(this.app, language, 1, async () => {
        await this.#dependencies.service.deleteRaw(card.path, true);
        await this.refresh();
      }).open();
    });
    if (card.previewMarkdown.length > 0) {
      body.createEl('p', { cls: 'selfgrow-review-preview', text: card.previewMarkdown });
    }
    if (card.recommendation !== null) {
      const recommendation = body.createDiv({
        attr: {
          'aria-label': copy.recommendationLabel(
            card.recommendation.score,
            card.recommendation.reason,
          ),
          title: copy.preferenceVersion(card.recommendation.protocolVersion),
        },
        cls: 'selfgrow-review-recommendation',
      });
      recommendation.createEl('strong', {
        text: copy.recommendationScore(card.recommendation.score),
      });
      recommendation.createSpan({ text: card.recommendation.reason });
      if (card.recommendation.matchedInterestedKeywords.length > 0) {
        recommendation.createSpan({
          cls: 'selfgrow-review-keyword-match is-interested',
          text: copy.interestedKeywordMatches(card.recommendation.matchedInterestedKeywords),
        });
      }
      if (card.recommendation.matchedUninterestedKeywords.length > 0) {
        recommendation.createSpan({
          cls: 'selfgrow-review-keyword-match is-uninterested',
          text: copy.uninterestedKeywordMatches(card.recommendation.matchedUninterestedKeywords),
        });
      }
      if ((card.recommendation.matchedPreferenceSignals?.length ?? 0) > 0) {
        recommendation.createSpan({
          cls: 'selfgrow-review-keyword-match is-profile',
          text: copy.preferenceSignalMatches(card.recommendation.matchedPreferenceSignals ?? []),
        });
      }
    }
    if (card.imagePaths[0] !== undefined) {
      const file = this.app.vault.getAbstractFileByPath(card.imagePaths[0]);
      if (file instanceof TFile) {
        body.createEl('img', {
          attr: { alt: card.title, loading: 'lazy', src: this.app.vault.getResourcePath(file) },
          cls: 'selfgrow-review-thumbnail',
        });
      }
    }
    const meta = body.createDiv({ cls: 'selfgrow-review-meta' });
    meta.createSpan({
      cls: `selfgrow-review-state is-${rawReviewGroup(card)}`,
      text: copy.states[card.distillationStatus],
    });
    meta.createSpan({ text: sourceLabel(card, copy.direct) });
    meta.createSpan({ text: formatTime(card.modifiedAt, language) });
    if (card.wikiTargets.length > 0) {
      meta.createSpan({ text: copy.targets(card.wikiTargets.length) });
    }
  }

  #bindGestures(
    article: HTMLElement,
    card: RawCardState,
    language: Language,
    updateBatch: () => void,
  ): void {
    const group = rawReviewGroup(card);
    const swipeRightAllowed = group !== 'completed';
    let pointerId: number | undefined;
    let startX = 0;
    let startY = 0;
    let dragX = 0;
    let axis: 'horizontal' | 'vertical' | undefined;
    let longPressTimer: number | undefined;
    let longPressFired = false;
    let lastTapAt: number | undefined;

    const clearLongPress = (): void => {
      if (longPressTimer !== undefined) {
        window.clearTimeout(longPressTimer);
        longPressTimer = undefined;
      }
    };

    const reset = (): void => {
      clearLongPress();
      pointerId = undefined;
      axis = undefined;
      dragX = 0;
      longPressFired = false;
      article.removeClass('is-pressed', 'is-dragging', 'is-swiping-left', 'is-swiping-right');
      article.style.removeProperty('--selfgrow-swipe-x');
    };

    const startLongPress = (): void => {
      clearLongPress();
      longPressTimer = window.setTimeout(() => {
        longPressTimer = undefined;
        longPressFired = true;
        if (this.#selectionMode) {
          if (this.#selected.has(card.path)) this.#selected.delete(card.path);
          else this.#selected.add(card.path);
          article.toggleClass('is-selected', this.#selected.has(card.path));
          updateBatch();
        } else {
          this.#selectionMode = true;
          this.#selected.add(card.path);
          void this.refresh();
        }
      }, LONG_PRESS_MS);
    };

    article.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      if (!event.isPrimary || event.button !== 0 || isInteractiveTarget(event.target)) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      longPressFired = false;
      article.addClass('is-pressed');
      startLongPress();
    });
    article.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      event.stopPropagation();
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (axis === undefined && Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 8) {
        axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
        clearLongPress();
        lastTapAt = undefined;
        article.removeClass('is-pressed');
        if (axis === 'horizontal') article.setPointerCapture(event.pointerId);
      }
      if (axis !== 'horizontal' || this.#selectionMode) return;
      event.preventDefault();
      dragX = Math.max(-120, Math.min(swipeRightAllowed ? 120 : 0, deltaX));
      article.addClass('is-dragging');
      article.toggleClass('is-swiping-right', dragX > 0);
      article.toggleClass('is-swiping-left', dragX < 0);
      article.style.setProperty('--selfgrow-swipe-x', `${dragX}px`);
    });
    const finish = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      event.stopPropagation();
      clearLongPress();
      const firedLongPress = longPressFired;
      const action = axis === 'horizontal' && Math.abs(dragX) >= 80 ? Math.sign(dragX) : 0;
      reset();
      if (firedLongPress) return;
      if (action > 0) {
        if (group === 'needs_update') {
          void this.#run(async () => {
            await this.#dependencies.service.confirmUpdate(card.path);
            await this.refresh();
          }, article);
        } else if (card.wikiSelected) {
          void this.#run(async () => {
            await this.#dependencies.service.cancelSelection(card.path);
            await this.refresh();
          }, article);
        } else {
          void this.#run(async () => {
            await this.#dependencies.service.select(card.path);
            await this.refresh();
          }, article);
        }
      } else if (action < 0) {
        new RawDeleteModal(this.app, language, 1, async () => {
          await this.#dependencies.service.deleteRaw(card.path, true);
          await this.refresh();
        }).open();
      } else if (axis === undefined) {
        if (this.#selectionMode) {
          if (this.#selected.has(card.path)) this.#selected.delete(card.path);
          else this.#selected.add(card.path);
          article.toggleClass('is-selected', this.#selected.has(card.path));
          updateBatch();
        } else {
          const now = Date.now();
          if (lastTapAt !== undefined && now - lastTapAt <= DOUBLE_TAP_MS) {
            lastTapAt = undefined;
            void this.#run(() => this.#dependencies.service.open(card.path), article);
          } else {
            lastTapAt = now;
          }
        }
      }
    };
    article.addEventListener('pointerup', finish);
    article.addEventListener('pointercancel', reset);
    article.addEventListener('pointerleave', reset);
    const containTouch = (event: TouchEvent): void => event.stopPropagation();
    article.addEventListener('touchstart', containTouch, { passive: true });
    article.addEventListener('touchmove', containTouch, { passive: true });
    article.addEventListener('touchend', containTouch, { passive: true });
    article.addEventListener('touchcancel', containTouch, { passive: true });
  }

  async #run(action: () => Promise<void>, trigger?: HTMLElement): Promise<void> {
    if (trigger !== undefined) {
      if (trigger.instanceOf(HTMLButtonElement)) trigger.disabled = true;
      trigger.addClass('is-busy');
      trigger.setAttribute('aria-busy', 'true');
    }
    try {
      await action();
    } catch {
      new Notice(COPY[this.#dependencies.language()].actionFailed);
    } finally {
      if (trigger !== undefined) {
        if (trigger.instanceOf(HTMLButtonElement)) trigger.disabled = false;
        trigger.removeClass('is-busy');
        trigger.removeAttribute('aria-busy');
      }
    }
  }
}

class RawDeleteModal extends Modal {
  readonly #action: () => Promise<void>;
  readonly #count: number;
  readonly #language: Language;

  constructor(
    app: RawReviewView['app'],
    language: Language,
    count: number,
    action: () => Promise<void>,
  ) {
    super(app);
    this.#action = action;
    this.#count = count;
    this.#language = language;
  }

  override onOpen(): void {
    const copy = COPY[this.#language];
    this.contentEl.createEl('h2', { text: copy.deleteTitle });
    this.contentEl.createEl('p', { text: copy.deleteBody(this.#count) });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(copy.keep).onClick(() => this.close()))
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

function sourceLabel(card: RawCardState, direct: string): string {
  if (card.sourceURL.startsWith('selfgrow:text:')) return direct;
  try {
    return new URL(card.sourceURL).hostname;
  } catch {
    return card.platform || direct;
  }
}

function formatTime(value: string, language: Language): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
    timestamp,
  );
}

const COPY = {
  en: {
    actionFailed: 'The Raw action failed.',
    allFolders: 'All folders',
    batchCount: (count: number) => `${count} selected`,
    batchSelect: 'Select Raw card',
    cancelDeposit: 'Deselect',
    collect: 'Collect',
    delete: 'Delete',
    deleteBody: (count: number) =>
      `Permanently delete ${count} Raw card(s)? Existing Wiki knowledge remains.`,
    deleteTitle: 'Delete Raw?',
    direct: 'Direct capture',
    empty: 'No Raw cards yet.',
    emptyGroup: 'No Raw cards in this state.',
    finishSelection: 'Done',
    folderFilter: 'Raw folder',
    groups: {
      completed: 'Distilled',
      failed: 'Failed',
      needs_update: 'Updated',
      queued: 'Awaiting distillation',
      unselected: 'Unselected',
    },
    interestedKeywordMatches: (keywords: readonly string[]) => `Interested: ${keywords.join(', ')}`,
    keep: 'Keep',
    more: 'More actions',
    nextPage: 'Next page',
    page: (current: number, total: number) => `${current} / ${total}`,
    pagination: 'Raw card pages',
    previousPage: 'Previous page',
    preferenceVersion: (version: string) => `Preference protocol ${version}`,
    preferenceSignalMatches: (signals: readonly string[]) => `Profile: ${signals.join(', ')}`,
    recommendationLabel: (score: number, reason: string) =>
      `Advisory relevance ${score} out of 100. ${reason}`,
    recommendationScore: (score: number) => `Fit ${score}`,
    review: 'Review',
    select: 'Select for distillation',
    states: {
      completed: '✓ Distilled',
      failed: '! Distillation failed',
      needs_update: '↻ Updated; confirmation required',
      not_started: '○ Unselected',
      processing: '… Agent processing',
      queued: '✓ Selected; awaiting agent',
    },
    swipeCancel: 'Swipe right to deselect',
    swipeConfirmUpdate: 'Swipe right to confirm update',
    swipeDelete: 'Swipe left to delete',
    swipeSelect: 'Swipe right to select',
    statusFilter: 'Raw status',
    targets: (count: number) => `${count} Wiki target(s)`,
    uninterestedKeywordMatches: (keywords: readonly string[]) =>
      `Not interested: ${keywords.join(', ')}`,
  },
  'zh-CN': {
    actionFailed: 'Raw 操作失败。',
    allFolders: '全部文件夹',
    batchCount: (count: number) => `已勾选 ${count} 条`,
    batchSelect: '勾选 Raw 卡片',
    cancelDeposit: '取消沉淀',
    collect: '收集',
    delete: '删除',
    deleteBody: (count: number) => `永久删除 ${count} 张 Raw 卡片？已经沉淀的 Wiki 知识不会删除。`,
    deleteTitle: '删除 Raw？',
    direct: '直接收集',
    empty: '还没有 Raw 卡片。',
    emptyGroup: '这个状态下还没有 Raw 卡片。',
    finishSelection: '完成',
    folderFilter: 'Raw 文件夹',
    groups: {
      completed: '已沉淀',
      failed: '失败',
      needs_update: '更新',
      queued: '待沉淀',
      unselected: '未选择',
    },
    interestedKeywordMatches: (keywords: readonly string[]) => `命中兴趣：${keywords.join('、')}`,
    keep: '保留',
    more: '更多操作',
    nextPage: '下一页',
    page: (current: number, total: number) => `${current} / ${total}`,
    pagination: 'Raw 卡片分页',
    previousPage: '上一页',
    preferenceVersion: (version: string) => `偏好协议 ${version}`,
    preferenceSignalMatches: (signals: readonly string[]) => `协议命中：${signals.join('、')}`,
    recommendationLabel: (score: number, reason: string) => `参考推荐度 ${score} 分。${reason}`,
    recommendationScore: (score: number) => `推荐度 ${score}`,
    review: '筛选',
    select: '选择沉淀',
    states: {
      completed: '✓ 已沉淀',
      failed: '! 沉淀失败',
      needs_update: '↻ 内容已更新，需要确认',
      not_started: '○ 未选择',
      processing: '… 智能体处理中',
      queued: '✓ 已选择，等待智能体',
    },
    swipeCancel: '右滑取消沉淀',
    swipeConfirmUpdate: '右滑确认更新',
    swipeDelete: '左滑删除',
    swipeSelect: '右滑选择沉淀',
    statusFilter: 'Raw 状态',
    targets: (count: number) => `关联 ${count} 个 Wiki 页面`,
    uninterestedKeywordMatches: (keywords: readonly string[]) =>
      `命中非兴趣：${keywords.join('、')}`,
  },
} as const;

function rawFolderName(path: VaultPath): string {
  const segments = path.split('/');
  return segments[segments.length - 2] ?? '';
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('button, a, label, summary, input, select, textarea') !== null
  );
}
