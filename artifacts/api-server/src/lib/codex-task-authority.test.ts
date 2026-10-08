import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  taskAttemptsTable,
  runtimeInstancesTable,
  executionPolicyTable,
  runtimeControlsTable,
  chatgptRegistrationsTable,
  chatgptRegistrationLocksTable,
  sourceChangesTable,
} from "@workspace/db";
import { createPostgresChatGPTRegistrationStore } from "./chatgpt-registration-store";
import { createCodexTaskAuthority } from "./codex-task-authority";
import { claimCodexTaskSession } from "./codex-task-session";
import type { ToolRuntimeContext } from "./orchestrator/execute-tool";
import { startTaskLeaseHeartbeat } from "./orchestrator/task-lease-heartbeat";
import { readRuntimeOperationsConfig } from "./runtime-operations-config";

async function fixture(t: TestContext, realHeartbeat = false) {
  await dbReady;
  const now = Date.now();
  const [originalPolicy] = await db.select().from(executionPolicyTable);
  const [originalControls] = await db.select().from(runtimeControlsTable);
  await db
    .update(executionPolicyTable)
    .set({ mode: "approval", revision: 1, custom: null });
  await db.update(runtimeControlsTable).set({ emergencyStopEnabled: false });
  const workerId = randomUUID(),
    attemptId = randomUUID(),
    leaseOwner = randomUUID(),
    logicalId = randomUUID();
  await db.insert(runtimeInstancesTable).values({
    id: workerId,
    role: "worker",
    state: "healthy",
    hostname: "fixture",
    processId: process.pid,
    buildVersion: "fixture",
    lastHeartbeatAt: new Date(now),
  });
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Owned coding authority fixture",
      role: "Fixture",
      systemPrompt: "Work",
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: new Date(now + 900000),
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Owned coding task",
      brief: "Work",
      ownerAgentId: agent.id,
      status: "in_progress",
      lastModelId: "chatgpt:fixture-model",
      lastModelProvider: "chatgpt",
      leaseOwner,
      leaseExpiresAt: new Date(now + 900000),
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, agent.id));
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: task.id,
    agentId: agent.id,
    workerInstanceId: workerId,
    leaseOwner,
    attemptNumber: 1,
    cycleNumber: 0,
    logicalExecutionId: logicalId,
    state: "running",
    lastHeartbeatAt: new Date(now),
  });
  const store = await createPostgresChatGPTRegistrationStore(
    db,
    "owned-codex-authority-fixture-key",
  );
  const registration = await store.replaceRegistration(0, {
    id: randomUUID(),
    hostId: await store.getHostId(),
    clientId: "fixture-client",
    accountId: "fixture-account",
    subject: "fixture-subject",
    credentials: {
      accessToken: "fixture-private-access",
      idToken: "fixture-private-id",
      grants: ["resource.invoke", "chatgpt.tokens.use.direct"],
      expiresAt: now + 3600000,
    },
  });
  await store.activateRegistration(registration.id, registration.revision);
  const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
  const heartbeat = realHeartbeat
    ? startTaskLeaseHeartbeat({
        taskId: task.id,
        agentId: agent.id,
        attemptId,
        leaseOwner,
        config,
      })
    : null;
  let assertions = 0,
    renewals = 0,
    stores = 0;
  const context = {
    agent,
    taskId: task.id,
    runtimeAttemptId: attemptId,
    taskLeaseOwner: leaseOwner,
    turnModelId: "chatgpt:fixture-model",
    assertTaskLease: async () => {
      assertions++;
      await heartbeat?.assertOwned("Owned coding authority fixture");
    },
    operationIdentity: {
      executionKind: "task_step",
      logicalExecutionId: logicalId,
      runtimeInstanceId: workerId,
      originAttemptId: attemptId,
      sourceMessageId: null,
      modelToolCallId: "call_fixture",
      callSlot: "round:1:tool:0",
      agentLeaseOwner: leaseOwner,
    },
  } as ToolRuntimeContext;
  const runtime = {
    store: async () => {
      stores++;
      return store;
    },
    sessions: async () => ({
      renewRegistration: async () => {
        renewals++;
        return (await store.readActiveRegistration())!;
      },
    }),
  };
  t.after(async () => {
    await heartbeat?.stop();
    await db
      .update(chatgptRegistrationLocksTable)
      .set({ activeRegistrationId: null })
      .where(
        eq(chatgptRegistrationLocksTable.activeRegistrationId, registration.id),
      );
    await db
      .delete(chatgptRegistrationsTable)
      .where(eq(chatgptRegistrationsTable.id, registration.id));
    await db
      .delete(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, attemptId));
    await db.delete(tasksTable).where(eq(tasksTable.id, task.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
    await db
      .delete(runtimeInstancesTable)
      .where(eq(runtimeInstancesTable.id, workerId));
    await db
      .update(executionPolicyTable)
      .set(originalPolicy)
      .where(eq(executionPolicyTable.id, 1));
    await db
      .update(runtimeControlsTable)
      .set(originalControls)
      .where(eq(runtimeControlsTable.id, 1));
  });
  return {
    context,
    runtime,
    store,
    registration,
    agent,
    task,
    workerId,
    attemptId,
    config,
    counters: () => ({ assertions, renewals, stores }),
    now,
  };
}

