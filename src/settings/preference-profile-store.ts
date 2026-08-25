import { SelfGrowError, type Language } from '../domain';
import type { TemporalContext, VaultTreePort } from '../platform/ports';
import {
  mergePreferenceKeywords,
  parsePreferenceProfileJSON,
  preferenceKeywordSignalsMatch,
  type PreferenceProfile,
  type PreferenceProfileStatus,
} from './preference-profile';
import type { PreferenceKeywordSettings } from './settings';

export class PreferenceProfileStore {
  readonly #clock: TemporalContext;
  readonly #rawRoot: string;
  readonly #vault: VaultTreePort;

  constructor(dependencies: { clock: TemporalContext; rawRoot: string; vault: VaultTreePort }) {
    this.#clock = dependencies.clock;
    this.#rawRoot = dependencies.rawRoot;
    this.#vault = dependencies.vault;
  }

  async load(): Promise<{
    profile: PreferenceProfile | null;
    status: PreferenceProfileStatus;
  }> {
    const path = preferenceProfilePath(this.#rawRoot);
    if (!(await this.#vault.exists(path))) {
      return { profile: null, status: { path, state: 'missing' } };
    }
    try {
      const profile = parsePreferenceProfileJSON(await this.#vault.read(path));
      return {
        profile,
        status: {
          path,
          profileVersion: profile.profileVersion,
          state: 'ready',
          updatedAt: profile.updatedAt,
        },
      };
    } catch {
      return { profile: null, status: { path, state: 'invalid' } };
    }
  }

  async syncKeywords(
    keywords: PreferenceKeywordSettings,
    language: Language,
  ): Promise<PreferenceProfile | null> {
    const current = await this.load();
    if (current.status.state === 'invalid') {
      throw new SelfGrowError(
        'OBSIDIAN_API_FAILED',
        'The existing preference profile is invalid and was not overwritten.',
      );
    }
    if (current.profile !== null && preferenceKeywordSignalsMatch(current.profile, keywords)) {
      return current.profile;
    }
    if (
      current.profile === null &&
      keywords.interested.length === 0 &&
      keywords.uninterested.length === 0
    ) {
      return null;
    }

    const profile = await mergePreferenceKeywords(
      current.profile,
      keywords,
      language,
      this.#clock.now(),
    );
    const path = preferenceProfilePath(this.#rawRoot);
    const parent = path.slice(0, path.lastIndexOf('/'));
    if (!(await this.#vault.exists(parent))) await this.#vault.createFolder(parent);
    const serialized = `${JSON.stringify(profile, null, 2)}\n`;
    if (await this.#vault.exists(path)) await this.#vault.process(path, () => serialized);
    else await this.#vault.create(path, serialized);
    return profile;
  }
}

export function preferenceProfilePath(rawRoot: string): string {
  const segments = rawRoot
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/gu, '')
    .split('/');
  segments.pop();
  return [...segments, 'Preferences', 'preference-profile.json'].join('/');
}
