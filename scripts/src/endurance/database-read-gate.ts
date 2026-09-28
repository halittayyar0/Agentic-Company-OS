/** Coordinates observations with this driver's deliberate outage. Never retries writes. */
export class DatabaseReadGate {
  private epoch = 0;
  private pending: Promise<void> | null = null;
  private release: (() => void) | null = null;
  constructor(private readonly timeoutMs = 120000) {}
  async pause(operation: () => Promise<void>) {
    if (this.pending) throw new Error("Database pause already active");
    this.epoch++;
    this.pending = new Promise((resolve) => {
      this.release = resolve;
    });
    try {
      await operation();
    } catch (error) {
      this.finish();
      throw error;
    }
  }
  private finish() {
    this.epoch++;
    this.release?.();
    this.pending = null;
    this.release = null;
  }
  async resume(operation: () => Promise<void>) {
    try {
      await operation();
    } finally {
      this.finish();
    }
  }
  private async wait() {
    if (!this.pending) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.pending,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Injected database pause did not recover")),
            this.timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async read<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.wait();
      const startedEpoch = this.epoch;
      try {
        return await operation();
      } catch (error) {
        if (startedEpoch === this.epoch || attempt === 2) throw error;
      }
    }
    throw new Error("Database observation could not settle");
  }
}
