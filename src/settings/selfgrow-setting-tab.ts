import {
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  SecretComponent,
  Setting,
  setIcon,
  type App,
  type SettingDefinitionItem,
} from 'obsidian';
import { isSelfGrowError, type Language } from '../domain';
import { isKnownMultimodalModel, modelImageInputEnabled, type ModelCatalogEntry } from '../ai';
import {
  changeChatSecret,
  chatModelLoadConfigurationReady,
  type PreferenceKeywordSettings,
  type SelfGrowSettings,
} from './settings';
import type { PreferenceProfileStatus } from './preference-profile';

export interface SelfGrowSettingsHost extends Plugin {
  ensureRawFolder(path: string): Promise<void>;
  getSelfGrowSettings(): SelfGrowSettings;
  getPreferenceProfileStatus(): Promise<PreferenceProfileStatus>;
  listChatModels(): Promise<ModelCatalogEntry[]>;
  openPreferenceProfile(): Promise<void>;
  savePreferenceKeywords(keywords: PreferenceKeywordSettings): Promise<void>;
  testChatConnection(): Promise<void>;
  testExtractionConnection(): Promise<void>;
  updateSelfGrowSettings(update: (current: SelfGrowSettings) => SelfGrowSettings): Promise<void>;
}

const COPY = {
  en: {
    accepted: 'I understand and accept this third-party data transmission.',
    baseURL: 'Base URL',
    chat: 'Chat',
    disclosure:
      'When enabled, SelfGrow may send the source URL and provider-required identifiers to this third-party service. Platform passwords and Cookies are never sent automatically.',
    extraction: 'Extraction',
    language: 'Language',
    localExtraction: 'Local article extraction',
    model: 'Model',
    modelDescription: 'Loads available models from the provider. Manual entry stays available.',
    modelLoad: 'Load models',
    modelLoadNoConfig: 'Select a model provider and enter an API key before loading models.',
    modelLoadNoURL: 'Fill in the service URL before loading models.',
    modelMultimodal: 'Image understanding',
    modelMultimodalDescription:
      'Known vision models are enabled automatically. For a custom model, enable this only when its provider accepts image input.',
    manualModel: 'Enter another model manually…',
    modelRefresh: 'Refresh models',
    modelsLoaded: (count: number) => `Loaded ${count} models.`,
    modelProvider: 'Model provider',
    preferenceDescription:
      'Selected topics update the same personal preference profile used for every score.',
    preferenceHeading: 'Recommendation preferences',
    preferenceOpen: 'Choose preferences',
    preferenceReady: (interested: number, uninterested: number) =>
      `${interested} interested · ${uninterested} not interested`,
    preferenceRequired:
      'Topics are optional. Saving them creates or updates the personal preference profile.',
    preferenceProfile: 'Personal preference profile',
    preferenceProfileDescription: (status: PreferenceProfileStatus) =>
      status.state === 'ready'
        ? `Profile ${status.profileVersion} · ${status.path}`
        : status.state === 'invalid'
          ? `The profile is invalid and will be ignored: ${status.path}`
          : `No profile yet. Saving topics or using the SelfGrow agent Skill can create it at ${status.path}.`,
    preferenceProfileLoading: 'Checking the Vault preference profile…',
    preferenceProfileOpen: 'View profile',
    selectProvider: 'Select a model provider',
    selectModel: 'Select a model',
    unlistedModel: 'Unlisted model',
    provider: 'Provider',
    rootPath: 'Root path',
    rootPathDescription:
      'Raw storage folder. Existing folders are accepted; Create makes it when missing.',
    createFolder: 'Create / use folder',
    folderReady: 'Raw folder is ready. Reload Obsidian to switch the active storage path.',
    secret: 'SecretStorage key',
    secretProviderDescription:
      'After entering an API key, select a model provider and click refresh to load the model list.',
    test: 'Test connection',
    testFailed: 'Connection test failed.',
    testPassed: 'Connection test passed.',
  },
  'zh-CN': {
    accepted: '我理解并接受上述第三方数据传输。',
    baseURL: '服务地址',
    chat: '聊天生成',
    disclosure:
      '启用后，SelfGrow 可能把来源 URL 和服务所需标识符发送给该第三方。不会自动发送平台密码或 Cookie。',
    extraction: '内容提取',
    language: '语言',
    localExtraction: '本地文章提取',
    model: '模型',
    modelDescription: '可从服务商加载可用模型，同时保留手动输入。',
    modelLoad: '加载模型',
    modelLoadNoConfig: '请选择模型服务商，填入API密钥后再加载模型',
    modelLoadNoURL: '请先填写服务地址，再加载模型。',
    modelMultimodal: '图片理解',
    modelMultimodalDescription:
      '已知视觉模型会自动启用；自定义模型仅在服务商确认支持图片输入时手动开启。',
    manualModel: '手动输入其他模型…',
    modelRefresh: '刷新模型',
    modelsLoaded: (count: number) => `已加载 ${count} 个模型。`,
    modelProvider: '模型服务商',
    preferenceDescription: '所选主题会更新同一份个人偏好协议；只有需要时才手动添加自定义关键词。',
    preferenceHeading: '推荐偏好',
    preferenceOpen: '选择推荐偏好',
    preferenceReady: (interested: number, uninterested: number) =>
      `感兴趣 ${interested} 项 · 不感兴趣 ${uninterested} 项`,
    preferenceRequired: '主题可选；保存后会创建或更新个人偏好协议。',
    preferenceProfile: '个人偏好协议',
    preferenceProfileDescription: (status: PreferenceProfileStatus) =>
      status.state === 'ready'
        ? `已读取版本 ${status.profileVersion} · ${status.path}`
        : status.state === 'invalid'
          ? `协议格式无效，当前会忽略：${status.path}`
          : `尚未生成；保存主题或使用 SelfGrow Agent Skill 都可在 ${status.path} 创建。`,
    preferenceProfileLoading: '正在检查 Vault 内的偏好协议…',
    preferenceProfileOpen: '查看协议',
    selectProvider: '请选择模型服务商',
    selectModel: '请选择模型',
    unlistedModel: '未收录模型',
    provider: '服务商',
    rootPath: '根目录',
    rootPathDescription: 'Raw 数据文件夹位置；可填写已有路径，不存在时可直接新建。',
    createFolder: '新建 / 使用文件夹',
    folderReady: 'Raw 文件夹已准备完成。请重新加载 Obsidian 以切换当前存储路径。',
    secret: 'SecretStorage 密钥',
    secretProviderDescription: '请在填写api密钥后选择模型服务商，点击刷新按钮加载模型列表',
    test: '测试连接',
    testFailed: '连接测试失败。',
    testPassed: '连接测试成功。',
  },
} as const;

