export interface ManualCaptureAnalysisInput {
  imageCount: number;
  note: string;
  shareText: string;
}

export interface ManualCaptureAnalysis {
  characterCount: number;
  materialText: string;
  route: 'ai' | 'direct';
  sourceURL: string | null;
}

interface LocatedURL {
  value: string;
}

const URL_CANDIDATE_PATTERN = /(?:https?:\/\/|(?:www\.)?github\.com\/)[^\s<>\u3000]+/giu;
const TRAILING_URL_PUNCTUATION = /[),.;!?\]}>'"，。；：！？）】》」』]+$/u;

export function analyzeManualCapture(input: ManualCaptureAnalysisInput): ManualCaptureAnalysis {
  const located = firstHTTPURL(input.shareText);
  const shareMaterial = located === null ? input.shareText.trim() : '';
  const materialText = [shareMaterial, input.note.trim()]
    .filter((value) => value.length > 0)
    .join('\n\n');
  const characterCount = [...materialText].length;
  const onlyLink = located !== null && characterCount === 0 && input.imageCount === 0;
  const onlyImages = located === null && characterCount === 0 && input.imageCount > 0;
  const hasText = characterCount > 0;

  return {
    characterCount,
    materialText,
    route: hasText || onlyLink || onlyImages ? 'ai' : 'direct',
    sourceURL: located?.value ?? null,
  };
}

export function extractFirstHTTPURL(value: string): string | null {
  return firstHTTPURL(value)?.value ?? null;
}

/**
 * Recognizes a bare project/repository/Skill name (no HTTP(S) URL) that is a
 * candidate for GitHub name completion: short, whitespace-free, and made of
 * ASCII name characters with at most one owner/repo slash.
 */
export function looksLikeGitHubName(value: string): boolean {
  const name = value.trim();
  if (name.length < 2 || name.length > 100 || name.includes(' ')) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)?$/.test(name);
}

function firstHTTPURL(value: string): LocatedURL | null {
  URL_CANDIDATE_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(URL_CANDIDATE_PATTERN)) {
    const raw = match[0];
    if (raw === undefined) continue;
    const trimmed = raw.replace(TRAILING_URL_PUNCTUATION, '');
    const candidate = /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
    if (candidate.length === 0) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      return { value: candidate };
    } catch {
      // Keep searching: a later candidate may be a valid share link.
    }
  }
  return null;
}
