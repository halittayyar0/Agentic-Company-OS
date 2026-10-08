import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import express from "express";
import { and, eq } from "drizzle-orm";
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
  chatgptRegistrationLocksTable,
  chatgptRegistrationsTable,
  approvalRequestsTable,
  codexActionApprovalsTable,
  codexTaskSessionsTable,
  activityEventsTable,
  operationReceiptsTable,
} from "@workspace/db";
import { createPostgresChatGPTRegistrationStore } from "./chatgpt-registration-store";
import { createCodexTaskAuthority } from "./codex-task-authority";
import {
  claimCodexTaskSession,
  runCodexTaskInSession,
} from "./codex-task-session";
import { buildCodexTaskConfiguration } from "./codex-task-configuration";
import type { CodexTaskPorts } from "./codex-task-adapter";
import type { CodexTurnControl } from "./codex-task-adapter";
import { createCodexTaskApprovalBridge } from "./codex-task-approvals";
import { createCodexActionTracker } from "./codex-action-scope";
import { createApprovalsRouter } from "../routes/approvals";
import { startTaskLeaseHeartbeat } from "./orchestrator/task-lease-heartbeat";
import { readRuntimeOperationsConfig } from "./runtime-operations-config";
import type { ToolRuntimeContext } from "./orchestrator/execute-tool";

import { fixture, nativeFixturePorts } from "./testing/codex-task-fixture";

for (const mode of ["completed", "lost_after_consumption"])
  test(`actual driver and API decision preserve ${mode} ownership, item metadata and checkpoint ordering`, async (t) => {
    const f = await fixture(t);
    const running = runCodexTaskInSession(
      f.session,
      {
        binding: f.authority.binding,
        prompt: "Complete the owned fixture",
        requestTimeoutMs: 2000,
        turnTimeoutMs: 10000,
        fenceIntervalMs: 100,
      },
      nativeFixturePorts(t, f, mode),
    );
    void running.catch(() => {});
    const approval = await f.pending();
    assert.equal(
      (
        await f.decide(approval.id, {
          decision: "approved",
          expectedArgsHash: approval.scope?.argsHash,
          locale: "en",
        })
      ).status,
      200,
    );
    if (mode === "completed") {
      const result = await running;
      assert.equal(result.actionReceipts.length, 1);
      assert.deepEqual(result.usage, {
        promptTokens: 5,
        completionTokens: 3,
        totalTokens: 8,
      });
      assert.equal(result.deliverableVerified, false);
      assert.equal((await f.row()).state, "receipted");
      const [session] = await db
        .select()
        .from(codexTaskSessionsTable)
        .where(eq(codexTaskSessionsTable.taskId, f.task.id));
      assert.equal(session.state, "ready");
      assert.equal(session.threadId, "fixture_thread");
    } else {
      await assert.rejects(running);
      const row = await f.row();
      assert.equal(row.state, "uncertain");
      assert.equal(row.nativeStatus, null);
      const [session] = await db
        .select()
        .from(codexTaskSessionsTable)
        .where(eq(codexTaskSessionsTable.taskId, f.task.id));
      assert.equal(session.state, "uncertain");
      assert.equal(session.threadId, null);
    }
  });

test("a native withdrawal closes an unconsumed review and preserves a separately completed turn", async (t) => {
  const f = await fixture(t);
  let control: CodexTurnControl | undefined;
  const running = runCodexTaskInSession(
    f.session,
    {
      binding: f.authority.binding,
      prompt: "Complete the fixture",
      requestTimeoutMs: 2000,
      turnTimeoutMs: 10000,
      fenceIntervalMs: 100,
      onControl: (value) => {
        control = value;
      },
    },
    nativeFixturePorts(t, f, "withdraw"),
  );
  void running.catch(() => {});
  await f.pending();
  assert.ok(control);
  await control.steer("Finish without this command");
  const result = await running;
  assert.equal(result.status, "completed");
  assert.equal(result.actionReceipts[0].decision, null);
  assert.equal(result.actionReceipts[0].status, "declined");
  const row = await f.row();
  assert.equal(row.state, "invalidated");
  assert.equal(row.decision, null);
  assert.equal(row.nativeStatus, null);
  assert.deepEqual(await f.authority.readBinding(), f.authority.binding);
});

