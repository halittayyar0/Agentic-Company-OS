import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, ne } from "drizzle-orm";
import type { createChatCompletion } from "@workspace/ai-server";
import {
  activityEventsTable,
  agentsTable,
  approvalRequestsTable,
  db,
  dbReady,
  messagesTable,
  taskAttemptsTable,
  tasksTable,
  usageEventsTable,
} from "@workspace/db";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import { executeApprovedAction, executeTool } from "./execute-tool";
import { registerRuntimeInstance } from "./runtime-instance-registry";
import { runAgentTurn } from "./run-agent-turn";
import { claimDueTasks } from "./scheduler";
import { stepTask } from "./step-task";
import {
  createLocalEmergencyStopCoordinator,
  EmergencyStopError,
  getEmergencyStopStatus,
  setEmergencyStop,
  startEmergencyStopMonitor,
  stopEmergencyStopMonitor,
} from "./runtime-emergency-stop";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function emergencyCompletion(
  model: string,
): Awaited<ReturnType<typeof createChatCompletion>> {
  return {
    provider: "replit",
    completion: {
      id: randomUUID(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1_000),
      model,
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          logprobs: null,
          message: {
            role: "assistant",
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: randomUUID(),
                type: "function",
                function: {
                  name: "browser_click",
                  arguments: JSON.stringify({ ref: 1 }),
                },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 2,
        completion_tokens: 1,
        total_tokens: 3,
      },
    },
  };
}

test("process emergency monitor is scheduler-independent and never overlaps polls", async (t) => {
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  let markSecondStarted!: () => void;
  const firstRelease = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const secondStarted = new Promise<void>((resolve) => {
    markSecondStarted = resolve;
  });
  startEmergencyStopMonitor({
    intervalMs: 5,
    synchronize: async () => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (calls === 1) {
        markFirstStarted();
        await firstRelease;
      } else {
        markSecondStarted();
      }
      active -= 1;
    },
  });
  t.after(stopEmergencyStopMonitor);

  await firstStarted;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 1);
  releaseFirst();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      secondStarted,
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(
          () => reject(new Error("second monitor poll timed out")),
          2_000,
        );
      }),
    ]);
  } finally {
    if (deadline) clearTimeout(deadline);
  }
  await stopEmergencyStopMonitor();
  assert.ok(calls >= 2);
  assert.equal(maxActive, 1);
  assert.equal(active, 0);
});

test("every runtime replica applies a persisted stop and idempotent PUTs force repair", async () => {
  const calls = { replicaA: 0, replicaB: 0 };
  const coordinator = (replica: keyof typeof calls) =>
    createLocalEmergencyStopCoordinator({
      stopAgentProcesses: () => {
        calls[replica] += 1;
        return 1;
      },
      closeBrowserSessions: async () => {},
    });
  const replicaA = coordinator("replicaA");
  const replicaB = coordinator("replicaB");
  const stop = { emergencyStopEnabled: true, version: 7 };

  assert.equal((await replicaA(stop)).applied, true);
  assert.equal((await replicaB(stop)).applied, true);
  assert.equal((await replicaA(stop)).applied, false);
  assert.equal((await replicaA(stop, { force: true })).applied, true);
  assert.deepEqual(calls, { replicaA: 2, replicaB: 1 });

  let closeAttempts = 0;
  const retryingReplica = createLocalEmergencyStopCoordinator({
    stopAgentProcesses: () => 0,
    closeBrowserSessions: async () => {
      closeAttempts += 1;
      if (closeAttempts === 1) throw new Error("synthetic partial cleanup");
    },
  });
  assert.equal((await retryingReplica(stop)).closedBrowserSessions, false);
  assert.equal((await retryingReplica(stop)).closedBrowserSessions, true);
  assert.equal(closeAttempts, 2);
});

test("persistent emergency stop revokes leases and blocks every autonomous entrypoint", async (t) => {
  await dbReady;
  await setEmergencyStop({ enabled: false, reason: null });
  t.after(async () => {
    await setEmergencyStop({ enabled: false, reason: null });
  });

  const leaseExpiresAt = new Date(Date.now() + 10 * 60_000);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Emergency stop test agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: "task:emergency-test",
      runLeaseExpiresAt: leaseExpiresAt,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Emergency stop test task",
      brief: "No autonomous work may begin while the stop is active.",
      ownerAgentId: agent.id,
      createdByUser: true,
      status: "in_progress",
      leaseOwner: "task:emergency-test",
      leaseExpiresAt,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id, currentAction: "Running" })
    .where(eq(agentsTable.id, agent.id));

  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "other",
      title: "Must remain queued",
      description: "Emergency stop must win before capability consumption.",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt: leaseExpiresAt,
      scope: { toolName: "browser_click", argsHash: "never-consume" },
      actionPayload: { toolName: "browser_click", args: { ref: 1 } },
    })
    .returning();

  const stopped = await setEmergencyStop({
    enabled: true,
    reason: "Production safety test",
  });
  assert.equal(stopped.emergencyStopEnabled, true);
  assert.equal(stopped.reason, "Production safety test");
  assert.equal(stopped.releasedTaskLeases, 1);
  assert.equal(stopped.releasedAgentLeases, 1);

  const [[persistedTask], [persistedAgent]] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
    db.select().from(agentsTable).where(eq(agentsTable.id, agent.id)),
  ]);
  assert.equal(persistedTask.status, "in_progress");
  assert.equal(persistedTask.leaseOwner, null);
  assert.equal(persistedAgent.status, "idle");
  assert.equal(persistedAgent.runLeaseOwner, null);

  const toolResult = await executeTool(
    { agent: persistedAgent, taskId: null },
    "log_note",
    JSON.stringify({ summary: "must not persist" }),
  );
  assert.match(toolResult.content, /acil durdurma/i);

  const messagesBefore = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(eq(messagesTable.agentId, agent.id));
  await assert.rejects(
    runAgentTurn(persistedAgent, "must not reach a model"),
    EmergencyStopError,
  );
  const messagesAfter = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(eq(messagesTable.agentId, agent.id));
  assert.equal(messagesAfter.length, messagesBefore.length);

  await assert.rejects(
    executeApprovedAction(approval.id, readRuntimeOperationsConfig()),
    EmergencyStopError,
  );
  const [persistedApproval] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, approval.id));
  assert.equal(persistedApproval.consumedAt, null);

  const versionBeforeIdempotentPut = stopped.version;
  const idempotent = await setEmergencyStop({
    enabled: true,
    reason: "Production safety test",
  });
  assert.equal(idempotent.changed, false);
  assert.equal(idempotent.version, versionBeforeIdempotentPut);
  assert.equal(idempotent.closedBrowserSessions, true);

  const [audit] = await db
    .select()
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.type, "task_status_changed"),
        eq(activityEventsTable.severity, "critical"),
      ),
    )
    .orderBy(activityEventsTable.id)
    .limit(1);
  assert.equal(audit.detail?.actor, "operator");
  assert.equal(audit.detail?.emergencyStopEnabled, true);

  const status = await getEmergencyStopStatus();
  assert.deepEqual(status.blockedScopes, [
    "agent_chat",
    "task_scheduler",
    "agent_tools",
    "approved_actions",
  ]);
});