test("authority uses the real task heartbeat, renews selected account once and keeps credentials out of the binding", async (t) => {
  const f = await fixture(t, true);
  const authority = await createCodexTaskAuthority(f.context, f.runtime);
  assert.equal(authority.model, "fixture-model");
  assert.equal(authority.binding.attemptId, f.attemptId);
  assert.ok(Object.isFrozen(authority.binding));
  assert.equal(authority.binding.registrationRevision, f.registration.revision);
  for (let i = 0; i < 3; i++)
    assert.deepEqual(await authority.readBinding(), authority.binding);
  const launch = await authority.readLaunchContext();
  assert.equal(
    launch.registration.credentials?.accessToken,
    "fixture-private-access",
  );
  assert.equal(launch.policy.mode, "approval");
  assert.equal(
    f.counters().renewals,
    1,
    "Ownership polls must not refresh tokens or send model requests",
  );
  assert.ok(f.counters().assertions >= 4);
  assert.ok(!JSON.stringify(authority).includes("fixture-private"));
  f.context.taskId = f.task.id + 1;
  f.context.turnModelId = "other:paid-model";
  f.context.operationIdentity!.runtimeInstanceId = "rebound-worker";
  assert.deepEqual(
    await authority.readBinding(),
    authority.binding,
    "Context mutation cannot rebind a running authority",
  );
});

for (const mutation of [
  "checking",
  "verified",
  "revision",
  "deleted",
  "duplicate",
] as const)
  test(`source workspace ${mutation} permanently invalidates the admitted native authority`, async (t) => {
    const f = await fixture(t);
    const id = randomUUID(),
      secondId = randomUUID();
    const change = {
      id,
      agentId: f.agent.id,
      taskId: f.task.id,
      sourcePath: "PRIVATE_original",
      request: "Fixture",
      baseCommit: "1".repeat(40),
      state: "draft",
      revision: 1,
    };
    try {
      await db.insert(sourceChangesTable).values(change);
      const authority = await createCodexTaskAuthority(f.context, f.runtime);
      const sourceChange = authority.sourceChange;
      if (mutation === "deleted")
        await db
          .delete(sourceChangesTable)
          .where(eq(sourceChangesTable.id, id));
      else if (mutation === "duplicate")
        await db.insert(sourceChangesTable).values({ ...change, id: secondId });
      else
        await db
          .update(sourceChangesTable)
          .set(mutation === "revision" ? { revision: 2 } : { state: mutation })
          .where(eq(sourceChangesTable.id, id));
      assert.equal(await authority.readBinding(), null);
      assert.deepEqual(sourceChange, { id, revision: 1 });
      await db
        .delete(sourceChangesTable)
        .where(eq(sourceChangesTable.id, secondId));
      if (mutation === "deleted")
        await db.insert(sourceChangesTable).values(change);
      else
        await db
          .update(sourceChangesTable)
          .set({ state: "draft", revision: 1 })
          .where(eq(sourceChangesTable.id, id));
      assert.equal(
        await authority.readBinding(),
        null,
        "Restoration cannot revive an invalidated authority",
      );
      assert.equal(f.counters().renewals, 1);
    } finally {
      await db
        .delete(sourceChangesTable)
        .where(eq(sourceChangesTable.taskId, f.task.id));
    }
  });