export class SelfGrowSettingTab extends PluginSettingTab {
  readonly #host: SelfGrowSettingsHost;
  #chatModels: ModelCatalogEntry[] = [];
  #chatModelsLoading = false;
  #chatModelsSignature = '';
  #settingsContainer: HTMLElement | null = null;

  constructor(app: App, host: SelfGrowSettingsHost) {
    super(app, host);
    this.#host = host;
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: 'SelfGrow',
        render: (setting) => {
          setting.settingEl.addClass('selfgrow-settings-host');
          this.#render(setting.settingEl);
        },
      },
    ];
  }

  #render(container: HTMLElement): void {
    const settings = this.#host.getSelfGrowSettings();
    const copy = COPY[settings.language];
    this.#settingsContainer = container;
    container.empty();

    let rootPath = settings.rootPath;
    new Setting(container)
      .setName(copy.rootPath)
      .setDesc(copy.rootPathDescription)
      .addText((component) =>
        component.setValue(settings.rootPath).onChange((value) => {
          rootPath = value.trim();
        }),
      )
      .addButton((button) =>
        button.setButtonText(copy.createFolder).onClick(async () => {
          if (rootPath.length === 0) return;
          await this.#host.ensureRawFolder(rootPath);
          new Notice(copy.folderReady);
          this.update();
        }),
      );
    new Setting(container).setName(copy.language).addDropdown((component) =>
      component
        .addOption('zh-CN', '简体中文')
        .addOption('en', 'English')
        .setValue(settings.language)
        .onChange((value) => {
          if (value !== 'zh-CN' && value !== 'en') return;
          void this.#update((current) => ({ ...current, language: value }), true);
        }),
    );

    this.#preferences();

    this.#endpoint(copy.chat, 'chat');
    this.#extraction();
  }

  #preferences(): void {
    const settings = this.#host.getSelfGrowSettings();
    const copy = COPY[settings.language];
    new Setting(this.#container())
      .setName(copy.preferenceHeading)
      .setDesc(copy.preferenceDescription)
      .setHeading();
    const ready =
      settings.preferenceKeywords.interested.length > 0 ||
      settings.preferenceKeywords.uninterested.length > 0;
    new Setting(this.#container())
      .setName(copy.preferenceOpen)
      .setDesc(
        ready
          ? copy.preferenceReady(
              settings.preferenceKeywords.interested.length,
              settings.preferenceKeywords.uninterested.length,
            )
          : copy.preferenceRequired,
      )
      .addButton((button) =>
        button.setButtonText(copy.preferenceOpen).onClick(() => {
          new PreferenceKeywordModal(
            this.app,
            settings.language,
            settings.preferenceKeywords,
            async (keywords) => {
              await this.#host.savePreferenceKeywords(keywords);
              this.update();
            },
          ).open();
        }),
      );

    const profile = new Setting(this.#container())
      .setName(copy.preferenceProfile)
      .setDesc(copy.preferenceProfileLoading)
      .addToggle((toggle) =>
        toggle.setValue(settings.preferenceProfileEnabled).onChange((value) => {
          void this.#update((current) => ({
            ...current,
            preferenceProfileEnabled: value,
          })).then(() => this.update());
        }),
      )
      .addButton((button) =>
        button.setButtonText(copy.preferenceProfileOpen).onClick(() => {
          void this.#host.openPreferenceProfile();
        }),
      );
    void this.#host.getPreferenceProfileStatus().then((status) => {
      if (profile.settingEl.isConnected) profile.setDesc(copy.preferenceProfileDescription(status));
    });
  }

  #endpoint(name: string, key: 'chat'): void {
    const settings = this.#host.getSelfGrowSettings();
    const endpoint = settings[key];
    const copy = COPY[settings.language];
    new Setting(this.#container()).setName(name).setHeading();
    this.#renderSecretSetting(copy, key, endpoint);
    new Setting(this.#container()).setName(copy.modelProvider).addDropdown((component) =>
      component
        .addOptions({
          unconfigured: copy.selectProvider,
          custom: 'Custom',
          deepseek: 'DeepSeek',
          kimi: 'Kimi',
          openai: 'OpenAI',
          qwen: 'Qwen',
        })
        .setValue(endpoint.preset)
        .onChange((value) => {
          if (!isEndpointPreset(value)) return;
          void this.#updateEndpoint(key, {
            ...endpointPresetPatch(value),
            model: '',
            multimodal: false,
          }).then(() => {
            this.#chatModels = [];
            this.#chatModelsSignature = '';
            this.update();
          });
        }),
    );
    new Setting(this.#container()).setName(copy.baseURL).addText((component) =>
      component.setValue(endpoint.baseURL).onChange((value) => {
        void this.#updateEndpoint(key, { baseURL: value.trim() }).then(() => {
          this.#chatModels = [];
          this.#chatModelsSignature = '';
          this.update();
        });
      }),
    );
    this.#renderModelSetting(copy, key, endpoint);
    new Setting(this.#container())
      .setName(copy.modelMultimodal)
      .setDesc(copy.modelMultimodalDescription)
      .addToggle((toggle) => {
        const knownMultimodal = isKnownMultimodalModel(endpoint.model);
        toggle
          .setValue(modelImageInputEnabled(endpoint.model, endpoint.multimodal))
          .setDisabled(knownMultimodal)
          .onChange((value) => {
            void this.#updateEndpoint(key, { multimodal: value });
          });
      });
    new Setting(this.#container()).setName(copy.test).addButton((button) =>
      button.setButtonText(copy.test).onClick(() => {
        void this.#test(() => this.#host.testChatConnection());
      }),
    );
  }

  #renderSecretSetting(
    copy: (typeof COPY)[Language],
    key: 'chat',
    endpoint: SelfGrowSettings['chat'],
  ): void {
    new Setting(this.#container())
      .setName(copy.secret)
      .setDesc(copy.secretProviderDescription)
      .addComponent((element) =>
        new SecretComponent(this.app, element).setValue(endpoint.secretName).onChange((value) => {
          if (value === endpoint.secretName) return;
          void this.#update((current) => changeChatSecret(current, value)).then(() => {
            this.#chatModels = [];
            this.#chatModelsSignature = '';
            this.update();
          });
        }),
      );
  }

  #renderModelSetting(
    copy: (typeof COPY)[Language],
    key: 'chat',
    endpoint: SelfGrowSettings['chat'],
  ): void {
    const signature = modelListSignature(endpoint);
    if (this.#chatModelsSignature !== signature) {
      this.#chatModels = [];
      this.#chatModelsSignature = signature;
    }
    const models = this.#chatModels;
    const setting = new Setting(this.#container())
      .setName(copy.model)
      .setDesc(copy.modelDescription);

    if (models.length === 0) {
      setting.addText((component) =>
        component.setValue(endpoint.model).onChange((value) => {
          const model = value.trim();
          void this.#updateEndpoint(key, {
            model,
            multimodal: isKnownMultimodalModel(model),
          });
        }),
      );
    } else {
      const selected = endpoint.model.trim();
      const optionText = (entry: ModelCatalogEntry): string =>
        entry.description.length === 0 ? entry.id : `${entry.id} — ${entry.description}`;
      setting.addDropdown((component) => {
        component.addOption('', copy.selectModel);
        for (const entry of models) component.addOption(entry.id, optionText(entry));
        if (selected.length > 0 && !models.some((entry) => entry.id === selected)) {
          component.addOption(selected, `${selected} — ${copy.unlistedModel}`);
        }
        component.addOption(MANUAL_MODEL_VALUE, copy.manualModel);
        component.setValue(selected).onChange((value) => {
          if (value === MANUAL_MODEL_VALUE) {
            this.#chatModels = [];
            this.update();
            return;
          }
          if (value.length === 0) return;
          void this.#updateEndpoint(key, {
            model: value,
            multimodal: isKnownMultimodalModel(value),
          }).then(() => this.update());
        });
      });
    }

    setting.addExtraButton((button) =>
      button
        .setIcon('refresh-cw')
        .setTooltip(models.length === 0 ? copy.modelLoad : copy.modelRefresh)
        .setDisabled(this.#chatModelsLoading)
        .onClick(() => {
          void this.#loadChatModels();
        }),
    );
  }

  async #loadChatModels(): Promise<void> {
    if (this.#chatModelsLoading) return;
    const copy = COPY[this.#host.getSelfGrowSettings().language];
    const endpoint = this.#host.getSelfGrowSettings().chat;
    const secret =
      endpoint.secretName.trim().length === 0
        ? null
        : this.app.secretStorage.getSecret(endpoint.secretName);
    if (!chatModelLoadConfigurationReady(endpoint, secret)) {
      new Notice(copy.modelLoadNoConfig);
      return;
    }
    if (endpoint.baseURL.trim().length === 0) {
      new Notice(copy.modelLoadNoURL);
      return;
    }
    this.#chatModelsLoading = true;
    try {
      const models = await this.#host.listChatModels();
      this.#chatModels = models;
      this.#chatModelsSignature = modelListSignature(endpoint);
      new Notice(copy.modelsLoaded(models.length));
    } catch (error) {
      new Notice(isSelfGrowError(error) ? error.message : copy.testFailed);
    } finally {
      this.#chatModelsLoading = false;
      this.update();
    }
  }

  #extraction(): void {
    const settings = this.#host.getSelfGrowSettings();
    const copy = COPY[settings.language];
    const extraction = settings.extraction;
    new Setting(this.#container()).setName(copy.extraction).setHeading();
    new Setting(this.#container())
      .setName(copy.provider)
      .setDesc(extraction === null ? copy.localExtraction : copy.disclosure)
      .addDropdown((component) =>
        component
          .addOptions({ custom: 'Custom', local: copy.localExtraction, tikhub: 'TikHub' })
          .setValue(extraction?.preset ?? 'local')
          .onChange((value) => {
            void this.#update(
              (current) => ({
                ...current,
                extraction:
                  value === 'local'
                    ? null
                    : {
                        baseURL: '',
                        connectionTest: null,
                        disclosureAccepted: false,
                        preset: value === 'custom' ? 'custom' : 'tikhub',
                        secretName: '',
                      },
              }),
              true,
            );
          }),
      );
    if (extraction === null) return;

    new Setting(this.#container()).setName(copy.baseURL).addText((component) =>
      component.setValue(extraction.baseURL).onChange((value) => {
        void this.#updateExtraction({ baseURL: value.trim() });
      }),
    );
    new Setting(this.#container()).setName(copy.secret).addComponent((element) =>
      new SecretComponent(this.app, element).setValue(extraction.secretName).onChange((value) => {
        void this.#updateExtraction({ secretName: value });
      }),
    );
    new Setting(this.#container())
      .setName(copy.accepted)
      .setDesc(copy.disclosure)
      .addToggle((toggle) =>
        toggle.setValue(extraction.disclosureAccepted).onChange((value) => {
          void this.#updateExtraction({ disclosureAccepted: value });
        }),
      );
    new Setting(this.#container()).setName(copy.test).addButton((button) =>
      button
        .setButtonText(copy.test)
        .setDisabled(!extraction.disclosureAccepted)
        .onClick(() => {
          void this.#test(() => this.#host.testExtractionConnection());
        }),
    );
  }

  async #test(action: () => Promise<void>): Promise<void> {
    const copy = COPY[this.#host.getSelfGrowSettings().language];
    try {
      await action();
      new Notice(copy.testPassed);
      this.update();
    } catch (error) {
      new Notice(isSelfGrowError(error) ? error.message : copy.testFailed);
    }
  }

  async #update(
    update: (current: SelfGrowSettings) => SelfGrowSettings,
    redisplay = false,
  ): Promise<void> {
    await this.#host.updateSelfGrowSettings(update);
    if (redisplay) this.update();
  }

  async #updateEndpoint(key: 'chat', patch: Partial<SelfGrowSettings[typeof key]>): Promise<void> {
    await this.#update((current) => ({
      ...current,
      [key]: { ...current[key], ...patch, connectionTest: null },
    }));
  }

  async #updateExtraction(
    patch: Partial<NonNullable<SelfGrowSettings['extraction']>>,
  ): Promise<void> {
    await this.#update((current) => ({
      ...current,
      extraction:
        current.extraction === null
          ? null
          : { ...current.extraction, ...patch, connectionTest: null },
    }));
  }

  #container(): HTMLElement {
    if (this.#settingsContainer === null) throw new Error('Settings are not mounted.');
    return this.#settingsContainer;
  }
}

