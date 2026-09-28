import assert from "node:assert/strict";
import test from "node:test";
import {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  approvalRequestsTable,
  operationReceiptsTable,
  runtimeControlsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { approvePolicyActions } from "./policy-approvals";
import {
  readExecutionPolicy,
  updateExecutionPolicy,
  withToolPolicy,
  assertToolPolicy,
} from "../execution-policy";
import { canonicalArgumentHash } from "./operation-receipts";

test.before(() => dbReady);
test.after(() => closeDatabase());
test("full access creates one exact action receipt, and downgrade invalidates its automatic authority", async () => {
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Automatic policy",
      role: "test",
      systemPrompt: "test",
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Test",
      brief: "Test",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const args = { command: "echo policy-test" };
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      agentId: agent.id,
      taskId: task.id,
      category: "other",
      title: "Test",
      description: "Test",
      scope: {
        toolName: "vm_run_command",
        argsHash: canonicalArgumentHash(args),
      },
      actionPayload: { toolName: "vm_run_command", args },
      expiresAt: new Date(Date.now() + 60000),
    })
    .returning();
  assert.equal(await approvePolicyActions(), 0);
  let policy = await readExecutionPolicy();
  policy = await updateExecutionPolicy({
    mode: "full_access",
    expectedRevision: policy.revision,
  });
  const concurrent = await Promise.all([
    approvePolicyActions(),
    approvePolicyActions(),
  ]);
  assert.equal(concurrent[0] + concurrent[1], 1);
  assert.equal(await approvePolicyActions(), 0);
  const [saved] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, approval.id));
  assert.equal(saved.automaticPolicyRevision, policy.revision);
  assert.equal(saved.status, "approved");
  const receipts = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.approvalId, approval.id));
  assert.equal(receipts.length, 1);
  await withToolPolicy(
    "vm_run_command",
    () => assertToolPolicy(),
    policy.revision,
  );
  await updateExecutionPolicy({
    mode: "approval",
    expectedRevision: policy.revision,
  });
  await assert.rejects(
    withToolPolicy("vm_run_command", () => assertToolPolicy(), policy.revision),
    /EXECUTION_POLICY_DENIED/u,
  );
});

test("emergency stop forbids automatic approval even in full access", async () => {
  const policy = await readExecutionPolicy();
  await updateExecutionPolicy({
    mode: "full_access",
    expectedRevision: policy.revision,
  });
  await db
    .update(runtimeControlsTable)
    .set({ emergencyStopEnabled: true })
    .where(eq(runtimeControlsTable.id, 1));
  assert.equal(await approvePolicyActions(), 0);
  await db
    .update(runtimeControlsTable)
    .set({ emergencyStopEnabled: false })
    .where(eq(runtimeControlsTable.id, 1));
});

test("automatic policy never turns expired, changed or unscoped requests into authority", async () => {
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Invalid automatic requests",
      role: "test",
      systemPrompt: "test",
      createdByUser: true,
    })
    .returning();
  const args = { command: "echo policy-test" };
  for (const kind of ["expired", "changed", "unscoped"]) {
    const [task] = await db
      .insert(tasksTable)
      .values({
        title: kind,
        brief: "test",
        ownerAgentId: agent.id,
        status: "awaiting_approval",
        createdByUser: true,
      })
      .returning();
    await db.insert(approvalRequestsTable).values({
      agentId: agent.id,
      taskId: task.id,
      category: "other",
      title: kind,
      description: "test",
      expiresAt: new Date(Date.now() + (kind === "expired" ? -60000 : 60000)),
      scope:
        kind === "unscoped"
          ? null
          : {
              toolName: "vm_run_command",
              argsHash:
                kind === "changed"
                  ? "0".repeat(64)
                  : canonicalArgumentHash(args),
            },
      actionPayload: { toolName: "vm_run_command", args },
    });
  }
  assert.equal(await approvePolicyActions(), 0);
});

test("old ineligible requests cannot starve later actions, and emergency stop retains the pending request", async () => {
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Queue fairness",
      role: "test",
      systemPrompt: "test",
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Queue fairness",
      brief: "test",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const base = {
    agentId: agent.id,
    taskId: task.id,
    category: "other" as const,
    title: "test",
    description: "test",
    expiresAt: new Date(Date.now() + 60000),
  };
  await db
    .insert(approvalRequestsTable)
    .values(Array.from({ length: 55 }, () => ({ ...base })));
  const args = { command: "echo fairness" };
  const [eligible] = await db
    .insert(approvalRequestsTable)
    .values({
      ...base,
      scope: {
        toolName: "vm_run_command",
        argsHash: canonicalArgumentHash(args),
      },
      actionPayload: { toolName: "vm_run_command", args },
    })
    .returning();
  await db
    .update(runtimeControlsTable)
    .set({ emergencyStopEnabled: true })
    .where(eq(runtimeControlsTable.id, 1));
  for (let i = 0; i < 3; i++) assert.equal(await approvePolicyActions(), 0);
  const [pending] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, eligible.id));
  assert.equal(pending.status, "pending");
  await db
    .update(runtimeControlsTable)
    .set({ emergencyStopEnabled: false })
    .where(eq(runtimeControlsTable.id, 1));
  let admitted = 0;
  for (let i = 0; i < 3; i++) admitted += await approvePolicyActions();
  assert.equal(admitted, 1);
});
