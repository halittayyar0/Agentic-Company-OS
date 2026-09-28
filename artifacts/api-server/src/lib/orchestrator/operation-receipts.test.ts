import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  db,
  dbReady,
  operationReceiptsTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  tasksTable,
} from "@workspace/db";
import {
  canonicalArgumentHash,
  canonicalOperationKey,
  canonicalReplayKey,
  canonicalizeJson,
  classifyToolSideEffect,
  OperationReceiptIntegrityError,
  reserveOperation,
} from "./operation-receipts";

const baseIdentity = {
  canonicalVersion: 1 as const,
  executionKind: "task_step" as const,
  logicalExecutionId: "11111111-1111-4111-8111-111111111111",
  toolName: "vm_write_file",
  args: {
    path: "reports/daily.txt",
    contentHash: "sha256:content",
  },
  physical: {
    attemptId: "attempt-one",
    workerInstanceId: "worker-one",
    modelToolCallId: "model-call-one",
    callSlot: "provider:0:tool:0",
  },
};

function legacyCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(legacyCanonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${legacyCanonicalJson(record[key])}`)
    .join(",")}}`;
}

test("canonical JSON is deterministic and rejects ambiguous non-JSON values", () => {
  assert.equal(
    canonicalizeJson({ b: 2, a: 1 }),
    canonicalizeJson({ a: 1, b: 2 }),
  );
  assert.equal(
    canonicalArgumentHash({ text: "e\u0301", amount: -0 }),
    canonicalArgumentHash({ amount: 0, text: "é" }),
  );
  assert.equal(canonicalizeJson({ value: -0 }), canonicalizeJson({ value: 0 }));
  assert.equal(
    canonicalizeJson({ label: "e\u0301" }),
    canonicalizeJson({ label: "é" }),
  );
  assert.equal(
    canonicalizeJson({ a: 1, omitted: undefined }),
    canonicalizeJson({ a: 1 }),
  );
  assert.notEqual(
    canonicalizeJson({ values: [1, 2, 3] }),
    canonicalizeJson({ values: [3, 2, 1] }),
  );
  assert.equal(
    canonicalizeJson(JSON.parse('{"__proto__":1,"constructor":2}')),
    '{"__proto__":1,"constructor":2}',
  );

  assert.throws(() => canonicalizeJson(undefined), /JSON|undefined/i);
  assert.throws(() => canonicalizeJson([undefined]), /JSON|undefined/i);
  assert.throws(() => canonicalizeJson(Number.NaN), /finite|JSON/i);
  assert.throws(
    () => canonicalizeJson(Number.POSITIVE_INFINITY),
    /finite|JSON/i,
  );
  assert.throws(() => canonicalizeJson(1n), /JSON|bigint/i);
  assert.throws(() => canonicalizeJson(new Date()), /plain|JSON/i);

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(() => canonicalizeJson(circular), /circular|JSON/i);
});

test("operation identity is stable under object ordering and replay omits physical attempts", () => {
  const reordered = {
    ...baseIdentity,
    args: { contentHash: "sha256:content", path: "reports/daily.txt" },
  };
  assert.equal(
    canonicalOperationKey(baseIdentity),
    canonicalOperationKey(reordered),
  );
  assert.equal(
    canonicalReplayKey({ ...baseIdentity, sideEffectClass: "idempotent" }),
    canonicalReplayKey({
      ...baseIdentity,
      sideEffectClass: "idempotent",
      physical: {
        attemptId: "attempt-recovered",
        workerInstanceId: "worker-two",
        modelToolCallId: "model-call-replayed",
        callSlot: "provider:1:tool:0",
      },
    }),
  );
  assert.notEqual(
    canonicalOperationKey(baseIdentity),
    canonicalOperationKey({
      ...baseIdentity,
      physical: { ...baseIdentity.physical, callSlot: "provider:0:tool:1" },
    }),
  );
  assert.notEqual(
    canonicalReplayKey({ ...baseIdentity, sideEffectClass: "idempotent" }),
    canonicalReplayKey({
      ...baseIdentity,
      sideEffectClass: "idempotent",
      args: { ...baseIdentity.args, path: "reports/next.txt" },
    }),
  );
  assert.equal(
    canonicalReplayKey({ ...baseIdentity, sideEffectClass: "read_only" }),
    null,
  );
  assert.match(canonicalOperationKey(baseIdentity), /^op:v1:[0-9a-f]{64}$/u);
  assert.match(
    canonicalReplayKey({ ...baseIdentity, sideEffectClass: "idempotent" }) ??
      "",
    /^replay:v1:[0-9a-f]{64}$/u,
  );
});

