import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeProjectPreparation,
  hasProjectDraftInput,
  readProjectPreparation,
} from "./project-preparation";

const text = {
  title: "  分析 — تحليل  ",
  brief: " First line\n\nSecond line 😀  ",
};
const source = {
  kind: "project" as const,
  id: 42,
  status: "completed",
  updatedAt: "2026-10-09T05:00:00.000Z",
};

test("legacy and attributed preparation preserve exact text without execution fields", () => {
  assert.deepEqual(readProjectPreparation({ acosSkillDraft: text }), text);
  assert.deepEqual(
    readProjectPreparation({
      acosSkillDraft: {
        ...text,
        source,
        requestId: "old",
        permissions: ["all"],
      },
    }),
    { ...text, source },
  );
  assert.deepEqual(
    readProjectPreparation({
      acosSkillDraft: {
        ...text,
        source: {
          kind: "guide",
          id: "user-example",
          revision: 3,
          enabled: false,
        },
      },
    }),
    {
      ...text,
      source: {
        kind: "guide",
        id: "user-example",
        revision: 3,
        enabled: false,
      },
    },
  );
});

test("preparation rejects invalid text, source and oversized boundaries", () => {
  assert.ok(
    readProjectPreparation({
      acosSkillDraft: { title: "x".repeat(300), brief: "x".repeat(8000) },
    }),
  );
  for (const value of [
    null,
    {},
    [],
    { title: " ", brief: "yes" },
    { title: "x".repeat(301), brief: "yes" },
    { title: "yes", brief: "x".repeat(8001) },
    { title: "yes", brief: " " },
    { ...text, source: null },
    { ...text, source: { ...source, id: 0 } },
    { ...text, source: { ...source, id: 2147483648 } },
    { ...text, source: { ...source, updatedAt: "not-a-date" } },
    { ...text, source: { ...source, permissions: ["all"] } },
    {
      ...text,
      source: { kind: "guide", id: "builtin", revision: 1, enabled: true },
    },
    {
      ...text,
      source: { kind: "guide", id: "user-ok", revision: 0, enabled: true },
    },
    {
      ...text,
      source: { kind: "guide", id: "user-ok", revision: 1, enabled: "yes" },
    },
  ])
    assert.equal(readProjectPreparation({ acosSkillDraft: value }), null);
});

test("only the matching incoming seed is consumed and sibling navigation state remains", () => {
  let state: unknown = {
    acosSkillDraft: { ...text, source },
    sibling: { value: "preserve" },
  };
  const history = {
    get state() {
      return state;
    },
    replaceState(next: unknown) {
      state = next;
    },
  };
  assert.equal(
    consumeProjectPreparation(
      { ...text, source: { ...source, id: 43 } },
      history,
    ),
    false,
  );
  assert.equal(consumeProjectPreparation({ ...text, source }, history), true);
  assert.deepEqual(state, { sibling: { value: "preserve" } });
  assert.equal(consumeProjectPreparation(text, history), false);
});

test("denied and no-op history changes are reported without claiming consumption", () => {
  const state = { acosSkillDraft: text, sibling: 1 };
  assert.equal(
    consumeProjectPreparation(text, {
      state,
      replaceState() {
        throw Error("denied");
      },
    }),
    false,
  );
  assert.equal(
    consumeProjectPreparation(text, { state, replaceState() {} }),
    false,
  );
  assert.deepEqual(state.acosSkillDraft, text);
});

test("even whitespace and changed controls represent draft information", () => {
  const empty = {
    version: 1 as const,
    kind: "project" as const,
    title: "",
    brief: "",
    priority: "normal" as const,
    autonomyMode: "finite" as const,
    cadenceSeconds: 3600 as const,
  };
  assert.equal(hasProjectDraftInput(empty), false);
  assert.equal(hasProjectDraftInput({ ...empty, title: " " }), true);
  assert.equal(hasProjectDraftInput({ ...empty, brief: "\n" }), true);
  assert.equal(hasProjectDraftInput({ ...empty, priority: "high" }), true);
  assert.equal(
    hasProjectDraftInput({ ...empty, autonomyMode: "continuous" }),
    true,
  );
  assert.equal(hasProjectDraftInput({ ...empty, cadenceSeconds: 900 }), true);
});
