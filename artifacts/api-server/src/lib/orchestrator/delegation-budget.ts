import { and, count, eq, sql } from "drizzle-orm";
import { agentsTable } from "@workspace/db";
import {
  lockRuntimeControlState,
  type RuntimeTransaction,
} from "./runtime-emergency-stop";
import { RuntimeCapacityError } from "./runtime-capacity";

function limit(name: string, fallback: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

/** Called inside the mutation transaction, before insertion. The control-row
 * lock serializes siblings and descendants across workers, not just this process. */
export async function assertDelegationBudget(
  tx: RuntimeTransaction,
  taskId: number,
): Promise<void> {
  await lockRuntimeControlState(tx);
  const result = await tx.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_task_id, last_cycle_completed_at FROM tasks WHERE id = ${taskId}
      UNION
      SELECT t.id, t.parent_task_id, t.last_cycle_completed_at
      FROM tasks t JOIN ancestors a ON t.id = a.parent_task_id
    ), root AS (
      SELECT id, last_cycle_completed_at FROM ancestors WHERE parent_task_id IS NULL
    ), family AS (
      SELECT t.id, t.status, t.created_at FROM tasks t JOIN root r ON t.id = r.id
      UNION
      SELECT t.id, t.status, t.created_at FROM tasks t JOIN family f ON t.parent_task_id = f.id
    )
    SELECT (SELECT count(*) FROM root)::int AS roots,
      count(*) FILTER (WHERE status IN ('pending','planning','in_progress','awaiting_approval','blocked'))::int AS active,
      count(*) FILTER (WHERE created_at >= coalesce((SELECT last_cycle_completed_at FROM root), '-infinity'::timestamptz))::int AS total
    FROM family
  `);
  const row = result.rows[0] as
    { roots: number; active: number; total: number } | undefined;
  if (!row || Number(row.roots) !== 1)
    throw new Error("Delegation requires a valid rooted task family");
  const activeLimit = limit("MAX_TASK_FAMILY_ACTIVE", 4, 64);
  const totalLimit = limit("MAX_TASK_FAMILY_TOTAL", 32, 1000);
  if (Number(row.active) >= activeLimit)
    throw new RuntimeCapacityError("outstandingTasks", activeLimit);
  if (Number(row.total) >= totalLimit)
    throw new RuntimeCapacityError("outstandingTasks", totalLimit);
}

export async function assertAgentCreationBudget(
  tx: RuntimeTransaction,
  parentAgentId: number,
): Promise<void> {
  await lockRuntimeControlState(tx);
  const [row] = await tx
    .select({ value: count() })
    .from(agentsTable)
    .where(
      and(
        eq(agentsTable.parentAgentId, parentAgentId),
        eq(agentsTable.isActive, true),
      ),
    );
  const maximum = limit("MAX_AUTOMATIC_DIRECT_REPORTS", 4, 32);
  if ((row?.value ?? 0) >= maximum)
    throw new RuntimeCapacityError("activeAgents", maximum);
}
