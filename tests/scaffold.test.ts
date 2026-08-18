import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Manifest {
  id: string;
  isDesktopOnly: boolean;
  minAppVersion: string;
  name: string;
  version: string;
}

interface PackageMetadata {
  name: string;
  version: string;
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('Task-005 scaffold', () => {
  const manifest = readJson<Manifest>(resolve(projectRoot, 'manifest.json'));
  const packageMetadata = readJson<PackageMetadata>(resolve(projectRoot, 'package.json'));

  it('keeps plugin identity and versions aligned', () => {
    expect(manifest.id).toBe('selfgrow');
    expect(basename(projectRoot).toLowerCase()).toBe(manifest.id);
    expect(packageMetadata.name).toBe(manifest.id);
    expect(packageMetadata.version).toBe(manifest.version);
    expect(manifest.name).toBe('SelfGrow');
  });

  it('declares the required mobile compatibility', () => {
    expect(manifest.isDesktopOnly).toBe(false);
    expect(manifest.minAppVersion).toBe('1.13.0');
  });

  it('contains no stale standalone-app project at the repository root', () => {
    const rootNames = readdirSync(projectRoot);
    const forbiddenNames = [
      'Package.swift',
      'Podfile',
      'SelfGrow.xcodeproj',
      'SelfGrow.xcworkspace',
    ];

    expect(rootNames).not.toEqual(expect.arrayContaining(forbiddenNames));
  });
});
