import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  db,
  dbReady,
  taskAttemptsTable,
  tasksTable,
  usageEventsTable,
} from "@workspace/db";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import { registerRuntimeInstance } from "./runtime-instance-registry";
import { stepTask } from "./step-task";

async function probeBudget(t: TestContext, shared: boolean) {
  await dbReady;
  const names = [
    "MAX_TASK_TOKENS",
    "MAX_TASK_FAMILY_TOKENS",
    "AI_INTEGRATIONS_OPENAI_API_KEY",
    "AI_INTEGRATIONS_OPENAI_BASE_URL",
  ] as const;
  const before = names.map((n) => process.env[n]);
  process.env.MAX_TASK_TOKENS = shared ? "100000" : "2";
  process.env.MAX_TASK_FAMILY_TOKENS = shared ? "2" : "250000";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  t.after(() =>
    names.forEach((n, i) => {
      if (before[i] === undefined) delete process.env[n];
      else process.env[n] = before[i];
    }),
  );
  const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
  const runtime = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    config,
  );
  t.after(() => runtime.stopHeartbeat());
  const leaseOwner = randomUUID(),
    leaseExpiresAt = new Date(Date.now() + 900000);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Economy",
      role: "Test",
      systemPrompt: "Test",
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: leaseExpiresAt,
    })
    .returning();
  const root = shared
    ? (
        await db
          .insert(tasksTable)
          .values({
            title: "Recurring shared budget",
            brief: "Test",
            ownerAgentId: agent.id,
            autonomyMode: "continuous",
            cadenceSeconds: 3600,
          })
          .returning()
      )[0]
    : null;
  if (root)
    await db.insert(usageEventsTable).values({
      agentId: agent.id,
      taskId: root.id,
      kind: "judge",
      modelId: "fixture",
      provider: "fixture",
      totalTokens: 2,
    });
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Recurring budget",
      brief: "Test",
      ownerAgentId: agent.id,
      autonomyMode: shared ? "finite" : "continuous",
      cadenceSeconds: shared ? null : 3600,
      parentTaskId: root?.id ?? null,
      status: "in_progress",
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
    cycleNumber: 0,
    state: "claimed",
    logicalExecutionId,
  });
  let calls = 0;
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
      createCompletion: async (params) => {
        await params.beforeRequest?.();
        calls++;
        return {
          provider: "replit",
          completion: {
            id: "budget",
            object: "chat.completion",
            created: 1,
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
                      id: `call-${calls}`,
                      type: "function",
                      function: { name: "vm_write_file", arguments: "{" },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
        };
      },
    },
  );
  const [saved] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  assert.equal(calls, shared ? 0 : 1);
  assert.equal(saved.status, "blocked");
  assert.equal(saved.blockedReason, "budget");
  assert.equal(saved.leaseOwner, null);
}

test("a recurring task stops inside its tool loop when reported token budget is consumed", (t) =>
  probeBudget(t, false));
test("a child makes no model call after its recurring parent's shared review budget is consumed", (t) =>
  probeBudget(t, true));
