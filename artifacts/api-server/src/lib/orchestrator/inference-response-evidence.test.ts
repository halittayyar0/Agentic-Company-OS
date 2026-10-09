import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  db,
  dbReady,
  closeDatabase,
  inferenceAttemptsTable,
  usageEventsTable,
  inferenceResponseEvidenceTable,
} from "@workspace/db";
import {
  runAccountedCompletion,
  InferenceAccountingError,
} from "./inference-accounting";
import { recordInferenceResponseEvidence } from "./inference-response-evidence";
import { readInferenceAccountingStatus } from "../inference-accounting-status";
test.after(() => closeDatabase());
async function fixture(t: test.TestContext) {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({ name: "Evidence fixture", role: "test", systemPrompt: "test" })
    .returning();
  t.after(async () => {
    await db
      .delete(inferenceResponseEvidenceTable)
      .where(eq(inferenceResponseEvidenceTable.attemptId, attempt.id));
    await db
      .delete(usageEventsTable)
      .where(eq(usageEventsTable.agentId, agent.id));
    await db
      .delete(inferenceAttemptsTable)
      .where(eq(inferenceAttemptsTable.agentId, agent.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });
  await assert.rejects(
    runAccountedCompletion(
      {
        agentId: agent.id,
        taskId: null,
        modelId: "fixture",
        provider: "openrouter",
        kind: "chat",
      },
      { model: "fixture", messages: [] },
      async (params) => {
        await params.beforeRequest?.();
        return {
          provider: "openrouter",
          completion: {
            id: "response-fixture",
            object: "chat.completion",
            created: 1,
            model: "fixture",
            choices: [],
          },
        };
      },
    ),
    InferenceAccountingError,
  );
  const [attempt] = await db
    .select()
    .from(inferenceAttemptsTable)
    .where(eq(inferenceAttemptsTable.agentId, agent.id));
  assert.ok(attempt.invocationOwnerId);
  const evidence = {
    provider: "openrouter" as const,
    model: "fixture",
    responseId: "response-fixture",
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
  };
  return {
    attempt,
    evidence,
    write: (value = evidence, owner = attempt.invocationOwnerId!) =>
      recordInferenceResponseEvidence(attempt.id, owner, value),
    records: () =>
      db
        .select()
        .from(inferenceResponseEvidenceTable)
        .where(eq(inferenceResponseEvidenceTable.attemptId, attempt.id)),
    marker: async () =>
      (
        await db
          .select()
          .from(inferenceAttemptsTable)
          .where(eq(inferenceAttemptsTable.id, attempt.id))
      )[0],
    receipts: () =>
      db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.agentId, agent.id)),
  };
}
test("same-invocation late evidence is immutable/idempotent and recording alone does not clear uncertainty or edit the original receipt", async (t) => {
  const f = await fixture(t),
    original = await f.receipts();
  await f.write();
  await f.write();
  assert.equal((await f.records()).length, 1);
  assert.equal((await f.records())[0].totalTokens, 5);
  assert.equal((await f.records())[0].reportedCostUsd, null);
  assert.deepEqual(await f.receipts(), original);
  assert.equal((await f.marker()).state, "uncertain");
});
test("wrong owner and legacy null owner cannot manufacture response evidence", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.write(f.evidence, randomUUID()),
    InferenceAccountingError,
  );
  await db
    .update(inferenceAttemptsTable)
    .set({ invocationOwnerId: null })
    .where(eq(inferenceAttemptsTable.id, f.attempt.id));
  await assert.rejects(f.write(), InferenceAccountingError);
  assert.deepEqual(await f.records(), []);
});
test("conflicting same-owner full evidence durably poisons recovery, and later exact retries cannot erase that poison", async (t) => {
  const f = await fixture(t);
  await f.write();
  await assert.rejects(
    f.write({
      ...f.evidence,
      usage: { prompt_tokens: 2, completion_tokens: 4, total_tokens: 6 },
    }),
    InferenceAccountingError,
  );
  assert.ok((await f.marker()).evidenceConflictAt);
  await assert.rejects(f.write(), InferenceAccountingError);
  assert.equal((await f.records()).length, 1);
  assert.equal((await f.records())[0].totalTokens, 5);
  assert.equal((await f.marker()).state, "uncertain");
});
test("lost journal commit acknowledgement retries only persistence and keeps one row", async (t) => {
  const f = await fixture(t),
    original = db.transaction.bind(db);
  let commits = 0;
  t.mock.method(
    db,
    "transaction",
    async (callback: Parameters<typeof db.transaction>[0]) => {
      const value = await original(callback);
      if (++commits === 1)
        throw new Error("owned lost evidence acknowledgement");
      return value;
    },
  );
  await f.write();
  assert.equal((await f.records()).length, 1);
  assert.equal(commits, 2);
});
test("route mismatch, unsafe response ID and malformed or PostgreSQL-oversized counters are rejected without a journal row", async (t) => {
  for (const change of [
    { model: "different-model" },
    { provider: "ollama" },
    { responseId: "https://private.example/secret" },
    {
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 2147483648,
      },
    },
    { usage: { prompt_tokens: 4, completion_tokens: 4, total_tokens: 1 } },
    {
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        cost: 1000000,
      },
    },
  ]) {
    const f = await fixture(t);
    await assert.rejects(
      f.write({ ...f.evidence, ...change } as typeof f.evidence),
      InferenceAccountingError,
    );
    assert.deepEqual(await f.records(), []);
    assert.equal((await f.marker()).state, "uncertain");
  }
});
test("reported zero is valid evidence; unknown costs stay unknown", async (t) => {
  const f = await fixture(t);
  await f.write({
    ...f.evidence,
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
  assert.equal((await f.records())[0].totalTokens, 0);
  assert.equal((await f.records())[0].reportedCostUsd, null);
});
test("undispatched markers reject evidence without inventing a response", async (t) => {
  const f = await fixture(t);
  await db
    .update(inferenceAttemptsTable)
    .set({ state: "reserved", dispatchedAt: null, settledAt: null })
    .where(eq(inferenceAttemptsTable.id, f.attempt.id));
  await assert.rejects(f.write(), InferenceAccountingError);
  assert.deepEqual(await f.records(), []);
  assert.equal((await f.marker()).state, "reserved");
});
test("concurrent exact callbacks persist once and snapshot primitive evidence before waiting", async (t) => {
  const f = await fixture(t),
    value = { ...f.evidence, usage: { ...f.evidence.usage } };
  const first = f.write(value),
    second = f.write();
  value.usage.total_tokens = 999;
  value.responseId = "mutated-after-observation";
  await Promise.all([first, second]);
  const [saved] = await f.records();
  assert.equal((await f.records()).length, 1);
  assert.equal(saved.totalTokens, 5);
  assert.equal(saved.responseId, f.evidence.responseId);
});
test("persistent journal outage retries storage only, retains the original receipt and cannot clear the fence", async (t) => {
  const f = await fixture(t),
    original = await f.receipts();
  let retries = 0;
  t.mock.method(db, "transaction", async () => {
    retries++;
    throw new Error("owned offline journal outage");
  });
  await assert.rejects(
    f.write(),
    (error) =>
      error instanceof InferenceAccountingError && error.reason === "storage",
  );
  assert.equal(retries, 3);
  assert.deepEqual(await f.records(), []);
  assert.deepEqual(await f.receipts(), original);
  assert.equal((await f.marker()).state, "uncertain");
});
test("malformed same-owner evidence after a valid observation durably poisons exact replay", async (t) => {
  const f = await fixture(t);
  await f.write();
  await assert.rejects(
    f.write({ ...f.evidence, responseId: "https://private.invalid/secret" }),
    InferenceAccountingError,
  );
  assert.ok((await f.marker()).evidenceConflictAt);
  await assert.rejects(f.write(), InferenceAccountingError);
  assert.equal((await f.records()).length, 1);
});
test("positive costs below stored precision cannot become reported zero", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.write({
      ...f.evidence,
      usage: { ...f.evidence.usage, cost: 0.0000001 },
    } as typeof f.evidence),
    InferenceAccountingError,
  );
  assert.deepEqual(await f.records(), []);
  assert.ok((await f.marker()).evidenceConflictAt);
});
test("poisoning an accounted attempt survives a newer unsettled attempt in the same scope", async (t) => {
  const f = await fixture(t);
  await f.write();
  await db
    .update(inferenceAttemptsTable)
    .set({ state: "accounted" })
    .where(eq(inferenceAttemptsTable.id, f.attempt.id));
  const nextId = randomUUID();
  await db.insert(inferenceAttemptsTable).values({
    id: nextId,
    agentId: f.attempt.agentId,
    scopeKey: f.attempt.scopeKey,
    modelId: "fixture",
    provider: "openrouter",
    kind: "chat",
    invocationOwnerId: randomUUID(),
    requestDeadlineAt: new Date(Date.now() + 60000),
  });
  await assert.rejects(
    f.write({
      ...f.evidence,
      usage: { prompt_tokens: 2, completion_tokens: 4, total_tokens: 6 },
    }),
    (error) =>
      error instanceof InferenceAccountingError && error.reason === "conflict",
  );
  assert.ok((await f.marker()).evidenceConflictAt);
  const status = await readInferenceAccountingStatus(
    "agent",
    f.attempt.agentId,
  );
  assert.equal(status?.status, "recovery_required");
  assert.equal(status?.unsettledCount, 2);
  await db
    .delete(inferenceAttemptsTable)
    .where(eq(inferenceAttemptsTable.id, nextId));
  let calls = 0;
  await assert.rejects(
    runAccountedCompletion(
      {
        agentId: f.attempt.agentId,
        taskId: null,
        modelId: "fixture",
        provider: "openrouter",
        kind: "chat",
      },
      { model: "fixture", messages: [] },
      async () => {
        calls++;
        throw new Error("must not dispatch");
      },
    ),
    InferenceAccountingError,
  );
  assert.equal(calls, 0);
});
