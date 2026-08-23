declare const selfGrowIDBrand: unique symbol;
declare const vaultPathBrand: unique symbol;

export type SelfGrowID = string & { readonly [selfGrowIDBrand]: true };
export type VaultPath = string & { readonly [vaultPathBrand]: true };

export function selfGrowID(value: string): SelfGrowID {
  if (value.length === 0) {
    throw new TypeError('SelfGrow ID must not be empty.');
  }
  return value as SelfGrowID;
}

export function vaultPath(value: string): VaultPath {
  const segments = value.split('/');
  if (
    value.length === 0 ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('\\') ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new TypeError('Vault path must be non-empty and normalized.');
  }
  return value as VaultPath;
}

export const LANGUAGES = ['zh-CN', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const PLATFORMS = [
  'youtube',
  'bilibili',
  'xiaohongshu',
  'douyin',
  'wechat_official_account',
  'generic_web',
  'unknown',
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const CAPTURE_METHODS = ['share_sheet', 'clipboard_shortcut', 'shared_text'] as const;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

export const RAW_CATEGORIES = ['Project', 'Skill', 'Experience'] as const;
export type RawCategory = (typeof RAW_CATEGORIES)[number];

export function isRawCategory(value: unknown): value is RawCategory {
  return typeof value === 'string' && (RAW_CATEGORIES as readonly string[]).includes(value);
}

export interface CoreKnowledgeItem {
  explanationMarkdown: string;
  title: string;
}

export interface PreferenceRecommendation {
  matchedInterestedKeywords: readonly string[];
  matchedPreferenceSignals?: readonly string[];
  matchedUninterestedKeywords: readonly string[];
  profileVersion?: string | null;
  protocolVersion: string;
  reason: string;
  score: number;
}

export interface GeneratedKnowledge {
  category: RawCategory;
  coreKnowledge: readonly CoreKnowledgeItem[];
  githubQueries: readonly string[];
  outputLanguage: Language;
  recommendation: PreferenceRecommendation | null;
  recognitionSource: 'ai' | 'local';
  sourceLanguage: string;
  summaryMarkdown: string;
  title: string;
}

export interface InboxCapture {
  attachmentPaths?: readonly VaultPath[];
  collectionFolder?: string;
  captureTitle?: string;
  capturedText?: string;
  captureMethod: CaptureMethod;
  id: SelfGrowID;
  imagePaths?: readonly VaultPath[];
  importedAt: string;
  normalizedURL: string;
  path: VaultPath;
  sourceURL: string;
  state: import('./processing-state').ProcessingState;
}
