import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import type { createChatCompletion } from "@workspace/ai-server";
import {
  activityEventsTable,
  agentsTable,
  db,
  dbReady,
  taskAttemptsTable,
  tasksTable,
} from "@workspace/db";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import type { executeTool } from "./execute-tool";
import { registerRuntimeInstance } from "./runtime-instance-registry";
import { stepTask } from "./step-task";

test("malformed nonterminal tools use bounded fallback then durable backoff", async (t) => {
  await dbReady;
  const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
  const runtime = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    config,
  );
  t.after(() => runtime.stopHeartbeat());
  const previous = {
    key: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    url: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    rounds: process.env.MAX_AGENT_TOOL_ROUNDS,
    routes: process.env.MODEL_FALLBACK_MAX_ROUTES,
  };
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  process.env.MAX_AGENT_TOOL_ROUNDS = "4";
  process.env.MODEL_FALLBACK_MAX_ROUTES = "2";
  const leaseOwner = `task:rejected-tools:${Date.now()}`;
  const leaseExpiresAt = new Date(Date.now() + 15 * 60_000);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Rejected tool protocol owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: leaseExpiresAt,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Malformed write loop",
      brief: "A malformed write must never look like successful progress.",
      ownerAgentId: agent.id,
      status: "in_progress",
      leaseOwner,
      leaseExpiresAt,
      createdByUser: true,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, agent.id));
  const attemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: task.id,
    agentId: agent.id,
    workerInstanceId: runtime.id,
    leaseOwner,
    attemptNumber: 1,
    cycleNumber: 0,
    state: "claimed",
    logicalExecutionId,
  });
  const claimedTask = {
    ...task,
    leaseOwner,
    runtimeAttemptId: attemptId,
    runtimeInstanceId: runtime.id,
    logicalExecutionId,
  };

  let attempts = 0;
  const fakeCompletion: typeof createChatCompletion = async (params) => {
    attempts += 1;
    return {
      provider: "replit",
      completion: {
        id: `rejected-${attempts}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1_000),
        model: params.model,
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
                  id: `call-${attempts}`,
                  type: "function",
                  function: {
                    name: "vm_write_file",
                    arguments: "{",
                  },
                },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
      },
    };
  };

  try {
    await stepTask(claimedTask, {
      createCompletion: fakeCompletion,
      runtimeOperationsConfig: config,
    });
    assert.equal(attempts, 4);
    const [persisted] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    assert.equal(persisted.status, "in_progress");
    assert.equal(persisted.consecutiveFailures, 1);
    assert.ok(persisted.nextAttemptAt);
    assert.equal(persisted.leaseOwner, null);
    assert.ok(persisted.modelFallbackCount >= 1);
    assert.match(persisted.lastError ?? "", /tool_compatibility/iu);
    const [attempt] = await db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, attemptId));
    assert.equal(attempt.state, "retrying");
    const events = await db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, task.id));
    assert.ok(
      events.some(
        (event) => event.detail?.runtimeEvent === "model_fallback_activated",
      ),
    );
    const retryEvent = events.find(
      (event) => event.detail?.runtimeEvent === "task_retry_scheduled",
    );
    assert.equal(retryEvent?.detail?.attemptId, attemptId);
  } finally {
    const restore = (key: keyof typeof previous, envName: string) => {
      const value = previous[key];
      if (value === undefined) delete process.env[envName];
      else process.env[envName] = value;
    };
    restore("key", "AI_INTEGRATIONS_OPENAI_API_KEY");
    restore("url", "AI_INTEGRATIONS_OPENAI_BASE_URL");
    restore("rounds", "MAX_AGENT_TOOL_ROUNDS");
    restore("routes", "MODEL_FALLBACK_MAX_ROUTES");
  }
});

test("inactive-owner telemetry is discarded after a concurrent lease revoke", async (t) => {
  await dbReady;
  const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
  const runtime = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    config,
  );
  t.after(() => runtime.stopHeartbeat());
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Inactive lease-race owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      isActive: false,
      status: "archived",
    })
    .returning();
  const [persistedTask] = await db
    .insert(tasksTable)
    .values({
      title: "Already revoked task",
      brief: "A stale step must not emit a failure after deactivation wins.",
      ownerAgentId: agent.id,
      status: "blocked",
      blockedReason: "owner_inactive",
      createdByUser: true,
    })
    .returning();
  const logicalExecutionId = randomUUID();
  const staleClaim = {
    ...persistedTask,
    status: "in_progress" as const,
    leaseOwner: `task:stale:${Date.now()}`,
    leaseExpiresAt: new Date(Date.now() + 60_000),
    runtimeAttemptId: randomUUID(),
    runtimeInstanceId: runtime.id,
    logicalExecutionId,
  };
  await db.insert(taskAttemptsTable).values({
    id: staleClaim.runtimeAttemptId,
    taskId: persistedTask.id,
    agentId: agent.id,
    workerInstanceId: runtime.id,
    leaseOwner: staleClaim.leaseOwner,
    attemptNumber: 1,
    cycleNumber: 0,
    state: "claimed",
    logicalExecutionId,
  });

  await stepTask(staleClaim, { runtimeOperationsConfig: config });

  const [after] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, persistedTask.id));
  const events = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.taskId, persistedTask.id));
  assert.equal(after.status, "blocked");
  assert.equal(after.blockedReason, "owner_inactive");
  assert.equal(events.length, 0);
  const [attempt] = await db
    .select()
    .from(taskAttemptsTable)
    .where(eq(taskAttemptsTable.id, staleClaim.runtimeAttemptId));
  assert.equal(attempt.state, "claimed");
});

test("an unknown operation stops the batch and blocks before another model call", async (t) => {
  await dbReady;
  const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
  const runtime = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    config,
  );
  t.after(() => runtime.stopHeartbeat());

  const previous = {
    key: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    url: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    rounds: process.env.MAX_AGENT_TOOL_ROUNDS,
    routes: process.env.MODEL_FALLBACK_MAX_ROUTES,
  };
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  process.env.MAX_AGENT_TOOL_ROUNDS = "4";
  process.env.MODEL_FALLBACK_MAX_ROUTES = "2";

  const leaseOwner = `task:unknown-operation:${Date.now()}`;
  const leaseExpiresAt = new Date(Date.now() + 15 * 60_000);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Unknown operation owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: leaseExpiresAt,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Stop after ambiguous effect",
      brief: "Never execute a later tool after an unknown external outcome.",
      ownerAgentId: agent.id,
      status: "in_progress",
      leaseOwner,
      leaseExpiresAt,
      createdByUser: true,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, agent.id));
  const attemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: task.id,
    agentId: agent.id,
    workerInstanceId: runtime.id,
    leaseOwner,
    attemptNumber: 1,
    cycleNumber: 0,
    state: "claimed",
    logicalExecutionId,
  });

  let providerCalls = 0;
  const fakeCompletion: typeof createChatCompletion = async (params) => {
    providerCalls += 1;
    return {
      provider: "replit",
      completion: {
        id: `unknown-${providerCalls}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1_000),
        model: params.model,
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
                  id: "call-unknown-effect",
                  type: "function",
                  function: {
                    name: "vm_run_command",
                    arguments: JSON.stringify({ command: "external-tool" }),
                  },
                },
                {
                  id: "call-must-not-run",
                  type: "function",
                  function: {
                    name: "log_note",
                    arguments: JSON.stringify({ summary: "too late" }),
                  },
                },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
      },
    };
  };
  const executedTools: string[] = [];
  const runTool: typeof executeTool = async (_ctx, toolName) => {
    executedTools.push(toolName);
    return {
      content: "Operation outcome is unknown.",
      createdTasks: [],
      createdAgents: [],
      toolOutcome: "unknown",
      receiptId: "receipt-unknown-effect",
    } as Awaited<ReturnType<typeof executeTool>>;
  };

  try {
    await stepTask(
      {
        ...task,
        leaseOwner,
        runtimeAttemptId: attemptId,
        runtimeInstanceId: runtime.id,
        logicalExecutionId,
      },
      {
        createCompletion: fakeCompletion,
        runTool,
        runtimeOperationsConfig: config,
      },
    );

    assert.deepEqual(executedTools, ["vm_run_command"]);
    assert.equal(providerCalls, 1);
    const [persisted] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    assert.equal(persisted.status, "blocked");
    assert.equal(persisted.blockedReason, "operation_outcome_unknown");
    assert.equal(persisted.leaseOwner, null);
    assert.match(persisted.lastError ?? "", /receipt-unknown-effect/u);

    const [attempt] = await db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, attemptId));
    assert.equal(attempt.state, "blocked");
  } finally {
    const restore = (key: keyof typeof previous, envName: string) => {
      const value = previous[key];
      if (value === undefined) delete process.env[envName];
      else process.env[envName] = value;
    };
    restore("key", "AI_INTEGRATIONS_OPENAI_API_KEY");
    restore("url", "AI_INTEGRATIONS_OPENAI_BASE_URL");
    restore("rounds", "MAX_AGENT_TOOL_ROUNDS");
    restore("routes", "MODEL_FALLBACK_MAX_ROUTES");
  }
});
