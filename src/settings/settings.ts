import { LANGUAGES } from '../domain';
import { SelfGrowError } from '../domain/errors';
import { z } from '../schema/zod';

export const PROVIDER_PRESETS = ['openai', 'deepseek', 'qwen', 'kimi', 'custom'] as const;
export const EXTRACTION_PROVIDER_PRESETS = ['tikhub', 'custom'] as const;

const providerPresetSchema = z.enum(PROVIDER_PRESETS);
const connectionTestSchema = z.strictObject({
  configurationFingerprint: z.string().min(1),
  modelFingerprint: z.string().min(1),
  testedAt: z.string().min(1),
});
const endpointSettingsSchema = z.strictObject({
  baseURL: z.string(),
  connectionTest: connectionTestSchema.nullable(),
  model: z.string(),
  preset: providerPresetSchema,
  secretName: z.string(),
});
const extractionCapabilitySchema = z.strictObject({
  articleBody: z.boolean(),
  platformDetail: z.boolean(),
  subtitles: z.boolean(),
});
const extractionConnectionTestSchema = z.strictObject({
  capabilities: extractionCapabilitySchema,
  configurationFingerprint: z.string().min(1),
  testedAt: z.string().min(1),
});
const extractionProviderSettingsSchema = z.strictObject({
  baseURL: z.string(),
  connectionTest: extractionConnectionTestSchema.nullable(),
  disclosureAccepted: z.boolean(),
  preset: z.enum(EXTRACTION_PROVIDER_PRESETS),
  secretName: z.string(),
});

export const selfGrowSettingsSchema = z.strictObject({
  chat: endpointSettingsSchema,
  extraction: extractionProviderSettingsSchema.nullable().default(null),
  language: z.enum(LANGUAGES),
  rootPath: z.string().min(1),
  schemaVersion: z.literal(1),
});

export type ProviderPreset = (typeof PROVIDER_PRESETS)[number];
export type ExtractionProviderPreset = (typeof EXTRACTION_PROVIDER_PRESETS)[number];
export type ConnectionTestMetadata = z.infer<typeof connectionTestSchema>;
export type ExtractionCapabilities = z.infer<typeof extractionCapabilitySchema>;
export type ExtractionConnectionTestMetadata = z.infer<typeof extractionConnectionTestSchema>;
export type ExtractionProviderSettings = z.infer<typeof extractionProviderSettingsSchema>;
export type EndpointSettings = z.infer<typeof endpointSettingsSchema>;
export type SelfGrowSettings = z.infer<typeof selfGrowSettingsSchema>;

export interface ConnectionTestResult {
  fingerprint: string;
  testedAt: string;
}

export interface SettingsLogSummary {
  chatConfigured: boolean;
  language: SelfGrowSettings['language'];
  schemaVersion: 1;
}

export function createDefaultSettings(): SelfGrowSettings {
  return {
    chat: emptyEndpoint('openai'),
    extraction: null,
    language: 'zh-CN',
    rootPath: 'Raw',
    schemaVersion: 1,
  };
}

export function loadSettings(input: unknown): SelfGrowSettings {
  if (input === null || input === undefined) {
    return createDefaultSettings();
  }

  const source = typeof input === 'object' && input !== null ? input : {};
  const result = selfGrowSettingsSchema.safeParse({
    chat: (source as { chat?: unknown }).chat,
    extraction: (source as { extraction?: unknown }).extraction,
    language: (source as { language?: unknown }).language,
    rootPath: (source as { rootPath?: unknown }).rootPath,
    schemaVersion: (source as { schemaVersion?: unknown }).schemaVersion,
  });
  if (!result.success) {
    throw new SelfGrowError('OBSIDIAN_API_FAILED', 'Stored SelfGrow settings are invalid.', {
      issueCount: result.error.issues.length,
    });
  }

  return {
    ...result.data,
    chat: invalidateStaleConnectionTest(result.data.chat),
    extraction: invalidateStaleExtractionTest(result.data.extraction),
  };
}

export function serializeSettings(settings: SelfGrowSettings): SelfGrowSettings {
  return selfGrowSettingsSchema.parse(settings);
}

export function updateChat(
  settings: SelfGrowSettings,
  patch: Partial<EndpointConfiguration>,
): SelfGrowSettings {
  return { ...settings, chat: updateEndpoint(settings.chat, patch) };
}

