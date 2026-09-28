import type OpenAI from "openai";
import { db, usageEventsTable } from "@workspace/db";
import { logger } from "../logger";

export type UsageKind = "chat" | "task_step" | "judge";

export interface RecordedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reportedCostUsd: number | null;
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
export async function recordCompletionUsage(params: {
  completion: OpenAI.Chat.Completions.ChatCompletion;
  provider: string;
  modelId: string;
  agentId: number;
  taskId: number | null;
  kind: UsageKind;
}): Promise<RecordedUsage> {
  const usage = params.completion.usage as
    (OpenAI.Completions.CompletionUsage & { cost?: unknown }) | undefined;
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

  const normalized = {
    promptTokens,
    completionTokens,
    totalTokens,
    reportedCostUsd,
  };

  await db
    .insert(usageEventsTable)
    .values({
      agentId: params.agentId,
      taskId: params.taskId,
      kind: params.kind,
      modelId: params.modelId,
      provider: params.provider,
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