for (const scenario of [
  "task_cancelled",
  "task_model_changed",
  "task_owner_changed",
  "task_lease_expired",
  "agent_lease_changed",
  "agent_lease_expired",
  "agent_task_changed",
  "agent_disabled",
  "terminal_revoked",
  "attempt_finished",
  "attempt_worker_changed",
  "attempt_stale",
  "worker_draining",
  "worker_stale",
  "policy_changed",
  "emergency_stop",
  "token_rotated",
  "signed_out",
  "quota_paused",
  "account_changed",
  "token_expired",
] as const) {
  test(`durable ${scenario} fences an admitted authority permanently`, async (t) => {
    const f = await fixture(t);
    let clock = f.now;
    const authority = await createCodexTaskAuthority(f.context, f.runtime, {
      now: () => clock,
    });
    assert.ok(await authority.readBinding());
    const expired = new Date(f.now - 1);
    switch (scenario) {
      case "task_model_changed":
        await db
          .update(tasksTable)
          .set({ lastModelId: "other:paid-model" })
          .where(eq(tasksTable.id, f.task.id));
        break;
      case "task_cancelled":
        await db
          .update(tasksTable)
          .set({ status: "cancelled" })
          .where(eq(tasksTable.id, f.task.id));
        break;
      case "task_owner_changed": {
        const [other] = await db
          .insert(agentsTable)
          .values({
            name: "Owned replacement fixture",
            role: "Fixture",
            systemPrompt: "Work",
          })
          .returning();
        t.after(async () => {
          await db.delete(agentsTable).where(eq(agentsTable.id, other.id));
        });
        await db
          .update(tasksTable)
          .set({ ownerAgentId: other.id })
          .where(eq(tasksTable.id, f.task.id));
        break;
      }
      case "task_lease_expired":
        await db
          .update(tasksTable)
          .set({ leaseExpiresAt: expired })
          .where(eq(tasksTable.id, f.task.id));
        break;
      case "agent_lease_changed":
        await db
          .update(agentsTable)
          .set({ runLeaseOwner: randomUUID() })
          .where(eq(agentsTable.id, f.agent.id));
        break;
      case "agent_lease_expired":
        await db
          .update(agentsTable)
          .set({ runLeaseExpiresAt: expired })
          .where(eq(agentsTable.id, f.agent.id));
        break;
      case "agent_task_changed":
        await db
          .update(agentsTable)
          .set({ currentTaskId: null })
          .where(eq(agentsTable.id, f.agent.id));
        break;
      case "agent_disabled":
        await db
          .update(agentsTable)
          .set({ isActive: false })
          .where(eq(agentsTable.id, f.agent.id));
        break;
      case "terminal_revoked":
        await db
          .update(agentsTable)
          .set({
            permissions: { ...f.agent.permissions, canUseTerminal: false },
          })
          .where(eq(agentsTable.id, f.agent.id));
        break;
      case "attempt_finished":
        await db
          .update(taskAttemptsTable)
          .set({ state: "succeeded" })
          .where(eq(taskAttemptsTable.id, f.attemptId));
        break;
      case "attempt_worker_changed": {
        const otherId = randomUUID();
        await db.insert(runtimeInstancesTable).values({
          id: otherId,
          role: "worker",
          state: "healthy",
          hostname: "fixture",
          processId: process.pid,
          buildVersion: "fixture",
        });
        t.after(async () => {
          await db
            .delete(runtimeInstancesTable)
            .where(eq(runtimeInstancesTable.id, otherId));
        });
        await db
          .update(taskAttemptsTable)
          .set({ workerInstanceId: otherId })
          .where(eq(taskAttemptsTable.id, f.attemptId));
        break;
      }
      case "attempt_stale":
        await db
          .update(taskAttemptsTable)
          .set({ lastHeartbeatAt: new Date(f.now - f.config.taskLeaseMs - 1) })
          .where(eq(taskAttemptsTable.id, f.attemptId));
        break;
      case "worker_draining":
        await db
          .update(runtimeInstancesTable)
          .set({ state: "draining" })
          .where(eq(runtimeInstancesTable.id, f.workerId));
        break;
      case "worker_stale":
        await db
          .update(runtimeInstancesTable)
          .set({
            lastHeartbeatAt: new Date(f.now - f.config.workerStaleAfterMs - 1),
          })
          .where(eq(runtimeInstancesTable.id, f.workerId));
        break;
      case "policy_changed":
        await db.update(executionPolicyTable).set({ revision: 2 });
        break;
      case "emergency_stop":
        await db
          .update(runtimeControlsTable)
          .set({ emergencyStopEnabled: true });
        break;
      case "token_rotated":
        await f.store.replaceRegistration(f.registration.revision, {
          ...f.registration,
          credentials: {
            ...f.registration.credentials!,
            accessToken: "fixture-new-access",
          },
        });
        break;
      case "signed_out":
        await f.store.replaceRegistration(f.registration.revision, {
          ...f.registration,
          credentials: null,
        });
        break;
      case "quota_paused":
        await f.store.replaceRegistration(f.registration.revision, {
          ...f.registration,
          planPause: {
            id: randomUUID(),
            code: "rate_limit_exceeded",
            pausedAt: f.now,
            retryAt: null,
          },
        });
        break;
      case "account_changed":
        await db
          .update(chatgptRegistrationLocksTable)
          .set({ activeRegistrationId: null });
        break;
      case "token_expired":
        clock = f.registration.credentials!.expiresAt;
        await db
          .update(runtimeInstancesTable)
          .set({ lastHeartbeatAt: new Date(clock) })
          .where(eq(runtimeInstancesTable.id, f.workerId));
        await db
          .update(taskAttemptsTable)
          .set({ lastHeartbeatAt: new Date(clock) })
          .where(eq(taskAttemptsTable.id, f.attemptId));
        await db
          .update(tasksTable)
          .set({ leaseExpiresAt: new Date(clock + 900000) })
          .where(eq(tasksTable.id, f.task.id));
        await db
          .update(agentsTable)
          .set({ runLeaseExpiresAt: new Date(clock + 900000) })
          .where(eq(agentsTable.id, f.agent.id));
        break;
    }
    assert.equal(await authority.readBinding(), null);
    await assert.rejects(authority.readLaunchContext(), {
      kind: "ownership_lost",
    });
    await db.update(runtimeControlsTable).set({ emergencyStopEnabled: false });
    await db.update(executionPolicyTable).set({ revision: 1 });
    assert.equal(
      await authority.readBinding(),
      null,
      "A lost authority cannot revive after a later state change",
    );
    assert.equal(f.counters().renewals, 1);
  });
}

