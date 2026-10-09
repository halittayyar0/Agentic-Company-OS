import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test, { after } from "node:test";
import * as runtimeShutdown from "./runtime-shutdown";
import {
  closeAllSessions,
  ensureSession,
  inspectBrowserSession,
} from "./vm/browser";

const execFileAsync = promisify(execFile);
after(() => closeAllSessions());

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function observeBoundedDrain(
  drain: Promise<void>,
  externalTimeoutMs = 250,
): Promise<{
  status: "resolved" | "rejected" | "external-timeout";
  error?: unknown;
}> {
  return Promise.race([
    drain.then(
      () => ({ status: "resolved" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    ),
    new Promise<{ status: "external-timeout" }>((resolve) => {
      setTimeout(
        () => resolve({ status: "external-timeout" }),
        externalTimeoutMs,
      );
    }),
  ]);
}

test("ordered drain keeps browser sessions open until active scheduler steps settle", async () => {
  const runOrderedRuntimeDrain = (
    runtimeShutdown as typeof runtimeShutdown & {
      runOrderedRuntimeDrain?: (
        dependencies: {
          stopHttpAdmission(): Promise<void>;
          stopSchedulerAdmission(): Promise<void>;
          markRuntimeDraining(): Promise<void>;
          closeSessions(): Promise<void>;
          stopEmergencyMonitor(): Promise<void>;
          markRuntimeStopped(): Promise<void>;
          closeDatabase(): Promise<void>;
        },
        deadlineMs: number,
      ) => Promise<void>;
    }
  ).runOrderedRuntimeDrain;
  assert.equal(
    typeof runOrderedRuntimeDrain,
    "function",
    "runtime shutdown must expose one testable ordered drain coordinator",
  );

  const activeStep = deferred();
  const order: string[] = [];
  let sessionsOpen = true;
  const draining = runOrderedRuntimeDrain!(
    {
      stopHttpAdmission: async () => {
        order.push("http-admission-closed");
      },
      stopSchedulerAdmission: () => {
        order.push("scheduler-admission-closed");
        return activeStep.promise.then(() => {
          order.push("active-step-settled");
        });
      },
      markRuntimeDraining: async () => {
        order.push("runtime-draining");
      },
      closeSessions: async () => {
        sessionsOpen = false;
        order.push("sessions-closed");
      },
      stopEmergencyMonitor: async () => {
        order.push("emergency-monitor-stopped");
      },
      markRuntimeStopped: async () => {
        order.push("runtime-stopped");
      },
      closeDatabase: async () => {
        order.push("database-closed");
      },
    },
    1_000,
  );

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(sessionsOpen, true);
  assert.deepEqual(order, [
    "http-admission-closed",
    "scheduler-admission-closed",
    "runtime-draining",
  ]);

  activeStep.resolve();
  await draining;
  assert.equal(sessionsOpen, false);
  assert.deepEqual(order, [
    "http-admission-closed",
    "scheduler-admission-closed",
    "runtime-draining",
    "active-step-settled",
    "sessions-closed",
    "emergency-monitor-stopped",
    "runtime-stopped",
    "database-closed",
  ]);
});

test("the explicit drain deadline closes a real browser session after, never before, expiry", async () => {
  const agentId = 2_000_000 + Math.floor(Math.random() * 100_000);
  await ensureSession(agentId);
  assert.equal((await inspectBrowserSession(agentId)).active, true);
  const activeBrowserStep = deferred();
  const draining = runtimeShutdown.runOrderedRuntimeDrain(
    {
      stopHttpAdmission: async () => undefined,
      stopSchedulerAdmission: () => activeBrowserStep.promise,
      markRuntimeDraining: async () => undefined,
      closeSessions: () => closeAllSessions(),
      stopEmergencyMonitor: async () => undefined,
      markRuntimeStopped: async () => undefined,
      closeDatabase: async () => undefined,
    },
    100,
  );
  const deadlineFailure = assert.rejects(
    draining,
    (error) =>
      error instanceof AggregateError &&
      error.errors.some((failure) =>
        /shutdown deadline exceeded/iu.test(String(failure)),
      ),
  );
  // A real browser title lookup can outlast the deadline on a busy runner.
  // Observe both promises before yielding; the final await still checks the
  // original rejection rather than hiding an unexpected drain outcome.
  void deadlineFailure.catch(() => undefined);

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    (await inspectBrowserSession(agentId)).active,
    true,
    "the in-flight browser step must retain its real session before deadline",
  );
  await deadlineFailure;
  assert.equal((await inspectBrowserSession(agentId)).active, false);
  activeBrowserStep.resolve();
});

test("a scheduler drain timeout fences running effects before destructive cleanup", async () => {
  const activeEffect = deferred();
  const order: string[] = [];
  const draining = runtimeShutdown.runOrderedRuntimeDrain(
    {
      stopHttpAdmission: async () => {
        order.push("http-admission-closed");
      },
      stopSchedulerAdmission: () => {
        order.push("scheduler-admission-closed");
        return activeEffect.promise;
      },
      markRuntimeDraining: async () => {
        order.push("runtime-draining");
      },
      markTimedOutOperationsUnknown: async () => {
        order.push("running-effects-unknown");
      },
      closeSessions: async () => {
        order.push("sessions-closed");
      },
      stopEmergencyMonitor: async () => {
        order.push("monitor-stopped");
      },
      markRuntimeStopped: async () => {
        order.push("runtime-stopped");
      },
      closeDatabase: async () => {
        order.push("database-closed");
      },
    },
    20,
  );
  await assert.rejects(draining, AggregateError);
  assert.ok(
    order.indexOf("running-effects-unknown") >
      order.indexOf("runtime-draining"),
  );
  assert.ok(
    order.indexOf("running-effects-unknown") < order.indexOf("sessions-closed"),
  );
  activeEffect.resolve();
});

test("an HTTP drain timeout also fences this runtime's running effects", async () => {
  const activeRequest = deferred();
  const order: string[] = [];
  const draining = runtimeShutdown.runOrderedRuntimeDrain(
    {
      stopHttpAdmission: () => {
        order.push("http-admission-closed");
        return activeRequest.promise;
      },
      stopSchedulerAdmission: async () => {
        order.push("scheduler-settled");
      },
      markRuntimeDraining: async () => {
        order.push("runtime-draining");
      },
      markTimedOutOperationsUnknown: async () => {
        order.push("running-effects-unknown");
      },
      closeSessions: async () => {
        order.push("sessions-closed");
      },
      stopEmergencyMonitor: async () => undefined,
      markRuntimeStopped: async () => undefined,
      closeDatabase: async () => undefined,
    },
    20,
  );

  await assert.rejects(draining, AggregateError);
  assert.ok(
    order.indexOf("running-effects-unknown") >
      order.indexOf("runtime-draining"),
  );
  assert.ok(
    order.indexOf("running-effects-unknown") < order.indexOf("sessions-closed"),
  );
  activeRequest.resolve();
});

test("the absolute drain deadline covers a stuck runtime-draining write and still invokes cleanup", async () => {
  const never = deferred();
  const order: string[] = [];
  const result = await observeBoundedDrain(
    runtimeShutdown.runOrderedRuntimeDrain(
      {
        stopHttpAdmission: async () => {
          order.push("http");
        },
        stopSchedulerAdmission: async () => {
          order.push("scheduler");
        },
        markRuntimeDraining: () => {
          order.push("mark-draining");
          return never.promise;
        },
        closeSessions: async () => {
          order.push("sessions");
        },
        stopEmergencyMonitor: async () => {
          order.push("monitor");
        },
        markRuntimeStopped: async () => {
          order.push("mark-stopped");
        },
        closeDatabase: async () => {
          order.push("database");
        },
      },
      20,
    ),
  );

  assert.equal(result.status, "rejected");
  assert.ok(result.error instanceof AggregateError);
  assert.equal(
    result.error.errors.some((failure) =>
      /shutdown deadline exceeded/iu.test(String(failure)),
    ),
    true,
  );
  assert.deepEqual(order, [
    "http",
    "scheduler",
    "mark-draining",
    "sessions",
    "monitor",
    "mark-stopped",
    "database",
  ]);
  never.resolve();
});

test("the absolute drain deadline rejects a stuck database close", async () => {
  const never = deferred();
  const order: string[] = [];
  const result = await observeBoundedDrain(
    runtimeShutdown.runOrderedRuntimeDrain(
      {
        stopHttpAdmission: async () => {
          order.push("http");
        },
        stopSchedulerAdmission: async () => {
          order.push("scheduler");
        },
        markRuntimeDraining: async () => {
          order.push("mark-draining");
        },
        closeSessions: async () => {
          order.push("sessions");
        },
        stopEmergencyMonitor: async () => {
          order.push("monitor");
        },
        markRuntimeStopped: async () => {
          order.push("mark-stopped");
        },
        closeDatabase: () => {
          order.push("database");
          return never.promise;
        },
      },
      20,
    ),
  );

  assert.equal(result.status, "rejected");
  assert.ok(result.error instanceof AggregateError);
  assert.equal(
    result.error.errors.some((failure) =>
      /shutdown deadline exceeded/iu.test(String(failure)),
    ),
    true,
  );
  assert.deepEqual(order, [
    "http",
    "scheduler",
    "mark-draining",
    "sessions",
    "monitor",
    "mark-stopped",
    "database",
  ]);
  never.resolve();
});

test("an overdue event-loop block cannot clear the absolute deadline as success", async () => {
  const order: string[] = [];
  const startedAt = Date.now();
  const result = await observeBoundedDrain(
    runtimeShutdown.runOrderedRuntimeDrain(
      {
        stopHttpAdmission: async () => {
          order.push("http");
        },
        stopSchedulerAdmission: async () => {
          order.push("scheduler");
        },
        markRuntimeDraining: async () => {
          order.push("mark-draining");
          while (Date.now() - startedAt < 60) {
            // Deliberately block the event loop past the configured deadline.
          }
        },
        closeSessions: async () => {
          order.push("sessions");
        },
        stopEmergencyMonitor: async () => {
          order.push("monitor");
        },
        markRuntimeStopped: async () => {
          order.push("mark-stopped");
        },
        closeDatabase: async () => {
          order.push("database");
        },
      },
      20,
    ),
  );

  assert.equal(result.status, "rejected");
  assert.ok(result.error instanceof AggregateError);
  assert.equal(
    result.error.errors.some((failure) =>
      /shutdown deadline exceeded/iu.test(String(failure)),
    ),
    true,
  );
  assert.deepEqual(order, [
    "http",
    "scheduler",
    "mark-draining",
    "sessions",
    "monitor",
    "mark-stopped",
    "database",
  ]);
});

test("the drain deadline remains referenced after admission closes the last handle", async () => {
  const script = `
    import { runOrderedRuntimeDrain } from "./artifacts/api-server/src/lib/runtime-shutdown.ts";
    const never = new Promise(() => undefined);
    const noop = async () => undefined;
    try {
      await runOrderedRuntimeDrain({
        stopHttpAdmission: noop,
        stopSchedulerAdmission: noop,
        markRuntimeDraining: () => never,
        closeSessions: noop,
        stopEmergencyMonitor: noop,
        markRuntimeStopped: noop,
        closeDatabase: noop,
      }, 20);
      process.stdout.write("resolved");
    } catch {
      process.stdout.write("deadline-rejected");
    }
  `;
  // This timeout guards a genuinely hung child; it is not the 20 ms runtime
  // deadline under test. Parallel Windows test runs can spend more than two
  // seconds starting a TSX loader, so use Node 24's built-in type stripping
  // and leave ample process-start headroom. If the deadline is unreferenced,
  // the child still exits early with empty stdout and this assertion fails.
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { cwd: process.cwd(), timeout: 30_000, windowsHide: true },
  );
  assert.equal(stdout, "deadline-rejected");
});
