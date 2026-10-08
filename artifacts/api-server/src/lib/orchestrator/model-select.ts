import {
  chooseModel,
  getFullModelCatalog,
  isDirectOpenAIConfigured,
  isChatGPTPlanConfigured,
  isOllamaConfigured,
  isOpenRouterConfigured,
  MODEL_CATALOG,
  resolveModelProvider,
  type ComplexityHint,
  type ModelPurpose,
  type ModelTier,
} from "@workspace/ai-server";

/**
 * Runtime model selection.
 *
 * Priority order:
 *   1. explicit per-request override (UI "chat-time" model switch)
 *   2. agent's saved manual pin (modelMode === "manual")
 *   3. automatic routing by purpose/depth/complexity (Replit fleet)
 *
 * A ChatGPT or local pin preserves its billing boundary even when unavailable.
 * Other manual picks keep the existing automatic recovery policy.
 */

export interface ModelOverrideInput {
  modelMode?: "auto" | "manual" | null | undefined;
  modelId?: string | null | undefined;
}

export interface ModelSelectionResult {
  modelId: string;
  provider: string | null;
  usedFallback: boolean;
}

export type ModelRouteSource =
  "request_pin" | "task_pin" | "agent_pin" | "automatic" | "fallback";

export interface ModelRouteCandidate extends ModelSelectionResult {
  provider: string;
  source: ModelRouteSource;
  tier: ModelTier;
}

export interface ModelSelectionPlan {
  primary: ModelRouteCandidate;
  routes: ModelRouteCandidate[];
  freeOnly: boolean;
}

export class ModelProviderSetupRequiredError extends Error {
  readonly code = "MODEL_PROVIDER_SETUP_REQUIRED";

  constructor() {
    super(
      "No model provider is configured with a tool-capable model. Set OPENROUTER_API_KEY, OPENAI_API_KEY, OLLAMA_BASE_URL with a tool-capable local model, or both AI_INTEGRATIONS_OPENAI_* variables.",
    );
    this.name = "ModelProviderSetupRequiredError";
  }
}

function providerAvailable(provider: string): boolean {
  if (provider === "replit") {
    return Boolean(
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY &&
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    );
  }
  if (provider === "openrouter") return isOpenRouterConfigured();
  if (provider === "openai") return isDirectOpenAIConfigured();
  if (provider === "ollama") return isOllamaConfigured();
  if (provider === "chatgpt") return isChatGPTPlanConfigured();
  return false;
}

