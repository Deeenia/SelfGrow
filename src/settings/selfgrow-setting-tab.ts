import {
  Notice,
  Plugin,
  PluginSettingTab,
  SecretComponent,
  Setting,
  type App,
  type SettingDefinitionItem,
} from 'obsidian';
import { isSelfGrowError } from '../domain';
import type { SelfGrowSettings } from './settings';

export interface SelfGrowSettingsHost extends Plugin {
  ensureRawFolder(path: string): Promise<void>;
  getSelfGrowSettings(): SelfGrowSettings;
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
    provider: 'Provider',
    rootPath: 'Root path',
    rootPathDescription:
      'Raw storage folder. Existing folders are accepted; Create makes it when missing.',
    createFolder: 'Create / use folder',
    folderReady: 'Raw folder is ready. Reload Obsidian to switch the active storage path.',
    secret: 'SecretStorage key',
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
    provider: '服务商',
    rootPath: '根目录',
    rootPathDescription: 'Raw 数据文件夹位置；可填写已有路径，不存在时可直接新建。',
    createFolder: '新建 / 使用文件夹',
    folderReady: 'Raw 文件夹已准备完成。请重新加载 Obsidian 以切换当前存储路径。',
    secret: 'SecretStorage 密钥',
    test: '测试连接',
    testFailed: '连接测试失败。',
    testPassed: '连接测试成功。',
  },
} as const;

export class SelfGrowSettingTab extends PluginSettingTab {
  readonly #host: SelfGrowSettingsHost;
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
    new Setting(this.#container()).setName(copy.provider).addDropdown((component) =>
      component
        .addOptions({ custom: 'Custom', deepseek: 'DeepSeek', openai: 'OpenAI', qwen: 'Qwen' })
        .setValue(endpoint.preset)
        .onChange((value) => {
          if (!isEndpointPreset(value)) return;
          void this.#updateEndpoint(key, endpointPresetPatch(value));
        }),
    );
    new Setting(this.#container()).setName(copy.baseURL).addText((component) =>
      component.setValue(endpoint.baseURL).onChange((value) => {
        void this.#updateEndpoint(key, { baseURL: value.trim() });
      }),
    );
    new Setting(this.#container()).setName(copy.model).addText((component) =>
      component.setValue(endpoint.model).onChange((value) => {
        void this.#updateEndpoint(key, { model: value.trim() });
      }),
    );
    new Setting(this.#container()).setName(copy.secret).addComponent((element) =>
      new SecretComponent(this.app, element).setValue(endpoint.secretName).onChange((value) => {
        void this.#updateEndpoint(key, { secretName: value });
      }),
    );
    new Setting(this.#container()).setName(copy.test).addButton((button) =>
      button.setButtonText(copy.test).onClick(() => {
        void this.#test(() => this.#host.testChatConnection());
      }),
    );
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

function isEndpointPreset(value: string): value is SelfGrowSettings['chat']['preset'] {
  return value === 'openai' || value === 'deepseek' || value === 'qwen' || value === 'custom';
}

function endpointPresetPatch(
  preset: SelfGrowSettings['chat']['preset'],
): Partial<SelfGrowSettings['chat']> {
  const baseURLs = {
    custom: '',
    deepseek: 'https://api.deepseek.com',
    openai: 'https://api.openai.com/v1',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  } as const;
  return { baseURL: baseURLs[preset], preset };
}
