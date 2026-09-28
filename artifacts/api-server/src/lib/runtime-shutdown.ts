import type { Server } from "node:http";
import { performance } from "node:perf_hooks";

const serverClosures = new WeakMap<Server, Promise<void>>();

function isAlreadyClosedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING"
  );
}

/**
 * Stops accepting traffic, permits a short drain, then severs lingering HTTP
 * keep-alive/request sockets. The returned promise is bounded and idempotent
 * so a second shutdown signal cannot create a competing close sequence.
 */
export function closeHttpServerWithin(
  server: Server,
  forceAfterMs: number,
): Promise<void> {
  const existing = serverClosures.get(server);
  if (existing) return existing;

  const boundedForceAfterMs = Number.isFinite(forceAfterMs)
    ? Math.min(60_000, Math.max(1, Math.floor(forceAfterMs)))
    : 2_000;
  const closure = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error && !isAlreadyClosedError(error)) reject(error);
      else resolve();
    };
    const deadline = setTimeout(() => {
      try {
        server.closeAllConnections?.();
      } finally {
        // A server close callback is allowed to lag behind a force-close on
        // some Windows Node builds; cleanup must still remain bounded.
        finish();
      }
    }, boundedForceAfterMs);
    deadline.unref();

    try {
      server.close((error) => finish(error));
      server.closeIdleConnections?.();
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
  serverClosures.set(server, closure);
  return closure;
}

export interface OrderedRuntimeDrainDependencies {
  stopHttpAdmission(): Promise<void>;
  /** Invocation closes claim admission; resolution means active steps settled. */
  stopSchedulerAdmission(): Promise<void>;
  markRuntimeDraining(): Promise<void>;
  /** Fences still-running effects as unknown after the scheduler drain times out. */
  markTimedOutOperationsUnknown?(): Promise<void>;
  closeSessions(): Promise<void>;
  stopEmergencyMonitor(): Promise<void>;
  markRuntimeStopped(): Promise<void>;
  closeDatabase(): Promise<void>;
}

/**
 * Runs one shutdown owner in admission/drain/cleanup order. Browser and VM
 * sessions remain available while scheduler steps retain their task heartbeat;
 * they close only after those steps settle or the explicit deadline expires.
 */
export async function runOrderedRuntimeDrain(
  dependencies: OrderedRuntimeDrainDependencies,
  deadlineMs: number,
): Promise<void> {
  const boundedDeadlineMs = Number.isFinite(deadlineMs)
    ? Math.max(1, Math.floor(deadlineMs))
    : 20_000;
  const failures: unknown[] = [];
  const deadlineError = new Error("Graceful shutdown deadline exceeded");
  const deadlineAt = performance.now() + boundedDeadlineMs;
  let deadlineExpired = false;
  let deadlineRecorded = false;
  let deadline: NodeJS.Timeout | undefined;
  const deadlineSignal = new Promise<never>((_resolve, reject) => {
    deadline = setTimeout(() => {
      deadlineExpired = true;
      reject(deadlineError);
    }, boundedDeadlineMs);
  });
  // The shared deadline can be cleared before any phase races it. Keep its
  // rejection observed even when every dependency finishes synchronously.
  void deadlineSignal.catch(() => undefined);

  const recordFailure = (error: unknown): void => {
    if (error === deadlineError) {
      if (deadlineRecorded) return;
      deadlineRecorded = true;
    }
    failures.push(error);
  };
  const start = (operation: () => Promise<void>): Promise<void> => {
    try {
      const pending = Promise.resolve(operation());
      // A phase abandoned at the absolute deadline may reject later. Observe
      // it without letting that late settlement extend shutdown.
      void pending.catch(() => undefined);
      return pending;
    } catch (error) {
      const pending = Promise.reject(error);
      void pending.catch(() => undefined);
      return pending;
    }
  };
  const waitWithinDeadline = async <T>(pending: Promise<T>): Promise<T> => {
    if (deadlineExpired || performance.now() >= deadlineAt) {
      deadlineExpired = true;
      throw deadlineError;
    }
    try {
      const result = await Promise.race([pending, deadlineSignal]);
      if (deadlineExpired || performance.now() >= deadlineAt) {
        deadlineExpired = true;
        throw deadlineError;
      }
      return result;
    } catch (error) {
      if (deadlineExpired || performance.now() >= deadlineAt) {
        deadlineExpired = true;
        throw deadlineError;
      }
      throw error;
    }
  };

  // Close both admission gates immediately. The scheduler promise resolves
  // only after its already-owned steps have settled.
  const httpClosing = start(dependencies.stopHttpAdmission);
  const schedulerDraining = start(dependencies.stopSchedulerAdmission);

  try {
    await waitWithinDeadline(start(dependencies.markRuntimeDraining));
  } catch (error) {
    recordFailure(error);
  }

  try {
    const admissionResults = await waitWithinDeadline(
      Promise.allSettled([httpClosing, schedulerDraining]),
    );
    for (const result of admissionResults) {
      if (result.status === "rejected") recordFailure(result.reason);
    }
  } catch (error) {
    recordFailure(error);
  }

  if (deadlineExpired && dependencies.markTimedOutOperationsUnknown) {
    const fenceBudgetMs = Math.min(
      1_000,
      Math.max(50, Math.floor(boundedDeadlineMs / 10)),
    );
    const fenceTimeoutError = new Error(
      "Timed-out runtime effects could not be fenced before shutdown",
    );
    let fenceTimer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        start(dependencies.markTimedOutOperationsUnknown),
        new Promise<never>((_resolve, reject) => {
          fenceTimer = setTimeout(
            () => reject(fenceTimeoutError),
            fenceBudgetMs,
          );
        }),
      ]);
    } catch (error) {
      recordFailure(error);
    } finally {
      if (fenceTimer) clearTimeout(fenceTimer);
    }
  }

  for (const cleanup of [
    dependencies.closeSessions,
    dependencies.stopEmergencyMonitor,
    dependencies.markRuntimeStopped,
    dependencies.closeDatabase,
  ]) {
    const pending = start(cleanup);
    try {
      await waitWithinDeadline(pending);
    } catch (error) {
      recordFailure(error);
    }
  }
  if (deadline) clearTimeout(deadline);
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "One or more shutdown operations failed",
    );
  }
}
