import assert from "node:assert/strict";
import test from "node:test";
import {
  beginProjectStart,
  readProjectStart,
  clearProjectStart,
  acceptProjectReceipt,
  projectStartKey,
} from "./project-start-request";
const draft = {
  version: 1 as const,
  kind: "project" as const,
  title: "  Review  ",
  brief: "Original brief",
  priority: "normal" as const,
  autonomyMode: "finite" as const,
  cadenceSeconds: 3600 as const,
};
const id = "335bedf7-d6eb-4eb1-870a-166ff54e3b7a";
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
}
test("a saved request freezes the submitted draft and blocks a second identity across reload", () => {
  const store = storage(),
    request = beginProjectStart(draft, id, store);
  assert.ok(request);
  assert.equal(request.input.title, "Review");
  draft.brief = "A later edited draft";
  assert.equal(readProjectStart(store).request?.input.brief, "Original brief");
  assert.equal(
    beginProjectStart(draft, "11829287-003c-4515-b7cc-6d15d97773be", store),
    null,
  );
  assert.equal(request.submittedDraft.brief, "Original brief");
  draft.brief = "Original brief";
});
test("denied, corrupted, oversized or silently refusing storage cannot authorize submission", () => {
  const denied = {
    getItem() {
      throw Error("denied");
    },
    setItem() {
      throw Error("denied");
    },
    removeItem() {
      throw Error("denied");
    },
  };
  assert.equal(beginProjectStart(draft, id, denied), null);
  const store = storage();
  store.setItem(projectStartKey, "{");
  assert.equal(beginProjectStart(draft, id, store), null);
  assert.equal(store.getItem(projectStartKey), "{");
  store.removeItem(projectStartKey);
  assert.equal(beginProjectStart(draft, id, { ...store, setItem() {} }), null);
  for (const raw of [
    "x".repeat(65537),
    JSON.stringify({ version: 2, requestId: id, input: {} }),
  ]) {
    store.setItem(projectStartKey, raw);
    assert.equal(readProjectStart(store).error, true);
  }
});
test("a late acknowledgement cannot clear a different saved request and failed removal remains recoverable", () => {
  const store = storage(),
    request = beginProjectStart(draft, id, store);
  assert.ok(request);
  const other = {
    ...request,
    requestId: "11829287-003c-4515-b7cc-6d15d97773be",
    input: {
      ...request.input,
      requestId: "11829287-003c-4515-b7cc-6d15d97773be",
    },
  };
  store.setItem(projectStartKey, JSON.stringify(other));
  assert.equal(clearProjectStart(request, store), false);
  assert.deepEqual(readProjectStart(store).request, other);
  store.setItem(projectStartKey, JSON.stringify(request));
  assert.equal(
    clearProjectStart(request, { ...store, removeItem() {} }),
    false,
  );
  assert.deepEqual(readProjectStart(store).request, request);
  assert.equal(clearProjectStart(request, store), true);
});
test("only a narrow receipt for the exact identity permits opening a project", () => {
  const valid = {
    requestId: id,
    state: "created",
    taskId: 41,
    failureCode: null,
    createdAt: "2026-10-09T00:00:00Z",
  };
  assert.deepEqual(acceptProjectReceipt(valid, id), valid);
  for (const bad of [
    { ...valid, requestId: "11829287-003c-4515-b7cc-6d15d97773be" },
    { ...valid, taskId: -1 },
    { ...valid, taskId: 2147483648 },
    { ...valid, failureCode: "AGENT_UNAVAILABLE" },
    { ...valid, createdAt: "bad" },
    { ...valid, rawBrief: "private" },
    { ...valid, state: "completed" },
  ])
    assert.equal(acceptProjectReceipt(bad, id), null);
  assert.ok(
    acceptProjectReceipt(
      {
        ...valid,
        state: "rejected",
        taskId: null,
        failureCode: "EMERGENCY_STOP_ACTIVE",
      },
      id,
    ),
  );
  assert.equal(
    acceptProjectReceipt(
      {
        ...valid,
        state: "rejected",
        taskId: 41,
        failureCode: "EMERGENCY_STOP_ACTIVE",
      },
      id,
    ),
    null,
  );
});
