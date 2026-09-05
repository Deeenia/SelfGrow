import type { Language } from '../domain';

export function recommendationDegree(score: number, language: Language): string {
  if (score < 40) return language === 'zh-CN' ? '不太推荐' : 'Low fit';
  if (score < 60) return language === 'zh-CN' ? '一般' : 'Moderate fit';
  if (score < 80) return language === 'zh-CN' ? '值得关注' : 'Worth reviewing';
  return language === 'zh-CN' ? '强烈推荐' : 'Strongly recommended';
}
