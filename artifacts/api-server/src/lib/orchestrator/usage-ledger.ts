import type OpenAI from "openai";
import { PlanInferenceError } from "@workspace/ai-server";
import { db, usageEventsTable } from "@workspace/db";
import { logger } from "../logger";

export type UsageKind = "chat" | "task_step" | "judge";

export interface RecordedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reportedCostUsd: number | null;
  /** False means token counters below are a reported lower bound, not zero usage. */
  usageReported: boolean;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

/**
 * Normalize provider usage and append an immutable event. OpenRouter reports
 * cost directly; for other providers cost stays null instead of inventing a
 * per-token price.
 */
interface UsageContext {
  provider: string;
  modelId: string;
  agentId: number;
  taskId: number | null;
  kind: UsageKind;
}
async function appendUsage(
  params: UsageContext,
  usage: (OpenAI.Completions.CompletionUsage & { cost?: unknown }) | undefined,
  outcome: "completed" | "failed",
  failureKind: string | null,
): Promise<RecordedUsage> {
  const promptTokens = nonNegativeInteger(usage?.prompt_tokens);
  const completionTokens = nonNegativeInteger(usage?.completion_tokens);
  const totalTokens = nonNegativeInteger(
    usage?.total_tokens ?? promptTokens + completionTokens,
  );
  const rawCost = params.provider === "openrouter" ? usage?.cost : null;
  const reportedCostUsd =
    typeof rawCost === "number" && Number.isFinite(rawCost) && rawCost >= 0
      ? rawCost
      : null;
  const usageReported = [
    usage?.prompt_tokens,
    usage?.completion_tokens,
    usage?.total_tokens,
  ].every(
    (value) =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
  );

  const normalized = {
    promptTokens,
    completionTokens,
    totalTokens,
    reportedCostUsd,
    usageReported,
  };

  await db
    .insert(usageEventsTable)
    .values({
      agentId: params.agentId,
      taskId: params.taskId,
      kind: params.kind,
      modelId: params.modelId,
      provider: params.provider,
      usageReported,
      outcome,
      failureKind,
      promptTokens,
      completionTokens,
      totalTokens,
      reportedCostUsd:
        reportedCostUsd === null ? null : reportedCostUsd.toFixed(6),
    })
    .catch((error) => {
      logger.error(
        { error, agentId: params.agentId, taskId: params.taskId },
        "Usage ledger append failed",
      );
    });

  return normalized;
}

export async function recordCompletionUsage(
  params: UsageContext & {
    completion: OpenAI.Chat.Completions.ChatCompletion;
  },
): Promise<RecordedUsage> {
  return appendUsage(params, params.completion.usage, "completed", null);
}

/** Preserve accounting before propagating the exact failed inference outcome.
 * Connection validation and an already-paused plan did not start inference and
 * produce no fabricated receipt. The ordinary successful append stays with the
 * caller, including its existing late-result ownership fence. */
export async function withCompletionFailureAccounting<T>(
  action: () => Promise<T>,
  context: UsageContext,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (
      error instanceof PlanInferenceError &&
      (error.requestStarted || error.usage !== null)
    )
      await appendUsage(
        context,
        error.usage ?? undefined,
        "failed",
        error.kind,
      );
    throw error;
  }
}
