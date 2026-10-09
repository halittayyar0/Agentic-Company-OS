import assert from "node:assert/strict";
import test from "node:test";
import {
  composerDraftKey,
  readComposerDraft,
  writeComposerDraft,
  clearComposerDraft,
} from "./composer-draft";
const home = {
  version: 1 as const,
  kind: "home" as const,
  prompt: "Keep this original task",
  mode: "research" as const,
};
const project = {
  version: 1 as const,
  kind: "project" as const,
  title: "Daily review",
  brief: "Review supplied notes",
  priority: "high" as const,
  autonomyMode: "continuous" as const,
  cadenceSeconds: 21600 as const,
};
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
test("home and project draft scopes round-trip original fields without submission data or credentials", () => {
  const store = storage();
  assert.equal(writeComposerDraft(home, store), true);
  assert.equal(writeComposerDraft(project, store), true);
  assert.deepEqual(readComposerDraft("home", store), {
    draft: home,
    error: false,
  });
  assert.deepEqual(readComposerDraft("project", store), {
    draft: project,
    error: false,
  });
  assert.equal(clearComposerDraft(home, store), true);
  assert.deepEqual(readComposerDraft("project", store).draft, project);
});
test("malformed, wrong-version, oversized and credential-bearing storage never overwrites a valid editable draft", () => {
  const store = storage();
  for (const raw of [
    "{",
    JSON.stringify({ ...home, version: 2 }),
    JSON.stringify({ ...home, apiKey: "must-not-persist" }),
    JSON.stringify({ ...home, prompt: "x".repeat(7001) }),
    JSON.stringify(project),
  ]) {
    store.values.set(composerDraftKey("home"), raw);
    assert.deepEqual(readComposerDraft("home", store), {
      draft: null,
      error: true,
    });
    assert.equal(writeComposerDraft(home, store), false);
    assert.equal(store.getItem(composerDraftKey("home")), raw);
  }
  assert.equal(
    writeComposerDraft({ ...project, cadenceSeconds: 1 }, storage()),
    false,
  );
});
test("storage denial or a changed draft cannot be mistaken for a saved or cleared draft", () => {
  const denied = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("blocked");
    },
    removeItem() {
      throw Error("blocked");
    },
  };
  assert.equal(writeComposerDraft(home, denied), false);
  assert.equal(clearComposerDraft(home, denied), false);
  const store = storage();
  assert.equal(writeComposerDraft(home, store), true);
  const newer = { ...home, prompt: "A later task" };
  assert.equal(writeComposerDraft(newer, store), true);
  assert.equal(clearComposerDraft(home, store), false);
  assert.deepEqual(readComposerDraft("home", store).draft, newer);
});