test("missing, rebound and non-plan task scope is refused before account access", async (t) => {
  const f = await fixture(t);
  for (const context of [
    { ...f.context, taskId: null },
    { ...f.context, assertTaskLease: undefined },
    { ...f.context, turnModelId: "openai:fixture" },
    { ...f.context, turnModelId: "chatgpt:" },
    {
      ...f.context,
      operationIdentity: {
        ...f.context.operationIdentity!,
        originAttemptId: randomUUID(),
      },
    },
    { ...f.context, transactionalExecutor: db },
  ])
    await assert.rejects(
      createCodexTaskAuthority(context as ToolRuntimeContext, f.runtime),
      { kind: "unsupported_capability" },
    );
  assert.equal(f.counters().stores, 0);
  await db
    .update(tasksTable)
    .set({ leaseExpiresAt: new Date(f.now - 1) })
    .where(eq(tasksTable.id, f.task.id));
  await assert.rejects(createCodexTaskAuthority(f.context, f.runtime), {
    kind: "ownership_lost",
  });
  assert.equal(
    f.counters().assertions,
    0,
    "Do not renew an already expired claim into eligibility",
  );
  assert.equal(f.counters().stores, 0);
});

test("policy changes during renewal cannot admit a rebound coding child", async (t) => {
  const f = await fixture(t);
  const runtime = {
    ...f.runtime,
    sessions: async () => ({
      renewRegistration: async () => {
        await db.update(executionPolicyTable).set({ revision: 2 });
        return f.registration;
      },
    }),
  };
  await assert.rejects(createCodexTaskAuthority(f.context, runtime), {
    kind: "ownership_lost",
  });
});

