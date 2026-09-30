import { and, eq, exists, gt, inArray, isNull } from "drizzle-orm";
import { db, taskAttemptsTable, tasksTable } from "@workspace/db";

/** Bring only unleased tasks whose current attempt needs provider setup forward. */
export async function wakeProviderWaitingTasks(
  now = new Date(),
): Promise<number> {
  const currentSetupFailure = db
    .select({ id: taskAttemptsTable.id })
    .from(taskAttemptsTable)
    .where(
      and(
        eq(taskAttemptsTable.taskId, tasksTable.id),
        eq(taskAttemptsTable.attemptNumber, tasksTable.stepAttempts),
        eq(taskAttemptsTable.failureKind, "provider_setup_required"),
        eq(taskAttemptsTable.state, "retrying"),
      ),
    );
  const rows = await db
    .update(tasksTable)
    .set({ nextAttemptAt: now })
    .where(
      and(
        inArray(tasksTable.status, ["pending", "planning", "in_progress"]),
        isNull(tasksTable.leaseOwner),
        gt(tasksTable.nextAttemptAt, now),
        exists(currentSetupFailure),
      ),
    )
    .returning({ id: tasksTable.id });
  return rows.length;
}
