import type { SecretStorage } from 'obsidian';
import type { SecretReference, SecretResolver } from './ports';

export class ObsidianSecretResolver implements SecretResolver {
  readonly #storage: Pick<SecretStorage, 'getSecret'>;

  constructor(storage: Pick<SecretStorage, 'getSecret'>) {
    this.#storage = storage;
  }

  get(reference: SecretReference): string | null {
    return this.#storage.getSecret(reference.name);
  }
}