test("the real approval route feeds one native decision, holds the actual lease and records a separate item receipt without queuing generic execution", async (t) => {
  const f = await fixture(t),
    request = f.request(),
    abort = new AbortController();
  const choice = f.bridge.approve(request, f.authority.binding, abort.signal);
  void choice.catch(() => {});
  const approval = await f.pending();
  assert.equal(approval.actionPayload, null);
  assert.equal(approval.scope?.argsHash, request.action.digest);
  assert.match(approval.scope?.preview ?? "", /node --version/);
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, f.task.id));
  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, f.agent.id));
  assert.equal(task.status, "awaiting_approval");
  assert.equal(task.leaseOwner, f.leaseOwner);
  assert.equal(agent.runLeaseOwner, f.leaseOwner);
  assert.deepEqual(await f.authority.readBinding(), f.authority.binding);
  const publicRows = await (await fetch(`${f.url}/approvals`)).json();
  assert.doesNotMatch(
    JSON.stringify(publicRows),
    /sessionOwnerToken|session_owner_token|fixture-private|fixture-account/,
  );
  assert.equal(
    (
      await f.decide(approval.id, {
        decision: "approved",
        expectedArgsHash: request.action.digest,
        locale: "en",
      })
    ).status,
    200,
  );
  assert.equal(await choice, "accept");
  assert.equal((await f.row()).state, "consumed");
  assert.equal((await f.row()).nativeStatus, null);
  assert.equal(
    (
      await db
        .select()
        .from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.approvalId, approval.id))
    ).length,
    0,
  );
  const receipt = {
    threadId: request.action.threadId,
    turnId: request.action.turnId,
    itemId: request.action.itemId,
    actionDigest: request.action.digest,
    revision: request.action.revision,
    status: "completed" as const,
    exitCode: 0,
    completedAtMs: 105,
    decision: "accept" as const,
    proofScope: "codex_item" as const,
  };
  await f.bridge.onActionReceipt(receipt, f.authority.binding);
  assert.equal((await f.row()).state, "receipted");
  assert.equal((await f.row()).nativeStatus, "completed");
  await assert.rejects(
    f.bridge.onActionReceipt(
      { ...receipt, actionDigest: "b".repeat(64) },
      f.authority.binding,
    ),
    /codex_task_protocol/,
  );
  await assert.rejects(
    f.bridge.approve(request, f.authority.binding, abort.signal),
    /codex_task_protocol/,
  );
});

test("a native decision requires the exact reviewed digest", async (t) => {
  const f = await fixture(t),
    request = f.request(),
    abort = new AbortController();
  const choice = f.bridge.approve(request, f.authority.binding, abort.signal);
  void choice.catch(() => {});
  const approval = await f.pending();
  assert.equal(
    (await f.decide(approval.id, { decision: "approved" })).status,
    409,
  );
  assert.equal(
    (
      await f.decide(approval.id, {
        decision: "approved",
        expectedArgsHash: "b".repeat(64),
      })
    ).status,
    409,
  );
  assert.equal((await f.row()).state, "awaiting");
  abort.abort();
  await assert.rejects(choice);
  assert.equal((await f.row()).state, "invalidated");
  assert.doesNotMatch(
    (
      await db
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, approval.id))
    )[0].scope?.preview ?? "",
    /node --version/,
  );
});

for (const expiredFence of [false, true])
  test(`a review expiring during asynchronous ownership validation remains an expiry (${expiredFence})`, async (t) => {
    const f = await fixture(t);
    let clock = Date.now();
    const bridge = createCodexTaskApprovalBridge({
      authority: {
        ...f.authority,
        readBinding: async () => {
          const binding = await f.authority.readBinding();
          const row = await f.row();
          if (row) {
            clock = row.expiresAt.getTime() + 1;
            if (expiredFence) return null;
          }
          return binding;
        },
      },
      session: f.session,
      now: () => clock,
      approvalTimeoutMs: 10000,
      pollIntervalMs: 20,
    });
    t.after(() => bridge.close());
    try {
      await assert.rejects(bridge.approve(f.request(), f.authority.binding), {
        kind: "timeout",
      });
      const row = await f.row();
      assert.equal(row.state, "invalidated");
      assert.equal(row.invalidationReason, "expired");
      assert.equal(row.consumedAt, null);
    } finally {
      await bridge.close();
    }
  });

test("an expired review is invalidated and cannot emit a native decision", async (t) => {
  const f = await fixture(t, 300),
    request = f.request();
  const choice = f.bridge.approve(request, f.authority.binding);
  void choice.catch(() => {});
  const approval = await f.pending();
  await assert.rejects(choice, { kind: "timeout" });
  const row = await f.row();
  assert.equal(row.state, "invalidated");
  assert.equal(row.invalidationReason, "expired");
  assert.equal(row.consumedAt, null);
  assert.notEqual(
    (
      await f.decide(approval.id, {
        decision: "approved",
        expectedArgsHash: request.action.digest,
      })
    ).status,
    200,
  );
});

