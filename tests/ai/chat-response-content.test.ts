import { describe, expect, it } from 'vitest';
import { assistantContentText } from '../../src/ai/chat-response-content';

describe('assistantContentText', () => {
  it('reads provider text blocks even when type is absent', () => {
    expect(assistantContentText([{ text: '{"title":"卡片"}' }])).toBe('{"title":"卡片"}');
  });

  it('serializes already parsed structured output', () => {
    expect(assistantContentText({ category: 'Experience', title: '卡片' })).toBe(
      '{"category":"Experience","title":"卡片"}',
    );
  });

  it('unwraps nested provider content fields before serializing', () => {
    expect(assistantContentText({ content: { category: 'Skill', title: '方法' } })).toBe(
      '{"category":"Skill","title":"方法"}',
    );
  });
});
