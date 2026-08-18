export const SELF_GROW_ERROR_CODES = [
  'INVALID_URL',
  'UNSAFE_URL',
  'NETWORK_UNAVAILABLE',
  'AI_CONFIGURATION_MISSING',
  'AI_CONNECTION_TEST_FAILED',
  'AI_AUTHENTICATION_FAILED',
  'AI_MODEL_NOT_FOUND',
  'AI_PROTOCOL_UNSUPPORTED',
  'AI_OUTPUT_INVALID',
  'EXTRACTION_INCOMPLETE',
  'EXTRACTION_FAILED',
  'INBOX_NOTE_INVALID',
  'INBOX_CAPTURE_NOT_FOUND',
  'KNOWLEDGE_NOTE_INVALID',
  'RAW_SELECTION_INVALID',
  'RAW_CONTENT_CHANGED',
  'DISTILLATION_NOT_APPROVED',
  'NOTE_SECTION_CONFLICT',
  'TOPIC_PATH_INVALID',
  'DUPLICATE_URL',
  'SECRET_NOT_FOUND',
  'PERMANENT_DELETION_NOT_CONFIRMED',
  'OBSIDIAN_API_FAILED',
] as const;

export type SelfGrowErrorCode = (typeof SELF_GROW_ERROR_CODES)[number];

export type SafeDiagnosticValue = boolean | number | string | null;

export class SelfGrowError extends Error {
  readonly code: SelfGrowErrorCode;
  readonly diagnostics: Readonly<Record<string, SafeDiagnosticValue>>;

  constructor(
    code: SelfGrowErrorCode,
    safeMessage: string,
    diagnostics: Readonly<Record<string, SafeDiagnosticValue>> = {},
  ) {
    super(safeMessage);
    this.name = 'SelfGrowError';
    this.code = code;
    this.diagnostics = Object.freeze({ ...diagnostics });
  }
}

export function isSelfGrowError(error: unknown): error is SelfGrowError {
  return error instanceof SelfGrowError;
}
