import { and, desc, eq, gte, ne, or, sql } from "drizzle-orm";
import {
  db,
  operationReceiptsTable,
  taskAttemptsTable,
  tasksTable,
  sourceChangesTable,
  type Task,
} from "@workspace/db";
import { redactAuditText } from "../audit-redaction";
import { readCalculationEvidence } from "./calculation-evidence";
import { canonicalArgumentHash } from "./operation-receipts";

const RECEIPT_LIMIT = 12;
const TOOL_COUNT_LIMIT = 128;
const CHILD_LIMIT = 8;
const SOURCE_CHANGE_LIMIT = 8;
const commitId = (value: unknown): value is string =>
  typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value);

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
  // Preparation saves its row just before creating the linked task. The first
  // cycle therefore uses the explicit link, not a timestamp comparison that
  // would discard its own delivery. Old snapshots do not prove later cycles.
  const sourceScope = and(
    eq(sourceChangesTable.taskId, task.id),
    task.cycleCount > 0
      ? gte(sourceChangesTable.createdAt, cycleStart)
      : undefined,
  );

  // The same database snapshot supplies counts and samples. No provider call
  // happens inside this read transaction, and no task or receipt is mutated.
  return db.transaction(
    async (tx) => {
      const observedAt = new Date().toISOString();
      const savedCalculation = sql`(${operationReceiptsTable.resultData}->'calculation')`;
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
      // Cover tools used before the latest receipt sample. Never infer absence
      // from a truncated sample or copy arbitrary names into the model context.
      const toolCounts = await tx
        .select({
          tool: sql<string | null>`case
            when ${operationReceiptsTable.toolName} ~ '^[a-zA-Z][a-zA-Z0-9_]{0,79}$'
            then ${operationReceiptsTable.toolName} else null end`,
          state: operationReceiptsTable.state,
          reconciliationDecision: operationReceiptsTable.reconciliationDecision,
          count: sql<number>`count(*)::int`,
        })
        .from(operationReceiptsTable)
        .where(receiptScope)
        .groupBy(
          operationReceiptsTable.toolName,
          operationReceiptsTable.state,
          operationReceiptsTable.reconciliationDecision,
        )
        .orderBy(
          operationReceiptsTable.toolName,
          operationReceiptsTable.state,
          operationReceiptsTable.reconciliationDecision,
        )
        .limit(TOOL_COUNT_LIMIT + 1);
      const rows = await tx
        .select({
          id: sql<string>`left(${operationReceiptsTable.id}, 120)`,
          tool: sql<string>`left(${operationReceiptsTable.toolName}, 80)`,
          executionKind: operationReceiptsTable.executionKind,
          state: operationReceiptsTable.state,
          sideEffectClass: operationReceiptsTable.sideEffectClass,
          reconciliationDecision: operationReceiptsTable.reconciliationDecision,
          finishedAt: operationReceiptsTable.finishedAt,
          argumentHash: sql<
            string | null
          >`case when ${operationReceiptsTable.argumentHash} ~ '^[0-9a-f]{64}$' then ${operationReceiptsTable.argumentHash} else null end`,
          // A dedicated numeric projection; never select generic saved output.
          // CASE guards array operations even for malformed legacy JSON.
          calculation: sql<unknown>`case
            when ${operationReceiptsTable.toolName} = 'calculate'
              and ${operationReceiptsTable.executionKind} = 'task_step'
              and ${operationReceiptsTable.sideEffectClass} = 'read_only'
              and ${operationReceiptsTable.state} = 'succeeded'
              and ${operationReceiptsTable.reconciliationDecision} is null
              and ${operationReceiptsTable.resultData}->'ok' is distinct from 'false'::jsonb
              and ${operationReceiptsTable.finishedAt} is not null
              and ${operationReceiptsTable.finishedAt} >= ${operationReceiptsTable.reservedAt}
              and ${operationReceiptsTable.finishedAt} <= ${observedAt}::timestamptz
              and ${operationReceiptsTable.reservedAt} <= ${observedAt}::timestamptz
              and exists (select 1 from ${taskAttemptsTable}
                where "task_attempts"."id" = "operation_receipts"."origin_attempt_id"
                  and "task_attempts"."task_id" = ${task.id}
                  and "task_attempts"."cycle_number" = ${task.cycleCount}
                  and "task_attempts"."agent_id" = "operation_receipts"."agent_id"
                  and "task_attempts"."logical_execution_id"::text = "operation_receipts"."logical_execution_id")
              and jsonb_typeof(${savedCalculation}) = 'object'
              and jsonb_typeof(${savedCalculation}->'values') = 'array'
            then case when jsonb_array_length(${savedCalculation}->'values') between 1 and 8
              and ${savedCalculation} - ARRAY['schemaVersion','operation','values','value','arithmetic']::text[] = '{}'::jsonb
              and ${savedCalculation} @> '{"schemaVersion":1,"arithmetic":"IEEE-754"}'::jsonb
              and ${savedCalculation}->>'operation' in ('add','subtract','multiply','divide','mean','min','max','percentage')
              and jsonb_typeof(${savedCalculation}->'value') = 'number'
              and length((${savedCalculation}->'value')::text) <= 1024
              and not exists (select 1 from jsonb_array_elements(${savedCalculation}->'values') as numeric_input(value)
                where jsonb_typeof(numeric_input.value) <> 'number' or length(numeric_input.value::text) > 1024)
            then jsonb_build_object('schemaVersion',1,'operation',${savedCalculation}->>'operation',
              'values',${savedCalculation}->'values','value',${savedCalculation}->'value','arithmetic','IEEE-754')
            else null end
            else null end`,
          // Never select arguments, command output, file contents, error text,
          // result summaries, URLs or the arbitrary saved-result object.
          ok: sql<unknown>`${operationReceiptsTable.resultData}->'ok'`,
          exitCode: sql<unknown>`${operationReceiptsTable.resultData}->'exitCode'`,
          byteCount: sql<unknown>`${operationReceiptsTable.resultData}->'byteCount'`,
          nativeItemCount: sql<number | null>`case
            when jsonb_typeof(${operationReceiptsTable.resultData}->'nativeItemCount') = 'number'
              and ${operationReceiptsTable.resultData}->>'nativeItemCount' ~ '^(0|[1-9][0-9]{0,2})$'
            then (${operationReceiptsTable.resultData}->>'nativeItemCount')::int else null end`,
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
      const [sourceCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(sourceChangesTable)
        .where(sourceScope);
      const sourceRows = await tx
        .select({
          id: sourceChangesTable.id,
          state: sourceChangesTable.state,
          revision: sourceChangesTable.revision,
          updatedAt: sourceChangesTable.updatedAt,
          // Select fixed-size commit IDs only; paths, requests, commands and
          // check output never enter the model's completion review context.
          baseCommit: sql<
            string | null
          >`case when ${sourceChangesTable.baseCommit} ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'
            then ${sourceChangesTable.baseCommit} else null end`,
          candidateCommit: sql<
            string | null
          >`case when ${sourceChangesTable.candidateCommit} ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'
            then ${sourceChangesTable.candidateCommit} else null end`,
          appliedCommit: sql<
            string | null
          >`case when ${sourceChangesTable.appliedCommit} ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'
            then ${sourceChangesTable.appliedCommit} else null end`,
          passed: sql<boolean>`${sourceChangesTable.check}->'passed' = 'true'::jsonb`,
          exitCodeIsZero: sql<boolean>`${sourceChangesTable.check}->'exitCode' = '0'::jsonb`,
          commandCount: sql<number | null>`case
            when jsonb_typeof(${sourceChangesTable.check}->'commands') = 'array'
              then jsonb_array_length(${sourceChangesTable.check}->'commands')
            when jsonb_typeof(${sourceChangesTable.check}->'command') = 'array'
              then case when jsonb_array_length(${sourceChangesTable.check}->'command') > 0 then 1 else 0 end
            else null end`,
        })
        .from(sourceChangesTable)
        .where(sourceScope)
        .orderBy(
          desc(sourceChangesTable.updatedAt),
          desc(sourceChangesTable.id),
        )
        .limit(SOURCE_CHANGE_LIMIT);
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
        toolCountsTruncated:
          toolCounts.length > TOOL_COUNT_LIMIT ||
          toolCounts.some((row) => row.tool === null),
        toolCounts: toolCounts
          .slice(0, TOOL_COUNT_LIMIT)
          .filter((row) => row.tool !== null)
          .map((row) => ({
            tool: redactAuditText(row.tool!, 80),
            state: row.state,
            reconciliationDecision: row.reconciliationDecision,
            count: row.count,
          })),
        receiptsTruncated: receiptTotal > rows.length,
        receipts: rows.map((row) => {
          const candidate = readCalculationEvidence(row.calculation);
          const calculation =
            candidate &&
            row.argumentHash ===
              canonicalArgumentHash({
                operation: candidate.operation,
                values: candidate.values,
              })
              ? candidate
              : null;
          return {
            id: redactAuditText(row.id, 120),
            tool: redactAuditText(row.tool, 80),
            executionKind: row.executionKind,
            state: row.state,
            sideEffectClass: row.sideEffectClass,
            reconciliationDecision: row.reconciliationDecision,
            finishedAt: row.finishedAt?.toISOString() ?? null,
            ...(calculation
              ? {
                  calculation: {
                    proofScope: "bounded_calculation" as const,
                    ...calculation,
                  },
                }
              : {}),
            ...(row.tool === "vm_codex_task"
              ? {
                  // Keep the receipt's state; this scope alone cannot certify
                  // a terminal turn, deliverable, command, or artifact.
                  proofScope: "codex_turn" as const,
                  deliverableVerified: false as const,
                  ...(Number.isSafeInteger(row.nativeItemCount) &&
                  Number(row.nativeItemCount) >= 0 &&
                  Number(row.nativeItemCount) <= 128
                    ? { nativeItemCount: row.nativeItemCount as number }
                    : {}),
                }
              : {}),
            ...(row.tool !== "vm_codex_task" && typeof row.ok === "boolean"
              ? { ok: row.ok }
              : {}),
            ...(row.tool !== "vm_codex_task" &&
            Number.isSafeInteger(row.exitCode)
              ? { exitCode: row.exitCode as number }
              : {}),
            ...(row.tool !== "vm_codex_task" &&
            Number.isSafeInteger(row.byteCount) &&
            Number(row.byteCount) >= 0
              ? { byteCount: row.byteCount as number }
              : {}),
            ...(row.tool !== "vm_codex_task" &&
            row.artifactId &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
              row.artifactId,
            )
              ? { artifactId: row.artifactId }
              : {}),
          };
        }),
        childTotal,
        childCounts,
        childrenTruncated: childTotal > children.length,
        children,
        sourceChangeTotal: sourceCount.count,
        sourceChangesTruncated: sourceCount.count > sourceRows.length,
        sourceChanges: sourceRows.map((row) => {
          const snapshotChecksPassed =
            ["verified", "applied", "rolled_back"].includes(row.state) &&
            commitId(row.baseCommit) &&
            commitId(row.candidateCommit) &&
            row.baseCommit !== row.candidateCommit &&
            row.passed === true &&
            row.exitCodeIsZero === true &&
            Number.isSafeInteger(row.commandCount) &&
            Number(row.commandCount) >= 1 &&
            Number(row.commandCount) <= 4;
          return {
            id: row.id,
            state: row.state,
            revision: row.revision,
            updatedAt: row.updatedAt.toISOString(),
            proofScope: "frozen_source_snapshot" as const,
            snapshotChecksPassed,
            applicationRecorded:
              snapshotChecksPassed &&
              row.state === "applied" &&
              row.appliedCommit === row.candidateCommit,
            ...(snapshotChecksPassed
              ? {
                  candidateCommit: row.candidateCommit!,
                  checkCommandCount: row.commandCount!,
                }
              : {}),
          };
        }),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export type CompletionEvidence = Awaited<
  ReturnType<typeof loadCompletionEvidence>
>;
