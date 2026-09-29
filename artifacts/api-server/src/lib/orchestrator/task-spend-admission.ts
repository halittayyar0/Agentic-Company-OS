import { and, eq, gte, sql } from "drizzle-orm";
import { db, usageEventsTable, type Task } from "@workspace/db";
import {
  taskBudgetBlockReason,
  type TaskBudgetLimits,
} from "./task-budget-policy";
import type { WorkspaceLocale } from "../workspace-locale";

export class TaskSpendBudgetError extends Error {}

function positive(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function executionSpendLimits(): TaskBudgetLimits {
  const steps = Number(process.env.MAX_TASK_STEPS);
  return {
    maxSteps: Number.isSafeInteger(steps) && steps > 0 ? steps : null,
    maxTokens: Math.floor(positive("MAX_TASK_TOKENS", 100_000)),
    maxReportedCostUsd: positive("MAX_TASK_REPORTED_COST_USD", 1),
  };
}

/** Admission uses durable provider receipts, including judge calls. Continuous
 * counters span the installation's lifetime and must not stand in for a cycle.
 * This is a reported-usage breaker, not a provider-side hard spending cap. */
export async function readTaskSpendAdmission(
  task: Pick<
    Task,
    | "id"
    | "autonomyMode"
    | "tokensUsed"
    | "estimatedCostUsd"
    | "stepAttempts"
    | "lastCycleCompletedAt"
    | "createdAt"
  >,
  limits: TaskBudgetLimits = executionSpendLimits(),
  locale: WorkspaceLocale = "tr",
  now = new Date(),
) {
  const recurring = task.autonomyMode === "continuous";
  const cycleStart = task.lastCycleCompletedAt ?? task.createdAt;
  const dayStart = new Date(now.getTime() - 86_400_000);
  const [usage] = await db
    .select({
      tokens: sql<string>`coalesce(sum(case when ${usageEventsTable.createdAt} >= ${cycleStart} then ${usageEventsTable.totalTokens} else 0 end), 0)`,
      cost: sql<string>`coalesce(sum(case when ${usageEventsTable.createdAt} >= ${cycleStart} then ${usageEventsTable.reportedCostUsd} else 0 end), 0)`,
      allTokens: sql<string>`coalesce(sum(${usageEventsTable.totalTokens}), 0)`,
      allCost: sql<string>`coalesce(sum(${usageEventsTable.reportedCostUsd}), 0)`,
      dayTokens: sql<string>`coalesce(sum(case when ${usageEventsTable.createdAt} >= ${dayStart} then ${usageEventsTable.totalTokens} else 0 end), 0)`,
      dayCost: sql<string>`coalesce(sum(case when ${usageEventsTable.createdAt} >= ${dayStart} then ${usageEventsTable.reportedCostUsd} else 0 end), 0)`,
    })
    .from(usageEventsTable)
    .where(
      and(
        eq(usageEventsTable.taskId, task.id),
        recurring
          ? gte(
              usageEventsTable.createdAt,
              new Date(Math.min(cycleStart.getTime(), dayStart.getTime())),
            )
          : undefined,
      ),
    );
  const snapshot = {
    autonomyMode: "finite",
    stepAttempts: recurring ? 0 : task.stepAttempts,
    tokensUsed: recurring
      ? Number(usage?.tokens ?? 0)
      : Math.max(task.tokensUsed, Number(usage?.allTokens ?? 0)),
    estimatedCostUsd: String(
      recurring
        ? Number(usage?.cost ?? 0)
        : Math.max(
            Number(task.estimatedCostUsd ?? 0),
            Number(usage?.allCost ?? 0),
          ),
    ),
  };
  const cycleReason = taskBudgetBlockReason(
    snapshot,
    { ...limits, maxSteps: recurring ? null : limits.maxSteps },
    locale,
  );
  if (cycleReason || !recurring)
    return {
      reason: cycleReason,
      tokensUsed: snapshot.tokensUsed,
      reportedCostUsd: snapshot.estimatedCostUsd,
      usageSource: recurring
        ? "current_cycle_usage_ledger"
        : "max(task_aggregate,usage_events_ledger)",
    };
  const daily = {
    ...snapshot,
    tokensUsed: Number(usage?.dayTokens ?? 0),
    estimatedCostUsd: String(usage?.dayCost ?? 0),
  };
  const reason = taskBudgetBlockReason(
    daily,
    {
      maxSteps: null,
      maxTokens: Math.floor(positive("MAX_RECURRING_DAILY_TOKENS", 250_000)),
      maxReportedCostUsd: positive("MAX_RECURRING_DAILY_REPORTED_COST_USD", 5),
    },
    locale,
  );
  return {
    reason,
    tokensUsed: daily.tokensUsed,
    reportedCostUsd: daily.estimatedCostUsd,
    usageSource: "rolling_24h_usage_ledger",
  };
}

export async function readTaskSpendBlockReason(
  ...args: Parameters<typeof readTaskSpendAdmission>
): Promise<string | null> {
  return (await readTaskSpendAdmission(...args)).reason;
}
