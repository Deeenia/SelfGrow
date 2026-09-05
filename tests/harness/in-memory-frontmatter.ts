import type { Frontmatter, FrontmatterPort } from '../../src/platform/ports';

function clone(value: Frontmatter): Record<string, unknown> {
  return structuredClone(value);
}

export class InMemoryFrontmatter implements FrontmatterPort {
  readonly #byPath = new Map<string, Record<string, unknown>>();

  constructor(entries: Readonly<Record<string, Frontmatter>> = {}) {
    for (const [path, frontmatter] of Object.entries(entries)) {
      this.#byPath.set(path, clone(frontmatter));
    }
  }

  async process(
    path: string,
    update: (current: Frontmatter) => Record<string, unknown>,
  ): Promise<void> {
    const current = this.#byPath.get(path) ?? {};
    this.#byPath.set(path, clone(update(clone(current))));
  }

  async read(path: string): Promise<Frontmatter | null> {
    const frontmatter = this.#byPath.get(path);
    return frontmatter === undefined ? null : clone(frontmatter);
  }
}
