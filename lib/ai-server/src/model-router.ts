/**
 * Model routing for the agent organization.
 *
 * Automatic mode picks a model tier based on what kind of work is happening:
 * cheap/fast models for high-volume routine steps and judge checks, stronger
 * models for chat, planning, and CEO-level strategic decisions. Any agent can
 * be pinned to a specific model instead (modelMode: "manual").
 */

export type ModelPurpose = "chat" | "planning" | "execution_step" | "judge";
export type ModelTier = "economy" | "standard" | "premium" | "reasoning";
export type ComplexityHint = "low" | "normal" | "high";

export interface ModelCatalogEntry {
  id: string;
  tier: ModelTier;
  label: string;
  description: string;
  supportsTools: boolean;
  executionLocation?: "local" | "cloud" | "unknown";
  runtimeCompatibility?: "compatible" | "update_required" | "unverified";
  requiredOllamaVersion?: string;
}

export const DEFAULT_MAX_COMPLETION_TOKENS = 2048;

// Recognize existing saved pins so they fail closed after provider removal.
export function isRetiredUnprefixedModelId(modelId: string): boolean {
  return ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "o4-mini"].includes(
    modelId,
  );
}

/**
 * Every model in this gpt-5.6 fleet rejects function-tool calls on
 * /v1/chat/completions unless `reasoning_effort` is explicitly set to
 * "none" (confirmed for luna/terra/sol; o4-mini is reasoning-only and
 * treated the same way defensively). Spread the result into the
 * `openai.chat.completions.create()` call whenever tools are attached.
 */
export function getChatCompletionExtraParams(
  _modelId: string,
  hasTools: boolean,
): Record<string, unknown> {
  if (hasTools) {
    return { reasoning_effort: "none" };
  }
  return {};
}

/** Select the least expensive automatic tier appropriate to this kind of work. */
export function chooseModelTier(params: {
  purpose: ModelPurpose;
  agentDepth: number;
  complexityHint?: ComplexityHint;
}): "economy" | "standard" | "premium" {
  const { purpose, agentDepth, complexityHint = "normal" } = params;
  if (purpose === "judge") return "economy";
  if (purpose === "execution_step") {
    return complexityHint === "high" ? "standard" : "economy";
  }
  if (complexityHint === "low") return "economy";
  if (agentDepth === 0 && complexityHint === "high") return "premium";
  return "standard";
}
