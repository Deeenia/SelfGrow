import { describe, expect, it } from 'vitest';
import { SelfGrowError } from '../../src/domain';
import { PathGuard } from '../../src/vault/path-guard';

function fixtureNormalizePath(path: string): string {
  const output: string[] = [];
  for (const segment of path.replaceAll('\\', '/').split('/')) {
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') output.pop();
    else output.push(segment);
  }
  return output.join('/');
}

describe('Task-009 Vault path guard', () => {
  const guard = new PathGuard('SelfGrow/', fixtureNormalizePath);

  it('normalizes every accepted path', () => {
    expect(guard.rootPath).toBe('SelfGrow');
    expect(guard.assertWithinRoot('SelfGrow\\Inbox\\capture.md')).toBe('SelfGrow/Inbox/capture.md');
    expect(guard.join('Knowledge', 'AI', 'note.md')).toBe('SelfGrow/Knowledge/AI/note.md');
  });

  it.each(['Other/note.md', 'SelfGrow/../Other/note.md', '../SelfGrowElsewhere/note.md', '/'])(
    'rejects an out-of-root or invalid target: %s',
    (path) => {
      expect(() => guard.assertWithinRoot(path)).toThrow(SelfGrowError);
      expect(guard.contains(path)).toBe(false);
    },
  );

  it('distinguishes the root from a destructive descendant target', () => {
    expect(guard.assertWithinRoot('SelfGrow')).toBe('SelfGrow');
    expect(() => guard.assertDescendant('SelfGrow')).toThrow(SelfGrowError);
    expect(guard.assertDescendant('SelfGrow/Inbox')).toBe('SelfGrow/Inbox');
  });
});
