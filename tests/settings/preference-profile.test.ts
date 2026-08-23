import { describe, expect, it } from 'vitest';
import {
  applyPreferenceProfile,
  parsePreferenceProfile,
  preferenceProfilePromptValue,
  type PreferenceProfile,
} from '../../src/settings';

const PROFILE: PreferenceProfile = {
  schemaVersion: 1,
  profileVersion: '2026-08-24-1',
  updatedAt: '2026-08-24T01:00:00Z',
  positiveSignals: [
    {
      description: '包含可复现的数据、代码或方法步骤。',
      id: 'reproducible-evidence',
      label: '可复现证据',
      weight: 12,
    },
  ],
  negativeSignals: [
    {
      description: '结论缺少可检查的来源、数据或推理。',
      id: 'unsupported-claims',
      label: '缺少证据',
      weight: -10,
    },
  ],
  sources: [{ project: 'Fixture', summaryHash: 'a'.repeat(64) }],
};

describe('preference profile', () => {
  it('validates a bounded user-approved profile and omits sources from model context', () => {
    expect(parsePreferenceProfile(PROFILE)).toEqual(PROFILE);
    expect(preferenceProfilePromptValue(PROFILE)).not.toHaveProperty('sources');
  });

  it('applies unique approved signal weights and clamps the final score', () => {
    expect(
      applyPreferenceProfile(96, ['reproducible-evidence', 'reproducible-evidence'], PROFILE),
    ).toEqual({ matchedLabels: ['可复现证据'], score: 100 });
    expect(applyPreferenceProfile(8, ['unsupported-claims'], PROFILE)).toEqual({
      matchedLabels: ['缺少证据'],
      score: 0,
    });
  });

  it('rejects invented IDs, duplicate profile IDs, and invalid weight polarity', () => {
    expect(applyPreferenceProfile(50, ['invented-signal'], PROFILE)).toBeNull();
    expect(() =>
      parsePreferenceProfile({
        ...PROFILE,
        negativeSignals: [
          {
            ...PROFILE.negativeSignals[0],
            id: PROFILE.positiveSignals[0]?.id,
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      parsePreferenceProfile({
        ...PROFILE,
        positiveSignals: [{ ...PROFILE.positiveSignals[0], weight: -1 }],
      }),
    ).toThrow();
  });
});
