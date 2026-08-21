import { describe, expect, it } from 'vitest';
import { selfGrowID, vaultPath, type GeneratedKnowledge } from '../../src/domain';

describe('domain models', () => {
  it('brands validated IDs and portable Vault paths', () => {
    expect(selfGrowID('id-1')).toBe('id-1');
    expect(vaultPath('SelfGrow/Knowledge/note.md')).toBe('SelfGrow/Knowledge/note.md');
    expect(() => vaultPath('../outside')).toThrow(TypeError);
  });

  it('keeps generation focused on compact knowledge only', () => {
    const knowledge: GeneratedKnowledge = {
      category: 'Project',
      coreKnowledge: [{ explanationMarkdown: 'Path.', title: 'Method' }],
      githubQueries: [],
      outputLanguage: 'en',
      recommendation: null,
      recognitionSource: 'local',
      sourceLanguage: 'en',
      summaryMarkdown: 'Dense summary.',
      title: 'Title',
    };
    expect(knowledge.coreKnowledge).toHaveLength(1);
  });
});
