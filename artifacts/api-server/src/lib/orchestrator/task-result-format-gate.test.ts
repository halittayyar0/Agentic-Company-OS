import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import test, { type TestContext } from "node:test";
import { eq, and } from "drizzle-orm";
import type { createChatCompletion } from "@workspace/ai-server";
import type { WorkspaceLocale } from "../workspace-locale";

delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.RUNTIME_ROLE = "worker";
process.env.MODEL_FALLBACK_MAX_ROUTES = "1";
let judgeCalls = 0;
const peer = http.createServer(async (req, res) => {
  for await (const _chunk of req) {
    /* Consume only owned fixture requests. */
  }
  judgeCalls++;
  res.writeHead(200, {
    "content-type": "application/json",
    connection: "close",
  });
  res.end(
    JSON.stringify({
      id: randomUUID(),
      object: "chat.completion",
      created: 1,
      model: "gpt-5.6-sol",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: JSON.stringify({
              verdict: "pass",
              reasoning: "Controlled reviewer would accept any format.",
            }),
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
  );
});
await new Promise<void>((resolve) => peer.listen(0, "127.0.0.1", resolve));
const address = peer.address();
assert.ok(address && typeof address !== "string");
process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "local-result-format-test-key";
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
const {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  taskAttemptsTable,
  operationReceiptsTable,
  usageEventsTable,
  activityEventsTable,
} = await import("@workspace/db");
const { stepTask } = await import("./step-task");
const { registerRuntimeInstance } = await import("./runtime-instance-registry");
const { readRuntimeOperationsConfig } =
  await import("../runtime-operations-config");
const { WORKSPACE_LOCALES } = await import("../workspace-locale");
const { toolMessage } = await import("./tool-localization");
const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
const plan = () => {
  const primary = {
    provider: "replit",
    modelId: "gpt-5.6-sol",
    usedFallback: false,
    source: "agent_pin" as const,
    tier: "economy" as const,
  };
  return { primary, routes: [primary], freeOnly: false };
};
const format = { kind: "table" as const, columns: ["Owner", "Action", "Due"] };
const good =
  "| Owner | Action | Due |\n| --- | --- | --- |\n| Mira | Review | 2026-10-26 |\n\nLaunch date is undecided.";
const bad =
  "PRIVATE_FORMAT_BAD: Mira will review by 2026-10-26. Launch date is undecided.";
test.after(async () => {
  peer.closeAllConnections();
  await new Promise<void>((resolve) => peer.close(() => resolve()));
  await closeDatabase();
});
async function fixture(t: TestContext, continuous = false) {
  await dbReady;
  const runtime = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    config,
  );
  t.after(() => runtime.stopHeartbeat());
  const leaseOwner = `format-${randomUUID()}`,
    expires = new Date(Date.now() + 15 * 60_000);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Table fixture owner",
      role: "Test",
      systemPrompt: "Owned fixture only",
      modelMode: "manual",
      modelId: "gpt-5.6-sol",
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: expires,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Return selected table",
      brief:
        "Return the selected owner, action and due-date table. No other action.",
      ownerAgentId: agent.id,
      status: "in_progress",
      leaseOwner,
      leaseExpiresAt: expires,
      resultFormat: format,
      autonomyMode: continuous ? "continuous" : "finite",
      cadenceSeconds: continuous ? 60 : null,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, agent.id));
  const runtimeAttemptId = randomUUID(),
    logicalExecutionId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: runtimeAttemptId,
    taskId: task.id,
    agentId: agent.id,
    workerInstanceId: runtime.id,
    leaseOwner,
    attemptNumber: 1,
    cycleNumber: 0,
    state: "claimed",
    logicalExecutionId,
  });
  return {
    ...task,
    leaseOwner,
    runtimeAttemptId,
    runtimeInstanceId: runtime.id,
    logicalExecutionId,
  };
}
function response(
  calls: { count: number },
  choose: (n: number) => string,
): typeof createChatCompletion {
  return async (params) => {
    await params.beforeRequest?.();
    const index = ++calls.count;
    return {
      provider: "replit",
      completion: {
        id: randomUUID(),
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
                  id: randomUUID(),
                  type: "function",
                  function: {
                    name: "complete_task",
                    arguments: JSON.stringify({ resultSummary: choose(index) }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      },
    };
  };
}
for (const locale of WORKSPACE_LOCALES) {
  for (const continuous of [false, true])
    test(`${locale}: invalid table is corrected before review or finite/recurring completion (${continuous})`, async (t) => {
      const task = await fixture(t, continuous),
        calls = { count: 0 },
        reviews = judgeCalls;
      await stepTask(task, {
        locale,
        runtimeOperationsConfig: config,
        selectModelPlan: plan,
        createCompletion: response(calls, (n) => (n === 1 ? bad : good)),
      });
      assert.equal(
        calls.count,
        2,
        "one correction must follow the rejected format",
      );
      assert.equal(
        judgeCalls - reviews,
        1,
        "only the valid result reaches the otherwise permissive reviewer",
      );
      const [saved] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, task.id));
      assert.equal(saved.resultSummary, good);
      assert.deepEqual(saved.resultFormat, format);
      assert.equal(saved.status, continuous ? "in_progress" : "completed");
      assert.equal(saved.cycleCount, continuous ? 1 : 0);
      assert.equal(saved.nextAttemptAt !== null, continuous);
      const receipts = await db
        .select()
        .from(operationReceiptsTable)
        .where(
          and(
            eq(operationReceiptsTable.taskId, task.id),
            eq(operationReceiptsTable.toolName, "complete_task"),
          ),
        );
      assert.equal(
        receipts.length,
        1,
        "invalid format must not reserve a lifecycle effect",
      );
      const usage = await db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.taskId, task.id));
      assert.equal(usage.length, 3);
      assert.equal(
        usage.reduce((sum, x) => sum + x.totalTokens, 0),
        12,
      );
      const events = await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.taskId, task.id));
      const blocked = events.filter(
        (event) => event.detail?.runtimeEvent === "task_result_format_rejected",
      );
      assert.equal(blocked.length, 1);
      assert.equal(
        blocked[0].summary,
        toolMessage(locale, "teamResultFormatRejectedActivity"),
      );
      assert.ok(!JSON.stringify(blocked).includes("PRIVATE_FORMAT_BAD"));
    });
  test(`${locale}: repeated wrong formats cannot be passed by a permissive judge or close a cycle`, async (t) => {
    const task = await fixture(t, true),
      calls = { count: 0 },
      reviews = judgeCalls;
    await stepTask(task, {
      locale,
      runtimeOperationsConfig: config,
      selectModelPlan: plan,
      createCompletion: response(calls, () => bad),
    });
    assert.equal(calls.count, 2);
    assert.equal(judgeCalls, reviews);
    const [saved] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    assert.equal(saved.status, "in_progress");
    assert.equal(saved.resultSummary, null);
    assert.equal(saved.cycleCount, 0);
    assert.ok(saved.nextAttemptAt);
    assert.equal(saved.consecutiveFailures, 1);
    assert.equal(
      (
        await db
          .select()
          .from(operationReceiptsTable)
          .where(eq(operationReceiptsTable.taskId, task.id))
      ).length,
      0,
    );
    const usage = await db
      .select()
      .from(usageEventsTable)
      .where(eq(usageEventsTable.taskId, task.id));
    assert.equal(usage.length, 2);
    assert.equal(
      usage.reduce((sum, x) => sum + x.totalTokens, 0),
      10,
    );
  });
}
