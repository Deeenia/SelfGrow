import { describe, expect, it } from 'vitest';
import {
  mergePreferenceKeywords,
  parsePreferenceProfile,
  preferenceKeywordSignalsMatch,
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
    const promptValue = preferenceProfilePromptValue(PROFILE);
    expect(promptValue).not.toHaveProperty('sources');
    expect(JSON.stringify(promptValue)).not.toContain('reproducible-evidence');
    expect(promptValue).toMatchObject({
      negativePreferences: [
        { description: '结论缺少可检查的来源、数据或推理。', label: '缺少证据', weight: -10 },
      ],
      positivePreferences: [
        { description: '包含可复现的数据、代码或方法步骤。', label: '可复现证据', weight: 12 },
      ],
      profileVersion: '2026-08-24-1',
    });
  });

  it('rejects duplicate profile IDs and invalid weight polarity', () => {
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

  it('creates a keyword-first base profile and recognizes its manual signals', async () => {
    const result = await mergePreferenceKeywords(
      null,
      { interested: ['学术阅读'], uninterested: ['统计学'] },
      'zh-CN',
      new Date('2026-08-25T15:00:00.000Z'),
    );

    expect(result.negativeSignals[0]).toMatchObject({
      label: '不感兴趣：统计学',
      weight: -8,
    });
    expect(result.negativeSignals[0]?.id).toMatch(/^manual-uninterest-/u);
    expect(result.positiveSignals[0]).toMatchObject({ label: '感兴趣：学术阅读', weight: 8 });
    expect(result.positiveSignals[0]?.id).toMatch(/^manual-interest-/u);
    expect(result.profileVersion).toMatch(/^profile-20260825T150000000Z-/u);
    expect(result.sources).toEqual([]);
    expect(
      preferenceKeywordSignalsMatch(result, {
        interested: ['学术阅读'],
        uninterested: ['统计学'],
      }),
    ).toBe(true);
  });

  it('preserves agent-derived signals and sources when keywords update an existing profile', async () => {
    const withKeywords = await mergePreferenceKeywords(
      PROFILE,
      { interested: ['RAG'], uninterested: ['营销推广'] },
      'zh-CN',
      new Date('2026-08-25T15:01:00.000Z'),
    );
    const updated = await mergePreferenceKeywords(
      withKeywords,
      { interested: ['多模态'], uninterested: [] },
      'zh-CN',
      new Date('2026-08-25T15:02:00.000Z'),
    );

    expect(updated.positiveSignals).toEqual(
      expect.arrayContaining([
        PROFILE.positiveSignals[0],
        expect.objectContaining({ label: '感兴趣：多模态' }),
      ]),
    );
    expect(updated.positiveSignals).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: '感兴趣：RAG' })]),
    );
    expect(updated.negativeSignals).toEqual(PROFILE.negativeSignals);
    expect(updated.sources).toEqual(PROFILE.sources);
  });
});
