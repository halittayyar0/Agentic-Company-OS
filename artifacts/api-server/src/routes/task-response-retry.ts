import { Router } from "express";
import { z } from "zod/v4";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  db,
  agentsTable,
  tasksTable,
  taskAttemptsTable,
  activityEventsTable,
  approvalRequestsTable,
  operationReceiptsTable,
  operationInvocationsTable,
  codexTaskSessionsTable,
} from "@workspace/db";
import { parsePositiveInteger } from "../lib/http-params";
import {
  lockRuntimeControlState,
  type RuntimeTransaction,
} from "../lib/orchestrator/runtime-emergency-stop";
import { readTaskSpendAdmission } from "../lib/orchestrator/task-spend-admission";
import { readWorkspaceLocale } from "../lib/workspace-locale";
import { toolMessage } from "../lib/orchestrator/tool-localization";
import { readInferenceAccountingStatus } from "../lib/inference-accounting-status";

const router = Router();
const bodySchema = z
  .object({ blockedAttemptId: z.uuid(), acknowledge: z.literal(true) })
  .strict();
const receiptSchema = z
  .object({
    taskId: z.number().int().positive(),
    blockedAttemptId: z.uuid(),
    outcome: z.literal("accepted"),
    recordedAt: z.iso.datetime(),
  })
  .strict();
type Reader = typeof db | RuntimeTransaction;

async function readReceipt(taskId: number, attemptId: string, reader: Reader) {
  const [prior] = await reader
    .select()
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.taskId, taskId),
        eq(activityEventsTable.type, "task_status_changed"),
        sql`${activityEventsTable.detail}->>'runtimeEvent' = 'task_response_retry_recorded'`,
        sql`${activityEventsTable.detail}->>'blockedAttemptId' = ${attemptId}`,
      ),
    )
    .limit(1);
  if (!prior) return null;
  const receipt = receiptSchema.parse(prior.detail?.receipt);
  if (receipt.taskId !== taskId || receipt.blockedAttemptId !== attemptId)
    throw new Error("Invalid response retry receipt binding");
  return receipt;
}

async function currentAttempt(taskId: number, reader: Reader) {
  const [attempt] = await reader
    .select()
    .from(taskAttemptsTable)
    .where(eq(taskAttemptsTable.taskId, taskId))
    .orderBy(
      desc(taskAttemptsTable.attemptNumber),
      desc(taskAttemptsTable.startedAt),
    )
    .limit(1);
  return attempt;
}
async function eligibleTask(taskId: number, reader: Reader) {
  const [task] = await reader
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId));
  if (!task) return null;
  const [owner] = await reader
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, task.ownerAgentId));
  const attempt = await currentAttempt(taskId, reader);
  const eligible =
    task.status === "blocked" &&
    task.blockedReason === "runtime_failure" &&
    task.leaseOwner === null &&
    task.leaseExpiresAt === null &&
    !!owner?.isActive &&
    owner.runLeaseOwner === null &&
    owner.runLeaseExpiresAt === null &&
    attempt?.state === "blocked" &&
    attempt.finishedAt !== null &&
    (attempt.failureKind === "model_response_incomplete" ||
      (attempt.failureKind === "inference_accounting" &&
        (
          await readInferenceAccountingStatus(
            "task",
            taskId,
            new Date(),
            reader,
          )
        )?.status === "clear")) &&
    attempt.agentId === task.ownerAgentId &&
    attempt.attemptNumber === task.stepAttempts &&
    attempt.cycleNumber === task.cycleCount;
  return { task, attempt, eligible };
}

router.get("/tasks/:taskId/response-retry", async (req, res) => {
  const id = parsePositiveInteger(req.params.taskId, "taskId");
  res.setHeader("Cache-Control", "no-store");
  if (!id.ok) {
    res.status(400).json({ error: id.error });
    return;
  }
  const state = await eligibleTask(id.value, db);
  if (!state) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({
    taskId: id.value,
    canRetry: state.eligible,
    blockedAttemptId: state.eligible ? state.attempt!.id : null,
  });
});

router.get("/tasks/:taskId/response-retry/:attemptId", async (req, res) => {
  const id = parsePositiveInteger(req.params.taskId, "taskId"),
    attemptId = z.uuid().safeParse(req.params.attemptId);
  res.setHeader("Cache-Control", "no-store");
  if (!id.ok || !attemptId.success) {
    res.status(400).json({ error: "Invalid receipt identity" });
    return;
  }
  const receipt = await readReceipt(id.value, attemptId.data, db);
  if (!receipt) {
    res.status(404).json({ error: "No committed receipt" });
    return;
  }
  res.json(receipt);
});

