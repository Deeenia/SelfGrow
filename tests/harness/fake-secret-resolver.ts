import type { SecretReference, SecretResolver } from '../../src/platform/ports';

export const OBVIOUSLY_FAKE_SECRET = 'selfgrow-fixture-secret-not-valid-for-any-provider';

export class FakeSecretResolver implements SecretResolver {
  readonly #secrets: ReadonlyMap<string, string>;

  constructor(secrets: Readonly<Record<string, string>>) {
    this.#secrets = new Map(Object.entries(secrets));
  }

  get(reference: SecretReference): string | null {
    return this.#secrets.get(reference.name) ?? null;
  }
}
