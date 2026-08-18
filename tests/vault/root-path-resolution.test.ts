import { describe, expect, it } from 'vitest';
import { resolveSelfGrowRootPath } from '../../src/vault';

const normalize = (value: string) => value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');

describe('resolveSelfGrowRootPath', () => {
  it('keeps an existing configured root', () => {
    expect(resolveSelfGrowRootPath('Raw', ['AI'], (path) => path === 'Raw', normalize)).toBe('Raw');
  });

  it('detects one container folder around Raw for an iCloud parent Vault', () => {
    expect(
      resolveSelfGrowRootPath('Raw', ['AI', 'Archive'], (path) => path === 'AI/Raw', normalize),
    ).toBe('AI/Raw');
  });

  it('fails closed when multiple container folders contain Raw', () => {
    expect(
      resolveSelfGrowRootPath(
        'Raw',
        ['AI', 'Other'],
        (path) => path === 'AI/Raw' || path === 'Other/Raw',
        normalize,
      ),
    ).toBe('Raw');
  });

  it('never overrides an explicit custom root', () => {
    expect(
      resolveSelfGrowRootPath(
        'Personal/Growth',
        ['AI'],
        (path) => path === 'AI/SelfGrow',
        normalize,
      ),
    ).toBe('Personal/Growth');
  });
});
