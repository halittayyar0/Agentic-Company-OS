import { and, eq, gte, sql } from "drizzle-orm";
import {
  db,
  taskAttemptsTable,
  tasksTable,
  usageEventsTable,
  type Task,
} from "@workspace/db";
import {
  taskBudgetBlockReason,
  unreportedTokenUsageBlockReason,
  type TaskBudgetLimits,
} from "./task-budget-policy";
import type { WorkspaceLocale } from "../workspace-locale";
import {
  readFamilySpendAdmission,
  type SpendReaderClient,
} from "./family-spend-admission";
import { ModelAdmissionDeniedError } from "./model-fallback";
import { tokenUsageEvidence } from "../usage-coverage";

export class TaskSpendBudgetError extends ModelAdmissionDeniedError {}

export async function assertTaskInferenceAdmission(
  taskId: number,
  locale: WorkspaceLocale,
) {
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId));
  if (!task) throw new Error("Task no longer exists");
  const reason = await readTaskSpendBlockReason(
    task,
    { ...executionSpendLimits(), maxSteps: null },
    locale,
  );
  if (reason) throw new TaskSpendBudgetError(reason);
}

function costEvidence(
  cost: string | null | undefined,
  rows: string | undefined,
  unknown: string | undefined,
  materialized?: string | null,
) {
  const count = Number(rows ?? 0),
    missing = Number(unknown ?? 0);
  const legacy = Number(materialized ?? 0);
  const amount =
    cost == null
      ? legacy > 0
        ? materialized!
        : null
      : Number(cost) >= legacy
        ? cost
        : materialized!;
  return {
    reportedCostUsd: amount,
    costCoverage:
      count === 0
        ? amount === null
          ? "no_usage"
          : "partial"
        : missing === 0
          ? "complete"
          : amount === null
            ? "unknown"
            : "partial",
  };
}

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
export async function readIndividualTaskSpendAdmission(
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
  client: SpendReaderClient = db,
) {
  const recurring = task.autonomyMode === "continuous";
  const cycleStart = task.lastCycleCompletedAt ?? task.createdAt;
  const dayStart = new Date(now.getTime() - 86_400_000);
  const [usage] = await client
    .select({
      tokens: sql<string>`coalesce(sum(case when ${usageEventsTable.createdAt} >= ${cycleStart} then ${usageEventsTable.totalTokens} else 0 end), 0)`,
      cost: sql<
        string | null
      >`sum(${usageEventsTable.reportedCostUsd}) filter (where ${usageEventsTable.createdAt} >= ${cycleStart})`,
      rows: sql<string>`count(*) filter (where ${usageEventsTable.createdAt} >= ${cycleStart})`,
      tokenReported: sql<string>`count(*) filter (where ${usageEventsTable.createdAt} >= ${cycleStart} and ${usageEventsTable.usageReported} is true)`,
      unknown: sql<string>`count(*) filter (where ${usageEventsTable.createdAt} >= ${cycleStart} and ${usageEventsTable.reportedCostUsd} is null)`,
      allTokens: sql<string>`coalesce(sum(${usageEventsTable.totalTokens}), 0)`,
      allCost: sql<string | null>`sum(${usageEventsTable.reportedCostUsd})`,
      allRows: sql<string>`count(*)`,
      allTokenReported: sql<string>`count(*) filter (where ${usageEventsTable.usageReported} is true)`,
      allUnknown: sql<string>`count(*) filter (where ${usageEventsTable.reportedCostUsd} is null)`,
      dayTokens: sql<string>`coalesce(sum(case when ${usageEventsTable.createdAt} >= ${dayStart} then ${usageEventsTable.totalTokens} else 0 end), 0)`,
      dayCost: sql<
        string | null
      >`sum(${usageEventsTable.reportedCostUsd}) filter (where ${usageEventsTable.createdAt} >= ${dayStart})`,
      dayRows: sql<string>`count(*) filter (where ${usageEventsTable.createdAt} >= ${dayStart})`,
      dayTokenReported: sql<string>`count(*) filter (where ${usageEventsTable.createdAt} >= ${dayStart} and ${usageEventsTable.usageReported} is true)`,
      dayUnknown: sql<string>`count(*) filter (where ${usageEventsTable.createdAt} >= ${dayStart} and ${usageEventsTable.reportedCostUsd} is null)`,
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
  const cycleCost = recurring
    ? costEvidence(usage?.cost, usage?.rows, usage?.unknown)
    : costEvidence(
        usage?.allCost,
        usage?.allRows,
        usage?.allUnknown,
        task.estimatedCostUsd,
      );
  const [{ setupRetries }] =
    !recurring && limits.maxSteps !== null
      ? await client
          .select({ setupRetries: sql<number>`count(*)::int` })
          .from(taskAttemptsTable)
          .where(
            and(
              eq(taskAttemptsTable.taskId, task.id),
              eq(taskAttemptsTable.failureKind, "provider_setup_required"),
              eq(taskAttemptsTable.state, "retrying"),
            ),
          )
      : [{ setupRetries: 0 }];
  const snapshot = {
    autonomyMode: "finite",
    stepAttempts: recurring ? 0 : Math.max(0, task.stepAttempts - setupRetries),
    tokensUsed: recurring
      ? Number(usage?.tokens ?? 0)
      : Math.max(task.tokensUsed, Number(usage?.allTokens ?? 0)),
    estimatedCostUsd: cycleCost.reportedCostUsd,
  };
  const cycleTokenEvidence = tokenUsageEvidence(
    recurring ? usage?.rows : usage?.allRows,
    recurring ? usage?.tokenReported : usage?.allTokenReported,
    !recurring && task.tokensUsed > Number(usage?.allTokens ?? 0),
  );
  const cycleReason =
    taskBudgetBlockReason(
      snapshot,
      { ...limits, maxSteps: recurring ? null : limits.maxSteps },
      locale,
    ) ??
    unreportedTokenUsageBlockReason(
      cycleTokenEvidence.tokenUsageCoverage,
      locale,
    );
  if (cycleReason || !recurring)
    return {
      reason: cycleReason,
      tokensUsed: snapshot.tokensUsed,
      ...cycleCost,
      ...cycleTokenEvidence,
      usageSource: recurring
        ? "current_cycle_usage_ledger"
        : "max(task_aggregate,usage_events_ledger)",
    };
  const dailyCost = costEvidence(
    usage?.dayCost,
    usage?.dayRows,
    usage?.dayUnknown,
  );
  const daily = {
    ...snapshot,
    tokensUsed: Number(usage?.dayTokens ?? 0),
    estimatedCostUsd: dailyCost.reportedCostUsd,
  };
  const dailyTokenEvidence = tokenUsageEvidence(
    usage?.dayRows,
    usage?.dayTokenReported,
  );
  const reason =
    taskBudgetBlockReason(
      daily,
      {
        maxSteps: null,
        maxTokens: Math.floor(positive("MAX_RECURRING_DAILY_TOKENS", 250_000)),
        maxReportedCostUsd: positive(
          "MAX_RECURRING_DAILY_REPORTED_COST_USD",
          5,
        ),
      },
      locale,
    ) ??
    unreportedTokenUsageBlockReason(
      dailyTokenEvidence.tokenUsageCoverage,
      locale,
    );
  return {
    reason,
    tokensUsed: daily.tokensUsed,
    ...dailyCost,
    ...dailyTokenEvidence,
    usageSource: "rolling_24h_usage_ledger",
  };
}

export async function readTaskSpendAdmission(
  ...args: Parameters<typeof readIndividualTaskSpendAdmission>
) {
  const individual = await readIndividualTaskSpendAdmission(...args);
  if (individual.reason)
    return { ...individual, budgetScope: "task", rootTaskId: null };
  const family = await readFamilySpendAdmission(
    args[0].id,
    args[2] ?? "tr",
    args[3],
    args[4],
  );
  return family.reason
    ? { ...family, budgetScope: "family" }
    : { ...individual, budgetScope: "task", rootTaskId: family.rootTaskId };
}

export async function readTaskSpendBlockReason(
  ...args: Parameters<typeof readTaskSpendAdmission>
): Promise<string | null> {
  return (await readTaskSpendAdmission(...args)).reason;
}
