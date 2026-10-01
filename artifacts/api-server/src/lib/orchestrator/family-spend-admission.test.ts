import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  db,
  dbReady,
  tasksTable,
  usageEventsTable,
  closeDatabase,
} from "@workspace/db";
import {
  assertTaskInferenceAdmission,
  readTaskSpendAdmission,
  TaskSpendBudgetError,
} from "./task-spend-admission";
import { runJudge } from "./judge";

const localLimits = {
  maxSteps: null,
  maxTokens: 100_000,
  maxReportedCostUsd: 100,
};
test.after(() => closeDatabase());

test("spend admission uses the supplied reader for individual and family evidence", async () => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({ name: "Reader", role: "Test", systemPrompt: "Test" })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({ ownerAgentId: agent.id, title: "Reader scope", brief: "Test" })
    .returning();
  let selects = 0;
  let executions = 0;
  const client = {
    select: (...args: Parameters<typeof db.select>) => {
      selects++;
      return db.select(...args);
    },
    execute: (...args: Parameters<typeof db.execute>) => {
      executions++;
      return db.execute(...args);
    },
  } as Pick<typeof db, "select" | "execute">;
  const result = await readTaskSpendAdmission(
    task,
    localLimits,
    "en",
    new Date(),
    client,
  );
  assert.equal(result.reason, null);
  assert.equal(
    selects,
    1,
    "individual evidence must use the transaction reader",
  );
  assert.equal(
    executions,
    1,
    "family evidence must use the same transaction reader",
  );
});

