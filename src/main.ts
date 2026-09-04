import { loadPdfJs, MarkdownView, Notice, Platform, Plugin, TFile, TFolder } from 'obsidian';
import { ChatConnectionService, ModelCatalogService, type ModelCatalogEntry } from './ai';
import { SelfGrowError, selfGrowID, vaultPath, type RawCategory, type VaultPath } from './domain';
import {
  CapturedTextAndGenericExtractor,
  ConfiguredPlatformProvider,
  ExtractionCapabilityService,
  LinkSupplementExtractor,
  LocalDocumentExtractor,
  OpenAIVisionOCRService,
  PriorityPlatformExtractor,
  type PDFJSLike,
} from './extraction';
import { createObsidianArticleDocumentProcessor } from './extraction/obsidian-article-document-processor';
import {
  GitHubRepositoryExtractor,
  fetchGitHubRepositoryMeta,
  parseGitHubRepository,
  resolveGitHubName,
  type GitHubNameResolution,
} from './github';
import {
  analyzeManualCapture,
  captureTokenAt,
  InboxOperationalService,
  InboxReconciler,
  isSupportedCaptureDocumentName,
  looksLikeGitHubName,
} from './inbox';
import {
  InboxView,
  INBOX_VIEW_TYPE,
  type ManualCaptureInput,
  type RecognitionSuggestion,
} from './inbox/inbox-view';
import {
  CanonicalKnowledgeNoteCommitter,
  ensureRawCategoryFolders,
  RawEvidenceGenerator,
  deriveDirectMaterialTitle,
  initializeWikiSchema,
  knowledgeNoteFileName,
  rawContentHash,
  RawCardService,
  scanRawFolders,
  serializeDirectMaterialNote,
  URLNoteIndex,
} from './knowledge';
import { showRawScanReport } from './knowledge/raw-scan-modal';
import { RawReviewView, RAW_REVIEW_VIEW_TYPE } from './knowledge/raw-review-view';
import { ObsidianHTTPTransport } from './platform/obsidian-http-transport';
import { ObsidianSecretResolver } from './platform/obsidian-secret-resolver';
import {
  ObsidianFrontmatterAdapter,
  ObsidianVaultAdapter,
} from './platform/obsidian-vault-adapter';
import type { TemporalContext } from './platform/ports';
import { ForegroundProcessingCoordinator } from './processing';
import {
  createDefaultSettings,
  loadSettings,
  markConnectionTested,
  markExtractionTested,
  PreferenceProfileStore,
  preferenceProfileHasSignals,
  preferenceProfilePath,
  serializeSettings,
  type PreferenceKeywordSettings,
  type PreferenceProfile,
  type PreferenceProfileStatus,
  type SelfGrowSettings,
} from './settings';
import { SelfGrowSettingTab, type SelfGrowSettingsHost } from './settings/selfgrow-setting-tab';
import { URLService } from './url';
import { normalizeObsidianPath } from './vault/obsidian-path-normalizer';
import { PathGuard, resolveSelfGrowRootPath } from './vault';

export default class SelfGrowPlugin extends Plugin implements SelfGrowSettingsHost {
  #coordinator: ForegroundProcessingCoordinator | null = null;
  #draining = false;
  #inbox: InboxOperationalService | null = null;
  #manualCaptureInProgress = false;
  #manualCaptureSubmitter: ((input: ManualCaptureInput) => Promise<void>) | null = null;
  #rawCards: RawCardService | null = null;
  #recognitionGenerator: RawEvidenceGenerator | null = null;
  #settings: SelfGrowSettings = createDefaultSettings();
  #stopped = false;

