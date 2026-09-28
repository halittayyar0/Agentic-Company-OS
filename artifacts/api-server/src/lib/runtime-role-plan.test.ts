import assert from "node:assert/strict";
import test from "node:test";
import { assertEntrypointRole, planRuntimeRole } from "./runtime-role-plan";

test("api, worker, and combined roles have disjoint production responsibilities", () => {
  assert.deepEqual(
    planRuntimeRole({ role: "api", schedulerSetting: undefined }),
    {
      startsHttp: true,
      startsScheduler: false,
      seedsDatabase: true,
      recoversProcessLocalComputerActivities: false,
    },
  );
  assert.deepEqual(
    planRuntimeRole({ role: "worker", schedulerSetting: undefined }),
    {
      startsHttp: false,
      startsScheduler: true,
      seedsDatabase: false,
      recoversProcessLocalComputerActivities: false,
    },
  );
  assert.deepEqual(
    planRuntimeRole({ role: "combined", schedulerSetting: true }),
    {
      startsHttp: true,
      startsScheduler: true,
      seedsDatabase: true,
      recoversProcessLocalComputerActivities: true,
    },
  );
});

test("split roles reject scheduler settings that contradict their responsibility", () => {
  assert.throws(
    () => planRuntimeRole({ role: "api", schedulerSetting: true }),
    /SCHEDULER_ENABLED must not be true when RUNTIME_ROLE=api/,
  );
  assert.throws(
    () => planRuntimeRole({ role: "worker", schedulerSetting: false }),
    /SCHEDULER_ENABLED must not be false when RUNTIME_ROLE=worker/,
  );

  assert.equal(
    planRuntimeRole({ role: "combined", schedulerSetting: false })
      .startsScheduler,
    false,
  );
});

test("entrypoints fail before loading a runtime with the wrong role", () => {
  assert.doesNotThrow(() => assertEntrypointRole("api", "api"));
  assert.doesNotThrow(() => assertEntrypointRole("api", "combined"));
  assert.doesNotThrow(() => assertEntrypointRole("worker", "worker"));
  assert.throws(
    () => assertEntrypointRole("api", "worker"),
    /worker role must start through the worker entrypoint/,
  );
  assert.throws(
    () => assertEntrypointRole("worker", "combined"),
    /worker entrypoint requires RUNTIME_ROLE=worker/,
  );
});
