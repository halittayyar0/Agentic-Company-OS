import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import {
  agentsTable,
  db,
  dbReady,
  closeDatabase,
  inferenceAttemptsTable as attempts,
  inferenceResponseEvidenceTable as evidence,
  usageEventsTable as receipts,
} from "@workspace/db";
import { InferenceAccountingError } from "./inference-accounting-errors";
import { tasksTable, runtimeHealthSamplesTable } from "@workspace/db";
import { readIndividualTaskSpendAdmission } from "./task-spend-admission";
import { readFamilySpendAdmission } from "./family-spend-admission";
import { readInferenceAccountingStatus } from "../inference-accounting-status";
import { getOperationsOverview } from "../operations/operations-read-model";
import express from "express";
import orgRouter from "../../routes/org";
import { databaseBackend, effectiveUsageEventsView } from "@workspace/db";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { reconcileSavedInferenceEvidence } from "./inference-usage-correction";
import { recordInferenceResponseEvidence } from "./inference-response-evidence";
import { reconcileInferenceResponseEvidence as recover } from "./inference-usage-correction";
test.after(() => closeDatabase());
async function fixture(
  t: test.TestContext,
  original: Partial<typeof receipts.$inferInsert> = {},
  late: Partial<typeof evidence.$inferInsert> = {},
) {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Owned correction fixture",
      role: "test",
      systemPrompt: "test",
    })
    .returning();
  const id = randomUUID(),
    owner = randomUUID(),
    time = new Date("2026-10-07T12:00:00Z");
  await db.insert(attempts).values({
    id,
    agentId: agent.id,
    scopeKey: `agent:${agent.id}`,
    modelId: "fixture",
    provider: "openrouter",
    kind: "chat",
    state: "uncertain",
    invocationOwnerId: owner,
    dispatchedAt: time,
    settledAt: time,
    requestDeadlineAt: time,
  });
  const [receipt] = await db
    .insert(receipts)
    .values({
      agentId: agent.id,
      ordinaryInferenceId: id,
      modelId: "fixture",
      provider: "openrouter",
      kind: "chat",
      outcome: "failed",
      failureKind: "timeout",
      usageReported: false,
      createdAt: time,
      ...original,
    })
    .returning();
  await db.insert(evidence).values({
    attemptId: id,
    invocationOwnerId: owner,
    modelId: "fixture",
    provider: "openrouter",
    responseId: "resp_correction",
    promptTokens: 2,
    completionTokens: 3,
    totalTokens: 5,
    ...late,
  });
  t.after(async () => {
    await db.execute(
      sql`DELETE FROM inference_usage_corrections WHERE attempt_id=${id}::uuid`,
    );
    await db.delete(evidence).where(eq(evidence.attemptId, id));
    await db.delete(receipts).where(eq(receipts.agentId, agent.id));
    await db.delete(attempts).where(eq(attempts.id, id));
    await db.delete(tasksTable).where(eq(tasksTable.ownerAgentId, agent.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });
  return {
    id,
    receipt,
    time,
    marker: async () =>
      (await db.select().from(attempts).where(eq(attempts.id, id)))[0],
    raw: async () =>
      (await db.select().from(receipts).where(eq(receipts.id, receipt.id)))[0],
    effective: async () =>
      (
        await db.execute(
          sql`SELECT * FROM effective_usage_events WHERE id=${receipt.id}`,
        )
      ).rows[0],
  };
}
test("late usage corrects exactly one effective receipt at its original time without rewriting the failed outcome", async (t) => {
  const f = await fixture(t);
  assert.equal(await recover(f.id), "applied");
  assert.deepEqual(await f.raw(), f.receipt);
  const effective = await f.effective();
  assert.equal(effective.total_tokens, 5);
  assert.equal(effective.usage_reported, true);
  assert.equal(effective.outcome, "failed");
  assert.equal(effective.failure_kind, "timeout");
  assert.equal(
    new Date(String(effective.created_at)).getTime(),
    f.time.getTime(),
  );
  assert.equal((await f.marker()).state, "accounted");
  await recover(f.id);
  assert.equal(
    (
      await db.execute(
        sql`SELECT count(*)::int AS n FROM inference_usage_corrections WHERE attempt_id=${f.id}::uuid`,
      )
    ).rows[0].n,
    1,
  );
});
test("component lower bounds and known dollars cannot shrink or disappear", async (t) => {
  const f = await fixture(t, {
    promptTokens: 1,
    completionTokens: 2,
    totalTokens: 3,
    reportedCostUsd: "0.250000",
  });
  await recover(f.id);
  assert.equal((await f.effective()).reported_cost_usd, "0.250000");
  for (const [original, late] of [
    [{ promptTokens: 3 }, {}],
    [{ completionTokens: 4 }, {}],
    [{ totalTokens: 6 }, {}],
    [{ reportedCostUsd: "0.250000" }, { reportedCostUsd: "0.200000" }],
    [
      {
        promptTokens: 1,
        completionTokens: 3,
        totalTokens: 4,
        usageReported: true,
      },
      {},
    ],
  ] as const) {
    const denied = await fixture(t, original, late);
    await assert.rejects(recover(denied.id), InferenceAccountingError);
    assert.ok((await denied.marker()).evidenceConflictAt);
    assert.equal((await denied.marker()).state, "uncertain");
    assert.equal(
      (await denied.effective()).total_tokens,
      denied.receipt.totalTokens,
    );
  }
});
test("a lost recovery acknowledgement retries persistence and concurrent workers keep one correction", async (t) => {
  const f = await fixture(t),
    original = db.transaction.bind(db);
  let commits = 0;
  t.mock.method(
    db,
    "transaction",
    async (callback: Parameters<typeof db.transaction>[0]) => {
      const result = await original(callback);
      if (++commits === 1)
        throw new Error("owned recovery acknowledgement lost");
      return result;
    },
  );
  await Promise.all([recover(f.id), recover(f.id)]);
  assert.equal((await f.effective()).total_tokens, 5);
  assert.equal(
    (
      await db.execute(
        sql`SELECT count(*)::int AS n FROM inference_usage_corrections WHERE attempt_id=${f.id}::uuid`,
      )
    ).rows[0].n,
    1,
  );
});
test("a missing original receipt cannot clear accounting until the original settlement arrives", async (t) => {
  const f = await fixture(t);
  await db.delete(receipts).where(eq(receipts.id, f.receipt.id));
  assert.equal(await recover(f.id), "pending");
  assert.equal((await f.marker()).state, "uncertain");
  await db.insert(receipts).values(f.receipt);
  await recover(f.id);
  assert.equal((await f.marker()).state, "accounted");
});
test("a poisoned or ownerless marker cannot authorize a correction", async (t) => {
  for (const change of [
    { evidenceConflictAt: new Date() },
    { invocationOwnerId: null },
  ]) {
    const f = await fixture(t);
    await db.update(attempts).set(change).where(eq(attempts.id, f.id));
    await assert.rejects(recover(f.id), InferenceAccountingError);
    assert.equal((await f.effective()).total_tokens, 0);
    assert.equal((await f.marker()).state, "uncertain");
  }
});
test("conflict after correction revokes complete provenance without shrinking accepted lower bounds", async (t) => {
  const f = await fixture(t, {}, { reportedCostUsd: "0.250000" });
  await recover(f.id);
  const marker = await f.marker();
  await assert.rejects(
    recordInferenceResponseEvidence(f.id, marker.invocationOwnerId!, {
      provider: "openrouter",
      model: "fixture",
      responseId: "resp_correction",
      usage: {
        prompt_tokens: 2,
        completion_tokens: 4,
        total_tokens: 6,
        cost: 0.25,
      },
    }),
    InferenceAccountingError,
  );
  const effective = await f.effective();
  assert.equal(effective.total_tokens, 5);
  assert.equal(effective.reported_cost_usd, "0.250000");
  assert.equal(effective.usage_reported, false);
  const status = await readInferenceAccountingStatus("agent", marker.agentId);
  assert.equal(status?.status, "recovery_required");
  assert.equal(status?.attempts[0].usage?.usageReported, false);
  assert.deepEqual(await f.raw(), f.receipt);
  await assert.rejects(recover(f.id), InferenceAccountingError);
  assert.equal(
    (
      await db.execute(
        sql`SELECT count(*)::int AS n FROM activity_events WHERE type='operations_changed' AND detail->>'attemptId'=${f.id}`,
      )
    ).rows[0].n,
    2,
    "correction and first poison both invalidate cached operations",
  );
});
test("task/family/status and already sampled operations history agree at original time, while future cycles exclude that usage", async (t) => {
  const f = await fixture(
    t,
    { kind: "task_step" },
    { reportedCostUsd: "0.250000" },
  );
  const marker = await f.marker();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Owned correction task",
      brief: "test",
      ownerAgentId: marker.agentId,
      status: "blocked",
      blockedReason: "budget",
      createdAt: new Date("2026-10-06T00:00:00Z"),
    })
    .returning();
  await db
    .update(attempts)
    .set({ taskId: task.id, scopeKey: `task:${task.id}`, kind: "task_step" })
    .where(eq(attempts.id, f.id));
  await db
    .update(receipts)
    .set({ taskId: task.id })
    .where(eq(receipts.id, f.receipt.id));
  const immutable = await f.raw();
  const [sample] = await db
    .insert(runtimeHealthSamplesTable)
    .values({
      bucketAt: f.time,
      sampledAt: new Date(f.time.getTime() + 60000),
      runtimeTruthState: "offline",
      dueQueueDepth: 7,
      providerSuccessCount: 1,
      providerErrorCount: 2,
      taskTokens: 0,
      reportedCostUsd: "0.000000",
    })
    .returning();
  t.after(() =>
    db
      .delete(runtimeHealthSamplesTable)
      .where(eq(runtimeHealthSamplesTable.bucketAt, f.time)),
  );
  await recover(f.id);
  const limits = { maxSteps: null, maxTokens: 100000, maxReportedCostUsd: 1 };
  const individual = await readIndividualTaskSpendAdmission(
    task,
    limits,
    "en",
    new Date("2026-10-09T12:00:00Z"),
  );
  const family = await readFamilySpendAdmission(
    task.id,
    "en",
    new Date("2026-10-09T12:00:00Z"),
  );
  assert.equal(individual.tokensUsed, 5);
  assert.equal(Number(individual.reportedCostUsd), 0.25);
  assert.equal(family.tokensUsed, 5);
  assert.equal(Number(family.reportedCostUsd), 0.25);
  assert.equal(family.accountingStatus, null);
  const status = await readInferenceAccountingStatus("task", task.id);
  assert.equal(status?.status, "clear");
  assert.equal(status?.attempts[0].usage?.totalTokens, 5);
  const overview = await getOperationsOverview({
    now: new Date("2026-10-07T12:10:00Z"),
  });
  assert.equal(overview.usage.taskTokens, 5);
  assert.equal(overview.usage.reportedCostUsd, 0.25);
  const history = overview.fleetHealthSamples.find(
    (s) => s.bucketAt === f.time.toISOString(),
  );
  assert.ok(history);
  assert.equal(history.taskTokens, 5);
  assert.equal(history.reportedCostUsd, 0.25);
  assert.equal(history.providerSuccessCount, 0);
  assert.equal(history.providerErrorCount, 2);
  assert.equal(history.runtimeTruthState, "offline");
  assert.equal(history.dueQueueDepth, 7);
  assert.deepEqual(
    (
      await db
        .select()
        .from(runtimeHealthSamplesTable)
        .where(eq(runtimeHealthSamplesTable.bucketAt, f.time))
    )[0],
    sample,
  );
  assert.deepEqual(await f.raw(), immutable);
  const [unchangedTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  assert.equal(unchangedTask.status, "blocked");
  assert.equal(unchangedTask.blockedReason, "budget");
  const [recurring] = await db
    .update(tasksTable)
    .set({
      autonomyMode: "continuous",
      lastCycleCompletedAt: new Date("2026-10-08T00:00:00Z"),
    })
    .where(eq(tasksTable.id, task.id))
    .returning();
  assert.equal(
    (
      await readIndividualTaskSpendAdmission(
        recurring,
        limits,
        "en",
        new Date("2026-10-09T12:00:00Z"),
      )
    ).tokensUsed,
    0,
  );
  assert.equal(
    (
      await readFamilySpendAdmission(
        task.id,
        "en",
        new Date("2026-10-09T12:00:00Z"),
      )
    ).tokensUsed,
    0,
  );
});
test("organization today's usage reads corrected billing once and preserves unknown dollars", async (t) => {
  const old = await fixture(t);
  await recover(old.id);
  const today = await fixture(t, { createdAt: new Date() });
  await recover(today.id);
  const app = express();
  app.use("/api", orgRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/org/summary`,
  );
  assert.equal(response.status, 200);
  const result = (await response.json()) as Record<string, unknown>;
  assert.equal(result.tokensUsedToday, 5);
  assert.equal(result.usageEventsToday, 1);
  assert.equal(result.tokenReportedEventsToday, 1);
  assert.equal(result.tokenUsageCoverageToday, "complete");
  assert.equal(result.costReportedEventsToday, 0);
});
test("restart catch-up is bounded and consumes only saved evidence without inference", async (t) => {
  const first = await fixture(t),
    second = await fixture(t);
  assert.equal(await reconcileSavedInferenceEvidence(1), 1);
  assert.equal((await first.marker()).state, "accounted");
  assert.equal((await second.marker()).state, "uncertain");
  assert.equal(await reconcileSavedInferenceEvidence(1), 1);
  assert.equal(await reconcileSavedInferenceEvidence(1), 0);
  await assert.rejects(reconcileSavedInferenceEvidence(0));
  assert.deepEqual(await first.raw(), first.receipt);
  assert.deepEqual(await second.raw(), second.receipt);
});
test("native and historical receipts remain identical through ordinary correction and poison", async (t) => {
  const f = await fixture(t),
    marker = await f.marker();
  const historical = await db
    .insert(receipts)
    .values({
      agentId: marker.agentId,
      modelId: "legacy",
      provider: "ollama",
      kind: "chat",
      totalTokens: 8,
      usageReported: null,
    })
    .returning();
  const native = await db
    .insert(receipts)
    .values({
      agentId: marker.agentId,
      modelId: "codex",
      provider: "chatgpt",
      kind: "task_step",
      inferenceKey: `codex:${"a".repeat(64)}`,
      totalTokens: 9,
      usageReported: true,
    })
    .returning();
  await recover(f.id);
  await assert.rejects(
    recordInferenceResponseEvidence(f.id, marker.invocationOwnerId!, {
      provider: "openrouter",
      model: "fixture",
      responseId: "different-response",
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }),
    InferenceAccountingError,
  );
  for (const [original] of [historical, native]) {
    const [effective] = await db
      .select()
      .from(effectiveUsageEventsView)
      .where(eq(effectiveUsageEventsView.id, original.id));
    assert.deepEqual(effective, original);
  }
});
test("separate PostgreSQL processes reconcile one receipt once and advance one operations event", async (t) => {
  if (databaseBackend !== "postgresql") {
    assert.notEqual(process.env.POSTGRES_RACE_TEST_FAIL_IF_SKIPPED, "1");
    t.skip(
      "Requires owned disposable PostgreSQL, no cross-process PGlite claim",
    );
    return;
  }
  assert.equal(process.env.POSTGRES_RACE_TEST_DISPOSABLE, "1");
  const f = await fixture(t);
  const execute = promisify(execFile),
    worker = fileURLToPath(
      new URL(
        "./fixtures/inference-usage-correction-worker.ts",
        import.meta.url,
      ),
    );
  const results = await Promise.all(
    [1, 2].map(() =>
      execute(process.execPath, ["--import", "tsx", worker, f.id], {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      }),
    ),
  );
  for (const result of results)
    assert.match(result.stdout, /"result":"applied"/);
  assert.equal((await f.effective()).total_tokens, 5);
  assert.equal((await f.marker()).state, "accounted");
  assert.equal(
    (
      await db.execute(
        sql`SELECT count(*)::int AS n FROM inference_usage_corrections WHERE attempt_id=${f.id}::uuid`,
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.execute(
        sql`SELECT count(*)::int AS n FROM activity_events WHERE type='operations_changed' AND detail->>'attemptId'=${f.id}`,
      )
    ).rows[0].n,
    1,
  );
});
