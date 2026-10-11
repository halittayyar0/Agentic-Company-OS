import { inArray, sql } from "drizzle-orm";
import { db, usageEventsTable } from "@workspace/db";

/** Lifetime read projection, including reviews and reported failed calls.
 * The execution counter remains owned by the task runner. Preserve higher
 * legacy counters; neither missing receipts nor unknown prices imply free use.
 * One indexed aggregate serves the returned page, without per-task queries. */
export async function withRecordedTaskUsage<
  T extends { id: number; tokensUsed: number },
>(tasks: T[]): Promise<T[]> {
  if (!tasks.length) return [];
  const rows = await db
    .select({
      taskId: usageEventsTable.taskId,
      tokens: sql<string>`coalesce(sum(${usageEventsTable.totalTokens}), 0)`,
    })
    .from(usageEventsTable)
    .where(
      inArray(
        usageEventsTable.taskId,
        tasks.map((task) => task.id),
      ),
    )
    .groupBy(usageEventsTable.taskId);
  const totals = new Map(
    rows.map((row) => {
      const tokens = Number(row.tokens);
      if (!Number.isSafeInteger(tokens) || tokens < 0) {
        throw new RangeError(
          "Recorded task usage exceeds an exact API number.",
        );
      }
      return [row.taskId, tokens] as const;
    }),
  );
  return tasks.map((task) => ({
    ...task,
    tokensUsed: Math.max(task.tokensUsed, totals.get(task.id) ?? 0),
  }));
}

export async function withRecordedSingleTaskUsage<
  T extends { id: number; tokensUsed: number },
>(task: T): Promise<T> {
  return (await withRecordedTaskUsage([task]))[0]!;
}
