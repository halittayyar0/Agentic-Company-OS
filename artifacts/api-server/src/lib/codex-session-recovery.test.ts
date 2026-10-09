import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  rm,
} from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  codexTaskSessionsTable as sessions,
  codexSessionRecoveriesTable as recoveries,
  approvalRequestsTable,
  codexActionApprovalsTable as native,
  usageEventsTable,
  activityEventsTable,
} from "@workspace/db";
import {
  recoverCodexSession,
  readCodexSessionRecovery,
  readCodexSessionRecoveryReceipt,
} from "./codex-session-recovery";
import { claimCodexTaskSession } from "./codex-task-session";
import type { CodexTaskAuthority } from "./codex-task-authority";

test.after(() => closeDatabase());
async function fixture(t: TestContext) {
  await dbReady;
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "acos-recovery-fixture-")),
  );
  const storage = path.join(root, "private-runtime"),
    home = path.join(storage, randomUUID()),
    workspace = path.join(root, "workspace");
  await mkdir(home, { recursive: true });
  await mkdir(workspace);
  await writeFile(path.join(home, "preserved.txt"), "old private state");
  await writeFile(path.join(workspace, "preserved.txt"), "actual user work");
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Recovery fixture",
      role: "Fixture",
      systemPrompt: "Fixture",
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Recovery fixture",
      brief: "Fixture",
      ownerAgentId: agent.id,
      status: "blocked",
      blockedReason: "operation_outcome_unknown",
    })
    .returning();
  const scope = {
    taskId: task.id,
    agentId: agent.id,
    revision: 4,
    state: "uncertain",
    ownerToken: null,
    attemptId: randomUUID(),
    leaseOwner: randomUUID(),
    policyRevision: 1,
    registrationId: randomUUID(),
    registrationRevision: 2,
    admissionVersion: 0,
    hostId: "private-fixture-host",
    cwd: workspace,
    storageDirectory: storage,
    home,
    model: "fixture-model",
    executableDigest: "a".repeat(64),
    threadId: "private_fixture_thread",
    lastTurnId: "private_fixture_turn",
    promptTokens: 5,
    completionTokens: 3,
    totalTokens: 8,
    cleanupState: "verified",
    cleanupAt: new Date(),
  };
  await db.insert(sessions).values(scope);
  await db.insert(usageEventsTable).values({
    agentId: agent.id,
    taskId: task.id,
    kind: "task_step",
    modelId: "chatgpt:fixture-model",
    provider: "chatgpt",
    totalTokens: 8,
    usageReported: true,
    outcome: "failed",
    failureKind: "codex_turn_failed",
    inferenceKey: "codex:" + randomUUID().replaceAll("-", "").repeat(2),
  });
  t.after(async () => {
    await db.delete(recoveries).where(eq(recoveries.taskId, task.id));
    await db
      .delete(usageEventsTable)
      .where(eq(usageEventsTable.agentId, agent.id));
    await db
      .delete(approvalRequestsTable)
      .where(eq(approvalRequestsTable.taskId, task.id));
    await db.delete(tasksTable).where(eq(tasksTable.id, task.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
    assert.equal(path.dirname(root), await realpath(os.tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  const request = {
    requestId: randomUUID(),
    expectedRevision: 4,
    acknowledgeUncertainEffects: true as const,
  };
  const row = async () =>
    (await db.select().from(sessions).where(eq(sessions.taskId, task.id)))[0];
  const addNative = async (state: "awaiting" | "uncertain") => {
    const [approval] = await db
      .insert(approvalRequestsTable)
      .values({
        taskId: task.id,
        agentId: agent.id,
        category: "other",
        title: "Fixture",
        description: "Fixture",
        status: state === "awaiting" ? "pending" : "approved",
      })
      .returning();
    await db.insert(native).values({
      approvalId: approval.id,
      taskId: task.id,
      agentId: agent.id,
      sessionRevision: 3,
      sessionOwnerToken: randomUUID(),
      attemptId: scope.attemptId,
      leaseOwner: scope.leaseOwner,
      policyRevision: 1,
      registrationId: scope.registrationId,
      registrationRevision: 2,
      admissionVersion: 0,
      threadId: scope.threadId,
      turnId: scope.lastTurnId,
      itemId: "fixture_item",
      requestKey: "string:fixture_request",
      actionStartedAtMs: 100,
      actionRevision: 1,
      actionDigest: "c".repeat(64),
      effectType: "commandExecution",
      state,
      decision: state === "uncertain" ? "accept" : null,
      consumedAt: state === "uncertain" ? new Date() : null,
      invalidatedAt: state === "uncertain" ? new Date() : null,
      invalidationReason: state === "uncertain" ? "cleanup_failed" : null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    return approval;
  };
  return {
    root,
    home,
    workspace,
    storage,
    task,
    agent,
    scope,
    request,
    row,
    addNative,
  };
}

test("explicit recovery archives private history without erasing uncertain effects or user work and admits only a fresh backend-bound home", async (t) => {
  const f = await fixture(t);
  await f.addNative("uncertain");
  const beforeTask = (
    await db.select().from(tasksTable).where(eq(tasksTable.id, f.task.id))
  )[0];
  const beforeNative = await db
    .select()
    .from(native)
    .where(eq(native.taskId, f.task.id));
  const beforeUsage = await db
    .select()
    .from(usageEventsTable)
    .where(eq(usageEventsTable.taskId, f.task.id));
  assert.equal((await readCodexSessionRecovery(f.task.id))!.canReset, true);
  const receipt = await recoverCodexSession(f.task.id, f.request, "en");
  assert.equal(receipt.outcome, "accepted");
  assert.equal(receipt.reason, null);
  assert.equal(receipt.revision, 5);
  const row = await f.row();
  assert.equal(row.state, "reset");
  assert.equal(row.ownerToken, null);
  assert.equal(row.threadId, null);
  assert.equal(row.totalTokens, null);
  const [archive] = await db
    .select()
    .from(recoveries)
    .where(eq(recoveries.requestId, f.request.requestId));
  assert.equal(archive.snapshot!.home, f.home);
  assert.equal(archive.snapshot!.threadId, f.scope.threadId);
  assert.equal(archive.snapshot!.totalTokens, 8);
  assert.equal(Object.hasOwn(archive.snapshot!, "ownerToken"), false);
  assert.deepEqual(
    (await db.select().from(tasksTable).where(eq(tasksTable.id, f.task.id)))[0],
    beforeTask,
  );
  assert.deepEqual(
    await db.select().from(native).where(eq(native.taskId, f.task.id)),
    beforeNative,
  );
  assert.deepEqual(
    await db
      .select()
      .from(usageEventsTable)
      .where(eq(usageEventsTable.taskId, f.task.id)),
    beforeUsage,
  );
  assert.equal(
    await readFile(path.join(f.home, "preserved.txt"), "utf8"),
    "old private state",
  );
  assert.equal(
    await readFile(path.join(f.workspace, "preserved.txt"), "utf8"),
    "actual user work",
  );
  const binding = {
    taskId: f.task.id,
    attemptId: randomUUID(),
    leaseOwner: randomUUID(),
    policyRevision: 2,
    registrationId: randomUUID(),
    registrationRevision: 1,
    accountId: "fixture_new_account",
    admissionVersion: 1,
  };
  const authority: CodexTaskAuthority = {
    binding,
    model: "fixture-new-model",
    readBinding: async () => binding,
    readLaunchContext: async () => ({
      policy: {
        id: 1,
        revision: 2,
        mode: "approval",
        custom: null,
        updatedAt: new Date(),
      },
      registration: {
        id: binding.registrationId,
        revision: 1,
        hostId: "fixture-new-host",
        clientId: "fixture-client",
        subject: "fixture-subject",
        accountId: binding.accountId,
        updatedAt: 1,
        credentials: {
          accessToken: "fixture-access",
          idToken: "fixture-id",
          refreshToken: "fixture-refresh",
          grants: ["resource.invoke", "chatgpt.tokens.use.direct"],
          expiresAt: Date.now() + 60_000,
        },
      },
    }),
  };
  const fresh = await claimCodexTaskSession({
    authority,
    agentId: f.agent.id,
    workspace: f.workspace,
    storageDirectory: f.storage,
    executableDigest: "b".repeat(64),
  });
  assert.notEqual(fresh.home, f.home);
  assert.equal(await fresh.readSession(), null);
  assert.equal((await f.row()).cleanupState, "unknown");
  assert.deepEqual(
    await recoverCodexSession(f.task.id, f.request, "ar"),
    receipt,
  );
  assert.deepEqual(
    await readCodexSessionRecoveryReceipt(f.task.id, f.request.requestId),
    receipt,
  );
  await fresh.uncertain();
  assert.doesNotMatch(
    JSON.stringify(receipt) +
      JSON.stringify(await readCodexSessionRecovery(f.task.id)),
    /private-fixture|private_fixture|ownerToken|registration|account|cwd|storageDirectory|threadId/,
  );
});

for (const [mutation, reason] of [
  [
    {
      state: "running",
      ownerToken: randomUUID(),
      cleanupState: "unknown",
      cleanupAt: null,
    },
    "session_running",
  ],
  [{ cleanupState: "unknown", cleanupAt: null }, "cleanup_unknown"],
  [{ revision: 5 }, "revision_changed"],
  [{ revision: Number.MAX_SAFE_INTEGER }, "revision_exhausted"],
] as const)
  test(`recovery refuses ${reason} without changing the session`, async (t) => {
    const f = await fixture(t);
    await db
      .update(sessions)
      .set(mutation)
      .where(eq(sessions.taskId, f.task.id));
    const before = await f.row();
    const input = {
      ...f.request,
      expectedRevision:
        reason === "revision_exhausted" ? Number.MAX_SAFE_INTEGER : 4,
    };
    const receipt = await recoverCodexSession(f.task.id, input, "tr");
    assert.equal(receipt.outcome, "rejected");
    assert.equal(receipt.reason, reason);
    assert.deepEqual(await f.row(), before);
  });

test("task activity, even an expired retained lease, an active owner or a pending native approval prevents recovery", async (t) => {
  const f = await fixture(t);
  for (const mutation of [
    { status: "in_progress", blockedReason: null },
    {
      status: "blocked",
      blockedReason: "operation_outcome_unknown",
      leaseOwner: "old_fixture",
      leaseExpiresAt: new Date(0),
    },
  ]) {
    await db
      .update(tasksTable)
      .set(mutation)
      .where(eq(tasksTable.id, f.task.id));
    assert.equal(
      (
        await recoverCodexSession(
          f.task.id,
          { ...f.request, requestId: randomUUID() },
          "en",
        )
      ).reason,
      "task_active",
    );
  }
  await db
    .update(tasksTable)
    .set({ leaseOwner: null, leaseExpiresAt: null })
    .where(eq(tasksTable.id, f.task.id));
  await db
    .update(agentsTable)
    .set({ currentTaskId: f.task.id })
    .where(eq(agentsTable.id, f.agent.id));
  assert.equal(
    (
      await recoverCodexSession(
        f.task.id,
        { ...f.request, requestId: randomUUID() },
        "en",
      )
    ).reason,
    "task_active",
  );
  await db
    .update(agentsTable)
    .set({ currentTaskId: null })
    .where(eq(agentsTable.id, f.agent.id));
  await f.addNative("awaiting");
  assert.equal(
    (await recoverCodexSession(f.task.id, f.request, "en")).reason,
    "native_pending",
  );
  assert.equal((await f.row()).revision, 4);
});

test("concurrent duplicate recovery has one immutable receipt, scope reuse conflicts and rejection is never silently retried", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([
    recoverCodexSession(f.task.id, f.request, "en"),
    recoverCodexSession(f.task.id, f.request, "en"),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(
    (await db.select().from(recoveries).where(eq(recoveries.taskId, f.task.id)))
      .length,
    1,
  );
  await assert.rejects(
    recoverCodexSession(f.task.id, { ...f.request, expectedRevision: 5 }, "en"),
    /recovery_scope_conflict/,
  );
  const next = { ...f.request, requestId: randomUUID() };
  const rejected = await recoverCodexSession(f.task.id, next, "en");
  assert.equal(rejected.reason, "revision_changed");
  await db
    .update(sessions)
    .set({ revision: 4, state: "uncertain" })
    .where(eq(sessions.taskId, f.task.id));
  assert.deepEqual(await recoverCodexSession(f.task.id, next, "en"), rejected);
  const activities = await db
    .select()
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.taskId, f.task.id),
        eq(activityEventsTable.type, "note"),
      ),
    );
  assert.equal(activities.length, 1);
  assert.equal(activities[0].detail?.actor, "operator");
});

test("request UUID casing cannot break receipt lookup or cause a second recovery", async (t) => {
  const f = await fixture(t);
  const receipt = await recoverCodexSession(
    f.task.id,
    { ...f.request, requestId: f.request.requestId.toUpperCase() },
    "en",
  );
  assert.equal(receipt.requestId, f.request.requestId);
  assert.deepEqual(
    await readCodexSessionRecoveryReceipt(f.task.id, f.request.requestId),
    receipt,
  );
  assert.deepEqual(
    await recoverCodexSession(f.task.id, f.request, "en"),
    receipt,
  );
});

test("an audit write failure rolls back both archive and reset; no committed request identity is lost", async (t) => {
  const f = await fixture(t);
  await db.execute(
    sql`CREATE FUNCTION fixture_reject_recovery_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit rejected'; END $$`,
  );
  await db.execute(
    sql`CREATE TRIGGER fixture_recovery_audit BEFORE INSERT ON activity_events FOR EACH ROW WHEN (NEW.task_id = ${sql.raw(String(f.task.id))}) EXECUTE FUNCTION fixture_reject_recovery_audit()`,
  );
  try {
    await assert.rejects(recoverCodexSession(f.task.id, f.request, "en"));
    assert.equal((await f.row()).state, "uncertain");
    assert.equal((await f.row()).revision, 4);
    assert.equal(
      await readCodexSessionRecoveryReceipt(f.task.id, f.request.requestId),
      null,
    );
  } finally {
    await db.execute(
      sql`DROP TRIGGER fixture_recovery_audit ON activity_events`,
    );
    await db.execute(sql`DROP FUNCTION fixture_reject_recovery_audit()`);
  }
  assert.equal(
    (await recoverCodexSession(f.task.id, f.request, "en")).outcome,
    "accepted",
  );
});
