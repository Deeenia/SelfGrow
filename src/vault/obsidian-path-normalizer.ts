import { normalizePath } from 'obsidian';
import type { PathNormalizer } from './path-guard';

export const normalizeObsidianPath: PathNormalizer = normalizePath;
