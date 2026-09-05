import { describe, expect, it } from 'vitest';
import { PreferenceProfileStore, type PreferenceProfile } from '../../src/settings';
import { FixedTemporalContext, InMemoryVault } from '../harness';

const CLOCK = new FixedTemporalContext('2026-08-25T16:00:00.000Z', 'Asia/Shanghai');

describe('PreferenceProfileStore', () => {
  it('creates a keyword-first base profile in the sibling Preferences folder', async () => {
    const vault = new InMemoryVault(CLOCK);
    const store = new PreferenceProfileStore({ clock: CLOCK, rawRoot: 'AI/Raw', vault });

    const profile = await store.syncKeywords(
      { interested: ['学术阅读'], uninterested: ['营销推广'] },
      'zh-CN',
    );

    expect(profile).toMatchObject({
      positiveSignals: [expect.objectContaining({ label: '感兴趣：学术阅读' })],
      negativeSignals: [expect.objectContaining({ label: '不感兴趣：营销推广' })],
      sources: [],
    });
    expect(await vault.read('AI/Preferences/preference-profile.json')).toContain(
      '"profileVersion"',
    );
  });

  it('preserves an agent-first profile when keywords are added and later changed', async () => {
    const agentProfile: PreferenceProfile = {
      schemaVersion: 1,
      profileVersion: 'agent-v1',
      updatedAt: '2026-08-25T15:00:00.000Z',
      positiveSignals: [
        {
          description: '偏好能够复现实验步骤的资料。',
          id: 'reproducible-methods',
          label: '可复现方法',
          weight: 12,
        },
      ],
      negativeSignals: [],
      sources: [{ project: 'Fixture', summaryHash: 'a'.repeat(64) }],
    };
    const vault = new InMemoryVault(CLOCK, [
      {
        content: `${JSON.stringify(agentProfile, null, 2)}\n`,
        path: 'AI/Preferences/preference-profile.json',
      },
    ]);
    const store = new PreferenceProfileStore({ clock: CLOCK, rawRoot: 'AI/Raw', vault });

    await store.syncKeywords({ interested: ['RAG'], uninterested: [] }, 'zh-CN');
    const updated = await store.syncKeywords({ interested: ['多模态'], uninterested: [] }, 'zh-CN');

    expect(updated?.positiveSignals).toEqual(
      expect.arrayContaining([
        agentProfile.positiveSignals[0],
        expect.objectContaining({ label: '感兴趣：多模态' }),
      ]),
    );
    expect(updated?.positiveSignals).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: '感兴趣：RAG' })]),
    );
    expect(updated?.sources).toEqual(agentProfile.sources);
  });

  it('refuses to overwrite an invalid existing profile', async () => {
    const vault = new InMemoryVault(CLOCK, [
      { content: '{invalid', path: 'AI/Preferences/preference-profile.json' },
    ]);
    const store = new PreferenceProfileStore({ clock: CLOCK, rawRoot: 'AI/Raw', vault });

    await expect(
      store.syncKeywords({ interested: ['RAG'], uninterested: [] }, 'zh-CN'),
    ).rejects.toMatchObject({ code: 'OBSIDIAN_API_FAILED' });
    await expect(vault.read('AI/Preferences/preference-profile.json')).resolves.toBe('{invalid');
  });
});
