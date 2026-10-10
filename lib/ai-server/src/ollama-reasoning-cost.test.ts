import assert from "node:assert/strict";
import test from "node:test";
import { configureOllama, refreshOllamaCatalog } from "./first-party-providers";
import { createChatCompletion } from "./openrouter";
import { ownedOllamaPeer } from "./testing/ollama-boundary-peer";

test("local thinking tool calls disable hidden reasoning by default and preserve an explicit choice", async (t) => {
  const peer = await ownedOllamaPeer({
    show: { capabilities: ["tools", "thinking"] },
  });
  t.after(() => {
    configureOllama({ baseUrl: null });
    return peer.close();
  });
  configureOllama({ baseUrl: peer.origin });
  await refreshOllamaCatalog(true);
  const params = {
    model: "ollama:owned:latest",
    messages: [{ role: "user" as const, content: "Calculate 17 × 23." }],
    tools: [
      {
        type: "function" as const,
        function: {
          name: "calculate",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    maxTokens: 128,
    disableRetries: true,
  };
  await createChatCompletion(params);
  assert.equal(peer.completions()[0]?.body.reasoning_effort, "none");
  await createChatCompletion({ ...params, localReasoningEffort: "high" });
  assert.equal(peer.completions()[1]?.body.reasoning_effort, "high");
  await createChatCompletion({ ...params, tools: undefined });
  assert.equal(peer.completions()[2]?.body.reasoning_effort, undefined);
  assert.ok(
    peer.completions().every(({ body }) => body.model === "owned:latest:local"),
  );
});

test("a model without thinking support receives no reasoning option", async (t) => {
  const peer = await ownedOllamaPeer();
  t.after(() => {
    configureOllama({ baseUrl: null });
    return peer.close();
  });
  configureOllama({ baseUrl: peer.origin });
  await refreshOllamaCatalog(true);
  await createChatCompletion({
    model: "ollama:owned:latest",
    messages: [{ role: "user", content: "Explain the supplied result." }],
    localReasoningEffort: "high",
    disableRetries: true,
  });
  assert.equal(peer.completions()[0]?.body.reasoning_effort, undefined);
});

test("local reasoning defaults never alter an explicitly selected cloud model", async (t) => {
  const peer = await ownedOllamaPeer({
    tags: [
      {
        name: "owned:latest",
        remote_host: "https://ollama.com",
        remote_model: "owned-cloud",
      },
    ],
    show: {
      capabilities: ["tools", "thinking"],
      remote_host: "https://ollama.com",
      remote_model: "owned-cloud",
    },
  });
  t.after(() => {
    configureOllama({ baseUrl: null });
    return peer.close();
  });
  configureOllama({ baseUrl: peer.origin, cloudOrigin: peer.origin });
  await refreshOllamaCatalog(true);
  await createChatCompletion({
    model: "ollama-cloud:owned:latest",
    messages: [{ role: "user", content: "Owned fixture only." }],
    tools: [
      {
        type: "function",
        function: {
          name: "calculate",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    disableRetries: true,
  });
  assert.equal(peer.completions()[0]?.body.reasoning_effort, undefined);
  assert.equal(peer.completions()[0]?.body.model, "owned:latest");
});