export function updateExtraction(
  settings: SelfGrowSettings,
  patch: Partial<ExtractionProviderConfiguration> | null,
): SelfGrowSettings {
  if (patch === null) return { ...settings, extraction: null };
  const current = settings.extraction ?? emptyExtractionProvider('tikhub');
  const updated = { ...current, ...patch };
  return {
    ...settings,
    extraction:
      extractionFingerprint(updated) === extractionFingerprint(current)
        ? updated
        : { ...updated, connectionTest: null },
  };
}

export function markExtractionTested(
  settings: SelfGrowSettings,
  result: { capabilities: ExtractionCapabilities; testedAt: string },
): SelfGrowSettings {
  const extraction = settings.extraction;
  if (extraction === null || !extraction.disclosureAccepted) {
    throw new SelfGrowError(
      'AI_CONFIGURATION_MISSING',
      'Extraction provider disclosure must be accepted before testing.',
    );
  }
  if (!requiredExtractionCapabilities(result.capabilities)) {
    throw new SelfGrowError(
      'AI_PROTOCOL_UNSUPPORTED',
      'The extraction provider does not support all required capabilities.',
    );
  }
  return {
    ...settings,
    extraction: {
      ...extraction,
      connectionTest: {
        capabilities: { ...result.capabilities },
        configurationFingerprint: extractionFingerprint(extraction),
        testedAt: result.testedAt,
      },
    },
  };
}

export function markConnectionTested(
  endpoint: EndpointSettings,
  result: ConnectionTestResult,
): EndpointSettings {
  return {
    ...endpoint,
    connectionTest: {
      configurationFingerprint: endpointFingerprint(endpoint),
      modelFingerprint: result.fingerprint,
      testedAt: result.testedAt,
    },
  };
}

export function settingsLogSummary(settings: SelfGrowSettings): SettingsLogSummary {
  return {
    chatConfigured: endpointConfigured(settings.chat),
    language: settings.language,
    schemaVersion: settings.schemaVersion,
  };
}

type EndpointConfiguration = Pick<EndpointSettings, 'baseURL' | 'model' | 'preset' | 'secretName'>;
type ExtractionProviderConfiguration = Pick<
  ExtractionProviderSettings,
  'baseURL' | 'disclosureAccepted' | 'preset' | 'secretName'
>;

function emptyEndpoint(preset: ProviderPreset): EndpointSettings {
  return { baseURL: '', connectionTest: null, model: '', preset, secretName: '' };
}

function emptyExtractionProvider(preset: ExtractionProviderPreset): ExtractionProviderSettings {
  return {
    baseURL: '',
    connectionTest: null,
    disclosureAccepted: false,
    preset,
    secretName: '',
  };
}

function updateEndpoint(
  endpoint: EndpointSettings,
  patch: Partial<EndpointConfiguration>,
): EndpointSettings {
  const updated = { ...endpoint, ...patch };
  return endpointFingerprint(updated) === endpointFingerprint(endpoint)
    ? updated
    : { ...updated, connectionTest: null };
}

function endpointFingerprint(endpoint: EndpointConfiguration): string {
  return JSON.stringify([endpoint.preset, endpoint.baseURL, endpoint.model, endpoint.secretName]);
}

function invalidateStaleConnectionTest(endpoint: EndpointSettings): EndpointSettings {
  if (
    endpoint.connectionTest === null ||
    endpoint.connectionTest.configurationFingerprint === endpointFingerprint(endpoint)
  ) {
    return endpoint;
  }
  return { ...endpoint, connectionTest: null };
}

function invalidateStaleExtractionTest(
  extraction: ExtractionProviderSettings | null,
): ExtractionProviderSettings | null {
  if (
    extraction === null ||
    extraction.connectionTest === null ||
    extraction.connectionTest.configurationFingerprint === extractionFingerprint(extraction)
  ) {
    return extraction;
  }
  return { ...extraction, connectionTest: null };
}

function extractionFingerprint(configuration: ExtractionProviderConfiguration): string {
  return JSON.stringify([
    configuration.preset,
    configuration.baseURL,
    configuration.secretName,
    configuration.disclosureAccepted,
  ]);
}

function requiredExtractionCapabilities(capabilities: ExtractionCapabilities): boolean {
  return capabilities.articleBody && capabilities.platformDetail && capabilities.subtitles;
}

function endpointConfigured(endpoint: EndpointSettings): boolean {
  return endpoint.baseURL.length > 0 && endpoint.model.length > 0 && endpoint.secretName.length > 0;
}
