import assert from "node:assert/strict";
import test from "node:test";
import {
  configureDirectOpenAI,
  configureOllama,
  getDirectOpenAIModelCatalog,
  getOllamaCatalogSnapshot,
  OPENAI_BASE_URL,
  refreshOllamaCatalog,
  resolveDirectOpenAIModelId,
  resolveOllamaModelId,
  validateOllamaBaseUrl,
} from "./first-party-providers";
import {
  configureProviderRequestGuard,
  configureProviderRequestObserver,
  createChatCompletion,
  type ProviderRequestMetadata,
} from "./openrouter";

test("provider request guard fails closed before any network call", async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => {
    networkCalls += 1;
    throw new Error("network must not be reached");
  }) as typeof fetch;
  configureDirectOpenAI({ apiKey: "guard-test-key" });
  configureProviderRequestGuard(async () => {
    throw new Error("provider revision unavailable");
  });
  try {
    await assert.rejects(
      createChatCompletion({
        model: "openai:gpt-5.6-terra",
        messages: [{ role: "user", content: "must not leave process" }],
        maxTokens: 8,
      }),
      /provider revision unavailable/u,
    );
    assert.equal(networkCalls, 0);
  } finally {
    configureProviderRequestGuard(null);
    configureDirectOpenAI({ apiKey: null });
    globalThis.fetch = originalFetch;
  }
});

test("direct OpenAI catalog is namespaced away from the Replit fleet", () => {
  assert.equal(OPENAI_BASE_URL, "https://api.openai.com/v1");
  const catalog = getDirectOpenAIModelCatalog();
  assert.ok(catalog.length >= 3);
  assert.ok(catalog.every((model) => model.id.startsWith("openai:")));
  assert.equal(
    resolveDirectOpenAIModelId("openai:gpt-5.6-terra"),
    "gpt-5.6-terra",
  );
  assert.equal(resolveDirectOpenAIModelId("gpt-5.6-terra"), null);
  assert.equal(
    resolveDirectOpenAIModelId("openai:https://attacker.test"),
    null,
  );
});

test("direct OpenAI requests stay on the fixed origin and report request IDs", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let authorization = "";
  let clientRequestId = "";
  let requestBody: Record<string, unknown> = {};
  const observed: ProviderRequestMetadata[] = [];

  globalThis.fetch = (async (input, init) => {
    const request =
      input instanceof Request
        ? input
        : new Request(input, init as RequestInit);
    requestUrl = request.url;
    authorization = request.headers.get("authorization") ?? "";
    clientRequestId = request.headers.get("x-client-request-id") ?? "";
    requestBody = JSON.parse(await request.clone().text()) as Record<
      string,
      unknown
    >;
    return new Response(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 1,
        model: "gpt-5.6-terra",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "OK" },
          },
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": "req_safe_test",
        },
      },
    );
  }) as typeof fetch;

  configureDirectOpenAI({ apiKey: "server-only-test-key" });
  configureProviderRequestObserver((metadata) => observed.push(metadata));
  try {
    const result = await createChatCompletion({
      model: "openai:gpt-5.6-terra",
      messages: [{ role: "user", content: "test" }],
      maxTokens: 8,
    });
    assert.equal(result.provider, "openai");
    assert.equal(requestUrl, "https://api.openai.com/v1/chat/completions");
    assert.equal(authorization, "Bearer server-only-test-key");
    assert.match(clientRequestId, /^[0-9a-f-]{36}$/u);
    assert.equal(requestBody.model, "gpt-5.6-terra");
    assert.equal(requestBody.max_completion_tokens, 8);
    assert.deepEqual(observed, [
      {
        provider: "openai",
        model: "gpt-5.6-terra",
        requestId: "req_safe_test",
        clientRequestId,
        outcome: "success",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    configureProviderRequestObserver(null);
    configureDirectOpenAI({ apiKey: null });
  }
});

test("Ollama endpoint validation accepts private targets and rejects SSRF targets", () => {
  assert.equal(
    validateOllamaBaseUrl("http://127.0.0.1:11434").openAIBaseUrl,
    "http://127.0.0.1:11434/v1",
  );
  assert.equal(
    validateOllamaBaseUrl("http://192.168.10.4:11434/v1").origin,
    "http://192.168.10.4:11434",
  );
  assert.equal(
    validateOllamaBaseUrl("http://host.docker.internal:11434").origin,
    "http://host.docker.internal:11434",
  );
  assert.equal(
    validateOllamaBaseUrl("http://[::1]:11434").openAIBaseUrl,
    "http://[::1]:11434/v1",
  );

  for (const unsafe of [
    "https://example.com:11434",
    "http://169.254.169.254:11434",
    "http://127.0.0.1:11434/api/delete",
    "http://user:pass@127.0.0.1:11434",
    "file:///etc/passwd",
  ]) {
    assert.throws(() => validateOllamaBaseUrl(unsafe));
  }
});

test("Ollama discovery fails closed for models without reported tool support", async () => {
  const originalFetch = globalThis.fetch;
  const requestedPaths: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const request =
      input instanceof Request
        ? input
        : new Request(input, init as RequestInit);
    const url = new URL(request.url);
    requestedPaths.push(url.pathname);
    assert.equal(request.redirect, "error");
    assert.equal(request.headers.has("authorization"), false);

    if (url.pathname === "/api/version")
      return Response.json({ version: "0.18.0" });

    if (url.pathname === "/api/tags") {
      return new Response(
        JSON.stringify({
          models: [
            {
              name: "qwen3:8b",
              model: "qwen3:8b",
              details: { parameter_size: "8.2B", quantization_level: "Q4_K_M" },
            },
            { name: "plain:latest", model: "plain:latest" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const body = JSON.parse(await request.clone().text()) as { model: string };
    return new Response(
      JSON.stringify({
        capabilities:
          body.model === "qwen3:8b:local"
            ? ["completion", "tools"]
            : ["completion"],
        details: {
          parameter_size: body.model === "qwen3:8b:local" ? "8.2B" : "7B",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  configureOllama({ baseUrl: "http://127.0.0.1:11434" });
  try {
    const catalog = await refreshOllamaCatalog(true);
    assert.equal(catalog.reachable, true);
    assert.equal(catalog.models.length, 2);
    assert.equal(
      catalog.models.find((model) => model.id === "ollama:qwen3:8b")
        ?.supportsTools,
      true,
    );
    assert.equal(
      catalog.models.find((model) => model.id === "ollama:plain:latest")
        ?.supportsTools,
      false,
    );
    assert.equal(resolveOllamaModelId("ollama:qwen3:8b"), "qwen3:8b");
    assert.equal(resolveOllamaModelId("ollama:https://attacker.test"), null);
    assert.equal(getOllamaCatalogSnapshot().error, null);
    assert.deepEqual(requestedPaths.sort(), [
      "/api/show",
      "/api/show",
      "/api/tags",
      "/api/version",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    configureOllama({ baseUrl: null });
  }
});
