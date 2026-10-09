import assert from "node:assert/strict";
import test from "node:test";
import {
  configureChatGPTPlan,
  configureDirectOpenAI,
  configureOllama,
  configureOpenRouter,
  fetchLiveOpenRouterCatalog,
  getFullModelCatalog,
  normalizeOpenRouterModels,
  refreshOllamaCatalog,
  refreshChatGPTPlanCatalog,
  resolveModelProvider,
} from "@workspace/ai-server";
import {
  ModelProviderSetupRequiredError,
  selectModel,
  selectModelPlan,
} from "./model-select";

const original = {
  key: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseUrl: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  openRouterKey: process.env.OPENROUTER_API_KEY,
  openAIKey: process.env.OPENAI_API_KEY,
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
};

test("a selected ChatGPT plan remains an explicit billing boundary even when disconnected", () => {
  configureDirectOpenAI({ apiKey: "fixture-paid-api" });
  const selected = selectModel({
    purpose: "execution_step",
    agentDepth: 1,
    agent: { modelMode: "manual", modelId: "chatgpt:gpt-fixture" },
  });
  assert.deepEqual(selected, {
    modelId: "chatgpt:gpt-fixture",
    provider: "chatgpt",
    usedFallback: false,
  });
  const plan = selectModelPlan({
    purpose: "execution_step",
    agentDepth: 1,
    agent: { modelMode: "manual", modelId: "chatgpt:gpt-fixture" },
  });
  assert.deepEqual(
    plan.routes.map((candidate) => candidate.provider),
    ["chatgpt"],
  );
  assert.equal(plan.freeOnly, false);
});

test("an installation with only an eligible ChatGPT account can select its first server-ordered model", async () => {
  configureChatGPTPlan({
    resolveAccount: async () => ({
      id: "c1c94b4d-7ce4-4e95-a0d8-ea289080b445",
      hostId: "urn:uuid:712b4d81-573e-47fc-8e03-66c44670b2a1",
      clientId: "fixture-client",
      accountId: "fixture-profile",
      subject: "fixture-subject",
      revision: 1,
      updatedAt: 1,
      credentials: {
        accessToken: "fixture-plan-token",
        idToken: "fixture-id",
        grants: ["resource.invoke", "chatgpt.tokens.use.direct"],
        expiresAt: Date.now() + 3600_000,
      },
    }),
    fetch: async () =>
      Response.json({
        models: [
          {
            slug: "gpt-first-fixture",
            display_name: "First",
            visibility: "list",
          },
          {
            slug: "gpt-next-fixture",
            display_name: "Next",
            visibility: "list",
          },
        ],
      }),
  });
  await refreshChatGPTPlanCatalog();
  const plan = selectModelPlan({
    purpose: "execution_step",
    agentDepth: 1,
    agent: { modelMode: "auto", modelId: null },
  });
  assert.equal(plan.primary.modelId, "chatgpt:gpt-first-fixture");
  assert.equal(plan.primary.provider, "chatgpt");
  assert.equal(plan.routes.length, 1);
});

test.beforeEach(() => {
  configureChatGPTPlan(null);
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OLLAMA_BASE_URL;
  configureOpenRouter({ apiKey: null });
  configureDirectOpenAI({ apiKey: null });
  configureOllama({ baseUrl: null });
});