test("emergency stop during a deferred provider loses the attempt without post-revocation work", async (t) => {
  await dbReady;
  await setEmergencyStop({ enabled: false, reason: null });
  t.after(async () => {
    await setEmergencyStop({ enabled: false, reason: null });
  });
  const previousKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const previousUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "emergency-attempt-test";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  t.after(() => {
    if (previousKey === undefined)
      delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = previousKey;
    if (previousUrl === undefined)
      delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = previousUrl;
  });

  const timers: Array<{
    callback: () => void | Promise<void>;
    delayMs: number;
    cleared: boolean;
    unref(): void;
  }> = [];
  const clock = {
    now: () => new Date(),
    setTimeout(callback: () => void | Promise<void>, delayMs: number) {
      const timer = {
        callback,
        delayMs,
        cleared: false,
        unref() {},
      };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer: (typeof timers)[number]) {
      timer.cleared = true;
    },
  };
  const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
  const runtime = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    config,
    clock,
  );
  t.after(() => runtime.stopHeartbeat());
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Deferred emergency owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Emergency during provider",
      brief: "No stale result may advance this task.",
      ownerAgentId: agent.id,
      status: "pending",
      createdByUser: true,
    })
    .returning();
  const claimed = (await claimDueTasks(runtime, config)).find(
    (candidate) => candidate.id === task.id,
  );
  assert.ok(claimed);

  const providerStarted = deferred<void>();
  const providerResult =
    deferred<Awaited<ReturnType<typeof createChatCompletion>>>();
  const createCompletion: typeof createChatCompletion = async (params) => {
    await params.beforeRequest?.();
    providerStarted.resolve();
    return providerResult.promise.then((result) => ({
      ...result,
      completion: { ...result.completion, model: params.model },
    }));
  };
  let toolCalls = 0;
  const stepping = stepTask(claimed, {
    createCompletion,
    runTool: async () => {
      toolCalls += 1;
      return {
        content: "must not run",
        createdTasks: [],
        createdAgents: [],
        toolOutcome: "succeeded" as const,
      };
    },
    leaseHeartbeatRuntime: clock,
    runtimeOperationsConfig: config,
  });
  await providerStarted.promise;
  const taskEventsBefore = await db
    .select({ id: activityEventsTable.id })
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.taskId, task.id),
        ne(activityEventsTable.type, "operations_changed"),
      ),
    );

  await setEmergencyStop({
    enabled: true,
    reason: "Deferred provider safety test",
  });
  providerResult.resolve(emergencyCompletion("test-model"));
  await stepping;

  const [[persistedTask], [attempt], usage, taskEventsAfter, approvals] =
    await Promise.all([
      db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
      db
        .select()
        .from(taskAttemptsTable)
        .where(eq(taskAttemptsTable.id, claimed.runtimeAttemptId)),
      db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.taskId, task.id)),
      db
        .select({ id: activityEventsTable.id })
        .from(activityEventsTable)
        .where(
          and(
            eq(activityEventsTable.taskId, task.id),
            ne(activityEventsTable.type, "operations_changed"),
          ),
        ),
      db
        .select({ id: approvalRequestsTable.id })
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.taskId, task.id)),
    ]);
  assert.equal(toolCalls, 0);
  assert.equal(persistedTask.leaseOwner, null);
  assert.equal(persistedTask.tokensUsed, 0);
  assert.ok(attempt);
  assert.equal(["claimed", "running"].includes(attempt.state), false);
  assert.equal(attempt.state, "lost");
  assert.equal(usage.length, 1);
  assert.deepEqual(taskEventsAfter, taskEventsBefore);
  assert.equal(approvals.length, 0);
  assert.equal(
    timers.filter((timer) => timer.delayMs === 15_000 && !timer.cleared).length,
    0,
    "the task heartbeat timer must be stopped by cleanup",
  );
});
