import {
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  SecretComponent,
  Setting,
  type App,
  type SettingDefinitionItem,
} from 'obsidian';
import { isSelfGrowError, type Language } from '../domain';
import type { ModelCatalogEntry } from '../ai';
import {
  applyChatSecretProfile,
  rememberChatSecretProfile,
  type SelfGrowSettings,
} from './settings';

export interface SelfGrowSettingsHost extends Plugin {
  ensureRawFolder(path: string): Promise<void>;
  getSelfGrowSettings(): SelfGrowSettings;
  listChatModels(): Promise<ModelCatalogEntry[]>;
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
    modelLoadNoConfig: 'Fill in the service URL before loading models.',
    modelRefresh: 'Refresh models',
    modelsLoaded: (count: number) => `Loaded ${count} models.`,
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
      'Bind this key to a provider. Switching keys restores the saved provider automatically.',
    selectSecret: 'Select a key',
    addSecret: 'Add key',
    manageSecret: 'Manage / delete key',
    secretEditTitle: 'Edit API key',
    secretID: 'Key ID',
    secretValue: 'API Key',
    secretValueOptional: 'Leave blank to keep the saved API key.',
    secretSave: 'Save key',
    secretIDLocked:
      'Obsidian does not expose key deletion or rename. Create a new key to use a new ID.',
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
    modelLoadNoConfig: '请先填写服务地址，再加载模型。',
    modelRefresh: '刷新模型',
    modelsLoaded: (count: number) => `已加载 ${count} 个模型。`,
    selectModel: '请选择模型',
    unlistedModel: '未收录模型',
    provider: '服务商',
    rootPath: '根目录',
    rootPathDescription: 'Raw 数据文件夹位置；可填写已有路径，不存在时可直接新建。',
    createFolder: '新建 / 使用文件夹',
    folderReady: 'Raw 文件夹已准备完成。请重新加载 Obsidian 以切换当前存储路径。',
    secret: 'SecretStorage 密钥',
    secretProviderDescription: '将密钥绑定到服务商；切换密钥时自动恢复对应的服务商和地址。',
    selectSecret: '选择密钥',
    addSecret: '添加密钥',
    manageSecret: '管理 / 删除密钥',
    secretEditTitle: '编辑 API 密钥',
    secretID: '密钥 ID',
    secretValue: 'API Key',
    secretValueOptional: '留空则保持已保存的 API Key 不变。',
    secretSave: '保存密钥',
    secretIDLocked: 'Obsidian 未提供密钥删除或重命名接口；如需新 ID，请添加一个新密钥。',
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

