import assert from "node:assert/strict";
import test from "node:test";
import {
  configureChatGPTPlan,
  configureDirectOpenAI,
  configureOllama,
  configureOpenRouter,
  refreshOllamaCatalog,
} from "@workspace/ai-server";
import { ownedOllamaPeer } from "../../../../../lib/ai-server/src/testing/ollama-boundary-peer";
import {
  ModelProviderSetupRequiredError,
  selectModelPlan,
} from "./model-select";

const environmentFields = [
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "OLLAMA_BASE_URL",
] as const;
const original = Object.fromEntries(
  environmentFields.map((key) => [key, process.env[key]]),
);
test.beforeEach(() => {
  for (const key of environmentFields) delete process.env[key];
  configureChatGPTPlan(null);
  configureOpenRouter({ apiKey: null });
  configureDirectOpenAI({ apiKey: null });
  configureOllama({ baseUrl: null });
});
test.after(() => {
  for (const key of environmentFields) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  configureOllama({ baseUrl: null });
});
const selection = (modelId: string | null, taskExecutionModelId?: string) =>
  selectModelPlan({
    purpose: "execution_step",
    agentDepth: 1,
    agent: { modelMode: modelId ? "manual" : "auto", modelId },
    taskExecutionModelId,
    maxRoutes: 4,
  });

test("automatic and fallback routes exclude cloud aliases even with consent and free-looking names", async () => {
  const peer = await ownedOllamaPeer({
    tags: [
      {
        name: "renamed:free",
        remote_host: "https://ollama.com",
        remote_model: "owned-cloud",
      },
      { name: "owned:latest" },
    ],
  });
  try {
    configureOllama({ baseUrl: peer.origin, cloudOrigin: peer.origin });
    await refreshOllamaCatalog(true);
    const plan = selection(null);
    assert.equal(plan.primary.modelId, "ollama:owned:latest");
    assert.deepEqual(
      plan.routes.map((route) => route.modelId),
      ["ollama:owned:latest"],
    );
    assert.equal(peer.completions().length, 0);
  } finally {
    await peer.close();
  }
});

test("cloud-only and unknown-only installations require explicit provider setup for automatic work", async () => {
  for (const tags of [
    [
      {
        name: "renamed:latest",
        remote_host: "https://ollama.com",
        remote_model: "owned-cloud",
      },
    ],
    [{ name: "unknown:latest", remote_host: "https://ollama.com" }],
  ]) {
    const peer = await ownedOllamaPeer({ tags });
    try {
      configureOllama({ baseUrl: peer.origin, cloudOrigin: peer.origin });
      await refreshOllamaCatalog(true);
      assert.throws(() => selection(null), ModelProviderSetupRequiredError);
      assert.equal(peer.completions().length, 0);
    } finally {
      await peer.close();
    }
  }
});

test("manual cloud pins preserve exactly one billing route and never claim free usage", async () => {
  const peer = await ownedOllamaPeer({
    tags: [
      {
        name: "renamed:free",
        remote_host: "https://ollama.com",
        remote_model: "owned-cloud",
      },
      { name: "owned:latest" },
    ],
  });
  try {
    configureOllama({ baseUrl: peer.origin, cloudOrigin: peer.origin });
    await refreshOllamaCatalog(true);
    configureDirectOpenAI({ apiKey: "fixture-paid-key" });
    const plan = selection("ollama-cloud:renamed:free");
    assert.equal(plan.freeOnly, false);
    assert.equal(plan.primary.source, "agent_pin");
    assert.deepEqual(
      plan.routes.map((route) => route.modelId),
      ["ollama-cloud:renamed:free"],
    );
    configureOllama({ baseUrl: null });
    const disconnected = selection("ollama-cloud:renamed:free");
    assert.deepEqual(
      disconnected.routes.map((route) => route.modelId),
      ["ollama-cloud:renamed:free"],
    );
    assert.equal(disconnected.freeOnly, false);
  } finally {
    await peer.close();
  }
});

test("an existing local task pin stays local after its alias becomes remote and another provider appears", async () => {
  const peer = await ownedOllamaPeer({
    tags: [
      {
        name: "owned:latest",
        remote_host: "https://ollama.com",
        remote_model: "owned-cloud",
      },
      { name: "other:latest" },
    ],
  });
  try {
    configureOllama({ baseUrl: peer.origin, cloudOrigin: peer.origin });
    await refreshOllamaCatalog(true);
    configureDirectOpenAI({ apiKey: "fixture-paid-key" });
    const plan = selection("openai:gpt-5.6-sol", "ollama:owned:latest");
    assert.equal(plan.primary.modelId, "ollama:owned:latest");
    assert.equal(plan.primary.source, "task_pin");
    assert.equal(plan.freeOnly, true);
    assert.deepEqual(
      plan.routes.map((route) => route.modelId),
      ["ollama:owned:latest", "ollama:other:latest"],
    );
    assert.equal(peer.completions().length, 0);
  } finally {
    await peer.close();
  }
});

test("unknown Ollama rows never become fallback routes for another free provider", async () => {
  const peer = await ownedOllamaPeer({
    tags: [
      { name: "unknown:latest", remote_host: "https://ollama.com" },
      { name: "owned:latest" },
    ],
  });
  try {
    configureOllama({ baseUrl: peer.origin });
    await refreshOllamaCatalog(true);
    const plan = selection("vendor/free-model:free");
    assert.ok(
      plan.routes.some((route) => route.modelId === "ollama:owned:latest"),
    );
    assert.ok(
      !plan.routes.some((route) => route.modelId === "ollama:unknown:latest"),
    );
  } finally {
    await peer.close();
  }
});