  override async onload(): Promise<void> {
    const stored = (await this.loadData()) as unknown;
    const storedSettings =
      typeof stored === 'object' && stored !== null && 'settings' in stored
        ? stored.settings
        : stored;
    this.#settings = loadSettings(storedSettings);
    await this.#persistData();
    this.addSettingTab(new SelfGrowSettingTab(this.app, this));
    this.registerView(
      INBOX_VIEW_TYPE,
      (leaf) =>
        new InboxView(leaf, {
          language: () => this.#settings.language,
          openReview: () => this.#openReview(),
          service: {
            createFolder: (name) => this.#createCollectionFolder(name),
            documentAIRecipient: () => ({
              model: this.#settings.chat.model,
              provider: this.#settings.chat.preset,
            }),
            listFolders: () => this.#collectionFolders(),
            list: (language) => this.#inbox?.list(language) ?? Promise.resolve([]),
            permanentlyDelete: (id) => this.#requireInbox().permanentlyDelete(id),
            resolveGitHubName: (name, category) => this.#resolveGitHubName(name, category),
            retry: (id) => this.#retry(id),
            submitCapture: (input) => this.#submitCapture(input),
            suggestRecognition: (input) => this.#suggestRecognition(input),
          },
        }),
    );
    this.registerView(
      RAW_REVIEW_VIEW_TYPE,
      (leaf) =>
        new RawReviewView(leaf, {
          language: () => this.#settings.language,
          openInbox: () => this.#openInbox(),
          service: {
            cancelSelection: async (path) => {
              await this.#requireRawCards().cancelSelection(path);
            },
            confirmUpdate: async (path) => {
              await this.#requireRawCards().confirmUpdate(path);
            },
            deleteRaw: (path, confirmed) => this.#requireRawCards().deleteRaw(path, confirmed),
            listFolders: () => this.#collectionFolders(),
            list: () => this.#rawCards?.list() ?? Promise.resolve([]),
            open: (path) => this.#openKnowledgeNote(path),
            select: async (path) => {
              await this.#requireRawCards().select(path);
            },
          },
        }),
    );
    this.addCommand({
      callback: () => {
        void this.#openInbox();
      },
      id: 'open-inbox',
      name: 'Open queue',
    });
    this.addCommand({
      callback: () => {
        void this.#openReview();
      },
      id: 'open-review',
      name: 'Open knowledge review / 打开知识筛选',
    });
    this.addCommand({
      callback: () => {
        void this.#scanRawFolders();
      },
      id: 'scan-raw-folders',
      name: 'Scan raw folders / 扫描 raw 目录',
    });
    this.addRibbonIcon('list-checks', 'Open knowledge review / 打开知识筛选', () => {
      void this.#openReview();
    });
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFile && this.#isCreatedIngressPath(file.path)) void this.#drain();
        if (file instanceof TFile && this.#isRawPath(file.path)) void this.#refreshReviewView();
      }),
    );
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && this.#isQueuePath(file.path)) void this.#drain();
        if (file instanceof TFile && this.#isRawPath(file.path)) {
          void this.#rawCards
            ?.recompute(file.path as VaultPath)
            .then(() => this.#refreshReviewView())
            .catch(() => undefined);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile && this.#isRawPath(file.path)) void this.#refreshReviewView();
      }),
    );
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => this.#refreshInternalPresentation()),
    );
    this.registerEvent(
      this.app.workspace.on('layout-change', () => this.#refreshInternalPresentation()),
    );
    this.app.workspace.onLayoutReady(() => {
      void this.#initializeReadyWorkspace();
    });
  }

  override onunload(): void {
    this.#stopped = true;
    this.app.workspace.iterateAllLeaves((leaf) => {
      leaf.view.containerEl.removeClass('selfgrow-internal-view');
      leaf.view.containerEl.removeClass('selfgrow-knowledge-view');
    });
  }

  getSelfGrowSettings(): SelfGrowSettings {
    return this.#settings;
  }

  async getPreferenceProfileStatus(): Promise<PreferenceProfileStatus> {
    return (await this.#loadPreferenceProfile()).status;
  }

  async openPreferenceProfile(): Promise<void> {
    const path = preferenceProfilePath(this.#settings.rootPath);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(
        this.#settings.language === 'zh-CN'
          ? `尚未找到偏好协议：${path}`
          : `Preference profile not found: ${path}`,
      );
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  async listChatModels(): Promise<ModelCatalogEntry[]> {
    return new ModelCatalogService({
      configuration: () => this.#settings.chat,
      http: new ObsidianHTTPTransport(),
      secretResolver: new ObsidianSecretResolver(this.app.secretStorage),
    }).list(this.#settings.language);
  }

  async ensureRawFolder(path: string): Promise<void> {
    const normalized = normalizeObsidianPath(path.trim());
    if (normalized.length === 0 || normalized === '.' || normalized.includes('..')) {
      throw new SelfGrowError('TOPIC_PATH_INVALID', 'The Raw folder path is invalid.');
    }
    const vault = new ObsidianVaultAdapter(this.app.vault, this.app.fileManager);
    await ensureFolders(vault, [vaultPath(normalized)]);
    await this.updateSelfGrowSettings((settings) => ({ ...settings, rootPath: normalized }));
  }

  async updateSelfGrowSettings(
    update: (current: SelfGrowSettings) => SelfGrowSettings,
  ): Promise<void> {
    this.#settings = serializeSettings(update(this.#settings));
    await this.#persistData();
    this.#refreshInternalPresentation();
  }

  async savePreferenceKeywords(keywords: PreferenceKeywordSettings): Promise<void> {
    const store = this.#preferenceProfileStore();
    const current = await store.load();
    if (current.status.state === 'invalid') {
      throw new SelfGrowError(
        'OBSIDIAN_API_FAILED',
        'The existing preference profile is invalid and was not overwritten.',
      );
    }
    await this.updateSelfGrowSettings((settings) => ({
      ...settings,
      preferenceKeywords: keywords,
      preferenceProfileEnabled: true,
    }));
    await store.syncKeywords(keywords, this.#settings.language);
  }

  async testChatConnection(): Promise<void> {
    const result = await this.#chatConnection().testChat(this.#settings.chat);
    await this.updateSelfGrowSettings((settings) => ({
      ...settings,
      chat: markConnectionTested(settings.chat, result),
    }));
  }

  async testExtractionConnection(): Promise<void> {
    const extraction = this.#settings.extraction;
    if (extraction === null) return;
    const result = await new ExtractionCapabilityService({
      clock: new DeviceTemporalContext(),
      http: new ObsidianHTTPTransport(),
      secretResolver: new ObsidianSecretResolver(this.app.secretStorage),
    }).test(extraction);
    await this.updateSelfGrowSettings((settings) =>
      markExtractionTested(settings, {
        capabilities: result.capabilities,
        testedAt: result.testedAt,
      }),
    );
  }

  async #initializeReadyWorkspace(): Promise<void> {
    try {
      await this.#migrateLegacyRoot();
      const clock = new DeviceTemporalContext();
      const vault = new ObsidianVaultAdapter(this.app.vault, this.app.fileManager);
      const rootPath = this.#resolveRootPath();
      if (rootPath !== this.#settings.rootPath) {
        await this.updateSelfGrowSettings((settings) => ({ ...settings, rootPath }));
      }
      const pathGuard = new PathGuard(rootPath, normalizeObsidianPath);
      const wikiPathGuard = new PathGuard(siblingWikiRoot(rootPath), normalizeObsidianPath);
      const frontmatter = new ObsidianFrontmatterAdapter(this.app.vault, this.app.fileManager);
      await ensureFolders(vault, [
        pathGuard.rootPath,
        pathGuard.join('Inbox'),
        pathGuard.join('Inbox', 'Attachments'),
        pathGuard.join('Attachments'),
      ]);
      await ensureRawCategoryFolders(vault, pathGuard.rootPath);
      const queuePath = siblingQueuePath(rootPath);
      if (!(await vault.exists(queuePath))) await vault.create(queuePath, '# SelfGrow\n');
      await initializeWikiSchema(vault, wikiPathGuard, !Platform.isMobile);
      const http = new ObsidianHTTPTransport();
      try {
        await this.#preferenceProfileStore(vault, clock).syncKeywords(
          this.#settings.preferenceKeywords,
          this.#settings.language,
        );
      } catch {
        new Notice(
          this.#settings.language === 'zh-CN'
            ? '偏好协议未能同步关键词；原协议未被覆盖。'
            : 'The preference profile could not synchronize keywords; the existing profile was preserved.',
        );
      }
      const urls = new URLService(http);
      const index = new URLNoteIndex(vault, frontmatter, pathGuard);
      await index.rebuild();
      this.#rawCards = new RawCardService({
        frontmatter,
        onDeleted: async (path) => {
          index.removePath(path);
        },
        pathGuard,
        vault,
        wikiPathGuard,
      });
      await this.#rawCards.migrateAll();
      const reconciler = new InboxReconciler({
        clock,
        frontmatter,
        idFactory: { next: () => selfGrowID(crypto.randomUUID()) },
        knowledgeURLs: index,
        pathGuard,
        urls,
        vault,
      });
      this.#inbox = new InboxOperationalService({
        frontmatter,
        onCompleted: async (path) => {
          this.#showInboxCompleted(path);
          await this.#openKnowledgeNote(path);
        },
        onStateChanged: () => this.#refreshInboxView(),
        pathGuard,
        reconciler,
        vault,
      });
      const secretResolver = new ObsidianSecretResolver(this.app.secretStorage);
      const ocr = new OpenAIVisionOCRService({
        configuration: () => this.#settings.chat,
        http,
        images: {
          read: async (rawPath) => {
            const path = pathGuard.assertDescendant(rawPath);
            if (!path.startsWith(`${pathGuard.join('Inbox', 'Attachments')}/`)) {
              throw new Error('Capture image is outside Inbox attachments.');
            }
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) throw new Error('Capture image does not exist.');
            return {
              bytes: new Uint8Array(await this.app.vault.readBinary(file)),
              mimeType: imageMimeType(file.extension),
            };
          },
        },
        preferenceProfile: () => this.#activePreferenceProfile(),
        secretResolver,
      });
      const notes = new CanonicalKnowledgeNoteCommitter({
        clock,
        frontmatter,
        index: {
          indexNote: async (path) => {
            await index.indexNote(path);
          },
        },
        pathGuard,
        vault,
      });
      const platformProvider = new ConfiguredPlatformProvider({
        configuration: () => this.#settings.extraction,
        http,
        secretResolver,
      });
      const githubExtractor = new GitHubRepositoryExtractor(http);
      const linkExtractor = new CapturedTextAndGenericExtractor(
        http,
        createObsidianArticleDocumentProcessor(),
        new PriorityPlatformExtractor(http, platformProvider),
        githubExtractor,
      );
      this.#recognitionGenerator = new RawEvidenceGenerator({
        configuration: () => this.#settings.chat,
        http,
        preferenceProfile: () => this.#activePreferenceProfile(),
        secretResolver,
      });
      this.#coordinator = new ForegroundProcessingCoordinator({
        extractor: new LocalDocumentExtractor(
          new LinkSupplementExtractor(linkExtractor, ocr),
          {
            readBinary: async (rawPath) => {
              const file = inboxAttachmentFile(this.app, pathGuard, rawPath);
              return new Uint8Array(await this.app.vault.readBinary(file));
            },
            readText: async (rawPath) => {
              const file = inboxAttachmentFile(this.app, pathGuard, rawPath);
              return this.app.vault.read(file);
            },
          },
          async () => (await loadPdfJs()) as PDFJSLike,
        ),
        generator: this.#recognitionGenerator,
        inbox: this.#inbox,
        language: this.#settings.language,
        notes,
        urls,
      });
      this.#manualCaptureSubmitter = (input) =>
        this.#createManualCapture(input, { clock, frontmatter, pathGuard, urls, vault });

      this.#refreshInternalPresentation();
      await this.#drain();
    } catch {
      new Notice(
        this.#settings.language === 'zh-CN'
          ? 'SelfGrow 初始化未完成，请检查 Inbox 和设置。'
          : 'SelfGrow initialization did not finish. Check Inbox and settings.',
      );
    }
  }

  async #migrateLegacyRoot(): Promise<void> {
    const configured = normalizeObsidianPath(this.#settings.rootPath);
    const segments = configured.split('/');
    if (segments.pop() !== 'SelfGrow') return;
    const target = [...segments, 'Raw'].join('/');
    const sourceFolder = this.app.vault.getAbstractFileByPath(configured);
    const targetEntry = this.app.vault.getAbstractFileByPath(target);
    if (sourceFolder instanceof TFolder && targetEntry === null) {
      await this.app.fileManager.renameFile(sourceFolder, target);
    } else if (sourceFolder instanceof TFolder && targetEntry !== null) {
      throw new SelfGrowError('TOPIC_PATH_INVALID', 'Both legacy SelfGrow and Raw folders exist.');
    }
    const legacyQueue = this.app.vault.getAbstractFileByPath(`${target}/Inbox Queue.md`);
    const queuePath = siblingQueuePath(target);
    if (legacyQueue instanceof TFile && this.app.vault.getAbstractFileByPath(queuePath) === null) {
      await this.app.fileManager.renameFile(legacyQueue, queuePath);
    }
    await this.updateSelfGrowSettings((settings) => ({ ...settings, rootPath: target }));
  }

  async #activePreferenceProfile(): Promise<PreferenceProfile | null> {
    if (!this.#settings.preferenceProfileEnabled) return null;
    const profile = (await this.#loadPreferenceProfile()).profile;
    return profile !== null && preferenceProfileHasSignals(profile) ? profile : null;
  }

  async #loadPreferenceProfile(): Promise<{
    profile: PreferenceProfile | null;
    status: PreferenceProfileStatus;
  }> {
    return this.#preferenceProfileStore().load();
  }

  #preferenceProfileStore(
    vault: ObsidianVaultAdapter = new ObsidianVaultAdapter(this.app.vault, this.app.fileManager),
    clock: TemporalContext = new DeviceTemporalContext(),
  ): PreferenceProfileStore {
    return new PreferenceProfileStore({
      clock,
      rawRoot: this.#settings.rootPath,
      vault,
    });
  }

  async #retry(id: Parameters<InboxOperationalService['retry']>[0]): Promise<void> {
    await this.#requireInbox().retry(id);
    await this.#refreshInboxView();
    void this.#drain();
  }

  async #drain(): Promise<void> {
    if (this.#draining || this.#coordinator === null || this.#manualCaptureInProgress) return;
    this.#draining = true;
    try {
      while (!this.#stopped) {
        const result = await this.#coordinator.processNext();
        if (result.kind !== 'processed') break;
      }
      await this.#refreshInboxView();
    } finally {
      this.#draining = false;
    }
  }

  #chatConnection(): ChatConnectionService {
    return new ChatConnectionService({
      clock: new DeviceTemporalContext(),
      http: new ObsidianHTTPTransport(),
      language: this.#settings.language,
      secretResolver: new ObsidianSecretResolver(this.app.secretStorage),
    });
  }

  #requireInbox(): InboxOperationalService {
    if (this.#inbox === null) throw new Error('SelfGrow Inbox is not ready.');
    return this.#inbox;
  }

  #requireRawCards(): RawCardService {
    if (this.#rawCards === null) throw new Error('SelfGrow Review is not ready.');
    return this.#rawCards;
  }

  async #scanRawFolders(): Promise<void> {
    try {
      const report = await scanRawFolders(await this.#requireRawCards().list());
      showRawScanReport(this.app, report, this.#settings.language);
    } catch {
      new Notice(this.#settings.language === 'zh-CN' ? 'Raw 扫描失败。' : 'The Raw scan failed.');
    }
  }

  async #resolveGitHubName(name: string, category: RawCategory): Promise<GitHubNameResolution> {
    return resolveGitHubName(new ObsidianHTTPTransport(), name, category);
  }

  async #suggestRecognition(input: {
    note: string;
    title: string;
    url: string;
  }): Promise<RecognitionSuggestion | null> {
    const analysis = analyzeManualCapture({
      imageCount: 0,
      note: input.note,
      shareText: input.url,
    });
    if (analysis.sourceURL !== null) {
      const ref = parseGitHubRepository(analysis.sourceURL);
      if (ref !== null) return this.#githubSuggestion(ref);
    }
    if (analysis.sourceURL === null && looksLikeGitHubName(input.url.trim())) return null;
    const material = analysis.materialText.trim();
    if (material.length < 20 || this.#recognitionGenerator === null) return null;
    const result = await this.#recognitionGenerator.recognizeRaw(
      material,
      this.#settings.language,
      input.title || undefined,
    );
    return {
      category: result.card.category,
      fallback: result.source === 'local',
      githubQueries: result.card.githubQueries,
      preview: result.card.preview,
      title: result.card.title,
    };
  }

  async #githubSuggestion(ref: {
    owner: string;
    repo: string;
  }): Promise<RecognitionSuggestion | null> {
    const meta = await fetchGitHubRepositoryMeta(new ObsidianHTTPTransport(), ref);
    const description = meta?.description ?? '';
    const category: RawCategory = /skill|agent|prompt|workflow|capabilit/i.test(description)
      ? 'Skill'
      : 'Project';
    return {
      category,
      fallback: false,
      githubQueries: [`${ref.owner}/${ref.repo}`],
      preview: description.slice(0, 140),
      title: ref.repo,
    };
  }

  #collectionFolders(): Promise<readonly string[]> {
    const root = normalizeObsidianPath(this.#settings.rootPath);
    const folder = this.app.vault.getAbstractFileByPath(root);
    if (!(folder instanceof TFolder)) return Promise.resolve(['Project', 'Skill', 'Experience']);
    return Promise.resolve(
      folder.children
        .filter(
          (entry): entry is TFolder =>
            entry instanceof TFolder && entry.name !== 'Inbox' && entry.name !== 'Attachments',
        )
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right)),
    );
  }

  async #createCollectionFolder(value: string): Promise<string> {
    const name = normalizeCollectionFolderName(value);
    const root = normalizeObsidianPath(this.#settings.rootPath);
    const path = vaultPath(`${root}/${name}`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile)
      throw new SelfGrowError('TOPIC_PATH_INVALID', 'Folder name is invalid.');
    if (!(existing instanceof TFolder)) await this.app.vault.createFolder(path);
    return name;
  }

  async #submitCapture(input: ManualCaptureInput): Promise<void> {
    if (this.#manualCaptureSubmitter === null) throw new Error('SelfGrow capture is not ready.');
    await this.#manualCaptureSubmitter(input);
    await this.#refreshInboxView();
    void this.#drain();
  }

  async #createManualCapture(
    input: ManualCaptureInput,
    dependencies: {
      clock: DeviceTemporalContext;
      frontmatter: ObsidianFrontmatterAdapter;
      pathGuard: PathGuard;
      urls: URLService;
      vault: ObsidianVaultAdapter;
    },
  ): Promise<void> {
    if (
      input.note.length > 50_000 ||
      input.files.length > 20 ||
      input.files.reduce((total, file) => total + file.size, 0) > 100_000_000
    ) {
      throw new Error('Capture input is too large.');
    }
    const analysis = analyzeManualCapture({
      documentCount: input.files.filter((file) => isSupportedCaptureDocumentName(file.name)).length,
      imageCount: input.files.filter((file) => file.type.startsWith('image/')).length,
      note: input.note,
      shareText: input.url,
    });
    if (input.url.trim().length > 0 && analysis.sourceURL === null) {
      throw new SelfGrowError('INVALID_URL', 'The link field does not contain a valid URL.');
    }
    const collectionFolder = normalizeCollectionFolderName(input.folder);
    const collectionPath = dependencies.pathGuard.join(collectionFolder);
    if (!(await dependencies.vault.exists(collectionPath))) {
      await dependencies.vault.createFolder(collectionPath);
    }
    if (
      analysis.sourceURL === null &&
      analysis.materialText.length === 0 &&
      input.files.length === 0
    ) {
      throw new Error('Capture content is empty.');
    }
    const hasSupportedDocuments = input.files.some((file) =>
      isSupportedCaptureDocumentName(file.name),
    );
    if (hasSupportedDocuments && input.documentAIConsent !== 'summarize') {
      await this.#createDirectMaterialDocument(input, dependencies);
      return;
    }
    const routedInput: ManualCaptureInput = {
      ...input,
      note: analysis.materialText,
      url: analysis.sourceURL ?? '',
    };
    if (analysis.route === 'direct') {
      await this.#createDirectMaterialDocument(routedInput, dependencies);
      return;
    }
    const id = selfGrowID(crypto.randomUUID());
    const idToken = id.replaceAll('-', '');
    const sourceURL = analysis.sourceURL ?? `selfgrow:text:${idToken}`;
    const normalized =
      analysis.sourceURL === null
        ? { normalized: sourceURL, platform: 'unknown' as const }
        : await dependencies.urls.normalize(sourceURL);
    const importedAt = dependencies.clock.now();
    const token = captureTokenAt(importedAt, dependencies.clock.timeZone());
    const capturePath = dependencies.pathGuard.join('Inbox', `${token}-${idToken}.md`);
    const attachmentPaths: VaultPath[] = [];
    const imagePaths: VaultPath[] = [];
    this.#manualCaptureInProgress = true;
    try {
      for (const [index, file] of input.files.entries()) {
        if (file.size <= 0 || file.size > 25_000_000) {
          throw new Error('Capture attachment is invalid.');
        }
        const path = dependencies.pathGuard.join(
          'Inbox',
          'Attachments',
          attachmentFileName(idToken, index, file),
        );
        await this.app.vault.createBinary(path, await file.arrayBuffer());
        attachmentPaths.push(path);
        if (file.type.startsWith('image/')) imagePaths.push(path);
      }
      const attachmentMarkdown = attachmentPaths.map((path) => `![[${path}]]`).join('\n');
      const captureTitle = deriveDirectMaterialTitle({
        explicitTitle: input.title,
        fileNames: input.files.map((file) => file.name),
        note: analysis.materialText,
        sourceURL,
      });
      const body = [analysis.materialText, attachmentMarkdown, analysis.sourceURL]
        .filter(Boolean)
        .join('\n\n');
      await dependencies.vault.create(capturePath, `${body}\n`);
      await dependencies.frontmatter.process(capturePath, (current) => ({
        ...current,
        capture_attachments: attachmentPaths,
        ...(hasSupportedDocuments ? { capture_document_ai_authorized: true } : {}),
        capture_folder: collectionFolder,
        capture_images: imagePaths,
        capture_method: 'shared_text',
        capture_note: analysis.materialText,
        capture_title: captureTitle,
        cssclasses: 'selfgrow-internal',
        imported_at: importedAt.toISOString(),
        normalized_url: normalized.normalized,
        selfgrow_capture: true,
        selfgrow_id: id,
        source_platform: normalized.platform,
        source_url: sourceURL,
        status: 'queued',
      }));
    } catch (error) {
      for (const path of attachmentPaths) {
        if (await dependencies.vault.exists(path)) await dependencies.vault.delete(path);
      }
      if (await dependencies.vault.exists(capturePath))
        await dependencies.vault.delete(capturePath);
      throw error;
    } finally {
      this.#manualCaptureInProgress = false;
    }
  }

  async #createDirectMaterialDocument(
    input: ManualCaptureInput,
    dependencies: {
      clock: DeviceTemporalContext;
      frontmatter: ObsidianFrontmatterAdapter;
      pathGuard: PathGuard;
      urls: URLService;
      vault: ObsidianVaultAdapter;
    },
  ): Promise<void> {
    const id = selfGrowID(crypto.randomUUID());
    const idToken = id.replaceAll('-', '');
    const sourceURL = input.url.trim().length > 0 ? input.url.trim() : `selfgrow:text:${idToken}`;
    const normalized =
      input.url.trim().length > 0
        ? await dependencies.urls.normalize(sourceURL)
        : { normalized: sourceURL, platform: 'unknown' as const };
    const title = deriveDirectMaterialTitle({
      explicitTitle: input.title,
      fileNames: input.files.map((file) => file.name),
      note: input.note,
      sourceURL,
    });
    const collectionFolder = normalizeCollectionFolderName(input.folder);
    const collectionPath = dependencies.pathGuard.join(collectionFolder);
    if (!(await dependencies.vault.exists(collectionPath))) {
      await dependencies.vault.createFolder(collectionPath);
    }
    const notePath = dependencies.pathGuard.join(collectionFolder, knowledgeNoteFileName(title));
    if (await dependencies.vault.exists(notePath)) {
      throw new SelfGrowError(
        'KNOWLEDGE_NOTE_INVALID',
        'A Knowledge document with this title already exists.',
      );
    }

    const attachmentPaths: VaultPath[] = [];
    this.#manualCaptureInProgress = true;
    try {
      for (const [index, file] of input.files.entries()) {
        if (file.size <= 0 || file.size > 25_000_000) {
          throw new Error('Capture attachment is invalid.');
        }
        const path = dependencies.pathGuard.join(
          'Attachments',
          attachmentFileName(idToken, index, file),
        );
        await this.app.vault.createBinary(path, await file.arrayBuffer());
        attachmentPaths.push(path);
      }
      const markdown = serializeDirectMaterialNote({
        attachmentPaths,
        note: input.note,
        sourceURL,
        title,
      });
      await dependencies.vault.create(notePath, markdown);
      const contentHash = await rawContentHash(markdown);
      await dependencies.frontmatter.process(notePath, (current) => ({
        ...current,
        capture_method: 'shared_text',
        content_hash: contentHash,
        distillation_approved_hash: null,
        distillation_error: null,
        distillation_status: 'not_started',
        distilled_at: null,
        distilled_hash: null,
        imported_at: dependencies.clock.now().toISOString(),
        normalized_url: normalized.normalized,
        selfgrow: true,
        selfgrow_category: collectionFolder,
        selfgrow_id: id,
        selfgrow_layer: 'raw',
        selfgrow_material: true,
        selfgrow_schema: 2,
        source_platform: normalized.platform,
        source_url: sourceURL,
        status: 'completed',
        wiki_selected: false,
        wiki_targets: [],
      }));
      this.#showInboxCompleted(notePath);
      await this.#openKnowledgeNote(notePath);
    } catch (error) {
      if (await dependencies.vault.exists(notePath)) await dependencies.vault.delete(notePath);
      for (const path of attachmentPaths) {
        if (await dependencies.vault.exists(path)) await dependencies.vault.delete(path);
      }
      throw error;
    } finally {
      this.#manualCaptureInProgress = false;
    }
  }

  async #persistData(): Promise<void> {
    await this.saveData(this.#settings);
  }

  #resolveRootPath(): string {
    return resolveSelfGrowRootPath(
      this.#settings.rootPath,
      this.app.vault
        .getRoot()
        .children.filter((entry): entry is TFolder => entry instanceof TFolder)
        .map((folder) => folder.path),
      (path) => this.app.vault.getAbstractFileByPath(path) instanceof TFolder,
      normalizeObsidianPath,
    );
  }

  async #openInbox(): Promise<void> {
    await this.#openSelfGrowView(INBOX_VIEW_TYPE);
  }

  async #openReview(): Promise<void> {
    await this.#openSelfGrowView(RAW_REVIEW_VIEW_TYPE);
  }

  async #openSelfGrowView(
    type: typeof INBOX_VIEW_TYPE | typeof RAW_REVIEW_VIEW_TYPE,
  ): Promise<void> {
    const leaves = [
      ...this.app.workspace.getLeavesOfType(INBOX_VIEW_TYPE),
      ...this.app.workspace.getLeavesOfType(RAW_REVIEW_VIEW_TYPE),
    ];
    const leaf =
      this.app.workspace.getLeavesOfType(type)[0] ?? leaves[0] ?? this.app.workspace.getLeaf(true);
    await leaf.setViewState({ active: true, type });
    for (const duplicate of leaves) {
      if (duplicate !== leaf) duplicate.detach();
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  async #openKnowledgeNote(path: VaultPath): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  async #refreshInboxView(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(INBOX_VIEW_TYPE)) {
      if (!(leaf.view instanceof InboxView)) continue;
      try {
        await leaf.view.refresh();
      } catch {
        // A presentation refresh must not turn a durable capture into a failed action.
      }
    }
  }

  async #refreshReviewView(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(RAW_REVIEW_VIEW_TYPE)) {
      if (!(leaf.view instanceof RawReviewView)) continue;
      try {
        await leaf.view.refresh();
      } catch {
        // Review rendering never changes durable Raw state.
      }
    }
  }

  #showInboxCompleted(path: VaultPath): void {
    const segments = path.split('/');
    const label = segments[segments.length - 1]?.replace(/\.md$/i, '') ?? path;
    for (const leaf of this.app.workspace.getLeavesOfType(INBOX_VIEW_TYPE)) {
      if (leaf.view instanceof InboxView) leaf.view.showCompleted(label);
    }
  }

  #refreshInternalPresentation(): void {
    const inboxPrefix = `${normalizeObsidianPath(this.#settings.rootPath)}/Inbox/`;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      const queueNote =
        view instanceof MarkdownView && view.file !== null && this.#isQueuePath(view.file.path);
      if (queueNote) {
        void leaf.setViewState({ active: true, type: INBOX_VIEW_TYPE });
        return;
      }
      const internalCapture =
        view instanceof MarkdownView &&
        view.file !== null &&
        view.file.path.startsWith(inboxPrefix) &&
        !this.#isQueuePath(view.file.path);
      const knowledgeNote =
        view instanceof MarkdownView && view.file !== null && this.#isRawPath(view.file.path);
      view.containerEl.toggleClass('selfgrow-internal-view', internalCapture);
      view.containerEl.toggleClass('selfgrow-knowledge-view', knowledgeNote);
    });
  }

  #isCreatedIngressPath(path: string): boolean {
    return path.startsWith(`${normalizeObsidianPath(this.#settings.rootPath)}/Inbox/`);
  }

  #isQueuePath(path: string): boolean {
    const root = normalizeObsidianPath(this.#settings.rootPath);
    return (
      path === siblingQueuePath(root) ||
      path === `${root}/Inbox Queue.md` ||
      path === `${root}/Inbox/Inbox Queue.md`
    );
  }

  #isRawPath(path: string): boolean {
    const root = `${normalizeObsidianPath(this.#settings.rootPath)}/`;
    const [folder, file, extra] = path.startsWith(root) ? path.slice(root.length).split('/') : [];
    return (
      extra === undefined &&
      folder !== undefined &&
      file !== undefined &&
      folder !== 'Inbox' &&
      folder !== 'Attachments' &&
      file.endsWith('.md')
    );
  }
}