    this.#endpoint(copy.chat, 'chat');
    this.#extraction();
  }

  #endpoint(name: string, key: 'chat'): void {
    const settings = this.#host.getSelfGrowSettings();
    const endpoint = settings[key];
    const copy = COPY[settings.language];
    new Setting(this.#container()).setName(name).setHeading();
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
    this.#renderSecretSetting(copy, key, endpoint);
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
    const secrets = this.app.secretStorage.listSecrets().sort();
    const setting = new Setting(this.#container())
      .setName(copy.secret)
      .setDesc(copy.secretProviderDescription);

    setting.addDropdown((component) => {
      component.addOption('', copy.selectSecret);
      for (const secretName of secrets) component.addOption(secretName, secretName);
      if (endpoint.secretName.length > 0 && !secrets.includes(endpoint.secretName)) {
        component.addOption(endpoint.secretName, endpoint.secretName);
      }
      component.setValue(endpoint.secretName).onChange((value) => {
        void this.#update((current) => {
          const restored = applyChatSecretProfile(current, value);
          return {
            ...restored,
            chat: {
              ...restored.chat,
              connectionTest: null,
              secretName: value,
            },
          };
        }, true).then(() => {
          this.#chatModels = [];
          this.#chatModelsSignature = '';
          if (value.trim().length > 0) void this.#loadChatModels();
        });
      });
    });

    setting.addExtraButton((button) =>
      button
        .setIcon('plus')
        .setTooltip(copy.addSecret)
        .onClick(() => this.#openNewChatSecret(key)),
    );
    if (endpoint.secretName.length > 0) {
      setting.addExtraButton((button) =>
        button
          .setIcon('key')
          .setTooltip(copy.manageSecret)
          .onClick(() => this.#openManageChatSecret(endpoint.secretName)),
      );
    }
  }

  #openNewChatSecret(
    key: 'chat',
    existingID = '',
    existingPreset: SelfGrowSettings['chat']['preset'] | '' = '',
  ): void {
    new NewChatSecretModal(this.app, this.#host, key, existingID, existingPreset, () => {
      this.#chatModels = [];
      this.#chatModelsSignature = '';
      this.update();
      void this.#loadChatModels();
    }).open();
  }

  #openManageChatSecret(secretName: string): void {
    new ManageChatSecretModal(this.app, secretName, () => {
      const current = this.#host.getSelfGrowSettings();
      if (
        current.chat.secretName.length > 0 &&
        !this.app.secretStorage.listSecrets().includes(current.chat.secretName)
      ) {
        void this.#host.updateSelfGrowSettings((settings) => ({
          ...settings,
          chat: { ...settings.chat, connectionTest: null, secretName: '' },
        }));
      }
      this.update();
    }).open();
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
          void this.#updateEndpoint(key, { model: value.trim() });
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
        component.setValue(selected).onChange((value) => {
          if (value.length === 0) return;
          void this.#updateEndpoint(key, { model: value });
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
    if (endpoint.baseURL.trim().length === 0) {
      new Notice(copy.modelLoadNoConfig);
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
    await this.#update((current) => {
      const endpoint = { ...current[key], ...patch, connectionTest: null };
      return rememberChatSecretProfile({ ...current, [key]: endpoint }, endpoint.secretName);
    });
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

class ManageChatSecretModal extends Modal {
  readonly #onClosed: () => void;
  readonly #secretName: string;
  #observer: MutationObserver | null = null;

  constructor(app: App, secretName: string, onClosed: () => void) {
    super(app);
    this.#secretName = secretName;
    this.#onClosed = onClosed;
  }

  override onOpen(): void {
    this.contentEl.createEl('h2', { text: this.#secretName });
    new Setting(this.contentEl).addComponent((element) =>
      new SecretComponent(this.app, element).setValue(this.#secretName),
    );
    this.#hideNativeAddKeyButton();
  }

  #hideNativeAddKeyButton(): void {
    const hide = (): void => {
      for (const element of document.querySelectorAll<HTMLElement>('button, a')) {
        const label = element.textContent?.trim() ?? '';
        if (/^(?:������Կ|Add key|Add Key)$/i.test(label)) {
          element.addClass('selfgrow-hidden');
        }
      }
    };
    hide();
    this.#observer = new MutationObserver(hide);
    this.#observer.observe(document.body, { childList: true, subtree: true });
  }

  override onClose(): void {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#onClosed();
  }
}

class NewChatSecretModal extends Modal {
  readonly #existingID: string;
  readonly #host: SelfGrowSettingsHost;
  readonly #key: 'chat';
  readonly #onSaved: () => void;
  #id = '';
  #preset: SelfGrowSettings['chat']['preset'];
  #secret = '';

  constructor(
    app: App,
    host: SelfGrowSettingsHost,
    key: 'chat',
    existingID: string,
    existingPreset: SelfGrowSettings['chat']['preset'] | '',
    onSaved: () => void,
  ) {
    super(app);
    const current = host.getSelfGrowSettings().chat;
    this.#existingID = existingID;
    this.#host = host;
    this.#id = existingID;
    this.#key = key;
    this.#onSaved = onSaved;
    this.#preset =
      existingID.length === 0 && isEndpointPreset(existingPreset)
        ? existingPreset
        : existingID.length > 0 && isEndpointPreset(existingPreset)
          ? existingPreset
          : current.preset;
  }

  #editing(): boolean {
    return this.#existingID.length > 0;
  }

  override onOpen(): void {
    const language = this.#host.getSelfGrowSettings().language;
    const editing = this.#editing();
    const copy = COPY[language];
    this.contentEl.createEl('h2', {
      text: editing ? copy.secretEditTitle : copy.addSecret,
    });
    new Setting(this.contentEl)
      .setName(copy.secretID)
      .setDesc(editing ? copy.secretIDLocked : '')
      .addText((component) =>
        component
          .setValue(this.#id)
          .setDisabled(editing)
          .onChange((value) => {
            this.#id = value.trim().toLowerCase();
          }),
      );
    new Setting(this.contentEl)
      .setName(copy.secretValue)
      .setDesc(editing ? copy.secretValueOptional : '')
      .addText((component) => {
        component.inputEl.type = 'password';
        component.onChange((value) => {
          this.#secret = value.trim();
        });
      });
    new Setting(this.contentEl).setName(copy.provider).addDropdown((component) =>
      component
        .addOptions({
          custom: 'Custom',
          deepseek: 'DeepSeek',
          kimi: 'Kimi',
          openai: 'OpenAI',
          qwen: 'Qwen',
        })
        .setValue(this.#preset)
        .onChange((value) => {
          if (isEndpointPreset(value)) this.#preset = value;
        }),
    );
    new Setting(this.contentEl).addButton((button) =>
      button
        .setCta()
        .setButtonText(copy.secretSave)
        .onClick(() => void this.#save()),
    );
  }

  async #save(): Promise<void> {
    const language = this.#host.getSelfGrowSettings().language;
    const editing = this.#editing();
    if (!/^[a-z0-9-]+$/.test(this.#id)) {
      new Notice(
        language === 'zh-CN'
          ? '��Կ ID ֻ�ܰ���Сд��ĸ�����ֺͶ̺��ߡ�'
          : 'Key ID may only contain lowercase letters, numbers, and dashes.',
      );
      return;
    }
    if (!editing && this.#secret.length === 0) {
      new Notice(language === 'zh-CN' ? 'API Key ����Ϊ�ա�' : 'API Key is required.');
      return;
    }

    if (this.#secret.length > 0) {
      try {
        this.app.secretStorage.setSecret(this.#id, this.#secret);
      } catch (error) {
        new Notice(
          language === 'zh-CN'
            ? `������Կʧ�ܣ�${error instanceof Error ? error.message : 'δ֪����'}`
            : `Failed to save key: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
        return;
      }
    }

    await this.#host.updateSelfGrowSettings((current) => {
      const remembered = rememberChatSecretProfile(current, current.chat.secretName);
      const patch = endpointPresetPatch(this.#preset);
      const sameProvider = current.chat.preset === this.#preset;
      return rememberChatSecretProfile(
        {
          ...remembered,
          [this.#key]: {
            ...remembered[this.#key],
            ...patch,
            connectionTest: null,
            model: sameProvider ? remembered[this.#key].model : '',
            secretName: this.#id,
          },
        },
        this.#id,
      );
    });
    this.#onSaved();
    this.close();
  }
}

function modelListSignature(endpoint: SelfGrowSettings['chat']): string {
  return JSON.stringify([endpoint.preset, endpoint.baseURL]);
}

function isEndpointPreset(value: string): value is SelfGrowSettings['chat']['preset'] {
  return (
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
    custom: '',
    deepseek: 'https://api.deepseek.com',
    kimi: 'https://api.moonshot.cn/v1',
    openai: 'https://api.openai.com/v1',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  } as const;
  return { baseURL: baseURLs[preset], preset };
}