const MANUAL_MODEL_VALUE = '__selfgrow_manual_model__';

function modelListSignature(endpoint: SelfGrowSettings['chat']): string {
  return JSON.stringify([endpoint.preset, endpoint.baseURL]);
}

function isEndpointPreset(value: string): value is SelfGrowSettings['chat']['preset'] {
  return (
    value === 'unconfigured' ||
    value === 'openai' ||
    value === 'deepseek' ||
    value === 'qwen' ||
    value === 'kimi' ||
    value === 'custom'
  );
}

function endpointPresetPatch(
  preset: SelfGrowSettings['chat']['preset'],
): Partial<SelfGrowSettings['chat']> {
  const baseURLs = {
    unconfigured: '',
    custom: '',
    deepseek: 'https://api.deepseek.com',
    kimi: 'https://api.moonshot.cn/v1',
    openai: 'https://api.openai.com/v1',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  } as const;
  return { baseURL: baseURLs[preset], preset };
}

interface KeywordPreset {
  en: string;
  'zh-CN': string;
}

type PreferenceGroup = keyof PreferenceKeywordSettings;

const PRESET_BATCH_SIZE = 12;

const TOPIC_PRESETS: readonly KeywordPreset[] = [
  { en: 'Academic reading', 'zh-CN': '学术阅读' },
  { en: 'Academic writing', 'zh-CN': '学术写作' },
  { en: 'Literature review', 'zh-CN': '文献综述' },
  { en: 'Note-taking methods', 'zh-CN': '笔记方法' },
  { en: 'Knowledge management', 'zh-CN': '知识管理' },
  { en: 'Critical thinking', 'zh-CN': '批判性思维' },
  { en: 'Problem solving', 'zh-CN': '问题解决' },
  { en: 'Exam preparation', 'zh-CN': '考试备考' },
  { en: 'Time management', 'zh-CN': '时间管理' },
  { en: 'Language learning', 'zh-CN': '语言学习' },
  { en: 'Academic presentations', 'zh-CN': '学术汇报' },
  { en: 'Research collaboration', 'zh-CN': '科研协作' },
  { en: 'Research methods', 'zh-CN': '研究方法' },
  { en: 'Experimental design', 'zh-CN': '实验设计' },
  { en: 'Statistics', 'zh-CN': '统计学' },
  { en: 'Causal inference', 'zh-CN': '因果推断' },
  { en: 'Survey research', 'zh-CN': '调查研究' },
  { en: 'Qualitative research', 'zh-CN': '定性研究' },
  { en: 'Data analysis', 'zh-CN': '数据分析' },
  { en: 'Data visualization', 'zh-CN': '数据可视化' },
  { en: 'Reproducible research', 'zh-CN': '可复现研究' },
  { en: 'Reference management', 'zh-CN': '文献管理' },
  { en: 'Open science', 'zh-CN': '开放科学' },
  { en: 'Research project design', 'zh-CN': '科研项目设计' },
  { en: 'Artificial intelligence', 'zh-CN': '人工智能' },
  { en: 'AI agents', 'zh-CN': '智能体' },
  { en: 'RAG', 'zh-CN': 'RAG' },
  { en: 'Multimodal AI', 'zh-CN': '多模态' },
  { en: 'Programming', 'zh-CN': '编程开发' },
  { en: 'Python', 'zh-CN': 'Python' },
  { en: 'R', 'zh-CN': 'R语言' },
  { en: 'GIS', 'zh-CN': 'GIS' },
  { en: 'Databases', 'zh-CN': '数据库' },
  { en: 'Automation', 'zh-CN': '自动化' },
  { en: 'Open source', 'zh-CN': '开源项目' },
  { en: 'Software engineering', 'zh-CN': '软件工程' },
  { en: 'Research tools', 'zh-CN': '科研工具' },
  { en: 'Mathematics', 'zh-CN': '数学' },
  { en: 'Computer science', 'zh-CN': '计算机科学' },
  { en: 'Physics', 'zh-CN': '物理学' },
  { en: 'Chemistry', 'zh-CN': '化学' },
  { en: 'Biology', 'zh-CN': '生物学' },
  { en: 'Earth science', 'zh-CN': '地球科学' },
  { en: 'Environmental science', 'zh-CN': '环境科学' },
  { en: 'Medicine', 'zh-CN': '医学' },
  { en: 'Psychology', 'zh-CN': '心理学' },
  { en: 'Economics', 'zh-CN': '经济学' },
  { en: 'Sociology', 'zh-CN': '社会学' },
  { en: 'History', 'zh-CN': '历史学' },
  { en: 'Philosophy', 'zh-CN': '哲学' },
  { en: 'Law', 'zh-CN': '法学' },
  { en: 'Linguistics', 'zh-CN': '语言学' },
  { en: 'Literature', 'zh-CN': '文学' },
  { en: 'Education', 'zh-CN': '教育' },
  { en: 'Management', 'zh-CN': '管理学' },
];

