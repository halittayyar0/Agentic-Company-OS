import assert from "node:assert/strict";
import test from "node:test";
import { inArray } from "drizzle-orm";
import { db, dbReady, runtimeInstancesTable } from "@workspace/db";
import {
  bindHttpRuntimeHandle,
  releaseHttpRuntimeHandle,
  requireHttpRuntimeHandle,
} from "./http-runtime-context";
import {
  markRuntimeStopped,
  registerRuntimeInstance,
  type RuntimeInstanceHandle,
} from "./orchestrator/runtime-instance-registry";
import { readRuntimeOperationsConfig } from "./runtime-operations-config";

const apiConfig = readRuntimeOperationsConfig({ RUNTIME_ROLE: "api" });

function forgedHandle(id: string): RuntimeInstanceHandle {
  return {
    id,
    startedAt: new Date("2026-09-01T00:00:00.000Z"),
    stopHeartbeat: async () => undefined,
  };
}

test("HTTP runtime binding is locally owned, exact, exclusive, and fail closed", async (t) => {
  await dbReady;
  const first = await registerRuntimeInstance(
    {
      role: "api",
      schedulerEnabled: false,
      capabilities: { http: true, scheduler: false },
    },
    apiConfig,
  );
  const other = await registerRuntimeInstance(
    {
      role: "api",
      schedulerEnabled: false,
      capabilities: { http: true, scheduler: false },
    },
    apiConfig,
  );
  t.after(async () => {
    releaseHttpRuntimeHandle(first);
    releaseHttpRuntimeHandle(other);
    await Promise.all([markRuntimeStopped(first), markRuntimeStopped(other)]);
    await db
      .delete(runtimeInstancesTable)
      .where(inArray(runtimeInstancesTable.id, [first.id, other.id]));
  });

  assert.throws(
    () => bindHttpRuntimeHandle(forgedHandle("forged-http-runtime")),
    /runtime handle/iu,
  );

  bindHttpRuntimeHandle(first);
  assert.equal(requireHttpRuntimeHandle(), first);
  assert.throws(() => bindHttpRuntimeHandle(other), /already bound/iu);
  assert.equal(releaseHttpRuntimeHandle(other), false);
  assert.equal(requireHttpRuntimeHandle(), first);
  assert.equal(releaseHttpRuntimeHandle(first), true);
  assert.throws(() => requireHttpRuntimeHandle(), /not bound/iu);
});