router.post("/tasks/:taskId/response-retry", async (req, res) => {
  const id = parsePositiveInteger(req.params.taskId, "taskId"),
    input = bodySchema.safeParse(req.body);
  res.setHeader("Cache-Control", "no-store");
  if (!id.ok || !input.success) {
    res
      .status(400)
      .json({ error: "Exact blocked attempt and acknowledgement required" });
    return;
  }
  const locale = await readWorkspaceLocale();
  const result = await db.transaction(async (tx) => {
    // Serializes duplicate acceptance across API replicas before any task lease.
    const control = await lockRuntimeControlState(tx);
    // These records are app-owned immutable audit events. The retained attempt
    // restricts task deletion; its identity cannot be reused for a later cycle.
    const prior = await readReceipt(id.value, input.data.blockedAttemptId, tx);
    if (prior) {
      // Historical acceptance is not permission to requeue cancelled/later work.
      return { receipt: prior };
    }
    if (control.emergencyStopEnabled) return { reason: "emergency_stop" };
    // Canonical order used by creation/delegation/cancellation: owners, approvals,
    // tasks, attempts. Freeze the bounded workforce before discovering ancestry.
    await tx.execute(sql`SELECT id FROM ${agentsTable} ORDER BY id FOR UPDATE`);
    const ancestors = await tx.execute(sql`WITH RECURSIVE a AS (
      SELECT id,parent_task_id FROM tasks WHERE id=${id.value}
      UNION SELECT t.id,t.parent_task_id FROM tasks t JOIN a ON t.id=a.parent_task_id
    ) SELECT id,parent_task_id FROM a ORDER BY id LIMIT 1001`);
    if (
      !ancestors.rows.length ||
      ancestors.rows.length > 1000 ||
      ancestors.rows.filter((r) => r.parent_task_id === null).length !== 1
    )
      return { reason: "task_changed" };
    const ids = ancestors.rows.map((r) => Number(r.id));
    await tx.execute(
      sql`SELECT id FROM ${approvalRequestsTable} WHERE ${inArray(approvalRequestsTable.taskId, ids)} ORDER BY id FOR UPDATE`,
    );
    await tx.execute(
      sql`SELECT id FROM ${tasksTable} WHERE ${inArray(tasksTable.id, ids)} ORDER BY id FOR UPDATE`,
    );
    await tx.execute(
      sql`SELECT id FROM ${taskAttemptsTable} WHERE ${eq(taskAttemptsTable.taskId, id.value)} ORDER BY id FOR UPDATE`,
    );
    const state = await eligibleTask(id.value, tx);
    if (!state?.eligible || state.attempt?.id !== input.data.blockedAttemptId)
      return { reason: "task_changed" };
    const family = await tx
      .select()
      .from(tasksTable)
      .where(inArray(tasksTable.id, ids));
    if (
      family.some(
        (t) =>
          t.id !== id.value &&
          ["completed", "cancelled", "failed"].includes(t.status),
      )
    )
      return { reason: "task_changed" };
    const approvals = await tx
      .select({ id: approvalRequestsTable.id })
      .from(approvalRequestsTable)
      .where(
        and(
          inArray(approvalRequestsTable.taskId, ids),
          or(
            eq(approvalRequestsTable.status, "pending"),
            and(
              eq(approvalRequestsTable.status, "approved"),
              isNull(approvalRequestsTable.consumedAt),
            ),
          ),
        ),
      )
      .limit(1);
    const attempts = await tx
      .select({ id: taskAttemptsTable.id })
      .from(taskAttemptsTable)
      .where(
        and(
          eq(taskAttemptsTable.taskId, id.value),
          inArray(taskAttemptsTable.state, ["claimed", "running"]),
        ),
      )
      .limit(1);
    const operations = await tx
      .select({ id: operationReceiptsTable.id })
      .from(operationReceiptsTable)
      .where(
        and(
          eq(operationReceiptsTable.taskId, id.value),
          or(
            inArray(operationReceiptsTable.state, ["reserved", "running"]),
            and(
              eq(operationReceiptsTable.state, "unknown"),
              isNull(operationReceiptsTable.reconciliationDecision),
            ),
          ),
        ),
      )
      .limit(1);
    const invocations = await tx
      .select({ id: operationInvocationsTable.id })
      .from(operationInvocationsTable)
      .innerJoin(
        operationReceiptsTable,
        eq(operationReceiptsTable.id, operationInvocationsTable.receiptId),
      )
      .where(
        and(
          eq(operationReceiptsTable.taskId, id.value),
          or(
            inArray(operationInvocationsTable.state, ["claimed", "running"]),
            and(
              eq(operationInvocationsTable.state, "unknown"),
              isNull(operationReceiptsTable.reconciliationDecision),
            ),
          ),
        ),
      )
      .limit(1);
    const nativeSessions = await tx
      .select({ taskId: codexTaskSessionsTable.taskId })
      .from(codexTaskSessionsTable)
      .where(
        and(
          eq(codexTaskSessionsTable.taskId, id.value),
          or(
            inArray(codexTaskSessionsTable.state, ["running", "uncertain"]),
            eq(codexTaskSessionsTable.cleanupState, "unknown"),
          ),
        ),
      )
      .limit(1);
    if (
      approvals.length ||
      attempts.length ||
      operations.length ||
      invocations.length ||
      nativeSessions.length
    )
      return { reason: "nothing_eligible" };
    const now = new Date();
    if (
      (await readTaskSpendAdmission(state.task, undefined, locale, now, tx))
        .reason
    )
      return { reason: "allowance_exhausted" };
    const receipt = receiptSchema.parse({
      taskId: id.value,
      blockedAttemptId: input.data.blockedAttemptId,
      outcome: "accepted",
      recordedAt: now.toISOString(),
    });
    await tx
      .update(tasksTable)
      .set({
        status: "in_progress",
        blockedReason: null,
        lastError: null,
        nextAttemptAt: now,
        consecutiveFailures: 0,
      })
      .where(eq(tasksTable.id, id.value));
    await tx.insert(activityEventsTable).values({
      agentId: state.task.ownerAgentId,
      taskId: id.value,
      type: "task_status_changed",
      severity: "info",
      summary: toolMessage(locale, "taskResponseRetryQueued"),
      detail: {
        runtimeEvent: "task_response_retry_recorded",
        blockedAttemptId: input.data.blockedAttemptId,
        receipt,
      },
    });
    return { receipt };
  });
  if ("receipt" in result) res.json(result.receipt);
  else
    res
      .status(409)
      .json({ error: "Task cannot safely retry", reason: result.reason });
});

export default router;
