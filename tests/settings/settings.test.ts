import { describe, expect, it } from 'vitest';
import { SelfGrowError } from '../../src/domain';
import { ObsidianSecretResolver } from '../../src/platform/obsidian-secret-resolver';
import { z } from '../../src/schema/zod';
import {
  EXTRACTION_PROVIDER_PRESETS,
  PROVIDER_PRESETS,
  applyChatSecretProfile,
  changeChatSecret,
  chatModelLoadConfigurationReady,
  createDefaultSettings,
  loadSettings,
  markConnectionTested,
  markExtractionTested,
  preferenceKeywordsReady,
  rememberChatSecretProfile,
  serializeSettings,
  updateChat,
  updateExtraction,
  type EndpointSettings,
  type SelfGrowSettings,
} from '../../src/settings';
import { OBVIOUSLY_FAKE_SECRET } from '../harness';

const testedAt = '2026-08-09T01:30:00.000Z';

function endpoint(overrides: Partial<EndpointSettings> = {}): EndpointSettings {
  return {
    baseURL: 'https://api.example.test/v1',
    connectionTest: null,
    model: 'fixture-model',
    multimodal: false,
    preset: 'custom',
    secretName: 'Shared Fixture Secret',
    ...overrides,
  };
}

describe('settings', () => {
  it('uses mobile-safe validation and only current configuration surfaces', () => {
    const settings = createDefaultSettings();
    expect(z.config().jitless).toBe(true);
    expect(PROVIDER_PRESETS).toEqual([
      'unconfigured',
      'openai',
      'deepseek',
      'qwen',
      'kimi',
      'custom',
    ]);
    expect(EXTRACTION_PROVIDER_PRESETS).toEqual(['tikhub', 'custom']);
    expect(settings).toEqual({
      chat: {
        baseURL: '',
        connectionTest: null,
        model: '',
        multimodal: false,
        preset: 'unconfigured',
        secretName: '',
      },
      chatSecretProfiles: {},
      extraction: null,
      language: 'zh-CN',
      preferenceKeywords: { interested: [], uninterested: [] },
      preferenceProfileEnabled: true,
      rootPath: 'Raw',
      schemaVersion: 1,
    });
  });

  it('invalidates stale chat tests and validates extraction disclosure', () => {
    const tested = markConnectionTested(endpoint(), { fingerprint: 'model-id', testedAt });
    expect(
      updateChat({ ...createDefaultSettings(), chat: tested }, { model: 'changed' }).chat
        .connectionTest,
    ).toBeNull();

    let settings = updateExtraction(createDefaultSettings(), {
      baseURL: 'https://extract.example.test/v1',
      disclosureAccepted: true,
      preset: 'custom',
      secretName: 'Extraction Secret',
    });
    settings = markExtractionTested(settings, {
      capabilities: { articleBody: true, platformDetail: true, subtitles: true },
      testedAt,
    });
    expect(settings.extraction?.connectionTest?.testedAt).toBe(testedAt);
  });

  it('requires a provider and stored API key before loading models', () => {
    const configured = endpoint();
    expect(chatModelLoadConfigurationReady(configured, OBVIOUSLY_FAKE_SECRET)).toBe(true);
    expect(
      chatModelLoadConfigurationReady(
        { ...configured, preset: 'unconfigured' },
        OBVIOUSLY_FAKE_SECRET,
      ),
    ).toBe(false);
    expect(chatModelLoadConfigurationReady(configured, null)).toBe(false);
    expect(chatModelLoadConfigurationReady(configured, '   ')).toBe(false);
  });

  it('clears the provider and model when the selected key changes', () => {
    const settings = { ...createDefaultSettings(), chat: endpoint() };
    const changed = changeChatSecret(settings, 'Another Secret');
    expect(changed.chat).toMatchObject({
      baseURL: settings.chat.baseURL,
      connectionTest: null,
      model: '',
      preset: 'unconfigured',
      secretName: 'Another Secret',
    });
    expect(changeChatSecret(settings, settings.chat.secretName)).toBe(settings);

    const firstSelection = changeChatSecret(
      {
        ...settings,
        chat: { ...settings.chat, preset: 'kimi', secretName: '' },
      },
      'First Secret',
    );
    expect(firstSelection.chat).toMatchObject({
      preset: 'kimi',
      secretName: 'First Secret',
    });
  });

  it('persists references but never secret values', () => {
    const settings = {
      ...createDefaultSettings(),
      chat: endpoint(),
      preferenceKeywords: {
        interested: ['本地优先', '多模态'],
        uninterested: ['营销炒作'],
      },
    };
    const json = JSON.stringify(serializeSettings(settings));
    expect(json).toContain('Shared Fixture Secret');
    expect(json).toContain('本地优先');
    expect(json).not.toContain(OBVIOUSLY_FAKE_SECRET);
    const resolver = new ObsidianSecretResolver({
      getSecret: (name) => (name === 'Shared Fixture Secret' ? OBVIOUSLY_FAKE_SECRET : null),
    });
    expect(resolver.get({ name: settings.chat.secretName })).toBe(OBVIOUSLY_FAKE_SECRET);
  });

  it('migrates legacy settings and enables keyword scoring with either group', () => {
    const current = createDefaultSettings();
    const {
      preferenceKeywords: _keywords,
      preferenceProfileEnabled: _profileEnabled,
      ...legacy
    } = current;
    const { multimodal: _multimodal, ...legacyChat } = legacy.chat;
    const loaded = loadSettings({ ...legacy, chat: legacyChat });

    expect(loaded.chat.multimodal).toBe(false);
    expect(loaded.preferenceKeywords).toEqual({ interested: [], uninterested: [] });
    expect(loaded.preferenceProfileEnabled).toBe(true);
    expect(preferenceKeywordsReady(loaded.preferenceKeywords)).toBe(false);
    expect(preferenceKeywordsReady({ interested: ['RAG'], uninterested: [] })).toBe(true);
    expect(preferenceKeywordsReady({ interested: [], uninterested: ['营销炒作'] })).toBe(true);
    expect(preferenceKeywordsReady({ interested: ['RAG'], uninterested: ['营销炒作'] })).toBe(true);
  });

  it('repairs stale disabled flags for known visual models on load and save', () => {
    const stale = {
      ...createDefaultSettings(),
      chat: endpoint({
        model: ' KIMI-K3 ',
        multimodal: false,
        preset: 'kimi',
      }),
      chatSecretProfiles: {
        vision: {
          baseURL: 'https://api.deepseek.com',
          model: 'DeepSeek-V4-Flash-Vision-Exp',
          multimodal: false,
          preset: 'deepseek' as const,
        },
      },
    };

    expect(loadSettings(stale).chat.multimodal).toBe(true);
    expect(loadSettings(stale).chatSecretProfiles.vision?.multimodal).toBe(true);
    expect(serializeSettings(stale).chat.multimodal).toBe(true);
    expect(serializeSettings(stale).chatSecretProfiles.vision?.multimodal).toBe(true);
  });

  it('remembers and restores provider profiles per SecretStorage key', () => {
    const settings = createDefaultSettings();
    const kimi = rememberChatSecretProfile(
      {
        ...settings,
        chat: {
          baseURL: 'https://api.moonshot.cn/v1',
          connectionTest: null,
          model: 'kimi-k3',
          multimodal: false,
          preset: 'kimi',
          secretName: 'kimi-key',
        },
      },
      'kimi-key',
    );
    const switched: SelfGrowSettings = {
      ...kimi,
      chat: {
        baseURL: 'https://api.deepseek.com',
        connectionTest: null,
        model: 'deepseek-v4-flash',
        multimodal: false,
        preset: 'deepseek',
        secretName: 'deepseek-key',
      },
    };
    const restored = applyChatSecretProfile(switched, 'kimi-key');
    expect(restored.chat).toMatchObject({
      baseURL: 'https://api.moonshot.cn/v1',
      model: 'kimi-k3',
      multimodal: true,
      preset: 'kimi',
      secretName: 'kimi-key',
    });
  });

  it('rejects invalid current settings and unsafe endpoint fields', () => {
    expect(loadSettings(null)).toEqual(createDefaultSettings());
    expect(() => loadSettings({ schemaVersion: 99 })).toThrow(SelfGrowError);
    const settings = createDefaultSettings();
    expect(() =>
      loadSettings({ ...settings, chat: { ...settings.chat, secretValue: OBVIOUSLY_FAKE_SECRET } }),
    ).toThrow(SelfGrowError);
  });
});
