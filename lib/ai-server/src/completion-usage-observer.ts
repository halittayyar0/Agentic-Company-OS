import type OpenAI from "openai";
import type { ModelProvider } from "./openrouter";
import type {
  UnifiedChatCompletionParams,
  UnifiedCompletion,
} from "./openrouter";
export interface ResponseUsageEvidence {
  provider: ModelProvider;
  model: string;
  responseId: string;
  usage: OpenAI.Completions.CompletionUsage & { cost?: unknown };
}
export async function observeCompletionResponseUsage(
  params: UnifiedChatCompletionParams,
  completion: UnifiedCompletion,
  provider: ModelProvider,
): Promise<void> {
  const usage = completion.usage;
  if (
    !params.onResponseUsage ||
    !usage ||
    ![usage.prompt_tokens, usage.completion_tokens, usage.total_tokens].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    usage.total_tokens < usage.prompt_tokens + usage.completion_tokens
  )
    return;
  // Copy primitive evidence before awaiting host persistence; no output or
  // provider-specific usage detail can enter the host's immutable journal.
  await params.onResponseUsage({
    provider,
    model: params.model,
    responseId: completion.id,
    usage: {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      cost: (usage as typeof usage & { cost?: unknown }).cost,
    },
  });
}
