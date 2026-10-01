import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  db,
  agentsTable,
  tasksTable,
  approvalRequestsTable,
  activityEventsTable,
  operationReceiptsTable,
  operationInvocationsTable,
  taskAttemptsTable,
  taskBudgetResumeRequestsTable,
} from "@workspace/db";
import { ResumeTaskBudgetResponse } from "@workspace/api-zod";
import {
  lockRuntimeControlState,
  type RuntimeTransaction,
} from "./orchestrator/runtime-emergency-stop";
import { readIndividualTaskSpendAdmission } from "./orchestrator/task-spend-admission";
import { readFamilySpendAdmission } from "./orchestrator/family-spend-admission";
import type { WorkspaceLocale } from "./workspace-locale";
import { toolMessage } from "./orchestrator/tool-localization";

export const MAX_BUDGET_RESUME_FAMILY = 1000;
type Receipt = ReturnType<typeof ResumeTaskBudgetResponse.parse>;
type Reader = Pick<typeof db, "execute">;

export function parseBudgetResumeReceipt(value: unknown): Receipt {
  const r = ResumeTaskBudgetResponse.parse(value);
  if (
    r.queuedCount !== r.queuedTaskIds.length ||
    new Set(r.queuedTaskIds).size !== r.queuedCount ||
    r.queuedCount + r.stillPausedCount > MAX_BUDGET_RESUME_FAMILY ||
    (r.outcome === "accepted"
      ? r.reason !== null || r.queuedCount === 0
      : r.reason === null || r.queuedCount !== 0)
  ) {
    throw new Error("Invalid budget resume receipt");
  }
  return r;
}

/** UNION stops corrupt parent cycles; a valid rooted task has exactly one root. */
export async function budgetResumeRoot(
  taskId: number,
  client: Reader = db,
): Promise<number | null> {
  const result = await client.execute(sql`WITH RECURSIVE ancestors AS (
    SELECT id,parent_task_id FROM tasks WHERE id=${taskId}
    UNION SELECT t.id,t.parent_task_id FROM tasks t JOIN ancestors a ON t.id=a.parent_task_id
  ) SELECT id FROM ancestors WHERE parent_task_id IS NULL LIMIT 2`);
  return result.rows.length === 1 ? Number(result.rows[0].id) : null;
}