const PREFERENCE_MODAL_COPY = {
  en: {
    add: 'Add',
    addCustom: 'Add a custom keyword',
    cancel: 'Cancel',
    customPlaceholder: 'Type one keyword',
    interested: 'What are you interested in?',
    interestedHint: 'Pick the topics you want to see more often.',
    keywordLimit: 'Each group supports up to 30 keywords.',
    needBoth:
      'Topics are optional; an existing personal profile remains active when this is empty.',
    refresh: 'New batch',
    save: 'Save preferences',
    saveFailed: 'Could not save preferences. Please try again.',
    subtitle:
      'Both groups use neutral topics. Saving updates the same versioned personal preference profile.',
    title: 'Choose recommendation preferences',
    uninterested: 'What are you not interested in?',
    uninterestedHint: 'Pick the topics you want to see less often.',
  },
  'zh-CN': {
    add: '添加',
    addCustom: '添加自定义关键词',
    cancel: '取消',
    customPlaceholder: '输入一个关键词',
    interested: '你对什么感兴趣？',
    interestedHint: '点击你希望更多看到的主题。',
    keywordLimit: '每组最多保留 30 个关键词。',
    needBoth: '主题不是必选项；清空后保存会保留协议中由 Agent 生成的其他偏好。',
    refresh: '换一批',
    save: '保存偏好',
    saveFailed: '偏好保存失败，请重试。',
    subtitle: '两栏使用同一套中性主题；保存后会更新同一份版本化个人偏好协议。',
    title: '选择推荐偏好',
    uninterested: '你对什么不感兴趣？',
    uninterestedHint: '点击你希望减少看到的主题。',
  },
} as const;