test("a human rejection blocks the task and cannot queue execution or consume authority", async (t) => {
  const f = await fixture(t),
    request = f.request();
  const choice = f.bridge.approve(request, f.authority.binding);
  void choice.catch(() => {});
  const approval = await f.pending();
  assert.equal(
    (await f.decide(approval.id, { decision: "rejected", locale: "en" }))
      .status,
    200,
  );
  await assert.rejects(choice);
  const row = await f.row();
  assert.equal(row.state, "invalidated");
  assert.equal(row.invalidationReason, "human_rejection");
  assert.equal(row.decision, null);
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, f.task.id));
  assert.equal(task.blockedReason, "approval_rejected");
});

test("emergency stop prevents the reviewed decision and invalidates its native wait", async (t) => {
  const f = await fixture(t),
    request = f.request();
  const choice = f.bridge.approve(request, f.authority.binding);
  void choice.catch(() => {});
  const approval = await f.pending();
  await db.update(runtimeControlsTable).set({ emergencyStopEnabled: true });
  assert.equal(
    (
      await f.decide(approval.id, {
        decision: "approved",
        expectedArgsHash: request.action.digest,
      })
    ).status,
    423,
  );
  await assert.rejects(choice);
  assert.equal((await f.row()).state, "invalidated");
});

test("a corrupted native marker cannot broaden ordinary awaiting-approval task authority", async (t) => {
  const f = await fixture(t),
    request = f.request();
  const choice = f.bridge.approve(request, f.authority.binding);
  void choice.catch(() => {});
  const approval = await f.pending();
  assert.ok(approval.scope);
  await db
    .update(approvalRequestsTable)
    .set({ scope: { ...approval.scope, argsHash: "b".repeat(64) } })
    .where(eq(approvalRequestsTable.id, approval.id));
  assert.equal(await f.authority.readBinding(), null);
  await assert.rejects(choice);
  assert.equal((await f.row()).state, "invalidated");
});

for (const change of [
  "policy",
  "account",
  "session",
  "attempt",
  "worker",
  "taskLease",
])
  test(`a changed ${change} cannot authorize the old native review`, async (t) => {
    const f = await fixture(t),
      request = f.request(),
      abort = new AbortController();
    const choice = f.bridge.approve(request, f.authority.binding, abort.signal);
    void choice.catch(() => {});
    const approval = await f.pending();
    if (change === "policy")
      await db.update(executionPolicyTable).set({ revision: 2 });
    if (change === "account")
      await f.store.replaceRegistration(f.registration.revision, {
        ...f.registration,
        credentials: null,
      });
    if (change === "session")
      await db
        .update(codexTaskSessionsTable)
        .set({ ownerToken: randomUUID() })
        .where(eq(codexTaskSessionsTable.taskId, f.task.id));
    if (change === "attempt")
      await db
        .update(taskAttemptsTable)
        .set({ state: "lost" })
        .where(eq(taskAttemptsTable.id, f.attemptId));
    if (change === "worker")
      await db
        .update(runtimeInstancesTable)
        .set({ state: "stopped" })
        .where(eq(runtimeInstancesTable.id, f.workerId));
    if (change === "taskLease")
      await db
        .update(tasksTable)
        .set({ leaseOwner: randomUUID() })
        .where(eq(tasksTable.id, f.task.id));
    assert.equal(
      (
        await f.decide(approval.id, {
          decision: "approved",
          expectedArgsHash: request.action.digest,
        })
      ).status,
      409,
    );
    await assert.rejects(choice);
    assert.equal((await f.row()).state, "invalidated");
    assert.equal((await f.row()).consumedAt, null);
  });

test("a withdrawn callback after consumption is uncertain without inventing a native receipt", async (t) => {
  const f = await fixture(t),
    request = f.request(),
    abort = new AbortController();
  const choice = f.bridge.approve(request, f.authority.binding, abort.signal);
  void choice.catch(() => {});
  const approval = await f.pending();
  assert.equal(
    (
      await f.decide(approval.id, {
        decision: "approved",
        expectedArgsHash: request.action.digest,
      })
    ).status,
    200,
  );
  assert.equal(await choice, "accept");
  abort.abort();
  await f.bridge.close();
  const row = await f.row();
  assert.equal(row.state, "uncertain");
  assert.equal(row.nativeStatus, null);
  assert.equal(row.nativeCompletedAtMs, null);
});

test.after(() => closeDatabase());
