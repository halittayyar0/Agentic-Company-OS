import assert from "node:assert/strict";
import test from "node:test";
import { matchesModelSearch, normalizeModelSearch } from "./model-search";

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
