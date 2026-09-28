import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import type { ToolRuntimeContext } from "./execute-tool";

delete process.env.DATABASE_URL;
delete process.env.RUNTIME_ROLE;
process.env.NODE_ENV = "test";
const root = await fsp.mkdtemp(
  path.join(os.tmpdir(), "acos-terminal-boundary-"),
);
process.env.AGENT_SANDBOX_ROOT = root;
const {
  agentsTable,
  db,
  dbReady,
  closeDatabase,
  operationInvocationsTable,
  operationReceiptsTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  tasksTable,
} = await import("@workspace/db");
const { executeTool } = await import("./execute-tool");
const { specialistPermissionsPreset } = await import("./permission-presets");
const { withFileOperationLock } = await import("../vm/file-operation-lock");
const { writeTextFile, getSandboxRoot } = await import("../vm/sandbox");

test.after(async () => {
  await closeDatabase();
  await fsp.rm(root, { recursive: true, force: true });
});

async function createFixture() {
  await dbReady;
  const suffix = randomUUID();
  const now = new Date();
  const leaseOwner = `durable-effect-${suffix}`;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Durable effect ${suffix}`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      permissions: specialistPermissionsPreset,
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: new Date(now.getTime() + 120_000),
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: `Durable effect ${suffix}`,
      brief: "Exercise the exact external effect boundary.",
      ownerAgentId: agent.id,
      createdByUser: true,
      status: "in_progress",
      leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + 120_000),
      stepAttempts: 1,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, agent.id));
  const runtimeInstanceId = `durable-effect-runtime-${suffix}`;
  await db.insert(runtimeInstancesTable).values({
    id: runtimeInstanceId,
    role: "worker",
    state: "healthy",
    hostname: "durable-effect-test",
    processId: 2201,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: now,
  });
  const attemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: task.id,
    agentId: agent.id,
    workerInstanceId: runtimeInstanceId,
    leaseOwner,
    attemptNumber: 1,
    cycleNumber: 0,
    state: "running",
    logicalExecutionId,
  });
  const attached = new Set<string>();
  const context: ToolRuntimeContext = {
    agent,
    taskId: task.id,
    taskLeaseOwner: leaseOwner,
    runtimeAttemptId: attemptId,
    assertTaskLease: async () => undefined,
    operationIdentity: {
      executionKind: "task_step",
      logicalExecutionId,
      runtimeInstanceId,
      originAttemptId: attemptId,
      sourceMessageId: null,
      modelToolCallId: `tool-call-${suffix}`,
      callSlot: "round:0:tool:0",
      agentLeaseOwner: leaseOwner,
    },
    attachOperationInvocation: (operation) => {
      attached.add(operation.invocationId);
    },
    detachOperationInvocation: (invocationId) => {
      attached.delete(invocationId);
    },
  };
  return {
    agent,
    task,
    attemptId,
    leaseOwner,
    logicalExecutionId,
    runtimeInstanceId,
    context,
    attached,
  };
}

for (const invalidation of ["cancelled", "lease_lost"] as const) {
  test(`Terminal revalidates ${invalidation} after waiting for a filesystem lock`, async () => {
    const fixture = await createFixture();
    await writeTextFile(fixture.agent.id, "protected.txt", "original");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const lock = withFileOperationLock(fixture.agent.id, async () => {
      entered();
      await held;
    });
    await ready;
    const pending = executeTool(
      { ...fixture.context, locale: "en" },
      "vm_run_command",
      JSON.stringify({ command: "write protected.txt unauthorized" }),
    );
    try {
      let running = false;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const receipts = await db
          .select()
          .from(operationReceiptsTable)
          .where(eq(operationReceiptsTable.agentId, fixture.agent.id));
        if (receipts.some((receipt) => receipt.state === "running")) {
          running = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(
        running,
        true,
        "effect admission must precede the held file lock",
      );
      if (invalidation === "cancelled") {
        await db
          .update(tasksTable)
          .set({ status: "cancelled", leaseOwner: null, leaseExpiresAt: null })
          .where(eq(tasksTable.id, fixture.task.id));
      } else {
        await db
          .update(agentsTable)
          .set({ runLeaseOwner: "replacement-owner" })
          .where(eq(agentsTable.id, fixture.agent.id));
      }
    } finally {
      release();
      await lock;
    }
    const result = await pending;
    assert.equal(
      await fsp.readFile(
        path.join(getSandboxRoot(fixture.agent.id), "protected.txt"),
        "utf8",
      ),
      "original",
      "a revoked operation must not publish a waiting write",
    );
    assert.notEqual(result.toolOutcome, "succeeded");
  });
}

test("real invocation, runtime, agent and task boundary denials are localized before any file effect", async () => {
  const { WORKSPACE_LOCALES } = await import("../workspace-locale");
  const { getTerminalCopy } = await import("../vm/terminal-localization");
  for (const locale of WORKSPACE_LOCALES) {
    for (const reason of [
      "invocationExpired",
      "runtimeUnavailable",
      "agentAuthorityLost",
      "taskAuthorityLost",
    ] as const) {
      const fixture = await createFixture();
      const result = await executeTool(
        {
          ...fixture.context,
          locale,
          beforeOperationEffectBoundary: async () => {
            const expired = new Date(Date.now() - 1);
            if (reason === "invocationExpired") {
              const [receipt] = await db
                .select()
                .from(operationReceiptsTable)
                .where(eq(operationReceiptsTable.agentId, fixture.agent.id));
              await db
                .update(operationInvocationsTable)
                .set({ leaseExpiresAt: expired })
                .where(eq(operationInvocationsTable.receiptId, receipt.id));
            } else if (reason === "runtimeUnavailable") {
              await db
                .update(runtimeInstancesTable)
                .set({ state: "stopped" })
                .where(eq(runtimeInstancesTable.id, fixture.runtimeInstanceId));
            } else if (reason === "agentAuthorityLost") {
              await db
                .update(agentsTable)
                .set({ runLeaseExpiresAt: expired })
                .where(eq(agentsTable.id, fixture.agent.id));
            } else {
              await db
                .update(tasksTable)
                .set({ leaseExpiresAt: expired })
                .where(eq(tasksTable.id, fixture.task.id));
            }
          },
        },
        "vm_run_command",
        '{"command":"touch must-not-exist.txt"}',
      );
      assert.equal(result.toolOutcome, "rejected");
      assert.ok(
        result.content.includes(getTerminalCopy(locale)[reason]),
        `${locale} ${reason}: ${result.content}`,
      );
      await assert.rejects(
        fsp.access(
          path.join(getSandboxRoot(fixture.agent.id), "must-not-exist.txt"),
        ),
      );
    }
  }
});
