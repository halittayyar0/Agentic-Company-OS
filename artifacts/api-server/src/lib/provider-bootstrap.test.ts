import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapProviders } from "./provider-bootstrap";

test("provider bootstrap configures every server-only provider before catalog readiness", async () => {
  const calls: string[] = [];
  const observed: unknown[] = [];
  const observerBox: {
    current: ((metadata: unknown) => void) | null;
  } = { current: null };

  await bootstrapProviders(
    { OLLAMA_BASE_URL: "http://ollama.internal:11434" },
    {
      readRuntimeConfig: async () => ({
        openrouterApiKey: "server-openrouter",
        openaiApiKey: "server-openai",
      }),
      configureOpenRouter: ({ apiKey }) => {
        assert.equal(apiKey, "server-openrouter");
        calls.push("openrouter");
      },
      configureDirectOpenAI: ({ apiKey }) => {
        assert.equal(apiKey, "server-openai");
        calls.push("openai");
      },
      configureOllama: ({ baseUrl }) => {
        assert.equal(baseUrl, "http://ollama.internal:11434");
        calls.push("ollama");
      },
      configureChatGPTProvider: () => calls.push("chatgpt"),
      configureRequestObserver: (nextObserver) => {
        observerBox.current = nextObserver;
        calls.push("observer");
      },
      logProviderRequest: (metadata) => observed.push(metadata),
      refreshModelCatalog: async () => {
        calls.push("catalog");
      },
    },
  );

  assert.deepEqual(calls, [
    "openrouter",
    "openai",
    "ollama",
    "chatgpt",
    "observer",
    "catalog",
  ]);
  const configuredObserver = observerBox.current;
  assert.ok(configuredObserver);
  const metadata = { provider: "openrouter", status: 200 };
  configuredObserver(metadata);
  assert.deepEqual(observed, [metadata]);
});

test("provider bootstrap clears absent optional configuration", async () => {
  const configured: unknown[] = [];
  await bootstrapProviders(
    {},
    {
      readRuntimeConfig: async () => ({}),
      configureOpenRouter: (value) => configured.push(value),
      configureDirectOpenAI: (value) => configured.push(value),
      configureOllama: (value) => configured.push(value),
      configureRequestObserver: () => undefined,
      logProviderRequest: () => undefined,
      refreshModelCatalog: async () => undefined,
    },
  );

  assert.deepEqual(configured, [
    { apiKey: null },
    { apiKey: null },
    { baseUrl: null },
  ]);
});

test("provider bootstrap prefers a saved local endpoint and null restores environment", async () => {
  for (const saved of ["http://192.168.1.2:11434/v1", null]) {
    let configured: string | null = null;
    await bootstrapProviders(
      { OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1" },
      {
        readRuntimeConfig: async () => ({ ollamaBaseUrl: saved }),
        configureOpenRouter: () => undefined,
        configureDirectOpenAI: () => undefined,
        configureOllama: ({ baseUrl }) => {
          configured = baseUrl;
        },
        configureRequestObserver: () => undefined,
        logProviderRequest: () => undefined,
        refreshModelCatalog: async () => undefined,
      },
    );
    assert.equal(configured, saved ?? "http://127.0.0.1:11434/v1");
  }
});

test("bootstrap applies consent only to the saved canonical origin across roles and environment changes", async () => {
  for (const role of ["api", "worker", "combined"]) {
    for (const [saved, address, consent] of [
      [null, "http://127.0.0.1:11434/v1", "http://127.0.0.1:11434"],
      [null, "http://127.0.0.1:11435/v1", null],
      ["http://192.168.1.2:11434/v1", "http://127.0.0.1:11434/v1", null],
    ] as const) {
      let configured: unknown;
      await bootstrapProviders(
        { RUNTIME_ROLE: role, OLLAMA_BASE_URL: address },
        {
          readRuntimeConfig: async () => ({
            ollamaBaseUrl: saved,
            ollamaCloudOrigin: "http://127.0.0.1:11434",
          }),
          configureOpenRouter: () => undefined,
          configureDirectOpenAI: () => undefined,
          configureOllama: (value) => {
            configured = value;
          },
          configureRequestObserver: () => undefined,
          logProviderRequest: () => undefined,
          refreshModelCatalog: async () => undefined,
        },
      );
      assert.deepEqual(configured, {
        baseUrl: saved ?? address,
        cloudOrigin: consent,
      });
    }
  }
});
