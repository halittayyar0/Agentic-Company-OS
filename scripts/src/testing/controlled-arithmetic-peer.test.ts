import assert from "node:assert/strict";
import test from "node:test";
import { createControlledArithmeticPeer } from "./controlled-arithmetic-peer";
import {
  configureOllama,
  refreshOllamaCatalog,
  prepareOllamaInferenceRequest,
} from "../../../lib/ai-server/src/first-party-providers";

test("owned native arithmetic producer is discovered as local and accepts the actual guarded SDK selector", async () => {
  const peer = await createControlledArithmeticPeer();
  try {
    configureOllama({ baseUrl: peer.endpoint });
    const catalog = await refreshOllamaCatalog(true);
    assert.equal(catalog.serverVersion, "0.18.0");
    assert.equal(catalog.localEnforcementSupported, true);
    assert.equal(catalog.cloudEnabled, false);
    assert.equal(catalog.models[0]?.executionLocation, "local");
    assert.equal(peer.requests.filter((row) => row.kind).length, 0);
    const request = await prepareOllamaInferenceRequest("ollama:" + peer.model);
    const completion = await request.client.chat.completions.create({
      model: request.upstreamModel,
      messages: [],
      tools: [
        { type: "function", function: { name: "calculate", parameters: {} } },
      ],
    });
    assert.equal(completion.choices[0]?.finish_reason, "tool_calls");
    assert.equal(peer.requests.filter((row) => row.kind).length, 1);
    assert.deepEqual(peer.unexpected, []);
  } finally {
    configureOllama({ baseUrl: null });
    await peer.close();
  }
});

test("native producer refuses a bare selector without a local-only SDK fence", async () => {
  const peer = await createControlledArithmeticPeer();
  try {
    const response = await fetch(peer.endpoint + "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: peer.model,
        messages: [],
        tools: [{ function: { name: "calculate" } }],
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(peer.requests.filter((row) => row.kind).length, 0);
  } finally {
    await peer.close();
  }
});
test("owned arithmetic peer exposes bounded discovery and the tool-result completion path", async () => {
  const peer = await createControlledArithmeticPeer();
  const send = async (body: unknown) => {
    const response = await fetch(peer.endpoint + "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    return (await response.json()) as {
      choices: { message: { tool_calls: { function: { name: string } }[] } }[];
    };
  };
  try {
    assert.match(peer.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/u);
    assert.equal((await fetch(peer.endpoint + "/api/tags")).status, 200);
    const first = await send({
      model: peer.model + ":local",
      messages: [],
      tools: [{ function: { name: "calculate" } }],
    });
    assert.equal(
      first.choices[0].message.tool_calls[0].function.name,
      "calculate",
    );
    const second = await send({
      model: peer.model + ":local",
      messages: [
        {
          role: "assistant",
          tool_calls: [{ function: { name: "calculate" } }],
        },
        { role: "tool", content: '{"value":391}' },
      ],
      tools: [{ function: { name: "complete_task" } }],
    });
    assert.equal(
      second.choices[0].message.tool_calls[0].function.name,
      "complete_task",
    );
    await send({
      model: peer.model + ":local",
      messages: [],
      response_format: { type: "json_object" },
    });
    assert.deepEqual(
      peer.requests.filter((row) => row.kind).map((row) => row.kind),
      ["calculate", "complete_task", "judge"],
    );
    assert.deepEqual(peer.unexpected, []);
  } finally {
    await peer.close();
  }
  await assert.rejects(fetch(peer.endpoint + "/api/tags"));
});
test("wrong models and exhausted fixture request limits cannot silently produce inference", async () => {
  const peer = await createControlledArithmeticPeer({ maxRequests: 1 });
  try {
    const wrong = await fetch(peer.endpoint + "/api/show", {
      method: "POST",
      body: JSON.stringify({ model: "foreign-model" }),
    });
    assert.equal(wrong.status, 400);
    assert.equal((await fetch(peer.endpoint + "/api/tags")).status, 200);
    assert.equal((await fetch(peer.endpoint + "/api/tags")).status, 400);
    assert.equal(peer.requests.length, 1);
    assert.equal(peer.requests.filter((row) => row.kind).length, 0);
  } finally {
    await peer.close();
  }
});
