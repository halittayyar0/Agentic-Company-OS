import assert from "node:assert/strict";
import test from "node:test";
import {
  matchesModelSearch,
  normalizeModelSearch,
  modelRuntimeReady,
} from "./model-search";

test("runtime readiness keeps local version admission separate from tool support", () => {
  const ready = modelRuntimeReady;
  const local = {
    id: "ollama:owned:latest",
    provider: "ollama",
    executionLocation: "local" as const,
  };
  assert.equal(
    ready({ ...local, runtimeCompatibility: "update_required" }),
    false,
  );
  assert.equal(ready({ ...local, runtimeCompatibility: "unverified" }), false);
  assert.equal(ready(local), false);
  assert.equal(ready({ ...local, runtimeCompatibility: "compatible" }), true);
  assert.equal(ready({ ...local, executionLocation: "unknown" }), false);
  assert.equal(
    ready({
      ...local,
      id: "ollama-cloud:owned:latest",
      executionLocation: "cloud",
    }),
    true,
  );
  assert.equal(ready({ id: "openai:owned", provider: "openai" }), true);
});

const miniMaxFree = {
  id: "minimax/minimax-m3:free",
  label: "MiniMax M3 (free)",
  description: "1M bağlam · girdi ücretsiz / çıktı ücretsiz",
  provider: "openrouter",
  tier: "economy",
  supportsTools: true,
};

test("model search ignores punctuation, accents, and word order", () => {
  assert.equal(matchesModelSearch(miniMaxFree, "minimax m3 free"), true);
  assert.equal(matchesModelSearch(miniMaxFree, "FREE M3 MiniMax"), true);
  assert.equal(matchesModelSearch(miniMaxFree, "ücretsiz minimax"), true);
  assert.equal(matchesModelSearch(miniMaxFree, "ucretsiz tools"), true);
  assert.equal(matchesModelSearch(miniMaxFree, "minimax paid"), false);
});

test("model search normalization keeps words and removes separators", () => {
  assert.equal(
    normalizeModelSearch("  MiniMax/minimax-M3:FREE  "),
    "minimax minimax m3 free",
  );
});

test("a cloud alias ending free cannot acquire free-price search aliases", () => {
  const model = {
    ...miniMaxFree,
    id: "ollama-cloud:alias:free",
    provider: "ollama",
    label: "Owned cloud alias",
    description: "Cloud account usage",
  };
  assert.equal(matchesModelSearch(model, "ücretsiz"), false);
  assert.equal(matchesModelSearch(model, "bedava"), false);
  assert.equal(matchesModelSearch(model, "alias free"), true);
  assert.equal(matchesModelSearch(miniMaxFree, "ücretsiz"), true);
});

test("model search handles the selected locale and marked Arabic without altering model identifiers", () => {
  assert.equal(matchesModelSearch(miniMaxFree, "MINIMAX", "en"), true);
  assert.equal(matchesModelSearch(miniMaxFree, "MINIMAX", "tr"), true);
  assert.equal(normalizeModelSearch("مَجَـانِي", "ar"), "مجاني");
  assert.equal(
    matchesModelSearch(
      { ...miniMaxFree, description: "مجاني" },
      "مَجَـانِي",
      "ar",
    ),
    true,
  );
});
