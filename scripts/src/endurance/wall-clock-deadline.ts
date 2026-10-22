interface DeadlineClock {
  now(): number;
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export async function waitUntilWallClockDeadline(
  deadlineMs: number,
  signal: AbortSignal,
  clock: DeadlineClock,
): Promise<void> {
  // A timer callback can wake before its wall-clock deadline on Windows.
  // Recheck the deadline before allowing a fault, sample or horizon to proceed.
  for (;;) {
    signal.throwIfAborted();
    const remainingMs = deadlineMs - clock.now();
    if (remainingMs <= 0) return;
    await clock.wait(remainingMs, signal);
  }
}
