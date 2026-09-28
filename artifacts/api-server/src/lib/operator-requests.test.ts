import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
const {
  agentsTable,
  db,
  dbReady,
  closeDatabase,
  operatorRequestsTable: receipts,
  runtimeControlsTable,
} = await import("@workspace/db");
const {
  reserveOperatorRequest,
  beforeOperatorEffect,
  completeOperatorRequest,
  failOperatorRequest,
  readOperatorRequest,
  OperatorRequestError,
} = await import("./operator-requests");

test("operator request admission binds exact identity, fences effects and keeps encrypted results recoverable", async (t) => {
  await dbReady;
  const previousKey = process.env.RUNTIME_CONTROL_KEY;
  process.env.RUNTIME_CONTROL_KEY = "operator-receipt-test-key-32-characters";
  t.after(async () => {
    if (previousKey === undefined) delete process.env.RUNTIME_CONTROL_KEY;
    else process.env.RUNTIME_CONTROL_KEY = previousKey;
    await closeDatabase();
  });
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Operator receipt test",
      role: "Test",
      systemPrompt: "Test",
    })
    .returning();
  const make = (
    input: Record<string, unknown> = {
      command: "printf 'original 秘密'",
      as: "sandbox",
    },
  ) => ({
    requestId: randomUUID(),
    agentId: agent.id,
    kind: "terminal_sandbox" as const,
    input,
  });
  const request = make();
  const outcomes = await Promise.all([
    reserveOperatorRequest(request),
    reserveOperatorRequest(request),
  ]);
  assert.equal(outcomes.filter((r) => r.admitted).length, 1);
  const claim = outcomes.find((r) => r.admitted)!;
  if (!claim.admitted) throw Error("missing owner");
  assert.equal(outcomes.find((r) => !r.admitted)!.receipt.state, "reserved");
  assert.equal(
    (await readOperatorRequest(agent.id, request.requestId))!.state,
    "reserved",
  );
  assert.equal(
    await readOperatorRequest(agent.id + 1000, request.requestId),
    null,
  );
  for (const changed of [
    { ...request, input: { ...request.input, command: "printf 'changed'" } },
    { ...request, agentId: agent.id + 1 },
    { ...request, kind: "terminal_host" as const },
  ])
    await assert.rejects(
      reserveOperatorRequest(changed),
      (e: unknown) =>
        e instanceof OperatorRequestError && e.code === "identity_conflict",
    );
  await assert.rejects(
    reserveOperatorRequest(make()),
    (e: unknown) => e instanceof OperatorRequestError && e.code === "busy",
  );
  await assert.rejects(
    beforeOperatorEffect({ ...claim.owner, ownerId: randomUUID() }),
    (e: unknown) =>
      e instanceof OperatorRequestError && e.code === "ownership_lost",
  );
  await beforeOperatorEffect(claim.owner);
  await beforeOperatorEffect(claim.owner); // Subsequent steps belong to this one owner.
  const output = {
    ok: true,
    exitCode: 0,
    stdout: "fixture-password=original-secret\n原文",
    stderr: "",
    durationMs: 12,
    note: null,
    cwd: "fixture-workspace",
  };
  await completeOperatorRequest(claim.owner, output);
  const receipt = (await readOperatorRequest(agent.id, request.requestId))!;
  assert.equal(receipt.state, "complete");
  assert.equal(receipt.resultAvailability, "available");
  assert.deepEqual(receipt.result, output);
  assert.equal("ownerId" in receipt, false);
  assert.equal("requestHash" in receipt, false);
  const [stored] = await db
    .select()
    .from(receipts)
    .where(eq(receipts.requestId, request.requestId));
  const raw = JSON.stringify(stored);
  for (const secret of [
    request.input.command,
    output.stdout,
    output.cwd,
    "original-secret",
  ])
    assert.equal(raw.includes(String(secret)), false);
  assert.equal((await reserveOperatorRequest(request)).admitted, false);
  assert.equal(
    (
      await reserveOperatorRequest({
        ...request,
        input: { as: "sandbox", command: request.input.command },
      })
    ).admitted,
    false,
    "object key order is not a new request",
  );
  await assert.rejects(
    reserveOperatorRequest({
      ...request,
      input: { ...request.input, command: request.input.command + " " },
    }),
    (e: unknown) =>
      e instanceof OperatorRequestError && e.code === "identity_conflict",
  );
  await assert.rejects(
    beforeOperatorEffect(claim.owner),
    (e: unknown) =>
      e instanceof OperatorRequestError && e.code === "ownership_lost",
  );

  process.env.RUNTIME_CONTROL_KEY =
    "a-different-operator-test-key-32-characters";
  const rotated = (await readOperatorRequest(agent.id, request.requestId))!;
  assert.equal(rotated.state, "complete");
  assert.equal(rotated.resultAvailability, "unavailable");
  assert.equal(rotated.result, null);
  await assert.rejects(
    reserveOperatorRequest(request),
    (e: unknown) =>
      e instanceof OperatorRequestError && e.code === "identity_conflict",
  );
  process.env.RUNTIME_CONTROL_KEY = "operator-receipt-test-key-32-characters";
  await db
    .update(receipts)
    .set({
      resultCiphertext:
        (stored.resultCiphertext!.startsWith("a") ? "b" : "a") +
        stored.resultCiphertext!.slice(1),
    })
    .where(eq(receipts.requestId, request.requestId));
  assert.equal(
    (await readOperatorRequest(agent.id, request.requestId))!
      .resultAvailability,
    "unavailable",
  );

  const expiredRequest = make(),
    expired = await reserveOperatorRequest(expiredRequest);
  if (!expired.admitted) throw Error("missing owner");
  await db
    .update(receipts)
    .set({ expiresAt: sql`clock_timestamp() - interval '1 second'` })
    .where(eq(receipts.requestId, expiredRequest.requestId));
  assert.equal(
    (await readOperatorRequest(agent.id, expiredRequest.requestId))!.state,
    "not_dispatched",
  );
  assert.equal(
    (
      await db
        .select()
        .from(receipts)
        .where(eq(receipts.requestId, expiredRequest.requestId))
    )[0].state,
    "reserved",
    "receipt read never mutates expiry",
  );
  await assert.rejects(
    beforeOperatorEffect(expired.owner),
    (e: unknown) =>
      e instanceof OperatorRequestError && e.code === "ownership_lost",
  );
  const nextRequest = make(),
    next = await reserveOperatorRequest(nextRequest);
  if (!next.admitted) throw Error("missing owner");
  await beforeOperatorEffect(next.owner);
  await db
    .update(receipts)
    .set({ expiresAt: sql`clock_timestamp() - interval '1 second'` })
    .where(eq(receipts.requestId, nextRequest.requestId));
  assert.equal(
    (await readOperatorRequest(agent.id, nextRequest.requestId))!.state,
    "unknown",
  );
  await assert.rejects(
    completeOperatorRequest(next.owner, output),
    (e: unknown) =>
      e instanceof OperatorRequestError && e.code === "ownership_lost",
  );

  const stopRequest = make(),
    stopped = await reserveOperatorRequest(stopRequest);
  if (!stopped.admitted) throw Error("missing owner");
  await db
    .update(runtimeControlsTable)
    .set({ version: sql`${runtimeControlsTable.version} + 2` })
    .where(eq(runtimeControlsTable.id, 1));
  await assert.rejects(
    beforeOperatorEffect(stopped.owner),
    (e: unknown) =>
      e instanceof OperatorRequestError && e.code === "execution_blocked",
  );
  await failOperatorRequest(stopped.owner, "execution_blocked");
  assert.equal(
    (await readOperatorRequest(agent.id, stopRequest.requestId))!.state,
    "not_dispatched",
  );

  const browserRequest = {
    requestId: randomUUID(),
    agentId: agent.id,
    kind: "browser_input" as const,
    input: { text: "fixture-private-text", leaseId: "fixture-private-lease" },
  };
  const browser = await reserveOperatorRequest(browserRequest);
  if (!browser.admitted) throw Error("missing owner");
  await beforeOperatorEffect(browser.owner);
  await failOperatorRequest(browser.owner, "execution_error");
  const unknown = (await readOperatorRequest(
    agent.id,
    browserRequest.requestId,
  ))!;
  assert.equal(unknown.state, "unknown");
  assert.equal(unknown.resultAvailability, "not_applicable");
  assert.equal(
    JSON.stringify(await db.select().from(receipts)).includes(
      "fixture-private",
    ),
    false,
  );
  const swappedRequest = make();
  const swapped = await reserveOperatorRequest(swappedRequest);
  if (!swapped.admitted) throw Error("missing owner");
  await beforeOperatorEffect(swapped.owner);
  await completeOperatorRequest(swapped.owner, {
    ...output,
    stdout: "other output",
  });
  await db
    .update(receipts)
    .set({
      resultCiphertext: stored.resultCiphertext,
      resultNonce: stored.resultNonce,
      resultAuthTag: stored.resultAuthTag,
    })
    .where(eq(receipts.requestId, swappedRequest.requestId));
  const swappedReceipt = (await readOperatorRequest(
    agent.id,
    swappedRequest.requestId,
  ))!;
  assert.equal(swappedReceipt.state, "complete");
  assert.equal(
    swappedReceipt.resultAvailability,
    "unavailable",
    "authentic ciphertext from another request is not this request's output",
  );
  assert.equal(swappedReceipt.result, null);

  process.env.RUNTIME_CONTROL_KEY = "too-short";
  const withoutKey = make();
  await assert.rejects(
    reserveOperatorRequest(withoutKey),
    (e: unknown) =>
      e instanceof OperatorRequestError && e.code === "key_unavailable",
  );
  assert.equal(await readOperatorRequest(agent.id, withoutKey.requestId), null);
  process.env.RUNTIME_CONTROL_KEY = "operator-receipt-test-key-32-characters";
  for (const malformed of [
    { command: undefined },
    { command: "a".repeat(131073) },
    { input: Number.NaN },
  ]) {
    const invalid = make(malformed);
    await assert.rejects(
      reserveOperatorRequest(invalid),
      (e: unknown) =>
        e instanceof OperatorRequestError && e.code === "invalid_request",
    );
    assert.equal(await readOperatorRequest(agent.id, invalid.requestId), null);
  }

  await db
    .update(runtimeControlsTable)
    .set({ emergencyStopEnabled: true })
    .where(eq(runtimeControlsTable.id, 1));
  const blocked = make();
  await assert.rejects(
    reserveOperatorRequest(blocked),
    (e: unknown) =>
      e instanceof OperatorRequestError && e.code === "execution_blocked",
  );
  assert.equal(await readOperatorRequest(agent.id, blocked.requestId), null);
  const cleanup = await reserveOperatorRequest({
    requestId: randomUUID(),
    agentId: agent.id,
    kind: "browser_release",
    input: { leaseId: "fixture-lease" },
  });
  if (!cleanup.admitted) throw Error("missing cleanup owner");
  await beforeOperatorEffect(cleanup.owner);
  assert.equal(
    (await completeOperatorRequest(cleanup.owner)).state,
    "complete",
  );
  await db
    .update(runtimeControlsTable)
    .set({ emergencyStopEnabled: false })
    .where(eq(runtimeControlsTable.id, 1));
  const [runtime] = await db
    .select()
    .from(runtimeControlsTable)
    .where(eq(runtimeControlsTable.id, 1));
  await db.delete(runtimeControlsTable).where(eq(runtimeControlsTable.id, 1));
  const unavailable = make();
  try {
    await assert.rejects(
      reserveOperatorRequest(unavailable),
      /Runtime control state is missing/,
    );
    assert.equal(
      await readOperatorRequest(agent.id, unavailable.requestId),
      null,
      "unavailable admission state never produces an owner or receipt",
    );
  } finally {
    await db.insert(runtimeControlsTable).values(runtime);
  }
  const last = await reserveOperatorRequest(make());
  if (!last.admitted) throw Error("missing owner");
  await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  await assert.rejects(
    beforeOperatorEffect(last.owner),
    (e: unknown) =>
      e instanceof OperatorRequestError && e.code === "ownership_lost",
    "deleted agent cannot receive a newly dispatched effect",
  );
  assert.equal(
    (await readOperatorRequest(agent.id, request.requestId))!.state,
    "complete",
  );
  await assert.rejects(
    reserveOperatorRequest(make()),
    (e: unknown) =>
      e instanceof OperatorRequestError && e.code === "agent_missing",
  );
});
