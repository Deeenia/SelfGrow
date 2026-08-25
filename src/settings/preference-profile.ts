import { z } from '../schema/zod';
import { SelfGrowError, type Language } from '../domain';
import type { PreferenceKeywordSettings } from './settings';

const PROFILE_SIGNAL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUMMARY_HASH = /^[a-f0-9]{64}$/;
const MAX_SIGNALS_PER_POLARITY = 50;
const MANUAL_INTEREST_PREFIX = 'manual-interest-';
const MANUAL_UNINTEREST_PREFIX = 'manual-uninterest-';
const MANUAL_SIGNAL_WEIGHT = 8;

const positiveSignalSchema = z.strictObject({
  description: z.string().min(1).max(240),
  id: z.string().min(1).max(64).regex(PROFILE_SIGNAL_ID),
  label: z.string().min(1).max(40),
  weight: z.number().int().min(1).max(20),
});

const negativeSignalSchema = positiveSignalSchema.extend({
  weight: z.number().int().min(-20).max(-1),
});

const preferenceProfileSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    profileVersion: z.string().min(1).max(64),
    updatedAt: z
      .string()
      .min(1)
      .max(64)
      .refine((value) => Number.isFinite(Date.parse(value))),
    positiveSignals: z.array(positiveSignalSchema).max(MAX_SIGNALS_PER_POLARITY),
    negativeSignals: z.array(negativeSignalSchema).max(MAX_SIGNALS_PER_POLARITY),
    sources: z
      .array(
        z.strictObject({
          project: z.string().min(1).max(120),
          summaryHash: z.string().regex(SUMMARY_HASH),
        }),
      )
      .max(30),
  })
  .refine(
    (profile) => {
      const ids = [...profile.positiveSignals, ...profile.negativeSignals].map(
        (signal) => signal.id,
      );
      return new Set(ids).size === ids.length;
    },
    { message: 'Preference signal IDs must be unique.' },
  );

export type PreferenceProfile = z.infer<typeof preferenceProfileSchema>;

export type PreferenceProfileStatus =
  | { path: string; state: 'missing' }
  | { path: string; state: 'invalid' }
  | {
      path: string;
      profileVersion: string;
      state: 'ready';
      updatedAt: string;
    };

export function parsePreferenceProfile(input: unknown): PreferenceProfile {
  return preferenceProfileSchema.parse(input);
}

export function parsePreferenceProfileJSON(input: string): PreferenceProfile {
  return parsePreferenceProfile(JSON.parse(input) as unknown);
}

export function preferenceProfilePromptValue(profile: PreferenceProfile): object {
  return {
    negativePreferences: profile.negativeSignals.map(({ description, label, weight }) => ({
      description,
      label,
      weight,
    })),
    positivePreferences: profile.positiveSignals.map(({ description, label, weight }) => ({
      description,
      label,
      weight,
    })),
    profileVersion: profile.profileVersion,
    schemaVersion: profile.schemaVersion,
  };
}

export function preferenceProfileHasSignals(profile: PreferenceProfile): boolean {
  return profile.positiveSignals.length > 0 || profile.negativeSignals.length > 0;
}

export function preferenceKeywordSignalsMatch(
  profile: PreferenceProfile,
  keywords: PreferenceKeywordSettings,
): boolean {
  return (
    sameLabels(
      manualLabels(profile.positiveSignals, MANUAL_INTEREST_PREFIX),
      keywords.interested,
    ) &&
    sameLabels(
      manualLabels(profile.negativeSignals, MANUAL_UNINTEREST_PREFIX),
      keywords.uninterested,
    )
  );
}

export async function mergePreferenceKeywords(
  profile: PreferenceProfile | null,
  keywords: PreferenceKeywordSettings,
  language: Language,
  now: Date = new Date(),
): Promise<PreferenceProfile> {
  const positiveSignals =
    profile?.positiveSignals.filter((signal) => !signal.id.startsWith(MANUAL_INTEREST_PREFIX)) ??
    [];
  const negativeSignals =
    profile?.negativeSignals.filter((signal) => !signal.id.startsWith(MANUAL_UNINTEREST_PREFIX)) ??
    [];
  positiveSignals.push(
    ...(await Promise.all(
      keywords.interested.map(async (keyword) => ({
        description:
          language === 'zh-CN'
            ? '用户在插件中明确选择，希望相关内容提高推荐度。'
            : 'The user explicitly selected this topic in the plugin to raise its recommendation score.',
        id: `${MANUAL_INTEREST_PREFIX}${await shortDigest(keyword)}`,
        label: language === 'zh-CN' ? `感兴趣：${keyword}` : `Interested: ${keyword}`,
        weight: MANUAL_SIGNAL_WEIGHT,
      })),
    )),
  );
  negativeSignals.push(
    ...(await Promise.all(
      keywords.uninterested.map(async (keyword) => ({
        description:
          language === 'zh-CN'
            ? '用户在插件中明确选择，希望相关内容降低推荐度。'
            : 'The user explicitly selected this topic in the plugin to lower its recommendation score.',
        id: `${MANUAL_UNINTEREST_PREFIX}${await shortDigest(keyword)}`,
        label: language === 'zh-CN' ? `不感兴趣：${keyword}` : `Not interested: ${keyword}`,
        weight: -MANUAL_SIGNAL_WEIGHT,
      })),
    )),
  );
  if (
    positiveSignals.length > MAX_SIGNALS_PER_POLARITY ||
    negativeSignals.length > MAX_SIGNALS_PER_POLARITY
  ) {
    throw new SelfGrowError(
      'OBSIDIAN_API_FAILED',
      'The combined preference profile contains too many signals.',
    );
  }
  const versionDigest = await shortDigest(
    JSON.stringify([keywords.interested, keywords.uninterested, now.toISOString()]),
  );
  return parsePreferenceProfile({
    schemaVersion: 1,
    profileVersion: `profile-${compactTimestamp(now)}-${versionDigest}`,
    updatedAt: now.toISOString(),
    positiveSignals,
    negativeSignals,
    sources: profile?.sources ?? [],
  });
}

function manualLabels(
  signals: PreferenceProfile['positiveSignals'] | PreferenceProfile['negativeSignals'],
  prefix: string,
): string[] {
  return signals
    .filter((signal) => signal.id.startsWith(prefix))
    .map((signal) =>
      signal.label.replace(/^(?:感兴趣|不感兴趣|Interested|Not interested)[:：]?\s*/u, ''),
    );
}

function sameLabels(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = left.map(normalizeLabel).sort();
  const normalizedRight = right.map(normalizeLabel).sort();
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function normalizeLabel(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

function compactTimestamp(value: Date): string {
  return value.toISOString().replace(/[-:.]/gu, '');
}

async function shortDigest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalizeLabel(value)),
  );
  return [...new Uint8Array(bytes)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