export async function resumeBudgetWithinTransaction(
  tx: RuntimeTransaction,
  taskId: number,
  input: { requestId: string; rootTaskId: number },
  locale: WorkspaceLocale,
) {
  const control = await lockRuntimeControlState(tx);
  const requestHash = createHash("sha256")
    .update(JSON.stringify(["task-budget-resume-v1", taskId, input.rootTaskId]))
    .digest("hex");
  const [prior] = await tx
    .select()
    .from(taskBudgetResumeRequestsTable)
    .where(eq(taskBudgetResumeRequestsTable.requestId, input.requestId));
  if (prior) {
    if (
      prior.taskId !== taskId ||
      prior.rootTaskId !== input.rootTaskId ||
      prior.requestHash !== requestHash
    )
      return { conflict: true as const };
    const receipt = parseBudgetResumeReceipt(prior.response);
    if (
      receipt.taskId !== taskId ||
      receipt.rootTaskId !== input.rootTaskId ||
      receipt.requestId !== input.requestId
    )
      throw new Error("Invalid budget receipt binding");
    return { receipt };
  }

  const finish = async (
    reason: Receipt["reason"],
    queuedTaskIds: number[] = [],
    stillPausedCount = 0,
  ) => {
    const receipt = parseBudgetResumeReceipt({
      requestId: input.requestId,
      taskId,
      rootTaskId: input.rootTaskId,
      outcome: reason ? "rejected" : "accepted",
      reason,
      queuedTaskIds,
      queuedCount: queuedTaskIds.length,
      stillPausedCount,
      recordedAt: new Date(),
    });
    await tx.insert(taskBudgetResumeRequestsTable).values({
      requestId: input.requestId,
      taskId,
      rootTaskId: input.rootTaskId,
      requestHash,
      response: JSON.parse(JSON.stringify(receipt)),
    });
    return { receipt };
  };
  if (control.emergencyStopEnabled) return finish("emergency_stop");
  // Creation/delegation/cancellation lock agents first. Freeze the bounded
  // workforce before discovering descendants, including newly delegated owners.
  await tx.execute(sql`SELECT id FROM ${agentsTable} ORDER BY id FOR UPDATE`);
  const rootId = await budgetResumeRoot(taskId, tx);
  if (rootId === null) return finish("family_invalid");
  if (rootId !== input.rootTaskId) return finish("task_changed");
  const graph = await tx.execute(sql`WITH RECURSIVE family AS (
    SELECT id FROM tasks WHERE id=${rootId}
    UNION SELECT t.id FROM tasks t JOIN family f ON t.parent_task_id=f.id
  ) SELECT id FROM family ORDER BY id LIMIT ${MAX_BUDGET_RESUME_FAMILY + 1}`);
  if (graph.rows.length > MAX_BUDGET_RESUME_FAMILY)
    return finish("family_too_large");
  const ids = graph.rows.map((r) => Number(r.id));
  const identities = await tx
    .select({ id: tasksTable.id, owner: tasksTable.ownerAgentId })
    .from(tasksTable)
    .where(inArray(tasksTable.id, ids));
  const owners = [...new Set(identities.map((t) => t.owner))].sort(
    (a, b) => a - b,
  );
  // Same canonical order as scheduler, cancellation and approved-action admission.
  await tx.execute(
    sql`SELECT id FROM ${approvalRequestsTable} WHERE ${inArray(approvalRequestsTable.taskId, ids)} ORDER BY id FOR UPDATE`,
  );
  await tx.execute(
    sql`SELECT id FROM ${tasksTable} WHERE ${inArray(tasksTable.id, ids)} ORDER BY id FOR UPDATE`,
  );
  const members = await tx
    .select()
    .from(tasksTable)
    .where(inArray(tasksTable.id, ids))
    .orderBy(tasksTable.id);
  const selected = members.find((t) => t.id === taskId),
    root = members.find((t) => t.id === rootId);
  if (
    !selected ||
    selected.status !== "blocked" ||
    selected.blockedReason !== "budget" ||
    !root ||
    ["completed", "cancelled", "failed"].includes(root.status) ||
    (await budgetResumeRoot(taskId, tx)) !== rootId
  )
    return finish("task_changed");
  const activeOwners = new Set(
    (
      await tx
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(
          and(inArray(agentsTable.id, owners), eq(agentsTable.isActive, true)),
        )
    ).map((a) => a.id),
  );
  const approvals = await tx
    .select()
    .from(approvalRequestsTable)
    .where(inArray(approvalRequestsTable.taskId, ids));
  const unsafe = new Set(
    approvals
      .filter(
        (a) =>
          a.status === "pending" || (a.status === "approved" && !a.consumedAt),
      )
      .map((a) => a.taskId),
  );
  const operations = await tx
    .select({ taskId: operationReceiptsTable.taskId })
    .from(operationReceiptsTable)
    .where(
      and(
        inArray(operationReceiptsTable.taskId, ids),
        or(
          inArray(operationReceiptsTable.state, ["reserved", "running"]),
          and(
            eq(operationReceiptsTable.state, "unknown"),
            isNull(operationReceiptsTable.reconciliationDecision),
          ),
        ),
      ),
    );
  for (const op of operations) if (op.taskId !== null) unsafe.add(op.taskId);
  const invocations = await tx
    .select({ taskId: operationReceiptsTable.taskId })
    .from(operationInvocationsTable)
    .innerJoin(
      operationReceiptsTable,
      eq(operationReceiptsTable.id, operationInvocationsTable.receiptId),
    )
    .where(
      and(
        inArray(operationReceiptsTable.taskId, ids),
        or(
          inArray(operationInvocationsTable.state, ["claimed", "running"]),
          and(
            eq(operationInvocationsTable.state, "unknown"),
            isNull(operationReceiptsTable.reconciliationDecision),
          ),
        ),
      ),
    );
  for (const op of invocations) if (op.taskId !== null) unsafe.add(op.taskId);
  const attempts = await tx
    .select({ taskId: taskAttemptsTable.taskId })
    .from(taskAttemptsTable)
    .where(
      and(
        inArray(taskAttemptsTable.taskId, ids),
        inArray(taskAttemptsTable.state, ["claimed", "running"]),
      ),
    );
  for (const attempt of attempts) unsafe.add(attempt.taskId);
  const candidates = members.filter(
    (t) => t.status === "blocked" && t.blockedReason === "budget",
  );
  const queued: number[] = [];
  let exhausted = false;
  const now = new Date();
  // The same locked family and instant apply to every candidate. Read the
  // recursive shared ledger once instead of repeating it for every descendant.
  const familyAdmission = await readFamilySpendAdmission(
    rootId,
    locale,
    now,
    tx,
  );
  if (familyAdmission.reason)
    return finish("allowance_exhausted", [], candidates.length);
  for (const task of candidates) {
    let parent = task.parentTaskId;
    let terminalAncestor = false;
    while (parent !== null) {
      const ancestor = members.find((t) => t.id === parent);
      if (
        !ancestor ||
        ["completed", "cancelled", "failed"].includes(ancestor.status)
      ) {
        terminalAncestor = true;
        break;
      }
      parent = ancestor.parentTaskId;
    }
    if (
      terminalAncestor ||
      !activeOwners.has(task.ownerAgentId) ||
      task.leaseOwner ||
      task.leaseExpiresAt ||
      unsafe.has(task.id)
    )
      continue;
    const admission = await readIndividualTaskSpendAdmission(
      task,
      undefined,
      locale,
      now,
      tx,
    );
    if (admission.reason) {
      exhausted = true;
      continue;
    }
    const [resumed] = await tx
      .update(tasksTable)
      .set({
        status: "in_progress",
        blockedReason: null,
        lastError: null,
        nextAttemptAt: now,
        consecutiveFailures: 0,
      })
      .where(
        and(
          eq(tasksTable.id, task.id),
          eq(tasksTable.status, "blocked"),
          eq(tasksTable.blockedReason, "budget"),
          isNull(tasksTable.leaseOwner),
        ),
      )
      .returning({ id: tasksTable.id });
    if (resumed) queued.push(resumed.id);
  }
  if (queued.length === 0)
    return finish(
      exhausted ? "allowance_exhausted" : "nothing_eligible",
      [],
      candidates.length,
    );
  await tx.insert(activityEventsTable).values({
    agentId: selected.ownerAgentId,
    taskId,
    type: "task_status_changed",
    severity: "info",
    summary: toolMessage(locale, "budgetFamilyResumed", {
      count: queued.length,
    }),
    detail: {
      runtimeEvent: "task_family_budget_resumed",
      requestId: input.requestId,
      rootTaskId: rootId,
      queuedCount: queued.length,
      stillPausedCount: candidates.length - queued.length,
    },
  });
  return finish(null, queued, candidates.length - queued.length);
}
