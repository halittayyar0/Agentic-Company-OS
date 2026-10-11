import assert from "node:assert/strict";
import test from "node:test";
import { configureOllama, refreshOllamaCatalog } from "./first-party-providers";
import { createChatCompletion } from "./openrouter";
import { findOllamaBoundaryError } from "./ollama-model-boundary";
import { ownedOllamaPeer } from "./testing/ollama-boundary-peer";

test("a tool-capable local model reports its required runtime separately and blocks inference before admission", async (t) => {
  const peer = await ownedOllamaPeer({
    version: "0.18.0",
    show: { capabilities: ["tools", "thinking"], requires: "0.30.0" },
  });
  t.after(async () => {
    configureOllama({ baseUrl: null });
    await peer.close();
  });
  configureOllama({ baseUrl: peer.origin });
  const catalog = await refreshOllamaCatalog(true);
  const row = catalog.models[0] as (typeof catalog.models)[number] & {
    runtimeCompatibility?: string;
    requiredOllamaVersion?: string;
  };
  assert.equal(row.executionLocation, "local");
  assert.equal(row.supportsTools, true);
  assert.equal(row.runtimeCompatibility, "update_required");
  assert.equal(row.requiredOllamaVersion, "0.30.0");
  let admissions = 0;
  await assert.rejects(
    createChatCompletion({
      model: row.id,
      messages: [
        { role: "user", content: "Do not dispatch this incompatible request" },
      ],
      disableRetries: true,
      beforeRequest: async () => {
        admissions++;
      },
    }),
    (error: unknown) =>
      findOllamaBoundaryError(error)?.code === "model_update_required",
  );
  assert.equal(admissions, 0);
  assert.equal(peer.completions().length, 0);
});

for (const [version, required] of [
  ["0.30.0", "0.30.0"],
  ["0.30.10", "0.30.9"],
  ["0.31.0", "0.30.99"],
  ["1.0.0", "0.99.99"],
  ["0.18.0", undefined],
  ["0.18.0", ""],
] as const) {
  test(`compatible local runtime ${version} accepts declared minimum ${String(required)}`, async (t) => {
    const peer = await ownedOllamaPeer({
      version,
      show: {
        capabilities: ["tools"],
        ...(required === undefined ? {} : { requires: required }),
      },
    });
    t.after(async () => {
      configureOllama({ baseUrl: null });
      await peer.close();
    });
    configureOllama({ baseUrl: peer.origin });
    const catalog = await refreshOllamaCatalog(true);
    assert.equal(
      (catalog.models[0] as { runtimeCompatibility?: string })
        .runtimeCompatibility,
      "compatible",
    );
    await createChatCompletion({
      model: catalog.models[0]!.id,
      messages: [
        { role: "user", content: "Owned synthetic compatibility probe" },
      ],
      disableRetries: true,
    });
    assert.equal(peer.completions().length, 1);
    assert.equal(peer.completions()[0]!.body.model, "owned:latest:local");
  });
}

test("invalid declared requirements stay bounded and cannot reach inference", async (t) => {
  for (const requires of [
    null,
    30,
    {},
    "0.30",
    "0.030.0",
    "0.30.0-rc1",
    "0.30.0+build",
    "0.30.0\n",
    "99999999999999999.0.0",
    "x".repeat(65),
  ]) {
    await t.test(
      `invalid requirement ${JSON.stringify(requires)}`,
      async (t) => {
        const peer = await ownedOllamaPeer({
          version: "1.0.0",
          show: { capabilities: ["tools"], requires },
        });
        t.after(async () => {
          configureOllama({ baseUrl: null });
          await peer.close();
        });
        configureOllama({ baseUrl: peer.origin });
        const catalog = await refreshOllamaCatalog(true);
        const row = catalog.models[0] as (typeof catalog.models)[number] & {
          runtimeCompatibility?: string;
          requiredOllamaVersion?: string;
        };
        assert.equal(row.runtimeCompatibility, "unverified");
        assert.equal(row.requiredOllamaVersion, undefined);
        let admissions = 0;
        await assert.rejects(
          createChatCompletion({
            model: row.id,
            messages: [{ role: "user", content: "Must not dispatch" }],
            disableRetries: true,
            beforeRequest: async () => {
              admissions++;
            },
          }),
          (error: unknown) =>
            findOllamaBoundaryError(error)?.code === "model_runtime_unverified",
        );
        assert.equal(admissions, 0);
        assert.equal(peer.completions().length, 0);
      },
    );
  }
});

test("a remote model requirement is not compared with the local gateway version", async (t) => {
  const peer = await ownedOllamaPeer({
    version: "0.18.0",
    tags: [
      {
        name: "owned:latest",
        remote_host: "https://ollama.com",
        remote_model: "owned:latest",
      },
    ],
    show: {
      capabilities: ["tools"],
      remote_host: "https://ollama.com",
      remote_model: "owned:latest",
      requires: "1.0.0",
    },
  });
  t.after(async () => {
    configureOllama({ baseUrl: null });
    await peer.close();
  });
  configureOllama({ baseUrl: peer.origin, cloudOrigin: peer.origin });
  const catalog = await refreshOllamaCatalog(true);
  assert.equal(catalog.models[0]!.executionLocation, "cloud");
  assert.equal(
    (catalog.models[0] as { runtimeCompatibility?: string })
      .runtimeCompatibility,
    undefined,
  );
  await createChatCompletion({
    model: catalog.models[0]!.id,
    messages: [{ role: "user", content: "Owned cloud fixture only" }],
    disableRetries: true,
  });
  assert.equal(peer.completions().length, 1);
});
