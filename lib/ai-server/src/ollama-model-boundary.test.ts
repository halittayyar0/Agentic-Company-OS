import assert from "node:assert/strict";
import test from "node:test";
import { configureOllama, refreshOllamaCatalog } from "./first-party-providers";
import { ownedOllamaPeer } from "./testing/ollama-boundary-peer";
import {
  localOllamaReference,
  parseOllamaModelReference,
  supportedOllamaVersion,
} from "./ollama-model-boundary";
import { resolveModelProvider } from "./openrouter";

test("local reference validation preserves bare local names and rejects conflicting cloud selectors", () => {
  for (const [input, expected] of [
    ["owned", "owned:latest:local"],
    ["owned:8b", "owned:8b:local"],
    ["owned:8b:local", "owned:8b:local"],
    ["my-cloud", "my-cloud:latest:local"],
  ]) {
    assert.equal(localOllamaReference(input!), expected);
  }
  for (const input of [
    "owned:cloud",
    "owned:8b-cloud",
    "owned:cloud:local",
    "owned:8b-cloud:local",
    "owned:local:cloud",
    "../owned",
    "owned/../private",
    "owned:latest\n",
  ]) {
    assert.throws(() => localOllamaReference(input));
  }
  assert.equal(
    parseOllamaModelReference("owned:8b:cloud")?.explicitSource,
    "cloud",
  );
});

test("malformed Ollama namespaces cannot be resolved through another provider", () => {
  for (const id of [
    "ollama:private/owned:cloud:local",
    "ollama-cloud:private/owned:local:cloud",
    "ollama:private/../owned",
  ])
    assert.equal(resolveModelProvider(id), null);
});

test("only stable valid versions at the local-selector floor qualify", () => {
  for (const version of ["0.18.0", "0.40.2", "1.0.0"])
    assert.equal(supportedOllamaVersion(version), version);
  for (const version of [
    "0.17.9",
    "0.18.0-rc1",
    "0.18.0+unknown",
    "00.18.0",
    "0.018.0",
    "0.18",
    "99999999999999999.0.0",
    18,
    null,
  ])
    assert.equal(supportedOllamaVersion(version), null);
});

test("renamed remote Ollama aliases are explicit cloud rows without cloud metadata requests", async (t) => {
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
  const catalog = await refreshOllamaCatalog(true);
  const rows = catalog.models as Array<{
    id: string;
    executionLocation?: string;
  }>;
  assert.equal(rows[0]?.executionLocation, "cloud");
  assert.equal(rows[0]?.id, "ollama-cloud:renamed:latest");
  assert.equal(
    peer.requests.some((row) => row.path === "/api/show"),
    false,
  );
  assert.equal(peer.completions().length, 0);
});

test("supported local discovery uses a server-enforced local reference and reports separate locality", async (t) => {
  const peer = await ownedOllamaPeer();
  t.after(async () => {
    configureOllama({ baseUrl: null });
    await peer.close();
  });
  configureOllama({ baseUrl: peer.origin });
  const catalog = await refreshOllamaCatalog(true);
  const row = catalog.models[0] as (typeof catalog.models)[number] & {
    executionLocation?: string;
  };
  assert.equal(row.executionLocation, "local");
  assert.equal(row.id, "ollama:owned:latest");
  assert.equal(row.supportsTools, true);
  assert.equal(
    peer.requests.find((request) => request.path === "/api/show")?.body.model,
    "owned:latest:local",
  );
  assert.equal(peer.completions().length, 0);
});

test("unreadable and unsupported Ollama versions cannot advertise local enforcement", async (t) => {
  for (const version of ["0.17.9", "0.18.0-rc1", "invalid", 18, undefined]) {
    await t.test(String(version), async () => {
      const peer = await ownedOllamaPeer({ version });
      try {
        configureOllama({ baseUrl: peer.origin });
        const catalog = await refreshOllamaCatalog(true);
        const row = catalog.models[0] as (typeof catalog.models)[number] & {
          executionLocation?: string;
        };
        assert.equal(row?.executionLocation, "unknown");
        assert.equal(
          peer.requests.some((request) => request.path === "/api/show"),
          false,
        );
        assert.equal(peer.completions().length, 0);
      } finally {
        configureOllama({ baseUrl: null });
        await peer.close();
      }
    });
  }
});

test("partial remote metadata is unknown and cannot masquerade as a local model", async (t) => {
  const peer = await ownedOllamaPeer({
    tags: [{ name: "partial:latest", remote_host: "https://ollama.com" }],
  });
  t.after(async () => {
    configureOllama({ baseUrl: null });
    await peer.close();
  });
  configureOllama({ baseUrl: peer.origin });
  const catalog = await refreshOllamaCatalog(true);
  const row = catalog.models[0] as (typeof catalog.models)[number] & {
    executionLocation?: string;
  };
  assert.equal(row.executionLocation, "unknown");
  assert.equal(
    peer.requests.some((request) => request.path === "/api/show"),
    false,
  );
  assert.equal(peer.completions().length, 0);
});

test("malformed show metadata cannot qualify a model as verified local", async (t) => {
  for (const show of [
    {},
    { capabilities: null },
    { capabilities: ["tools", 1] },
  ]) {
    await t.test(JSON.stringify(show), async () => {
      const peer = await ownedOllamaPeer({ show });
      try {
        configureOllama({ baseUrl: peer.origin });
        const catalog = await refreshOllamaCatalog(true);
        const row = catalog.models[0] as (typeof catalog.models)[number] & {
          executionLocation?: string;
        };
        assert.equal(row?.executionLocation, "unknown");
        assert.equal(peer.completions().length, 0);
      } finally {
        configureOllama({ baseUrl: null });
        await peer.close();
      }
    });
  }
});

test("conflicting tag name and model source cannot advertise local computation or fetch show", async (t) => {
  const peer = await ownedOllamaPeer({
    tags: [{ name: "owned:8b-cloud", model: "owned:8b" }],
  });
  t.after(async () => {
    configureOllama({ baseUrl: null });
    await peer.close();
  });
  configureOllama({ baseUrl: peer.origin });
  const catalog = await refreshOllamaCatalog(true);
  const row = catalog.models[0] as (typeof catalog.models)[number] & {
    executionLocation?: string;
  };
  assert.equal(row?.executionLocation, "unknown");
  assert.equal(
    peer.requests.some((request) => request.path === "/api/show"),
    false,
  );
  assert.equal(peer.completions().length, 0);
});