class PreferenceKeywordModal extends Modal {
  readonly #language: Language;
  readonly #onSave: (keywords: PreferenceKeywordSettings) => Promise<void>;
  readonly #selected: PreferenceKeywordSettings;
  #batchStarts: Record<PreferenceGroup, number> = {
    interested: 0,
    uninterested: PRESET_BATCH_SIZE,
  };
  #showCustom: Record<PreferenceGroup, boolean> = {
    interested: false,
    uninterested: false,
  };

  constructor(
    app: App,
    language: Language,
    initial: PreferenceKeywordSettings,
    onSave: (keywords: PreferenceKeywordSettings) => Promise<void>,
  ) {
    super(app);
    this.#language = language;
    this.#selected = {
      interested: [...initial.interested],
      uninterested: [...initial.uninterested],
    };
    this.#onSave = onSave;
  }

  override onOpen(): void {
    this.modalEl.addClass('selfgrow-preference-modal');
    this.#render();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  #render(): void {
    const copy = PREFERENCE_MODAL_COPY[this.#language];
    this.contentEl.empty();
    this.contentEl.createEl('h2', { text: copy.title });
    this.contentEl.createEl('p', {
      cls: 'selfgrow-preference-subtitle',
      text: copy.subtitle,
    });
    this.#renderGroup('interested', TOPIC_PRESETS, copy.interested, copy.interestedHint);
    this.#renderGroup('uninterested', TOPIC_PRESETS, copy.uninterested, copy.uninterestedHint);

    const footer = this.contentEl.createDiv({ cls: 'selfgrow-preference-footer' });
    const status = footer.createSpan({
      cls: 'selfgrow-preference-status',
      text:
        this.#selected.interested.length > 0 || this.#selected.uninterested.length > 0
          ? ''
          : copy.needBoth,
    });
    const actions = footer.createDiv({ cls: 'selfgrow-preference-actions' });
    const cancel = actions.createEl('button', { text: copy.cancel });
    cancel.addEventListener('click', () => this.close());
    const save = actions.createEl('button', {
      cls: 'mod-cta',
      text: copy.save,
    });
    save.addEventListener('click', () => {
      save.disabled = true;
      status.setText('');
      void this.#onSave({
        interested: [...this.#selected.interested],
        uninterested: [...this.#selected.uninterested],
      })
        .then(() => this.close())
        .catch(() => {
          save.disabled = false;
          status.setText(copy.saveFailed);
        });
    });
  }

  #renderGroup(
    group: PreferenceGroup,
    presets: readonly KeywordPreset[],
    title: string,
    hint: string,
  ): void {
    const copy = PREFERENCE_MODAL_COPY[this.#language];
    const section = this.contentEl.createDiv({ cls: `selfgrow-preference-section is-${group}` });
    const heading = section.createDiv({ cls: 'selfgrow-preference-section-heading' });
    heading.createEl('h3', { text: title });
    const headingActions = heading.createDiv({ cls: 'selfgrow-preference-heading-actions' });
    headingActions.createSpan({
      cls: 'selfgrow-preference-count',
      text: `${this.#selected[group].length}/30`,
    });
    const refresh = headingActions.createEl('button', {
      attr: { 'aria-label': copy.refresh, title: copy.refresh, type: 'button' },
      cls: 'selfgrow-preference-refresh',
    });
    setIcon(refresh, 'refresh-cw');
    refresh.createSpan({ text: copy.refresh });
    refresh.addEventListener('click', () => {
      this.#batchStarts[group] = (this.#batchStarts[group] + PRESET_BATCH_SIZE) % presets.length;
      this.#showCustom[group] = false;
      this.#render();
    });
    section.createEl('p', { cls: 'selfgrow-preference-hint', text: hint });
    const bubbles = section.createDiv({ cls: 'selfgrow-preference-bubbles' });
    for (const preset of this.#visiblePresets(group, presets)) {
      const selected = this.#presetValue(group, preset) !== null;
      const bubble = bubbles.createEl('button', {
        attr: { 'aria-pressed': String(selected), type: 'button' },
        cls: `selfgrow-preference-bubble${selected ? ' is-selected' : ''}`,
        text: preset[this.#language],
      });
      bubble.addEventListener('click', () => {
        this.#togglePreset(group, preset);
        this.#render();
      });
    }

    for (const keyword of this.#customKeywords(group, presets)) {
      const bubble = bubbles.createEl('button', {
        attr: {
          'aria-label': `${keyword} ×`,
          title: `${keyword} ×`,
          type: 'button',
        },
        cls: 'selfgrow-preference-bubble is-selected is-custom',
        text: `${keyword} ×`,
      });
      bubble.addEventListener('click', () => {
        this.#removeKeyword(group, keyword);
        this.#render();
      });
    }

    const customToggle = bubbles.createEl('button', {
      attr: { type: 'button' },
      cls: 'selfgrow-preference-bubble is-add',
      text: `＋ ${copy.addCustom}`,
    });
    customToggle.addEventListener('click', () => {
      this.#showCustom[group] = !this.#showCustom[group];
      this.#render();
    });
    if (this.#showCustom[group]) this.#renderCustomInput(section, group);
  }

  #renderCustomInput(container: HTMLElement, group: PreferenceGroup): void {
    const copy = PREFERENCE_MODAL_COPY[this.#language];
    const row = container.createDiv({ cls: 'selfgrow-preference-custom-row' });
    const input = row.createEl('input', {
      attr: {
        maxlength: '40',
        placeholder: copy.customPlaceholder,
        type: 'text',
      },
    });
    const add = row.createEl('button', { text: copy.add });
    add.disabled = true;
    input.addEventListener('input', () => {
      add.disabled = normalizeKeyword(input.value).length === 0;
    });
    const submit = (): void => {
      const keyword = normalizeKeyword(input.value);
      if (keyword.length === 0) return;
      if (this.#selected[group].length >= 30) {
        new Notice(copy.keywordLimit);
        return;
      }
      this.#addKeyword(group, keyword);
      this.#showCustom[group] = false;
      this.#render();
    };
    add.addEventListener('click', submit);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submit();
    });
    input.focus();
  }

  #togglePreset(group: PreferenceGroup, preset: KeywordPreset): void {
    const existing = this.#presetValue(group, preset);
    for (const label of [preset.en, preset['zh-CN']]) this.#removeKeyword(group, label);
    if (existing !== null) return;
    if (this.#selected[group].length >= 30) {
      new Notice(PREFERENCE_MODAL_COPY[this.#language].keywordLimit);
      return;
    }
    const other: PreferenceGroup = group === 'interested' ? 'uninterested' : 'interested';
    for (const label of [preset.en, preset['zh-CN']]) this.#removeKeyword(other, label);
    this.#addKeyword(group, preset[this.#language]);
  }

  #visiblePresets(
    group: PreferenceGroup,
    presets: readonly KeywordPreset[],
  ): readonly KeywordPreset[] {
    const selected = presets.filter((preset) => this.#presetValue(group, preset) !== null);
    const batch = Array.from(
      { length: Math.min(PRESET_BATCH_SIZE, presets.length) },
      (_, index) => presets[(this.#batchStarts[group] + index) % presets.length],
    ).filter((preset): preset is KeywordPreset => preset !== undefined);
    return [...selected, ...batch.filter((preset) => !selected.includes(preset))];
  }

  #addKeyword(group: PreferenceGroup, keyword: string): void {
    const other: PreferenceGroup = group === 'interested' ? 'uninterested' : 'interested';
    this.#removeKeyword(other, keyword);
    if (this.#hasKeyword(group, keyword)) return;
    this.#selected[group].push(keyword);
  }

  #removeKeyword(group: PreferenceGroup, keyword: string): void {
    const normalized = keyword.toLocaleLowerCase();
    this.#selected[group] = this.#selected[group].filter(
      (value) => value.toLocaleLowerCase() !== normalized,
    );
  }

  #hasKeyword(group: PreferenceGroup, keyword: string): boolean {
    const normalized = keyword.toLocaleLowerCase();
    return this.#selected[group].some((value) => value.toLocaleLowerCase() === normalized);
  }

  #presetValue(group: PreferenceGroup, preset: KeywordPreset): string | null {
    return (
      this.#selected[group].find(
        (value) =>
          value.toLocaleLowerCase() === preset.en.toLocaleLowerCase() ||
          value.toLocaleLowerCase() === preset['zh-CN'].toLocaleLowerCase(),
      ) ?? null
    );
  }

  #customKeywords(group: PreferenceGroup, presets: readonly KeywordPreset[]): string[] {
    return this.#selected[group].filter(
      (value) => !presets.some((preset) => this.#presetValueForValue(preset, value)),
    );
  }

  #presetValueForValue(preset: KeywordPreset, value: string): boolean {
    const normalized = value.toLocaleLowerCase();
    return (
      normalized === preset.en.toLocaleLowerCase() ||
      normalized === preset['zh-CN'].toLocaleLowerCase()
    );
  }
}

function normalizeKeyword(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').slice(0, 40);
}
