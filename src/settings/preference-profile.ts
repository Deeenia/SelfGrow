import { z } from '../schema/zod';

const PROFILE_SIGNAL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUMMARY_HASH = /^[a-f0-9]{64}$/;

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
    positiveSignals: z.array(positiveSignalSchema).max(20),
    negativeSignals: z.array(negativeSignalSchema).max(20),
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
export type PreferenceProfileSignal =
  PreferenceProfile['positiveSignals'][number] | PreferenceProfile['negativeSignals'][number];

export type PreferenceProfileStatus =
  | { path: string; state: 'missing' }
  | { path: string; state: 'invalid' }
  | {
      path: string;
      profileVersion: string;
      state: 'ready';
      updatedAt: string;
    };

export interface AppliedPreferenceProfile {
  matchedLabels: readonly string[];
  score: number;
}

export function parsePreferenceProfile(input: unknown): PreferenceProfile {
  return preferenceProfileSchema.parse(input);
}

export function parsePreferenceProfileJSON(input: string): PreferenceProfile {
  return parsePreferenceProfile(JSON.parse(input) as unknown);
}

export function preferenceProfilePromptValue(profile: PreferenceProfile): object {
  return {
    negativeSignals: profile.negativeSignals,
    positiveSignals: profile.positiveSignals,
    profileVersion: profile.profileVersion,
    schemaVersion: profile.schemaVersion,
  };
}

export function applyPreferenceProfile(
  baseScore: number,
  reportedSignalIDs: readonly string[],
  profile: PreferenceProfile,
): AppliedPreferenceProfile | null {
  const signals = new Map<string, PreferenceProfileSignal>();
  for (const signal of [...profile.positiveSignals, ...profile.negativeSignals]) {
    signals.set(signal.id, signal);
  }
  const matched: PreferenceProfileSignal[] = [];
  const seen = new Set<string>();
  for (const reported of reportedSignalIDs) {
    const id = reported.trim();
    const signal = signals.get(id);
    if (signal === undefined) return null;
    if (seen.has(id)) continue;
    seen.add(id);
    matched.push(signal);
  }
  const adjustment = matched.reduce((sum, signal) => sum + signal.weight, 0);
  return {
    matchedLabels: matched.map((signal) => signal.label),
    score: Math.max(0, Math.min(100, baseScore + adjustment)),
  };
}