export function selectModel(params: {
  purpose: ModelPurpose;
  agentDepth: number;
  complexityHint?: ComplexityHint;
  agent: { modelMode: string; modelId: string | null };
  override?: ModelOverrideInput | undefined;
}): ModelSelectionResult {
  const {
    purpose,
    agentDepth,
    complexityHint = "normal",
    agent,
    override,
  } = params;

  const manualCandidates: string[] = [];
  let manualFallback = false;
  if (override?.modelMode === "manual" && override.modelId) {
    manualCandidates.push(override.modelId);
  }
  if (
    override?.modelMode !== "auto" &&
    agent.modelMode === "manual" &&
    agent.modelId
  ) {
    manualCandidates.push(agent.modelId);
  }

  for (const candidate of manualCandidates) {
    const catalogModel = getFullModelCatalog().models.find(
      (model) => model.id === candidate,
    );
    const provider = catalogModel?.provider ?? resolveModelProvider(candidate);
    const toolCompatible = catalogModel?.supportsTools !== false;
    if (provider === "chatgpt") {
      // A disconnected plan is a connection problem, not permission to bill an API.
      return { modelId: candidate, provider, usedFallback: false };
    }
    if (provider && isFreeModel(candidate, provider)) {
      // Free is an explicit spend boundary even when live metadata says the
      // model lacks tools. Keep the free route and let bounded compatibility
      // handling fail visibly; never reinterpret incompatibility as consent
      // to use a paid automatic model.
      return { modelId: candidate, provider, usedFallback: false };
    }
    if (
      provider &&
      providerAvailable(provider) &&
      // A live-catalog row that explicitly says "no tools" is incompatible.
      // A forward-compatible OpenRouter id may not be cached yet; try it once
      // and let the bounded runtime fallback handle a provider-declared
      // incompatibility instead of rejecting every newly published model.
      toolCompatible
    ) {
      return { modelId: candidate, provider, usedFallback: false };
    }
    manualFallback = true;
  }

  const autoModel = chooseModel({
    purpose,
    agentDepth,
    modelMode: "auto",
    complexityHint,
  });
  if (providerAvailable("replit")) {
    return {
      modelId: autoModel,
      provider: "replit",
      usedFallback: manualFallback,
    };
  }

  if (providerAvailable("openrouter")) {
    const tier =
      MODEL_CATALOG.find((entry) => entry.id === autoModel)?.tier ?? "standard";
    const openRouterByTier = {
      economy: "anthropic/claude-haiku-4.5",
      standard: "google/gemini-2.5-flash",
      premium: "anthropic/claude-sonnet-4.5",
      reasoning: "deepseek/deepseek-r1",
    } as const;
    return {
      modelId: openRouterByTier[tier],
      provider: "openrouter",
      usedFallback: manualFallback,
    };
  }

  if (providerAvailable("openai")) {
    return {
      modelId: `openai:${autoModel}`,
      provider: "openai",
      usedFallback: manualFallback,
    };
  }

  if (providerAvailable("ollama")) {
    const targetTier =
      MODEL_CATALOG.find((entry) => entry.id === autoModel)?.tier ?? "standard";
    const localModel = getFullModelCatalog()
      .models.filter(
        (model) => model.provider === "ollama" && model.supportsTools,
      )
      .sort((left, right) => {
        const tierDelta =
          Math.abs(TIER_RANK[left.tier] - TIER_RANK[targetTier]) -
          Math.abs(TIER_RANK[right.tier] - TIER_RANK[targetTier]);
        return tierDelta || left.label.localeCompare(right.label, "en");
      })[0];
    if (localModel) {
      return {
        modelId: localModel.id,
        provider: "ollama",
        usedFallback: manualFallback,
      };
    }
  }

  if (providerAvailable("chatgpt")) {
    const planModel = getFullModelCatalog().models.find(
      (model) => model.provider === "chatgpt" && model.supportsTools,
    );
    if (planModel)
      return {
        modelId: planModel.id,
        provider: "chatgpt",
        usedFallback: manualFallback,
      };
  }
  throw new ModelProviderSetupRequiredError();
}

const TIER_RANK: Record<ModelTier, number> = {
  economy: 0,
  standard: 1,
  premium: 2,
  reasoning: 3,
};

function fallbackRouteLimit(): number {
  const parsed = Number(process.env.MODEL_FALLBACK_MAX_ROUTES);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(4, Math.floor(parsed)));
}

function isFreeModel(modelId: string, provider?: string | null): boolean {
  return provider === "ollama" || /:free$/iu.test(modelId);
}

/**
 * Produces a bounded, cost-conscious route list for one logical model turn.
 *
 * A task pin is stronger than a later agent-default change, while an explicit
 * request override remains strongest. Fallback never escalates above the
 * primary model's catalog tier. A user-pinned `:free` model is stricter: only
 * other free tool-capable routes may follow it, so resilience cannot silently
 * turn a free unattended responsibility into paid traffic.
 */