test("delegated inference shares one durable family budget", async (t) => {
  await dbReady;
  const names = [
    "MAX_TASK_FAMILY_TOKENS",
    "MAX_TASK_FAMILY_REPORTED_COST_USD",
    "MAX_RECURRING_FAMILY_DAILY_TOKENS",
    "MAX_RECURRING_FAMILY_DAILY_REPORTED_COST_USD",
  ] as const;
  const previous = names.map((name) => process.env[name]);
  t.after(() =>
    names.forEach((name, i) => {
      if (previous[i] === undefined) delete process.env[name];
      else process.env[name] = previous[i];
    }),
  );
  const [agent] = await db
    .insert(agentsTable)
    .values({ name: "Family", role: "Test", systemPrompt: "Test" })
    .returning();
  async function family(continuous = false) {
    const [root] = await db
      .insert(tasksTable)
      .values({
        ownerAgentId: agent.id,
        title: "Root",
        brief: "Test",
        autonomyMode: continuous ? "continuous" : "finite",
      })
      .returning();
    const [child] = await db
      .insert(tasksTable)
      .values({
        ownerAgentId: agent.id,
        parentTaskId: root.id,
        title: "Child",
        brief: "Test",
      })
      .returning();
    const [grandchild] = await db
      .insert(tasksTable)
      .values({
        ownerAgentId: agent.id,
        parentTaskId: child.id,
        title: "Grandchild",
        brief: "Test",
      })
      .returning();
    return { root, child, grandchild };
  }
  async function receipt(
    taskId: number,
    tokens: number,
    cost: string | null = null,
    createdAt = new Date(),
    kind: "task_step" | "judge" | "chat" = "task_step",
  ) {
    await db.insert(usageEventsTable).values({
      agentId: agent.id,
      taskId,
      kind,
      modelId: "fixture",
      provider: "fixture",
      totalTokens: tokens,
      reportedCostUsd: cost,
      createdAt,
    });
  }
  function limits(tokens = 100, cost = 100, dayTokens = 10_000) {
    process.env.MAX_TASK_FAMILY_TOKENS = String(tokens);
    process.env.MAX_TASK_FAMILY_REPORTED_COST_USD = String(cost);
    process.env.MAX_RECURRING_FAMILY_DAILY_TOKENS = String(dayTokens);
    process.env.MAX_RECURRING_FAMILY_DAILY_REPORTED_COST_USD = "100";
  }

  await t.test(
    "parent, child and grandchild receipts including reviews share the limit",
    async () => {
      limits();
      const f = await family();
      const unrelated = await family();
      await receipt(unrelated.root.id, 9000, "99");
      await receipt(f.root.id, 40);
      await receipt(f.child.id, 35);
      await receipt(f.grandchild.id, 25, null, new Date(), "judge");
      for (const member of Object.values(f)) {
        const result = await readTaskSpendAdmission(member, localLimits, "en");
        assert.match(result.reason ?? "", /shared.*100\/100/i);
        assert.equal(result.tokensUsed, 100);
        assert.equal(result.usageSource, "task_family_lifetime");
      }
      await assert.rejects(
        assertTaskInferenceAdmission(f.child.id, "en"),
        /shared/i,
      );
    },
  );

  await t.test(
    "legacy aggregates cannot reduce each member's recorded spend or double count it",
    async () => {
      limits(1000, 1.5);
      const f = await family();
      await db
        .update(tasksTable)
        .set({ tokensUsed: 10, estimatedCostUsd: "0.7" })
        .where(eq(tasksTable.id, f.root.id));
      await db
        .update(tasksTable)
        .set({ tokensUsed: 20, estimatedCostUsd: "0.8" })
        .where(eq(tasksTable.id, f.child.id));
      await receipt(f.root.id, 8, "0.5");
      await receipt(f.child.id, 21, "0.9");
      const result = await readTaskSpendAdmission(
        f.grandchild,
        localLimits,
        "en",
      );
      assert.match(result.reason ?? "", /shared.*cost/i);
      assert.equal(result.tokensUsed, 31);
      assert.equal(Number(result.reportedCostUsd), 1.6);
      assert.equal(result.costCoverage, "partial");
    },
  );

  await t.test(
    "a recurring root resets the entire family cycle but retains rolling-day spend",
    async () => {
      limits(100, 100, 300);
      const now = new Date();
      const cycle = new Date(now.getTime() - 60_000);
      const f = await family(true);
      await db
        .update(tasksTable)
        .set({
          lastCycleCompletedAt: cycle,
          tokensUsed: 999999,
          estimatedCostUsd: "999",
        })
        .where(eq(tasksTable.id, f.root.id));
      await receipt(
        f.grandchild.id,
        250,
        null,
        new Date(cycle.getTime() - 60_000),
      );
      await receipt(f.root.id, 30, null, now);
      await receipt(f.child.id, 40, null, now, "judge");
      const result = await readTaskSpendAdmission(
        f.grandchild,
        localLimits,
        "en",
        now,
      );
      assert.match(result.reason ?? "", /shared.*24.*320\/300/i);
      assert.equal(result.tokensUsed, 320);
      assert.equal(result.usageSource, "task_family_rolling_24h");
      limits(100, 100, 1000);
      assert.equal(
        (await readTaskSpendAdmission(f.grandchild, localLimits, "en", now))
          .reason,
        null,
      );
      await receipt(f.child.id, 30, null, now);
      assert.match(
        (await readTaskSpendAdmission(f.grandchild, localLimits, "en", now))
          .reason ?? "",
        /shared.*100\/100/i,
      );
      await db
        .update(tasksTable)
        .set({ lastCycleCompletedAt: new Date(now.getTime() + 1) })
        .where(eq(tasksTable.id, f.root.id));
      assert.equal(
        (await readTaskSpendAdmission(f.grandchild, localLimits, "en", now))
          .reason,
        null,
      );
    },
  );

  await t.test(
    "expired daily receipts and operator chat do not consume a task-family budget",
    async () => {
      limits(100, 100, 100);
      const f = await family(true);
      const now = new Date();
      await db
        .update(tasksTable)
        .set({ lastCycleCompletedAt: new Date(now.getTime() - 60_000) })
        .where(eq(tasksTable.id, f.root.id));
      await receipt(
        f.child.id,
        1000,
        "99",
        new Date(now.getTime() - 86_400_001),
      );
      await receipt(f.child.id, 1000, "99", now, "chat");
      assert.equal(
        (await readTaskSpendAdmission(f.root, localLimits, "en", now)).reason,
        null,
      );
    },
  );

  await t.test(
    "recurring daily reported cost includes previous cycles and preserves missing-cost coverage",
    async () => {
      limits(1000, 1);
      process.env.MAX_RECURRING_FAMILY_DAILY_REPORTED_COST_USD = "0.6";
      const now = new Date();
      const cycle = new Date(now.getTime() - 60_000);
      const f = await family(true);
      await db
        .update(tasksTable)
        .set({ lastCycleCompletedAt: cycle })
        .where(eq(tasksTable.id, f.root.id));
      await receipt(f.child.id, 10, "0.4", new Date(cycle.getTime() - 60_000));
      await receipt(f.root.id, 10, "0.3", now, "judge");
      await receipt(f.grandchild.id, 10, null, now);
      const result = await readTaskSpendAdmission(
        f.grandchild,
        localLimits,
        "en",
        now,
      );
      assert.match(result.reason ?? "", /shared.*24.*cost/i);
      assert.equal(Number(result.reportedCostUsd), 0.7);
      assert.equal(result.costCoverage, "partial");
      assert.equal(result.usageSource, "task_family_rolling_24h");
    },
  );

  await t.test(
    "all seven locales explain the shared budget and retain exact root identity",
    async () => {
      limits();
      const f = await family();
      await receipt(f.child.id, 100);
      const messages = new Set<string>();
      for (const locale of [
        "tr",
        "en",
        "de",
        "ru",
        "zh-CN",
        "zh-TW",
        "ar",
      ] as const) {
        const reason = (
          await readTaskSpendAdmission(f.root, localLimits, locale)
        ).reason;
        assert.ok(reason);
        assert.ok(reason.includes(String(f.root.id)));
        assert.ok(reason.includes("100/100"));
        assert.doesNotMatch(reason, /\{[a-zA-Z]+\}/);
        messages.add(reason);
      }
      assert.equal(messages.size, 7);
    },
  );

  await t.test(
    "completion judging propagates a shared cost stop without retries or fabricated review",
    async () => {
      limits(1000, 0.8);
      const f = await family();
      await receipt(f.root.id, 10, "0.4");
      await receipt(f.child.id, 10, "0.3");
      await receipt(f.grandchild.id, 10, "0.2");
      const names = [
        "AI_INTEGRATIONS_OPENAI_API_KEY",
        "AI_INTEGRATIONS_OPENAI_BASE_URL",
      ] as const;
      const values = names.map((name) => process.env[name]);
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "fixture";
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL =
        "https://example.invalid/v1";
      const originalFetch = globalThis.fetch;
      let requests = 0,
        attempts = 0,
        reviews = 0;
      globalThis.fetch = async () => {
        requests++;
        throw new Error("Unexpected fixture network request");
      };
      try {
        await assert.rejects(
          runJudge({
            locale: "en",
            agent,
            taskId: f.child.id,
            purpose: "completion",
            originalBrief: "Fixture",
            actionSummary: "Fixture",
            beforeAttempt: async () => {
              attempts++;
            },
            persistReview: async () => {
              reviews++;
            },
          }),
          (error) =>
            error instanceof TaskSpendBudgetError &&
            /shared.*cost/i.test(error.message),
        );
        assert.equal(requests, 0);
        assert.equal(attempts, 1);
        assert.equal(reviews, 0);
      } finally {
        globalThis.fetch = originalFetch;
        names.forEach((name, i) => {
          if (values[i] === undefined) delete process.env[name];
          else process.env[name] = values[i];
        });
      }
    },
  );

  await t.test(
    "a cyclic parent graph fails admission without an unbounded recursive walk",
    async () => {
      limits();
      const f = await family();
      await db
        .update(tasksTable)
        .set({ parentTaskId: f.grandchild.id })
        .where(eq(tasksTable.id, f.root.id));
      await assert.rejects(
        readTaskSpendAdmission(f.child, localLimits, "en"),
        /rooted task family/i,
      );
    },
  );
});
