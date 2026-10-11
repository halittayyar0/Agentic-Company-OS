import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  inferenceAttemptsTable,
  usageEventsTable,
  inferenceUsageCorrectionsTable,
} from "@workspace/db";
import app from "../app";
import { recordInferenceResponseEvidence } from "../lib/orchestrator/inference-response-evidence";
import { GetInferenceAccountingStatusResponse } from "@workspace/api-zod";

test.after(() => closeDatabase());

test("explicit scope-bound accounting recovery applies trusted saved evidence once without inference or task resume", async (t) => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Owned recovery",
      role: "Fixture",
      systemPrompt: "PRIVATE",
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      ownerAgentId: agent.id,
      title: "Preserved work",
      brief: "PRIVATE",
      status: "blocked",
      blockedReason: "runtime_failure",
    })
    .returning();
  const [otherAgent] = await db
    .insert(agentsTable)
    .values({ name: "Other owner", role: "Fixture", systemPrompt: "PRIVATE" })
    .returning();
  const [other] = await db
    .insert(tasksTable)
    .values({
      ownerAgentId: otherAgent.id,
      title: "Other scope",
      brief: "Fixture",
    })
    .returning();
  const id = randomUUID(),
    owner = randomUUID(),
    now = new Date();
  await db.insert(inferenceAttemptsTable).values({
    id,
    invocationOwnerId: owner,
    agentId: agent.id,
    taskId: task.id,
    scopeKey: `task:${task.id}`,
    modelId: "ollama:fixture",
    provider: "ollama",
    kind: "task_step",
    state: "uncertain",
    dispatchedAt: now,
    settledAt: now,
    requestDeadlineAt: now,
  });
  const [receipt] = await db
    .insert(usageEventsTable)
    .values({
      ordinaryInferenceId: id,
      agentId: agent.id,
      taskId: task.id,
      modelId: "ollama:fixture",
      provider: "ollama",
      kind: "task_step",
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      usageReported: false,
    })
    .returning();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const request = async (
    body: unknown = { acknowledge: true },
    scopeId = task.id,
    method = "POST",
  ) => {
    const response = await fetch(
      `${origin}/api/inference-accounting/${id}/reconcile?scopeType=task&scopeId=${scopeId}`,
      {
        method,
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: method === "POST" ? JSON.stringify(body) : undefined,
      },
    );
    const raw = await response.text();
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
    return { status: response.status, data };
  };
  assert.equal((await request()).status, 200);
  assert.equal((await request()).data.outcome, "pending");
  assert.equal(
    (await request({ acknowledge: true, totalTokens: 0 })).status,
    400,
  );
  assert.equal((await request({ acknowledge: false })).status, 400);
  assert.equal((await request(undefined, other.id)).status, 409);
  assert.equal((await request(undefined, task.id, "GET")).status, 404);
  await recordInferenceResponseEvidence(id, owner, {
    model: "ollama:fixture",
    provider: "ollama",
    responseId: "trusted-response",
    usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
  });
  const outcomes = await Promise.all([request(), request()]);
  assert.ok(
    outcomes.every(
      (x) =>
        x.status === 200 &&
        x.data.outcome === "applied" &&
        x.data.attemptId === id &&
        x.data.scopeId === task.id,
    ),
  );
  const corrections = await db
    .select()
    .from(inferenceUsageCorrectionsTable)
    .where(eq(inferenceUsageCorrectionsTable.attemptId, id));
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].receiptId, receipt.id);
  assert.deepEqual(
    (
      await db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.id, receipt.id))
    )[0],
    receipt,
  );
  assert.deepEqual(
    (await db.select().from(tasksTable).where(eq(tasksTable.id, task.id)))[0],
    task,
  );
  assert.equal((await request()).data.outcome, "applied");
  const status = await fetch(
    `${origin}/api/inference-accounting?scopeType=task&scopeId=${task.id}`,
  );
  const view = GetInferenceAccountingStatusResponse.strict().parse(
    await status.json(),
  );
  assert.equal(view.status, "clear");
  assert.ok(view.attempts[0].usage);
  assert.equal(view.attempts[0].usage.totalTokens, 7);
  assert.doesNotMatch(
    JSON.stringify(view),
    /PRIVATE|invocationOwnerId|systemPrompt/,
  );
});
