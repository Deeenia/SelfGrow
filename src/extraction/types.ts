import type {
  Language,
  Platform,
  PreferenceRecommendation,
  PreferenceRecommendationIssue,
  RawCategory,
  SelfGrowID,
} from '../domain';
import type { NormalizedURL } from '../url';

export type ExtractionRoute =
  | 'captured_text'
  | 'local_document'
  | 'local_article'
  | 'anonymous_platform'
  | 'third_party_provider'
  | 'visual_preview';

export interface ExtractionRequest {
  attachmentPaths?: readonly string[];
  capturedText?: string;
  documentAIAuthorized?: boolean;
  id: SelfGrowID;
  imagePaths?: readonly string[];
  language: Language;
  suggestedTitle?: string;
  url: NormalizedURL;
}

export interface GitHubDiagnostics {
  owner: string;
  readmeLanguage: Language | null;
  readmePath: string;
  repo: string;
}

export interface ExtractedContent {
  author?: string;
  body: string;
  bodyKind: 'article' | 'transcript';
  canonicalURL?: string;
  documentKind?: 'academic_paper' | 'general_document' | 'markdown';
  finalURL: string;
  github?: GitHubDiagnostics;
  platform: Platform;
  publishedAt?: string;
  route: ExtractionRoute;
  sourceLanguage?: string;
  title?: string;
  visualRecognition?: {
    category: RawCategory;
    recommendation: PreferenceRecommendation | null;
    recommendationIssue?: PreferenceRecommendationIssue | null;
    source: 'ai' | 'local';
  };
}

export type ExtractionOutcome =
  | { content: ExtractedContent; kind: 'complete' }
  | { code: string; kind: 'incomplete'; message: string };

export interface ContentExtractor {
  readonly id: string;
  canHandle(url: URL): boolean;
  extract(request: ExtractionRequest): Promise<ExtractionOutcome>;
}
