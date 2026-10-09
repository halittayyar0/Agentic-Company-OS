import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  db,
  dbReady,
  closeDatabase,
  usageEventsTable,
} from "@workspace/db";
import { PlanInferenceError } from "@workspace/ai-server";
import {
  recordCompletionUsage,
  withCompletionFailureAccounting,
  normalizeCompletionUsage,
} from "./usage-ledger";
import type OpenAI from "openai";
test.after(() => closeDatabase());

test("contradictory usage cannot certify zero spend below its reported components", () => {
  const usage = normalizeCompletionUsage(
    {
      agentId: 1,
      taskId: null,
      provider: "openrouter",
      modelId: "fixture",
      kind: "chat",
    },
    { prompt_tokens: 2, completion_tokens: 3, total_tokens: 0 },
  );
  assert.equal(usage.totalTokens, 5);
  assert.equal(usage.usageReported, false);
});

test("a failed durable usage append must not return successful accounting", async (t) => {
  await dbReady;
  const insertion = db.insert.bind(db);
  t.mock.method(db, "insert", (table: unknown) => {
    if (table !== usageEventsTable) return insertion(table as never);
    return {
      values: () => Promise.reject(new Error("owned synthetic ledger outage")),
    };
  });
  await assert.rejects(
    recordCompletionUsage({
      agentId: 1,
      taskId: null,
      modelId: "fixture",
      provider: "openrouter",
      kind: "chat",
      completion: {
        id: "owned-fixture",
        object: "chat.completion",
        created: 1,
        model: "fixture",
        choices: [],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      },
    }),
    /usage accounting/u,
  );
});

test("failed plan calls retain reported usage; an absent report is recorded as unknown and never completed", async (t) => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Plan usage fixture",
      role: "Fixture",
      systemPrompt: "Fixture",
    })
    .returning();
  t.after(async () => {
    await db
      .delete(usageEventsTable)
      .where(eq(usageEventsTable.agentId, agent.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });
  const context = {
    provider: "chatgpt",
    modelId: "chatgpt:gpt-fixture",
    agentId: agent.id,
    taskId: null,
    kind: "chat" as const,
  };
  for (const usage of [
    { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26 },
    null,
  ]) {
    const failure = new PlanInferenceError(
      "quota",
      usage,
      "subscription_sharing_usage_limit_exceeded",
      200,
      "req_fixture",
    );
    await assert.rejects(
      withCompletionFailureAccounting(async () => {
        throw failure;
      }, context),
      (error: unknown) => error === failure,
    );
  }
  const events = await db
    .select()
    .from(usageEventsTable)
    .where(eq(usageEventsTable.agentId, agent.id))
    .orderBy(usageEventsTable.id);
  assert.equal(events.length, 2);
  assert.equal(events[0].totalTokens, 26);
  assert.equal(events[0].usageReported, true);
  assert.equal(events[0].outcome, "failed");
  assert.equal(events[0].failureKind, "quota");
  assert.equal(events[0].reportedCostUsd, null);
  assert.equal(events[1].usageReported, false);
  assert.equal(events[1].outcome, "failed");
  assert.equal(events[1].reportedCostUsd, null);
});

test("missing successful usage is distinguishable from an actual provider report of zero", async (t) => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Unknown usage fixture",
      role: "Fixture",
      systemPrompt: "Fixture",
    })
    .returning();
  t.after(async () => {
    await db
      .delete(usageEventsTable)
      .where(eq(usageEventsTable.agentId, agent.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });
  const completion = {
    id: "fixture",
    object: "chat.completion",
    created: 1,
    model: "chatgpt:gpt-fixture",
    choices: [],
  } as OpenAI.Chat.Completions.ChatCompletion;
  const context = {
    provider: "chatgpt",
    modelId: completion.model,
    agentId: agent.id,
    taskId: null,
    kind: "chat" as const,
  };
  const missing = await recordCompletionUsage({ ...context, completion });
  const zero = await recordCompletionUsage({
    ...context,
    completion: {
      ...completion,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    },
  });
  assert.equal(missing.usageReported, false);
  assert.equal(zero.usageReported, true);
  assert.equal(missing.reportedCostUsd, null);
  assert.equal(zero.reportedCostUsd, null);
  const events = await db
    .select()
    .from(usageEventsTable)
    .where(eq(usageEventsTable.agentId, agent.id))
    .orderBy(usageEventsTable.id);
  assert.deepEqual(
    events.map((event) => [event.usageReported, event.outcome]),
    [
      [false, "completed"],
      [true, "completed"],
    ],
  );
});

test("connection admission failures before inference do not invent usage receipts", async (t) => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Admission fixture",
      role: "Fixture",
      systemPrompt: "Fixture",
    })
    .returning();
  t.after(async () => {
    await db
      .delete(usageEventsTable)
      .where(eq(usageEventsTable.agentId, agent.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });
  const failure = new PlanInferenceError("permission");
  await assert.rejects(
    withCompletionFailureAccounting(
      async () => {
        throw failure;
      },
      {
        provider: "chatgpt",
        modelId: "chatgpt:gpt-fixture",
        agentId: agent.id,
        taskId: null,
        kind: "chat",
      },
    ),
    (error: unknown) => error === failure,
  );
  assert.equal(
    (
      await db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.agentId, agent.id))
    ).length,
    0,
  );
});