test("side-effect classification is exhaustive and preapproval always upgrades authority", () => {
  const expected = new Map<string, string>([
    ["computer_observe", "read_only"],
    ["vm_list_files", "read_only"],
    ["vm_read_file", "read_only"],
    ["browser_snapshot", "read_only"],
    ["browser_extract_text", "read_only"],
    ["browser_wait", "read_only"],
    ["create_sub_agent", "transactional"],
    ["delegate_task", "transactional"],
    ["update_task_progress", "transactional"],
    ["complete_task", "transactional"],
    ["request_approval", "transactional"],
    ["request_user_input", "transactional"],
    ["log_note", "transactional"],
    ["post_company_message", "transactional"],
    ["vm_write_file", "idempotent"],
    ["browser_save_screenshot", "at_most_once"],
    ["vm_run_command", "at_most_once"],
    ["browser_open", "at_most_once"],
    ["browser_scroll", "at_most_once"],
    ["browser_click", "at_most_once"],
    ["vm_run_sudo_command", "approval_at_most_once"],
    ["browser_type", "approval_at_most_once"],
  ]);

  for (const [toolName, sideEffectClass] of expected) {
    assert.equal(
      classifyToolSideEffect({ toolName }),
      sideEffectClass,
      toolName,
    );
  }
  assert.equal(
    classifyToolSideEffect({
      toolName: "browser_click",
      approvalBound: true,
    }),
    "approval_at_most_once",
  );
  assert.equal(
    classifyToolSideEffect({
      toolName: "vm_read_file",
      preapprovedAction: true,
    }),
    "approval_at_most_once",
  );
  assert.equal(
    classifyToolSideEffect({
      toolName: "vm_run_command",
      args: { command: "echo safe" },
    }),
    "at_most_once",
  );
  assert.throws(
    () => classifyToolSideEffect({ toolName: "unknown_future_tool" }),
    /unknown|classif/i,
  );
});