export function selectModelPlan(params: {
  purpose: ModelPurpose;
  agentDepth: number;
  complexityHint?: ComplexityHint;
  agent: { modelMode: string; modelId: string | null };
  override?: ModelOverrideInput | undefined;
  taskExecutionModelId?: string | null | undefined;
  maxRoutes?: number | undefined;
}): ModelSelectionPlan {
  const hasRequestOverride =
    params.override?.modelMode === "manual" ||
    params.override?.modelMode === "auto";
  const pinnedTaskProvider =
    !hasRequestOverride && params.taskExecutionModelId
      ? (getFullModelCatalog().models.find(
          (model) => model.id === params.taskExecutionModelId,
        )?.provider ?? resolveModelProvider(params.taskExecutionModelId))
      : null;
  const selected =
    params.taskExecutionModelId && pinnedTaskProvider && !hasRequestOverride
      ? {
          modelId: params.taskExecutionModelId,
          provider: pinnedTaskProvider,
          usedFallback: false,
        }
      : selectModel({
          purpose: params.purpose,
          agentDepth: params.agentDepth,
          complexityHint: params.complexityHint,
          agent: params.agent,
          override: params.override,
        });
  if (!selected.provider) {
    // selectModel currently only returns configured providers, but keeping the
    // guard here prevents a future nullable provider from becoming a route.
    throw new Error(`Selected model ${selected.modelId} has no provider.`);
  }

  const catalog = getFullModelCatalog();
  const selectedEntry = catalog.models.find(
    (model) => model.id === selected.modelId,
  );
  const selectedTier =
    selectedEntry?.tier ??
    MODEL_CATALOG.find((model) => model.id === selected.modelId)?.tier ??
    "standard";
  const source: ModelRouteSource =
    params.override?.modelMode === "manual" &&
    params.override.modelId === selected.modelId
      ? "request_pin"
      : hasRequestOverride
        ? "automatic"
        : params.taskExecutionModelId === selected.modelId
          ? "task_pin"
          : params.agent.modelMode === "manual" &&
              params.agent.modelId === selected.modelId
            ? "agent_pin"
            : "automatic";
  const primary: ModelRouteCandidate = {
    ...selected,
    provider: selected.provider,
    source,
    tier: selectedTier,
  };
  // Plan failures retain their selected account/model. Another model or API is
  // a new user choice, not a transparent replay of potentially consumed usage.
  if (selected.provider === "chatgpt")
    return { primary, routes: [primary], freeOnly: false };
  const freeOnly =
    source !== "automatic" && isFreeModel(selected.modelId, selected.provider);
  const localOnly = source !== "automatic" && selected.provider === "ollama";
  const providerAvailability = new Map(
    catalog.providers.map((provider) => [provider.id, provider.available]),
  );
  const seen = new Set([selected.modelId]);
  const fallbackRows = catalog.models
    .filter(
      (model) =>
        !seen.has(model.id) &&
        model.provider !== "chatgpt" &&
        model.supportsTools &&
        providerAvailability.get(model.provider) === true &&
        TIER_RANK[model.tier] <= TIER_RANK[selectedTier] &&
        (!freeOnly || isFreeModel(model.id, model.provider)) &&
        (!localOnly || model.provider === "ollama"),
    )
    .sort((left, right) => {
      // Put one genuinely independent provider route ahead of same-provider
      // model variants. Otherwise a bounded plan can be filled entirely by an
      // unavailable provider and never reach the configured second provider.
      const providerDelta =
        Number(left.provider === selected.provider) -
        Number(right.provider === selected.provider);
      if (providerDelta !== 0) return providerDelta;
      const tierDelta =
        Math.abs(TIER_RANK[left.tier] - TIER_RANK[selectedTier]) -
        Math.abs(TIER_RANK[right.tier] - TIER_RANK[selectedTier]);
      if (tierDelta !== 0) return tierDelta;
      return left.label.localeCompare(right.label, "en", {
        sensitivity: "base",
        numeric: true,
      });
    });

  const requestedLimit = params.maxRoutes ?? fallbackRouteLimit();
  const routeLimit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(4, Math.floor(requestedLimit)))
    : fallbackRouteLimit();
  const routes = [
    primary,
    ...fallbackRows.map((model): ModelRouteCandidate => ({
      modelId: model.id,
      provider: model.provider,
      usedFallback: true,
      source: "fallback",
      tier: model.tier,
    })),
  ].slice(0, routeLimit);

  return { primary, routes, freeOnly };
}

/** Shared memoized catalog lookup for route handlers. */
export function describeAvailableModels() {
  return getFullModelCatalog();
}
