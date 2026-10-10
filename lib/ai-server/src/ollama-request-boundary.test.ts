import assert from "node:assert/strict";
import test from "node:test";
import { configureOllama } from "./first-party-providers";
import { createChatCompletion } from "./openrouter";
import { ownedOllamaPeer } from "./testing/ollama-boundary-peer";

const request = () => ({
  model: "ollama:owned:latest",
  messages: [
    { role: "user" as const, content: "Owned synthetic privacy probe" },
  ],
  maxTokens: 8,
  disableRetries: true,
});

test("actual local SDK completion carries the enforced local wire selector after one admission", async (t) => {
  const peer = await ownedOllamaPeer();
  t.after(async () => {
    configureOllama({ baseUrl: null });
    await peer.close();
  });
  configureOllama({ baseUrl: peer.origin });
  let admissions = 0;
  const result = await createChatCompletion({
    ...request(),
    beforeRequest: async () => {
      admissions++;
    },
  });
  assert.equal(result.provider, "ollama");
  assert.equal(admissions, 1);
  assert.equal(peer.completions().length, 1);
  assert.equal(peer.completions()[0]?.body.model, "owned:latest:local");
});

test("a server change during durable admission dispatches to neither the captured nor replacement endpoint", async (t) => {
  const original = await ownedOllamaPeer(),
    replacement = await ownedOllamaPeer();
  t.after(async () => {
    configureOllama({ baseUrl: null });
    await original.close();
    await replacement.close();
  });
  configureOllama({ baseUrl: original.origin });
  let admissions = 0;
  await assert.rejects(
    createChatCompletion({
      ...request(),
      beforeRequest: async () => {
        admissions++;
        configureOllama({ baseUrl: replacement.origin });
      },
    }),
  );
  assert.equal(admissions, 1);
  assert.equal(original.completions().length, 0);
  assert.equal(replacement.completions().length, 0);
});

test("the real Ollama SDK transport refuses a cross-origin 307 without forwarding the prompt", async (t) => {
  const destination = await ownedOllamaPeer();
  const original = await ownedOllamaPeer({
    complete: (_body, response) => {
      response.statusCode = 307;
      response.setHeader(
        "location",
        destination.origin + "/v1/chat/completions",
      );
      response.end();
    },
  });
  t.after(async () => {
    configureOllama({ baseUrl: null });
    await original.close();
    await destination.close();
  });
  configureOllama({ baseUrl: original.origin });
  await assert.rejects(createChatCompletion(request()));
  assert.equal(original.completions().length, 1);
  assert.equal(destination.completions().length, 0);
});

test("an unsupported Ollama server is rejected before admission or any completion request", async (t) => {
  const peer = await ownedOllamaPeer({ version: "0.17.9" });
  t.after(async () => {
    configureOllama({ baseUrl: null });
    await peer.close();
  });
  configureOllama({ baseUrl: peer.origin });
  let admissions = 0;
  await assert.rejects(
    createChatCompletion({
      ...request(),
      beforeRequest: async () => {
        admissions++;
      },
    }),
  );
  assert.equal(admissions, 0);
  assert.equal(peer.completions().length, 0);
});

test("a captured SDK retry cannot send another request after the configured server changes", async (t) => {
  const replacement = await ownedOllamaPeer();
  let calls = 0;
  const original = await ownedOllamaPeer({
    complete: (body, response) => {
      calls++;
      if (calls === 1) {
        configureOllama({ baseUrl: replacement.origin });
        response.statusCode = 429;
        response.setHeader("retry-after-ms", "1");
        response.end(
          JSON.stringify({
            error: { message: "Owned rate limit", type: "rate_limit_error" },
          }),
        );
      } else
        response.end(
          JSON.stringify({
            id: "owned-retry",
            object: "chat.completion",
            created: 0,
            model: body.model,
            choices: [],
          }),
        );
    },
  });
  t.after(async () => {
    configureOllama({ baseUrl: null });
    await original.close();
    await replacement.close();
  });
  configureOllama({ baseUrl: original.origin });
  let admissions = 0;
  await assert.rejects(
    createChatCompletion({
      ...request(),
      disableRetries: false,
      beforeRequest: async () => {
        admissions++;
      },
    }),
  );
  assert.equal(admissions, 1);
  assert.equal(original.completions().length, 1);
  assert.equal(replacement.completions().length, 0);
});

test("local IDs that select a cloud route are refused before admission", async (t) => {
  const peer = await ownedOllamaPeer();
  t.after(async () => {
    configureOllama({ baseUrl: null });
    await peer.close();
  });
  configureOllama({ baseUrl: peer.origin });
  let admissions = 0;
  for (const model of [
    "ollama:owned:cloud",
    "ollama:owned:8b-cloud",
    "ollama:owned:cloud:local",
  ]) {
    await assert.rejects(
      createChatCompletion({
        ...request(),
        model,
        beforeRequest: async () => {
          admissions++;
        },
      }),
    );
  }
  assert.equal(admissions, 0);
  assert.equal(peer.completions().length, 0);
});

test("intentional cloud aliases require the matching endpoint consent and keep their explicit namespace", async (t) => {
  const peer = await ownedOllamaPeer({
    tags: [
      {
        name: "renamed:latest",
        remote_host: "https://ollama.com",
        remote_model: "remote:large",
      },
    ],
  });
  t.after(async () => {
    configureOllama({ baseUrl: null });
    await peer.close();
  });
  configureOllama({ baseUrl: peer.origin });
  let admissions = 0;
  const params = {
    ...request(),
    model: "ollama-cloud:renamed:latest",
    beforeRequest: async () => {
      admissions++;
    },
  };
  await assert.rejects(createChatCompletion(params));
  assert.equal(admissions, 0);
  assert.equal(peer.completions().length, 0);
  configureOllama({
    baseUrl: peer.origin,
    cloudOrigin: peer.origin,
  } as Parameters<typeof configureOllama>[0] & { cloudOrigin: string });
  const result = await createChatCompletion(params);
  assert.equal(result.provider, "ollama");
  assert.equal(admissions, 1);
  assert.equal(peer.completions().length, 1);
  assert.equal(peer.completions()[0]?.body.model, "renamed:latest");
});
