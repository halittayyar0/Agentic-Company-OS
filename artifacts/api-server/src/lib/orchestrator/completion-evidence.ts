import { and, desc, eq, gte, ne, or, sql } from "drizzle-orm";
import {
  db,
  operationReceiptsTable,
  taskAttemptsTable,
  tasksTable,
  type Task,
} from "@workspace/db";
import { redactAuditText } from "../audit-redaction";

const RECEIPT_LIMIT = 12;
const CHILD_LIMIT = 8;

/** A bounded execution snapshot, not proof of artifact quality or report truth. */
export async function loadCompletionEvidence(
  task: Pick<Task, "id" | "cycleCount" | "lastCycleCompletedAt" | "createdAt">,
) {
  const cycleStart = task.lastCycleCompletedAt ?? task.createdAt;
  const receiptScope = and(
    eq(operationReceiptsTable.taskId, task.id),
    ne(operationReceiptsTable.toolName, "complete_task"),
    or(
      and(
        eq(operationReceiptsTable.executionKind, "task_step"),
        sql`exists (select 1 from ${taskAttemptsTable}
          where ${taskAttemptsTable.id} = ${operationReceiptsTable.originAttemptId}
            and ${taskAttemptsTable.taskId} = ${task.id}
            and ${taskAttemptsTable.cycleNumber} = ${task.cycleCount})`,
      ),
      and(
        eq(operationReceiptsTable.executionKind, "approved_action"),
        gte(operationReceiptsTable.reservedAt, cycleStart),
      ),
    ),
  );
  const childScope = and(
    eq(tasksTable.parentTaskId, task.id),
    gte(tasksTable.createdAt, cycleStart),
  );

  // The same database snapshot supplies counts and samples. No provider call
  // happens inside this read transaction, and no task or receipt is mutated.
  return db.transaction(
    async (tx) => {
      const receiptCounts = await tx
        .select({
          state: operationReceiptsTable.state,
          reconciliationDecision: operationReceiptsTable.reconciliationDecision,
          count: sql<number>`count(*)::int`,
        })
        .from(operationReceiptsTable)
        .where(receiptScope)
        .groupBy(
          operationReceiptsTable.state,
          operationReceiptsTable.reconciliationDecision,
        );
      const rows = await tx
        .select({
          id: sql<string>`left(${operationReceiptsTable.id}, 120)`,
          tool: sql<string>`left(${operationReceiptsTable.toolName}, 80)`,
          executionKind: operationReceiptsTable.executionKind,
          state: operationReceiptsTable.state,
          sideEffectClass: operationReceiptsTable.sideEffectClass,
          reconciliationDecision: operationReceiptsTable.reconciliationDecision,
          finishedAt: operationReceiptsTable.finishedAt,
          // Never select arguments, command output, file contents, error text,
          // result summaries, URLs or the arbitrary saved-result object.
          ok: sql<unknown>`${operationReceiptsTable.resultData}->'ok'`,
          exitCode: sql<unknown>`${operationReceiptsTable.resultData}->'exitCode'`,
          byteCount: sql<unknown>`${operationReceiptsTable.resultData}->'byteCount'`,
          artifactId: sql<string | null>`case
            when jsonb_typeof(${operationReceiptsTable.resultData}->'artifactId') = 'string'
              and length(${operationReceiptsTable.resultData}->>'artifactId') = 36
            then ${operationReceiptsTable.resultData}->>'artifactId'
            else null end`,
        })
        .from(operationReceiptsTable)
        .where(receiptScope)
        .orderBy(
          desc(operationReceiptsTable.reservedAt),
          desc(operationReceiptsTable.id),
        )
        .limit(RECEIPT_LIMIT);
      const childCounts = await tx
        .select({
          status: tasksTable.status,
          count: sql<number>`count(*)::int`,
        })
        .from(tasksTable)
        .where(childScope)
        .groupBy(tasksTable.status);
      const children = await tx
        .select({ id: tasksTable.id, status: tasksTable.status })
        .from(tasksTable)
        .where(childScope)
        .orderBy(desc(tasksTable.createdAt), desc(tasksTable.id))
        .limit(CHILD_LIMIT);
      const receiptTotal = receiptCounts.reduce(
        (sum, row) => sum + row.count,
        0,
      );
      const childTotal = childCounts.reduce((sum, row) => sum + row.count, 0);
      return {
        source: "persisted_runtime_metadata" as const,
        taskId: task.id,
        cycleNumber: task.cycleCount,
        receiptTotal,
        receiptCounts,
        receiptsTruncated: receiptTotal > rows.length,
        receipts: rows.map((row) => ({
          id: redactAuditText(row.id, 120),
          tool: redactAuditText(row.tool, 80),
          executionKind: row.executionKind,
          state: row.state,
          sideEffectClass: row.sideEffectClass,
          reconciliationDecision: row.reconciliationDecision,
          finishedAt: row.finishedAt?.toISOString() ?? null,
          ...(typeof row.ok === "boolean" ? { ok: row.ok } : {}),
          ...(Number.isSafeInteger(row.exitCode)
            ? { exitCode: row.exitCode as number }
            : {}),
          ...(Number.isSafeInteger(row.byteCount) && Number(row.byteCount) >= 0
            ? { byteCount: row.byteCount as number }
            : {}),
          ...(row.artifactId &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
            row.artifactId,
          )
            ? { artifactId: row.artifactId }
            : {}),
        })),
        childTotal,
        childCounts,
        childrenTruncated: childTotal > children.length,
        children,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export type CompletionEvidence = Awaited<
  ReturnType<typeof loadCompletionEvidence>
>;
