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
