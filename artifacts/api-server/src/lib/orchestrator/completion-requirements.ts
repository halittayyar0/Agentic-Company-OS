import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  operationReceiptsTable as receipts,
  taskAttemptsTable as attempts,
  type Task,
} from "@workspace/db";
import { parseCompletionRequirements } from "@workspace/db/completion-requirements";
import type { RuntimeTransaction } from "./runtime-emergency-stop";

export async function loadCompletionRequirementResults(
  task: Pick<
    Task,
    | "id"
    | "cycleCount"
    | "lastCycleCompletedAt"
    | "createdAt"
    | "completionRequirements"
  >,
  connection?: RuntimeTransaction,
) {
  const requirements = parseCompletionRequirements(task.completionRequirements);
  if (!requirements.length) return { requirements: [] };
  const cycleStart = task.lastCycleCompletedAt ?? task.createdAt;
  // Query only the exact (at most eight) required tool names. Counts and recent
  // samples are presentation aids and cannot establish absence or success.
  const read = async (tx: RuntimeTransaction) => {
    const observedAt = new Date();
    const rows = await tx
      .selectDistinct({ tool: receipts.toolName })
      .from(receipts)
      .where(
        and(
          eq(receipts.taskId, task.id),
          inArray(
            receipts.toolName,
            requirements.map((item) => item.tool),
          ),
          eq(receipts.state, "succeeded"),
          isNull(receipts.reconciliationDecision),
          isNotNull(receipts.finishedAt),
          lte(receipts.reservedAt, observedAt),
          lte(receipts.finishedAt, observedAt),
          gte(receipts.finishedAt, receipts.reservedAt),
          sql`${receipts.resultData}->'ok' is distinct from 'false'::jsonb`,
          sql`(${receipts.toolName} not in ('vm_run_command', 'vm_run_sudo_command')
        or (${receipts.resultData}->'ok' = 'true'::jsonb
          and ${receipts.resultData}->'exitCode' = '0'::jsonb))`,
          or(
            and(
              eq(receipts.executionKind, "task_step"),
              sql`exists (select 1 from ${attempts}
            where ${attempts.id} = ${receipts.originAttemptId}
              and ${attempts.taskId} = ${task.id}
              and ${attempts.cycleNumber} = ${task.cycleCount}
              and ${attempts.agentId} = ${receipts.agentId}
              and ${attempts.logicalExecutionId}::text = ${receipts.logicalExecutionId})`,
            ),
            and(
              eq(receipts.executionKind, "approved_action"),
              gte(receipts.reservedAt, cycleStart),
            ),
          ),
        ),
      );
    const succeeded = new Set(rows.map((row) => row.tool));
    return {
      requirements: requirements.map((requirement) => ({
        ...requirement,
        satisfied: succeeded.has(requirement.tool),
      })),
    };
  };
  return connection
    ? read(connection)
    : db.transaction(read, {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      });
}
