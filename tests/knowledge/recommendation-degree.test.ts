import { describe, expect, it } from 'vitest';
import { recommendationDegree } from '../../src/knowledge';

describe('recommendationDegree', () => {
  it.each([
    [0, '不太推荐', 'Low fit'],
    [39, '不太推荐', 'Low fit'],
    [40, '一般', 'Moderate fit'],
    [59, '一般', 'Moderate fit'],
    [60, '值得关注', 'Worth reviewing'],
    [79, '值得关注', 'Worth reviewing'],
    [80, '强烈推荐', 'Strongly recommended'],
    [100, '强烈推荐', 'Strongly recommended'],
  ])('maps score %i to stable Chinese and English labels', (score, chinese, english) => {
    expect(recommendationDegree(score, 'zh-CN')).toBe(chinese);
    expect(recommendationDegree(score, 'en')).toBe(english);
  });
});
