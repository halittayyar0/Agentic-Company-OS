import type { EnduranceMode } from "./report-schema";

export class ScenarioClock {
  readonly mode: EnduranceMode;
  readonly startedAt: Date;
  private virtualMinute = 0;
  private readonly wallNow: () => Date;

  constructor(input: {
    mode: EnduranceMode;
    startedAt?: Date;
    wallNow?: () => Date;
  }) {
    this.mode = input.mode;
    this.startedAt = new Date(input.startedAt ?? new Date());
    if (Number.isNaN(this.startedAt.getTime())) {
      throw new TypeError("Scenario start must be a valid date");
    }
    this.wallNow = input.wallNow ?? (() => new Date());
  }

  get minute(): number {
    if (this.mode === "accelerated") return this.virtualMinute;
    return Math.max(
      0,
      Math.floor(
        (this.wallNow().getTime() - this.startedAt.getTime()) / 60_000,
      ),
    );
  }

  now(): Date {
    return this.mode === "accelerated"
      ? new Date(this.startedAt.getTime() + this.virtualMinute * 60_000)
      : new Date(this.wallNow());
  }

  advanceMinutes(minutes: number): Date {
    if (this.mode !== "accelerated") {
      throw new TypeError("Wall-clock scenarios cannot advance virtual time");
    }
    if (!Number.isSafeInteger(minutes) || minutes <= 0) {
      throw new TypeError("minutes must be a positive integer");
    }
    this.virtualMinute += minutes;
    return this.now();
  }
}
