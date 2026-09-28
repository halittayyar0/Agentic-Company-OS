import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  activityEventsTable,
  agentsTable,
  db,
  dbReady,
  taskAttemptsTable,
  tasksTable,
} from "@workspace/db";
import app from "../../app";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import { readWorkspaceLocale } from "../workspace-locale";
import { getToolCopy } from "./tool-localization";
import { registerRuntimeInstance } from "./runtime-instance-registry";
import { reviveAndReleaseStaleWork } from "./scheduler";

function request(
  port: number,
  options: { method?: string; path: string; body?: unknown },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload =
    options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: options.path,
        headers: {
          Host: `127.0.0.1:${port}`,
          Origin: `http://127.0.0.1:${port}`,
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: body ? (JSON.parse(body) as Record<string, unknown>) : {},
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

test("a completed task can become a durable continuous responsibility", async (t) => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Continuous responsibility test agent",
      role: "Test",
      systemPrompt: "Test only",
      modelMode: "manual",
      modelId: "minimax/minimax-m3:free",
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Continuous responsibility test",
      brief: "Keep this responsibility alive until explicitly cancelled.",
      ownerAgentId: agent.id,
      status: "completed",
      progressPercent: 100,
      completedAt: new Date(),
      createdByUser: true,
    })
    .returning();

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const response = await request(address.port, {
    method: "PUT",
    path: `/api/tasks/${task.id}/autonomy`,
    body: { autonomyMode: "continuous", cadenceSeconds: 60 },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.autonomyMode, "continuous");
  assert.equal(response.body.cadenceSeconds, 60);
  assert.equal(response.body.status, "in_progress");
  assert.equal(response.body.progressPercent, 0);
  assert.equal(response.body.completedAt, null);
  assert.equal(typeof response.body.nextAttemptAt, "string");
  assert.equal(response.body.executionModelId, "minimax/minimax-m3:free");

  const vm = await request(address.port, {
    path: `/api/agents/${agent.id}/vm/status`,
  });
  assert.equal(vm.status, 200);
  assert.equal(vm.body.workspaceId, `agent-${agent.id}`);
  assert.equal(vm.body.isolation, "filesystem_sandbox");
  assert.equal(vm.body.persistent, true);
  assert.ok(["not_created", "ready"].includes(String(vm.body.lifecycle)));

  const created = await request(address.port, {
    method: "POST",
    path: "/api/tasks",
    body: {
      title: "Pinned unattended task",
      brief: "Keep the user's selected free model as the primary route.",
      ownerAgentId: agent.id,
      priority: "normal",
      autonomyMode: "finite",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.executionModelId, "minimax/minimax-m3:free");
  assert.equal(created.body.modelFallbackCount, 0);
});

test("expired work leases lose their exact attempt and are immediately due", async (t) => {
  await dbReady;
  const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
  const runtime = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    config,
  );
  t.after(() => runtime.stopHeartbeat());
  const expiredAt = new Date(Date.now() - 60_000);
  const leaseOwner = `expired-test:${Date.now()}`;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Lease recovery test agent",
      role: "Test",
      systemPrompt: "Test only",
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: expiredAt,
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Lease recovery test",
      brief: "A process crash must not orphan this responsibility.",
      ownerAgentId: agent.id,
      status: "in_progress",
      autonomyMode: "continuous",
      cadenceSeconds: 60,
      leaseOwner,
      leaseExpiresAt: expiredAt,
      lastHeartbeatAt: expiredAt,
      stepAttempts: 1,
      createdByUser: true,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id, currentAction: "Interrupted work" })
    .where(eq(agentsTable.id, agent.id));
  const attemptId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: task.id,
    agentId: agent.id,
    workerInstanceId: runtime.id,
    leaseOwner,
    attemptNumber: 1,
    cycleNumber: 0,
    state: "running",
    startedAt: new Date(expiredAt.getTime() - 30_000),
    lastHeartbeatAt: expiredAt,
  });

  const recoveryStartedAt = Date.now();
  const locale = await readWorkspaceLocale();
  await reviveAndReleaseStaleWork();

  const [recovered] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  const [releasedAgent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, agent.id));
  const [event] = await db
    .select()
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.taskId, task.id),
        eq(activityEventsTable.type, "task_status_changed"),
      ),
    );
  const [lostAttempt] = await db
    .select()
    .from(taskAttemptsTable)
    .where(eq(taskAttemptsTable.id, attemptId));

  assert.equal(recovered.status, "in_progress");
  assert.equal(recovered.leaseOwner, null);
  assert.equal(recovered.leaseExpiresAt, null);
  assert.equal(recovered.recoveryCount, 1);
  assert.ok(recovered.nextAttemptAt);
  assert.ok(recovered.nextAttemptAt.getTime() >= recoveryStartedAt);
  assert.equal(recovered.lastError, getToolCopy(locale).schedulerRecoveryNote);
  assert.equal(releasedAgent.status, "idle");
  assert.equal(releasedAgent.currentTaskId, null);
  assert.equal(releasedAgent.runLeaseOwner, null);
  assert.ok(event);
  assert.equal(event.detail?.reason, "expired_lease");
  assert.equal(event.detail?.recoveryCount, 1);
  assert.equal(lostAttempt.state, "lost");
  assert.equal(lostAttempt.failureKind, "lease_expired");
  assert.ok(lostAttempt.finishedAt);
});
