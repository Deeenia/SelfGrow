export const MIN_COMPLETE_CONTENT_CHARS = 200;
export const MAX_COMPLETE_CONTENT_CHARS = 100_000;

export type CompletenessResult =
  | { kind: 'complete'; normalized: string }
  | { kind: 'incomplete'; reason: 'content_too_large' | 'main_text_missing' };

export function validateCompleteContent(input: string): CompletenessResult {
  const normalized = input.replace(/\r\n?/g, '\n').trim();
  const meaningful = normalized.replace(/\s+/g, '');
  if (meaningful.length < MIN_COMPLETE_CONTENT_CHARS) {
    return { kind: 'incomplete', reason: 'main_text_missing' };
  }
  if (normalized.length > MAX_COMPLETE_CONTENT_CHARS) {
    return { kind: 'incomplete', reason: 'content_too_large' };
  }
  return { kind: 'complete', normalized };
}
