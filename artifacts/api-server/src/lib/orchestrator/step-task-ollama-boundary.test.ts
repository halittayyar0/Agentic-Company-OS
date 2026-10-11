import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  configureOllama,
  configureDirectOpenAI,
  configureOpenRouter,
  configureChatGPTPlan,
  refreshOllamaCatalog,
  createChatCompletion,
} from "@workspace/ai-server";
import {
  agentsTable,
  tasksTable,
  taskAttemptsTable,
  usageEventsTable,
  inferenceAttemptsTable,
  db,
  dbReady,
  closeDatabase,
} from "@workspace/db";
import { ownedOllamaPeer } from "../../../../../lib/ai-server/src/testing/ollama-boundary-peer";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import { registerRuntimeInstance } from "./runtime-instance-registry";
import { stepTask } from "./step-task";

test.after(() => closeDatabase());
for (const mode of [
  "unsupported_version",
  "cloud_consent_required",
  "unknown_locality",
] as const) {
  test(`${mode} pauses recurring local/cloud work for setup without inference or changing its pin`, async (t) => {
    await dbReady;
    const peer = await ownedOllamaPeer({
      version: mode === "unsupported_version" ? "0.17.0" : "0.18.0",
      tags:
        mode === "cloud_consent_required"
          ? [
              {
                name: "owned:latest",
                remote_host: "https://ollama.com",
                remote_model: "owned-cloud",
              },
            ]
          : mode === "unknown_locality"
            ? [{ name: "owned:latest", remote_host: "https://ollama.com" }]
            : [{ name: "owned:latest" }],
    });
    t.after(() => peer.close());
    configureChatGPTPlan(null);
    configureOpenRouter({ apiKey: null });
    configureDirectOpenAI({ apiKey: "fixture-other-paid-provider" });
    configureOllama({ baseUrl: peer.origin });
    await refreshOllamaCatalog(true);
    const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
    const runtime = await registerRuntimeInstance(
      { role: "worker", schedulerEnabled: true },
      config,
    );
    t.after(() => runtime.stopHeartbeat());
    const modelId =
      mode === "cloud_consent_required"
        ? "ollama-cloud:owned:latest"
        : "ollama:owned:latest";
    const leaseOwner = `task:owned-boundary:${randomUUID()}`;
    const leaseExpiresAt = new Date(Date.now() + 15 * 60_000);
    const [agent] = await db
      .insert(agentsTable)
      .values({
        name: "Owned local boundary",
        role: "Fixture",
        systemPrompt: "Fixture only",
        modelMode: "manual",
        modelId,
        status: "working",
        runLeaseOwner: leaseOwner,
        runLeaseExpiresAt: leaseExpiresAt,
      })
      .returning();
    const [task] = await db
      .insert(tasksTable)
      .values({
        title: "Owned recurring boundary",
        brief: "Never move this task to another billing boundary.",
        ownerAgentId: agent.id,
        autonomyMode: "continuous",
        status: "in_progress",
        executionModelId: modelId,
        cycleCount: 3,
        leaseOwner,
        leaseExpiresAt,
      })
      .returning();
    await db
      .update(agentsTable)
      .set({ currentTaskId: task.id })
      .where(eq(agentsTable.id, agent.id));
    const attemptId = randomUUID(),
      logicalExecutionId = randomUUID();
    await db.insert(taskAttemptsTable).values({
      id: attemptId,
      taskId: task.id,
      agentId: agent.id,
      workerInstanceId: runtime.id,
      leaseOwner,
      attemptNumber: 1,
      cycleNumber: 3,
      state: "claimed",
      logicalExecutionId,
    });
    await stepTask(
      {
        ...task,
        leaseOwner,
        runtimeAttemptId: attemptId,
        runtimeInstanceId: runtime.id,
        logicalExecutionId,
      },
      {
        runtimeOperationsConfig: config,
        locale: "en",
        createCompletion: async (params) => {
          assert.equal(
            params.model,
            modelId,
            "Owned fixture forbids any other provider destination",
          );
          return createChatCompletion(params);
        },
      },
    );
    const [after] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    const [attempt] = await db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, attemptId));
    assert.equal(attempt.failureKind, "provider_setup_required");
    assert.equal(attempt.state, "retrying");
    assert.equal(after.id, task.id);
    assert.equal(after.executionModelId, modelId);
    assert.equal(after.cycleCount, 3);
    assert.equal(after.modelFallbackCount, 0);
    assert.equal(after.leaseOwner, null);
    assert.ok(after.nextAttemptAt);
    assert.match(after.lastError ?? "", /Connect.*Settings/);
    assert.equal(
      (
        await db
          .select()
          .from(usageEventsTable)
          .where(eq(usageEventsTable.taskId, task.id))
      ).length,
      0,
    );
    const reservations = await db
      .select()
      .from(inferenceAttemptsTable)
      .where(eq(inferenceAttemptsTable.taskId, task.id));
    assert.equal(reservations.length, 1);
    assert.equal(reservations[0].state, "not_dispatched");
    assert.equal(reservations[0].dispatchedAt, null);
    assert.ok(reservations[0].settledAt);
    assert.equal(reservations[0].modelId, modelId);
    assert.equal(peer.completions().length, 0);
    configureOllama({ baseUrl: null });
    configureDirectOpenAI({ apiKey: null });
  });
}
