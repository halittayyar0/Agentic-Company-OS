import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import express from "express";
import { GetCodexTaskStatusResponse } from "@workspace/api-zod";
import {
  db,
  dbReady,
  closeDatabase,
  runtimeInstancesTable,
} from "@workspace/db";
import { readCodexTaskFleetStatus } from "./codex-task-status";
import { readCodexConfigurationReport } from "./codex-task-capability";
import {
  registerRuntimeInstance,
  heartbeatRuntimeInstance,
  markRuntimeDraining,
  markRuntimeStopped,
} from "./orchestrator/runtime-instance-registry";
import { readRuntimeOperationsConfig } from "./runtime-operations-config";
import { createCodexTaskStatusRouter } from "../routes/codex-task-status";
import { createOperatorAuth } from "./operator-auth";

test.after(() => closeDatabase());
const enabled = {
  ALLOW_AGENT_CODEX_TASKS: "true",
  ALLOW_AGENT_PROCESS_EXEC: "true",
  ACOS_CODEX_EXECUTABLE: process.execPath,
  RUNTIME_ROLE: "worker",
};

test("API host cannot stand in for fresh worker configuration, nor can stale, stopped or legacy workers imply readiness", async (t) => {
  await dbReady;
  const now = Date.now();
  const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
  const handles: Awaited<ReturnType<typeof registerRuntimeInstance>>[] = [];
  const runtime = {
    now: () => new Date(now),
    setTimeout: () => ({}),
    clearTimeout: () => {},
  };
  t.after(async () => {
    for (const handle of handles) await handle.stopHeartbeat();
    if (handles.length)
      await db.delete(runtimeInstancesTable).where(
        inArray(
          runtimeInstancesTable.id,
          handles.map((h) => h.id),
        ),
      );
  });
  assert.equal(
    (await readCodexTaskFleetStatus({ now: () => now })).state,
    "no_worker",
  );
  const worker = await registerRuntimeInstance(
    {
      role: "worker",
      schedulerEnabled: true,
      capabilities: readCodexConfigurationReport(enabled, "win32"),
    },
    config,
    runtime,
  );
  handles.push(worker);
  assert.equal(
    (await readCodexTaskFleetStatus({ now: () => now })).state,
    "no_worker",
  );
  await heartbeatRuntimeInstance(worker);
  const status = await readCodexTaskFleetStatus({ now: () => now });
  assert.equal(status.state, "preflight_required");
  assert.equal(status.proofScope, "worker_configuration");
  assert.equal(status.requiresTaskPreflight, true);
  assert.ok(GetCodexTaskStatusResponse.safeParse(status).success);
  assert.equal(status.workers[0].configurationState, "preflight_required");
  assert.equal(status.workers[0].configurationAt, worker.startedAt.getTime());
  assert.doesNotMatch(
    JSON.stringify(status),
    /node\.exe|hostname|processId|account|available|verified/,
  );
  await db
    .update(runtimeInstancesTable)
    .set({ capabilities: readCodexConfigurationReport(enabled, "linux") })
    .where(eq(runtimeInstancesTable.id, worker.id));
  assert.equal(
    (await readCodexTaskFleetStatus({ now: () => now })).state,
    "preflight_required",
  );
  await db
    .update(runtimeInstancesTable)
    .set({ capabilities: readCodexConfigurationReport(enabled, "darwin") })
    .where(eq(runtimeInstancesTable.id, worker.id));
  assert.equal(
    (await readCodexTaskFleetStatus({ now: () => now })).state,
    "unavailable",
  );
  await db
    .update(runtimeInstancesTable)
    .set({ capabilities: {} })
    .where(eq(runtimeInstancesTable.id, worker.id));
  assert.equal(
    (await readCodexTaskFleetStatus({ now: () => now })).state,
    "unknown",
  );
  assert.equal(
    (
      await readCodexTaskFleetStatus({
        now: () => now + config.workerStaleAfterMs,
      })
    ).state,
    "no_worker",
  );
  await db
    .update(runtimeInstancesTable)
    .set({ lastHeartbeatAt: new Date(now + 1) })
    .where(eq(runtimeInstancesTable.id, worker.id));
  assert.equal(
    (await readCodexTaskFleetStatus({ now: () => now })).state,
    "no_worker",
  );
  await db
    .update(runtimeInstancesTable)
    .set({ lastHeartbeatAt: new Date(now) })
    .where(eq(runtimeInstancesTable.id, worker.id));
  await markRuntimeDraining(worker);
  assert.equal(
    (await readCodexTaskFleetStatus({ now: () => now })).state,
    "no_worker",
  );
  await markRuntimeStopped(worker);
  assert.equal(
    (await readCodexTaskFleetStatus({ now: () => now })).state,
    "no_worker",
  );
  const apiConfig = readRuntimeOperationsConfig({ RUNTIME_ROLE: "api" });
  const api = await registerRuntimeInstance(
    {
      role: "api",
      schedulerEnabled: false,
      capabilities: readCodexConfigurationReport(enabled, "win32"),
    },
    apiConfig,
    runtime,
  );
  handles.push(api);
  await heartbeatRuntimeInstance(api);
  assert.equal(
    (await readCodexTaskFleetStatus({ now: () => now })).state,
    "no_worker",
  );
});

test("bounded fleet status cannot infer unavailability from a truncated worker list", async (t) => {
  await dbReady;
  const now = Date.now(),
    ids = Array.from({ length: 130 }, () => randomUUID());
  t.after(() =>
    db
      .delete(runtimeInstancesTable)
      .where(inArray(runtimeInstancesTable.id, ids)),
  );
  await db.insert(runtimeInstancesTable).values(
    ids.map((id) => ({
      id,
      role: "worker" as const,
      state: "healthy" as const,
      schedulerEnabled: true,
      hostname: "PRIVATE-DO-NOT-RETURN",
      processId: 123,
      buildVersion: "PRIVATE",
      capabilities: readCodexConfigurationReport({}, "linux"),
      startedAt: new Date(now),
      lastHeartbeatAt: new Date(now),
    })),
  );
  const status = await readCodexTaskFleetStatus({ now: () => now });
  assert.equal(status.workers.length, 128);
  assert.equal(status.truncated, true);
  assert.equal(status.state, "unknown");
  assert.doesNotMatch(JSON.stringify(status), /PRIVATE/);
});

test("coding status is authenticated, credential-free, nonexecuting and never exposes backend diagnostics", async (t) => {
  const auth = createOperatorAuth({
    token: "fixture-status-operator",
    secureCookies: false,
  });
  let reads = 0,
    fail = false;
  const app = express();
  app.use(
    "/api",
    auth.requireAuthentication,
    createCodexTaskStatusRouter({
      readStatus: async () => {
        reads++;
        if (fail) throw new Error("PRIVATE-account-path-token");
        return readCodexTaskFleetStatus();
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/api/connections/codex`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal(reads, 0);
  const headers = { Authorization: "Bearer fixture-status-operator" };
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const parsed = GetCodexTaskStatusResponse.safeParse(await response.json());
  assert.ok(parsed.success);
  const body = parsed.data;
  assert.equal(
    GetCodexTaskStatusResponse.safeParse({
      ...body,
      requiresTaskPreflight: false,
    }).success,
    false,
  );
  assert.equal(body.requiresTaskPreflight, true);
  assert.equal(body.state, "no_worker");
  fail = true;
  const failed = await fetch(url, { headers });
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "coding_status_unavailable" });
});