test("a database outage before admission returns a safe ownership failure before account access", async (t) => {
  const f = await fixture(t);
  const mutable = db as typeof db & { select: typeof db.select };
  const original = mutable.select;
  mutable.select = (() => {
    throw new Error("fixture-private-database-diagnostic");
  }) as typeof db.select;
  try {
    await assert.rejects(createCodexTaskAuthority(f.context, f.runtime), {
      kind: "ownership_lost",
      message: "codex_task_ownership_lost",
    });
    assert.equal(f.counters().stores, 0);
    assert.equal(f.counters().renewals, 0);
  } finally {
    mutable.select = original;
  }
});

test("plan consent and persisted quota are checked before renewal", async (t) => {
  const f = await fixture(t);
  const identityOnly = await f.store.replaceRegistration(
    f.registration.revision,
    {
      ...f.registration,
      credentials: { ...f.registration.credentials!, grants: ["openid"] },
    },
  );
  await assert.rejects(createCodexTaskAuthority(f.context, f.runtime), {
    kind: "permission",
    requestStarted: false,
  });
  const paused = await f.store.replaceRegistration(identityOnly.revision, {
    ...identityOnly,
    credentials: f.registration.credentials,
    planPause: {
      id: randomUUID(),
      code: "rate_limit_exceeded",
      pausedAt: f.now,
      retryAt: null,
    },
  });
  await assert.rejects(createCodexTaskAuthority(f.context, f.runtime), {
    kind: "quota",
    requestStarted: false,
  });
  assert.equal(f.counters().renewals, 0);
  assert.ok(paused.planPause);
});

test(
  "durable session claim and checkpoint use the actual heartbeat outside session transactions",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t, true);
    const authority = await createCodexTaskAuthority(f.context, f.runtime);
    const scope = {
      authority,
      agentId: f.agent.id,
      workspace: path.resolve("fixture-workspace"),
      storageDirectory: path.resolve("fixture-private-runtime"),
      executableDigest: "a".repeat(64),
    };
    const lease = await claimCodexTaskSession(scope);
    assert.equal(await lease.readSession(), null);
    await lease.complete({
      status: "completed",
      threadId: "fixture_thread",
      turnId: "fixture_turn",
      text: "Fixture only",
      usage: null,
      proofScope: "codex_turn",
      deliverableVerified: false,
      actionReceipts: [],
      session: {
        binding: authority.binding,
        cwd: scope.workspace,
        threadId: "fixture_thread",
        usage: null,
      },
    });
    const next = await claimCodexTaskSession(scope);
    assert.equal((await next.readSession())?.threadId, "fixture_thread");
    await db
      .update(tasksTable)
      .set({ leaseOwner: randomUUID() })
      .where(eq(tasksTable.id, f.task.id));
    await assert.rejects(next.assertCurrent(), /codex_task_ownership_lost/);
    await next.uncertain();
    assert.equal(f.counters().renewals, 1);
  },
);

test.after(() => closeDatabase());
