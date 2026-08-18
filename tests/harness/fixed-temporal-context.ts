import type { TemporalContext } from '../../src/platform/ports';

export class FixedTemporalContext implements TemporalContext {
  readonly #instant: Date;
  readonly #timeZone: string;

  constructor(instant: string | Date, timeZone: string) {
    this.#instant = new Date(instant);
    this.#timeZone = timeZone;
  }

  now(): Date {
    return new Date(this.#instant);
  }

  timeZone(): string {
    return this.#timeZone;
  }
}
