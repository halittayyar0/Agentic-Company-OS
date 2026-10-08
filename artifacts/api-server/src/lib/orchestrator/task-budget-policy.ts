export interface TaskBudgetSnapshot {
  autonomyMode: string;
  stepAttempts: number;
  tokensUsed: number;
  estimatedCostUsd: string | null;
}

export interface TaskBudgetLimits {
  maxSteps: number | null;
  maxTokens: number;
  maxReportedCostUsd: number;
}

/**
 * Returns an operator-visible circuit-breaker reason, never a fabricated
 * completion decision. A hard lifetime step cap is opt-in because step count
 * alone does not mean finite work is done or impossible.
 */
export function taskBudgetBlockReason(
  task: TaskBudgetSnapshot,
  limits: TaskBudgetLimits,
  locale: WorkspaceLocale = "tr",
): string | null {
  if (
    limits.maxSteps !== null &&
    task.autonomyMode !== "continuous" &&
    task.stepAttempts >= limits.maxSteps
  ) {
    return toolMessage(locale, "schedulerStepBudget", {
      used: task.stepAttempts,
      limit: limits.maxSteps,
    });
  }
  if (
    task.autonomyMode !== "continuous" &&
    task.tokensUsed >= limits.maxTokens
  ) {
    return toolMessage(locale, "schedulerTokenBudget", {
      used: task.tokensUsed,
      limit: limits.maxTokens,
    });
  }
  if (
    task.autonomyMode !== "continuous" &&
    Number(task.estimatedCostUsd ?? "0") >= limits.maxReportedCostUsd
  ) {
    return toolMessage(locale, "schedulerCostBudget", {
      used: task.estimatedCostUsd ?? "0",
      limit: limits.maxReportedCostUsd,
    });
  }
  return null;
}
import type { WorkspaceLocale } from "../workspace-locale";
import { toolMessage } from "./tool-localization";
import type { TokenUsageCoverage } from "../usage-coverage";

/** Missing receipts are not a zero balance. Keep the evidence and stop before
 * the next call; a missing dollar price alone does not invalidate token usage. */
export function unreportedTokenUsageBlockReason(
  coverage: TokenUsageCoverage,
  locale: WorkspaceLocale,
): string | null {
  return coverage === "unknown" || coverage === "partial"
    ? toolMessage(locale, "schedulerUnreportedTokenUsage")
    : null;
}