function attachmentFileName(idToken: string, index: number, file: File): string {
  const name = [...file.name.normalize('NFKC')]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f ? '-' : character;
    })
    .join('')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[ .]+|[ .]+$/g, '')
    .slice(-120);
  return `${idToken}-${index + 1}-${name || 'attachment'}`;
}

function inboxAttachmentFile(app: Plugin['app'], pathGuard: PathGuard, rawPath: string): TFile {
  const path = pathGuard.assertDescendant(rawPath);
  if (!path.startsWith(`${pathGuard.join('Inbox', 'Attachments')}/`)) {
    throw new Error('Capture document is outside Inbox attachments.');
  }
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) throw new Error('Capture document does not exist.');
  return file;
}

function normalizeCollectionFolderName(value: string): string {
  const folder = value.normalize('NFKC').trim();
  if (
    folder.length === 0 ||
    folder === '.' ||
    folder === '..' ||
    folder === 'Inbox' ||
    folder === 'Attachments' ||
    /[\\/]/u.test(folder) ||
    [...folder].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new SelfGrowError('TOPIC_PATH_INVALID', 'The collection folder is invalid.');
  }
  return folder;
}

function imageMimeType(extension: string): string {
  switch (extension.toLowerCase()) {
    case 'gif':
      return 'image/gif';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/png';
  }
}

class DeviceTemporalContext implements TemporalContext {
  now(): Date {
    return new Date();
  }

  timeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}

async function ensureFolders(
  vault: ObsidianVaultAdapter,
  paths: readonly VaultPath[],
): Promise<void> {
  const required = new Set<string>();
  for (const path of paths) {
    const segments = path.split('/');
    for (let length = 1; length <= segments.length; length += 1) {
      required.add(segments.slice(0, length).join('/'));
    }
  }
  for (const path of required) {
    if (!(await vault.exists(path))) await vault.createFolder(path);
  }
}

function siblingWikiRoot(selfGrowRoot: string): string {
  const segments = selfGrowRoot.split('/');
  segments.pop();
  return [...segments, 'Wiki'].join('/');
}

function siblingQueuePath(rawRoot: string): VaultPath {
  const segments = rawRoot.split('/');
  segments.pop();
  return vaultPath([...segments, 'SelfGrow.md'].join('/'));
}
