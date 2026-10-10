/**
 * Model routing for the agent organization.
 *
 * Automatic mode picks a model tier from the OpenAI fleet (served through
 * Replit's AI Integrations proxy) based on what kind of work is happening:
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
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: "gpt-5.6-luna",
    tier: "economy",
    label: "Luna",
    supportsTools: true,
    description:
      "Hizli ve ekonomik. Rutin arka plan adimlari ve denetim (judge) kontrolleri icin varsayilan.",
  },
  {
    id: "gpt-5.6-terra",
    tier: "standard",
    label: "Terra",
    supportsTools: true,
    description:
      "Guclu genel amacli model. Sohbet, planlama ve gorev bolme icin varsayilan.",
  },
  {
    id: "gpt-5.6-sol",
    tier: "premium",
    label: "Sol",
    supportsTools: true,
    description:
      "En yetenekli model. Kritik, belirsiz veya yuksek riskli stratejik kararlar icin.",
  },
  {
    id: "o4-mini",
    tier: "reasoning",
    label: "o4-mini",
    supportsTools: true,
    description:
      "Derin, cok adimli akil yurutme gerektiren analiz gorevleri icin.",
  },
];

export const DEFAULT_MODEL_ID = "gpt-5.6-terra";
export const DEFAULT_MAX_COMPLETION_TOKENS = 2048;

export function isKnownModelId(modelId: string): boolean {
  return MODEL_CATALOG.some((m) => m.id === modelId);
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

/**
 * Chooses which model to call for a given piece of work.
 *
 * - Manual override always wins when the agent has one configured.
 * - Judge (compliance) checks always use the cheapest tier -- they run
 *   frequently and are a classification-style task, not open creative work.
 * - Routine autonomous execution steps default to the cheap tier unless the
 *   caller signals the step is unusually complex.
 * - Chat/planning defaults to the standard tier; the CEO (depth 0) escalates
 *   to the premium tier when the caller signals high complexity/ambiguity.
 */
export function chooseModel(params: {
  purpose: ModelPurpose;
  agentDepth: number;
  modelMode: "auto" | "manual";
  modelId?: string | null;
  complexityHint?: ComplexityHint;
}): string {
  const {
    purpose,
    agentDepth,
    modelMode,
    modelId,
    complexityHint = "normal",
  } = params;

  if (modelMode === "manual" && modelId && isKnownModelId(modelId)) {
    return modelId;
  }

  if (purpose === "judge") {
    return "gpt-5.6-luna";
  }

  if (purpose === "execution_step") {
    return complexityHint === "high" ? "gpt-5.6-terra" : "gpt-5.6-luna";
  }

  // chat + planning
  if (complexityHint === "low") {
    return "gpt-5.6-luna";
  }
  if (agentDepth === 0 && complexityHint === "high") {
    return "gpt-5.6-sol";
  }
  return "gpt-5.6-terra";
}