test.after(() => {
  configureChatGPTPlan(null);
  if (original.key === undefined)
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = original.key;
  if (original.baseUrl === undefined)
    delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = original.baseUrl;
  if (original.openRouterKey === undefined)
    delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = original.openRouterKey;
  if (original.openAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = original.openAIKey;
  if (original.ollamaBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = original.ollamaBaseUrl;
  configureOpenRouter({ apiKey: null });
  configureDirectOpenAI({ apiKey: null });
  configureOllama({ baseUrl: null });
});

test("auto routing uses the Replit fleet when it is configured", () => {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  configureOpenRouter({ apiKey: null });
  const selected = selectModel({
    purpose: "chat",
    agentDepth: 1,
    agent: { modelMode: "auto", modelId: null },
  });
  assert.equal(selected.provider, "replit");
  assert.equal(selected.modelId, "gpt-5.6-terra");
});

test("auto routing works on an OpenRouter-only self-host", () => {
  configureOpenRouter({ apiKey: "test-openrouter-key" });
  const selected = selectModel({
    purpose: "execution_step",
    agentDepth: 2,
    agent: { modelMode: "auto", modelId: null },
  });
  assert.equal(selected.provider, "openrouter");
  assert.equal(selected.modelId, "anthropic/claude-haiku-4.5");
});

test("auto routing works on a direct OpenAI-only self-host", () => {
  configureDirectOpenAI({ apiKey: "test-openai-key" });
  const selected = selectModel({
    purpose: "planning",
    agentDepth: 1,
    agent: { modelMode: "auto", modelId: null },
  });
  assert.equal(selected.provider, "openai");
  assert.equal(selected.modelId, "openai:gpt-5.6-terra");
});

test("an explicit local Ollama pin never leaves the private provider", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const request =
      input instanceof Request
        ? input
        : new Request(input, init as RequestInit);
    const path = new URL(request.url).pathname;
    if (path === "/api/tags") {
      return new Response(
        JSON.stringify({
          models: [{ model: "local-tools:8b", name: "local-tools:8b" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        capabilities: ["completion", "tools"],
        details: { parameter_size: "8B" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  configureOpenRouter({ apiKey: "test-openrouter-key" });
  configureOllama({ baseUrl: "http://127.0.0.1:11434" });
  try {
    await refreshOllamaCatalog(true);
    const plan = selectModelPlan({
      purpose: "execution_step",
      agentDepth: 1,
      agent: { modelMode: "manual", modelId: "ollama:local-tools:8b" },
      maxRoutes: 4,
    });
    assert.equal(plan.primary.provider, "ollama");
    assert.equal(plan.freeOnly, true);
    assert.ok(plan.routes.every((route) => route.provider === "ollama"));
  } finally {
    globalThis.fetch = originalFetch;
    configureOllama({ baseUrl: null });
    configureOpenRouter({ apiKey: null });
  }
});

test("MiniMax M3 Free is a valid manual OpenRouter selection", () => {
  configureOpenRouter({ apiKey: "test-openrouter-key" });
  const selected = selectModel({
    purpose: "execution_step",
    agentDepth: 0,
    agent: {
      modelMode: "manual",
      modelId: "minimax/minimax-m3:free",
    },
  });
  assert.equal(selected.provider, "openrouter");
  assert.equal(selected.modelId, "minimax/minimax-m3:free");
  assert.equal(selected.usedFallback, false);
});

test("a persisted task pin wins over later agent defaults without paid fallback", () => {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  configureOpenRouter({ apiKey: "test-openrouter-key" });
  const plan = selectModelPlan({
    purpose: "execution_step",
    agentDepth: 0,
    agent: { modelMode: "manual", modelId: "gpt-5.6-sol" },
    taskExecutionModelId: "minimax/minimax-m3:free",
    maxRoutes: 4,
  });

  assert.equal(plan.primary.modelId, "minimax/minimax-m3:free");
  assert.equal(plan.primary.source, "task_pin");
  assert.equal(plan.freeOnly, true);
  assert.ok(plan.routes.length >= 1 && plan.routes.length <= 4);
  assert.ok(plan.routes.every((route) => route.modelId.endsWith(":free")));
  assert.ok(!plan.routes.some((route) => route.modelId === "gpt-5.6-sol"));
});

test("an explicit automatic override is not mislabeled as a coincident task pin", () => {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  const plan = selectModelPlan({
    purpose: "execution_step",
    agentDepth: 2,
    agent: { modelMode: "manual", modelId: "gpt-5.6-luna" },
    taskExecutionModelId: "gpt-5.6-luna",
    override: { modelMode: "auto" },
    maxRoutes: 1,
  });

  assert.equal(plan.primary.modelId, "gpt-5.6-luna");
  assert.equal(plan.primary.source, "automatic");
});

test("an unavailable free task pin fails in place instead of drifting to paid inference", () => {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  configureOpenRouter({ apiKey: null });
  const plan = selectModelPlan({
    purpose: "execution_step",
    agentDepth: 0,
    agent: { modelMode: "manual", modelId: "gpt-5.6-sol" },
    taskExecutionModelId: "minimax/minimax-m3:free",
    maxRoutes: 4,
  });

  assert.equal(plan.primary.modelId, "minimax/minimax-m3:free");
  assert.equal(plan.primary.provider, "openrouter");
  assert.equal(plan.freeOnly, true);
  assert.deepEqual(
    plan.routes.map((route) => route.modelId),
    ["minimax/minimax-m3:free"],
  );
});

test("automatic route plans are bounded and never escalate model tier", () => {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  configureOpenRouter({ apiKey: "test-openrouter-key" });
  const plan = selectModelPlan({
    purpose: "execution_step",
    agentDepth: 2,
    complexityHint: "normal",
    agent: { modelMode: "auto", modelId: null },
    maxRoutes: 3,
  });

  assert.equal(plan.primary.modelId, "gpt-5.6-luna");
  assert.equal(plan.routes[0], plan.primary);
  assert.ok(plan.routes.length <= 3);
  assert.ok(plan.routes.every((route) => route.tier === "economy"));
  assert.equal(
    new Set(plan.routes.map((route) => route.modelId)).size,
    plan.routes.length,
  );
});

test("bounded automatic plans include a genuinely independent provider", () => {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  configureOpenRouter({ apiKey: "test-openrouter-key" });
  const plan = selectModelPlan({
    purpose: "execution_step",
    agentDepth: 2,
    agent: {
      modelMode: "manual",
      modelId: "anthropic/claude-haiku-4.5",
    },
    maxRoutes: 3,
  });

  assert.equal(plan.primary.provider, "openrouter");
  assert.ok(plan.routes.some((route) => route.provider === "replit"));
  assert.ok(plan.routes.every((route) => route.tier === "economy"));
});

test("live catalog keeps free/thinking/batch variants and coalesces refreshes", async () => {
  const originalFetch = globalThis.fetch;
  const requestedOffsets: number[] = [];
  let authorizationHeaders = 0;

  globalThis.fetch = (async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input));
    requestedOffsets.push(Number(url.searchParams.get("offset") ?? "0"));
    const headers = new Headers(init?.headers);
    if (headers.has("Authorization")) authorizationHeaders += 1;

    const offset = Number(url.searchParams.get("offset") ?? "0");
    const data =
      offset === 0
        ? [
            {
              id: "minimax/minimax-m3:free",
              name: "MiniMax: MiniMax M3 (free)",
              description: "Agentic coding and tool use.",
              context_length: 1_048_576,
              pricing: { prompt: "0", completion: "0" },
              supported_parameters: ["tools", "tool_choice"],
            },
            {
              id: "minimax/minimax-m3:batch",
              name: "MiniMax: MiniMax M3 (batch)",
              pricing: { prompt: "0.0000003", completion: "0.0000012" },
            },
          ]
        : [
            {
              id: "example/reasoner:thinking",
              name: "Example: Reasoner (thinking)",
              pricing: { prompt: "0.000002", completion: "0.000004" },
              supported_parameters: ["tools"],
            },
            {
              id: "example/no-tools:free",
              name: "Example: No Tools Free",
              pricing: { prompt: "0", completion: "0" },
              supported_parameters: [],
            },
          ];
    return new Response(JSON.stringify({ data, total_count: 4 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    configureOpenRouter({ apiKey: "catalog-key-must-not-be-sent" });
    const [first, second] = await Promise.all([
      fetchLiveOpenRouterCatalog(true),
      fetchLiveOpenRouterCatalog(true),
    ]);
    assert.deepEqual(requestedOffsets, [0, 2]);
    assert.equal(authorizationHeaders, 0);
    assert.deepEqual(
      first.map((model) => model.id),
      [
        "minimax/minimax-m3:free",
        "minimax/minimax-m3:batch",
        "example/reasoner:thinking",
        "example/no-tools:free",
      ],
    );
    assert.deepEqual(second, first);

    const free = first.find((model) => model.id === "minimax/minimax-m3:free");
    assert.equal(free?.label, "MiniMax M3 (free)");
    assert.equal(free?.tier, "economy");
    assert.equal(free?.supportsTools, true);
    assert.match(free?.description ?? "", /1M bağlam/);
    assert.match(free?.description ?? "", /ücretsiz/);

    configureOpenRouter({ apiKey: null });
    const catalog = getFullModelCatalog();
    assert.equal(
      catalog.providers.find((provider) => provider.id === "openrouter")
        ?.available,
      false,
    );
    assert.ok(
      catalog.models.some((model) => model.id === "minimax/minimax-m3:free"),
    );
    assert.equal(
      first.find((model) => model.id === "minimax/minimax-m3:batch")
        ?.supportsTools,
      false,
    );

    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
    const freeNoToolsSelection = selectModel({
      purpose: "execution_step",
      agentDepth: 0,
      agent: { modelMode: "manual", modelId: "example/no-tools:free" },
    });
    assert.equal(freeNoToolsSelection.modelId, "example/no-tools:free");
    assert.equal(freeNoToolsSelection.provider, "openrouter");
    assert.equal(freeNoToolsSelection.usedFallback, false);

    configureOpenRouter({ apiKey: "test-openrouter-key" });
    const noToolsSelection = selectModel({
      purpose: "execution_step",
      agentDepth: 0,
      agent: {
        modelMode: "manual",
        modelId: "minimax/minimax-m3:batch",
      },
    });
    assert.notEqual(noToolsSelection.modelId, "minimax/minimax-m3:batch");
    // A paid, tool-incompatible pin may fall back to the configured automatic
    // fleet. The stricter fail-in-place rule applies only to explicit :free
    // spend boundaries.
    assert.equal(noToolsSelection.provider, "replit");
    assert.equal(noToolsSelection.usedFallback, true);

    const liveOnlySelection = selectModel({
      purpose: "execution_step",
      agentDepth: 0,
      agent: {
        modelMode: "manual",
        modelId: "example/reasoner:thinking",
      },
    });
    assert.equal(liveOnlySelection.modelId, "example/reasoner:thinking");
    assert.equal(liveOnlySelection.provider, "openrouter");
    assert.equal(liveOnlySelection.usedFallback, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("live catalog rejects spoofed ids and strips invisible display controls", () => {
  const models = normalizeOpenRouterModels([
    {
      id: "minimax/minimax-m3:free\u202e",
      name: "MiniMax M3 Free",
    },
    {
      id: "~minimax/minimax-m3:free",
      name: "MiniMax:\u202e Mini\u200bMax M3 Free",
      description: "Agentic\u2066 coding\u2069 and tool use.",
      pricing: { prompt: "0", completion: "0" },
    },
  ]);

  assert.equal(models.length, 1);
  assert.equal(models[0]?.id, "~minimax/minimax-m3:free");
  assert.equal(models[0]?.label, "MiniMax M3 Free");
  assert.equal(models[0]?.supportsTools, false);
  assert.doesNotMatch(models[0]?.description ?? "", /[\p{Cc}\p{Cf}]/u);
  assert.equal(resolveModelProvider("vendor/new-model:free"), "openrouter");
  assert.equal(resolveModelProvider("vendor/model\u202e"), null);
});

test("unavailable manual provider falls back to the configured provider", () => {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  configureOpenRouter({ apiKey: null });
  const selected = selectModel({
    purpose: "chat",
    agentDepth: 1,
    agent: { modelMode: "manual", modelId: "anthropic/claude-sonnet-4.5" },
  });
  assert.equal(selected.provider, "replit");
  assert.equal(selected.usedFallback, true);
});

test("an unavailable manual free model never drifts to a paid provider", () => {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  configureOpenRouter({ apiKey: null });

  const selected = selectModel({
    purpose: "chat",
    agentDepth: 1,
    agent: { modelMode: "manual", modelId: "minimax/minimax-m3:free" },
  });
  assert.equal(selected.modelId, "minimax/minimax-m3:free");
  assert.equal(selected.provider, "openrouter");
  assert.equal(selected.usedFallback, false);

  const plan = selectModelPlan({
    purpose: "execution_step",
    agentDepth: 1,
    agent: { modelMode: "manual", modelId: "minimax/minimax-m3:free" },
    maxRoutes: 4,
  });
  assert.equal(plan.primary.source, "agent_pin");
  assert.equal(plan.freeOnly, true);
  assert.deepEqual(
    plan.routes.map((route) => route.modelId),
    ["minimax/minimax-m3:free"],
  );
});

test("routing fails explicitly when no provider is configured", () => {
  assert.throws(
    () =>
      selectModel({
        purpose: "chat",
        agentDepth: 1,
        agent: { modelMode: "auto", modelId: null },
      }),
    (error) =>
      error instanceof ModelProviderSetupRequiredError &&
      error.code === "MODEL_PROVIDER_SETUP_REQUIRED",
  );
});
