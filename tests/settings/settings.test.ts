import { describe, expect, it } from 'vitest';
import { SelfGrowError } from '../../src/domain';
import { ObsidianSecretResolver } from '../../src/platform/obsidian-secret-resolver';
import { z } from '../../src/schema/zod';
import {
  EXTRACTION_PROVIDER_PRESETS,
  PROVIDER_PRESETS,
  createDefaultSettings,
  loadSettings,
  markConnectionTested,
  markExtractionTested,
  serializeSettings,
  updateChat,
  updateExtraction,
  type EndpointSettings,
} from '../../src/settings';
import { OBVIOUSLY_FAKE_SECRET } from '../harness';

const testedAt = '2026-08-09T01:30:00.000Z';

function endpoint(overrides: Partial<EndpointSettings> = {}): EndpointSettings {
  return {
    baseURL: 'https://api.example.test/v1',
    connectionTest: null,
    model: 'fixture-model',
    preset: 'custom',
    secretName: 'Shared Fixture Secret',
    ...overrides,
  };
}

describe('settings', () => {
  it('uses mobile-safe validation and only current configuration surfaces', () => {
    const settings = createDefaultSettings();
    expect(z.config().jitless).toBe(true);
    expect(PROVIDER_PRESETS).toEqual(['openai', 'deepseek', 'qwen', 'kimi', 'custom']);
    expect(EXTRACTION_PROVIDER_PRESETS).toEqual(['tikhub', 'custom']);
    expect(settings).toEqual({
      chat: { baseURL: '', connectionTest: null, model: '', preset: 'openai', secretName: '' },
      extraction: null,
      language: 'zh-CN',
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

  it('persists references but never secret values', () => {
    const settings = { ...createDefaultSettings(), chat: endpoint() };
    const json = JSON.stringify(serializeSettings(settings));
    expect(json).toContain('Shared Fixture Secret');
    expect(json).not.toContain(OBVIOUSLY_FAKE_SECRET);
    const resolver = new ObsidianSecretResolver({
      getSecret: (name) => (name === 'Shared Fixture Secret' ? OBVIOUSLY_FAKE_SECRET : null),
    });
    expect(resolver.get({ name: settings.chat.secretName })).toBe(OBVIOUSLY_FAKE_SECRET);
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