test("receipt reservation inserts or observes one immutable logical operation", async () => {
  await dbReady;
  const suffix = randomUUID();
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Receipt owner ${suffix}`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: `Receipt task ${suffix}`,
      brief: "Reserve one logical operation.",
      ownerAgentId: agent.id,
      createdByUser: true,
    })
    .returning();
  const runtimeId = `runtime-${suffix}`;
  await db.insert(runtimeInstancesTable).values({
    id: runtimeId,
    role: "worker",
    state: "healthy",
    hostname: "receipt-test",
    processId: 1701,
    buildVersion: "test",
    schedulerEnabled: true,
  });
  const attemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: task.id,
    agentId: agent.id,
    workerInstanceId: runtimeId,
    leaseOwner: `lease-${suffix}`,
    attemptNumber: 1,
    cycleNumber: 0,
    logicalExecutionId,
  });

  const input = {
    ...baseIdentity,
    logicalExecutionId,
    physical: {
      attemptId,
      workerInstanceId: runtimeId,
      modelToolCallId: "model-call-reserve",
      callSlot: "provider:0:tool:0",
    },
    taskId: task.id,
    agentId: agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: attemptId,
    sideEffectClass: "idempotent" as const,
    externalIdempotencyKey: `file-${suffix}`,
  };

  const first = await reserveOperation(input);
  const second = await reserveOperation({
    ...input,
    args: { contentHash: "sha256:content", path: "reports/daily.txt" },
  });
  const replacementRuntimeId = `replacement-${runtimeId}`;
  const replacementAttemptId = randomUUID();
  await db.insert(runtimeInstancesTable).values({
    id: replacementRuntimeId,
    role: "worker",
    state: "healthy",
    hostname: "receipt-recovery-test",
    processId: 1702,
    buildVersion: "test",
    schedulerEnabled: true,
  });
  await db.insert(taskAttemptsTable).values({
    id: replacementAttemptId,
    taskId: task.id,
    agentId: agent.id,
    workerInstanceId: replacementRuntimeId,
    leaseOwner: `replacement-lease-${suffix}`,
    attemptNumber: 2,
    cycleNumber: 0,
    logicalExecutionId,
  });
  const recoveredPhysicalAttempt = await reserveOperation({
    ...input,
    originAttemptId: replacementAttemptId,
    physical: {
      attemptId: replacementAttemptId,
      workerInstanceId: replacementRuntimeId,
      modelToolCallId: "model-call-recovered",
      callSlot: "provider:1:tool:0",
    },
  });

  assert.equal(first.execute, true);
  assert.equal(second.execute, false);
  assert.equal(recoveredPhysicalAttempt.execute, false);
  assert.equal(second.receipt.id, first.receipt.id);
  assert.equal(recoveredPhysicalAttempt.receipt.id, first.receipt.id);
  assert.equal(
    first.receipt.replayKey,
    recoveredPhysicalAttempt.receipt.replayKey,
  );

  const collisionInput = {
    ...input,
    physical: { ...input.physical, callSlot: "provider:0:tool:collision" },
  };
  const collisionOperationKey = canonicalOperationKey(collisionInput);
  await db.insert(operationReceiptsTable).values({
    id: randomUUID(),
    canonicalVersion: 1,
    operationKey: collisionOperationKey,
    replayKey: `replay:v1:${"a".repeat(64)}`,
    executionKind: "task_step",
    logicalExecutionId: randomUUID(),
    taskId: task.id,
    agentId: agent.id,
    originAttemptId: attemptId,
    sideEffectClass: "idempotent",
    toolName: "vm_write_file",
    argumentHash: "b".repeat(64),
    externalIdempotencyKey: `corrupt-${suffix}`,
  });
  await assert.rejects(
    reserveOperation(collisionInput),
    OperationReceiptIntegrityError,
  );

  const legacyExternalKey = `legacy-external-${suffix}`;
  const legacyLogicalExecutionId = randomUUID();
  await db.insert(operationReceiptsTable).values({
    id: randomUUID(),
    canonicalVersion: 1,
    operationKey: `legacy-operation-${suffix}`,
    replayKey: legacyExternalKey,
    executionKind: "task_step",
    logicalExecutionId: legacyLogicalExecutionId,
    taskId: task.id,
    agentId: agent.id,
    originAttemptId: attemptId,
    sideEffectClass: "idempotent",
    state: "succeeded",
    toolName: "vm_write_file",
    argumentHash: "legacy-arguments-were-not-preserved",
    externalIdempotencyKey: legacyExternalKey,
    startedAt: new Date(),
    finishedAt: new Date(),
    resultSummary: "Legacy terminal evidence",
  });
  const legacyAttemptId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: legacyAttemptId,
    taskId: task.id,
    agentId: agent.id,
    workerInstanceId: runtimeId,
    leaseOwner: `legacy-lease-${suffix}`,
    attemptNumber: 3,
    cycleNumber: 0,
    logicalExecutionId: legacyLogicalExecutionId,
  });
  const legacyMismatchFence = await reserveOperation({
    ...input,
    logicalExecutionId: legacyLogicalExecutionId,
    originAttemptId: legacyAttemptId,
    physical: {
      ...input.physical,
      attemptId: legacyAttemptId,
      callSlot: "provider:legacy-recovery:tool:0",
    },
    externalIdempotencyKey: legacyExternalKey,
  });
  assert.equal(legacyMismatchFence.execute, false);
  assert.equal(
    legacyMismatchFence.receipt.externalIdempotencyKey,
    legacyExternalKey,
  );
  const legacyRows = await db
    .select({ id: operationReceiptsTable.id })
    .from(operationReceiptsTable)
    .where(
      eq(operationReceiptsTable.externalIdempotencyKey, legacyExternalKey),
    );
  assert.equal(legacyRows.length, 1);

  const absentKeyLegacyExternalKey = `legacy-absent-key-${suffix}`;
  const absentKeyLogicalExecutionId = randomUUID();
  const absentKeyReceiptId = randomUUID();
  const recoveryAttemptId = randomUUID();
  const legacyDriftArgs = {
    path: "reports/e\u0301.txt",
    amount: -0,
    contentHash: "sha256:legacy-content",
  };
  const oldCanonicalHash = createHash("sha256")
    .update(legacyCanonicalJson(legacyDriftArgs))
    .digest("hex");
  assert.notEqual(oldCanonicalHash, canonicalArgumentHash(legacyDriftArgs));
  await db.insert(taskAttemptsTable).values({
    id: recoveryAttemptId,
    taskId: task.id,
    agentId: agent.id,
    workerInstanceId: runtimeId,
    leaseOwner: `legacy-recovery-${suffix}`,
    attemptNumber: 2,
    cycleNumber: 0,
    logicalExecutionId: absentKeyLogicalExecutionId,
    recoveryOfAttemptId: attemptId,
  });
  await db.insert(operationReceiptsTable).values({
    id: absentKeyReceiptId,
    canonicalVersion: 1,
    operationKey: `legacy-absent-key-operation-${suffix}`,
    replayKey: absentKeyLegacyExternalKey,
    executionKind: "task_step",
    logicalExecutionId: absentKeyLogicalExecutionId,
    taskId: task.id,
    agentId: agent.id,
    originAttemptId: attemptId,
    sideEffectClass: "idempotent",
    state: "succeeded",
    toolName: "vm_write_file",
    argumentHash: oldCanonicalHash,
    externalIdempotencyKey: absentKeyLegacyExternalKey,
    startedAt: new Date(),
    finishedAt: new Date(),
    resultSummary: "Legacy effect already completed",
  });

  const absentKeyReplay = await reserveOperation({
    ...input,
    args: legacyDriftArgs,
    logicalExecutionId: absentKeyLogicalExecutionId,
    originAttemptId: recoveryAttemptId,
    physical: {
      ...input.physical,
      attemptId: recoveryAttemptId,
      callSlot: "provider:legacy-absent-key-recovery:tool:0",
    },
    externalIdempotencyKey: null,
  });
  assert.equal(absentKeyReplay.execute, false);
  assert.equal(absentKeyReplay.receipt.id, absentKeyReceiptId);
  const absentKeyRows = await db
    .select({ id: operationReceiptsTable.id })
    .from(operationReceiptsTable)
    .where(
      eq(
        operationReceiptsTable.logicalExecutionId,
        absentKeyLogicalExecutionId,
      ),
    );
  assert.equal(absentKeyRows.length, 1);
});
