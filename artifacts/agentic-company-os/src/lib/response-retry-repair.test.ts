import assert from "node:assert/strict";
import test from "node:test";
import * as api from "./response-retry";

const taskId = 101;
const key = `acos.response-retry.v1.${taskId}`;
const intent = {
  taskId,
  blockedAttemptId: "14a81fd4-654e-4440-bfa0-aa7a5352a311",
};
function store(raw: string | null) {
  const entries = new Map<string, string>(raw === null ? [] : [[key, raw]]);
  entries.set(
    "acos.response-retry.v1.102",
    JSON.stringify({ ...intent, taskId: 102 }),
  );
  return {
    entries,
    getItem: (k: string) => entries.get(k) ?? null,
    removeItem: (k: string) => {
      entries.delete(k);
    },
  };
}
test("retry repair distinguishes a damaged entry from a valid unresolved identity", () => {
  assert.equal(typeof api.readResponseRetryRecord, "function");
  assert.deepEqual(api.readResponseRetryRecord(taskId, store(null)), {
    kind: "missing",
  });
  assert.deepEqual(api.readResponseRetryRecord(taskId, store("{")), {
    kind: "damaged",
    raw: "{",
  });
  assert.deepEqual(
    api.readResponseRetryRecord(taskId, store(JSON.stringify(intent))),
    { kind: "saved", intent },
  );
});
test("explicit repair clears only the exact observed damaged retry entry", () => {
  assert.equal(typeof api.clearDamagedResponseRetry, "function");
  for (const raw of [
    "{",
    "null",
    JSON.stringify({ ...intent, taskId: 102 }),
    JSON.stringify({ ...intent, blockedAttemptId: "invalid" }),
  ]) {
    const s = store(raw),
      other = s.entries.get("acos.response-retry.v1.102");
    api.clearDamagedResponseRetry(taskId, raw, s);
    assert.equal(s.getItem(key), null);
    assert.equal(s.entries.get("acos.response-retry.v1.102"), other);
  }
});
test("repair refuses any valid saved identity, including compatible extra metadata", () => {
  assert.equal(typeof api.clearDamagedResponseRetry, "function");
  for (const raw of [
    JSON.stringify(intent),
    JSON.stringify({ ...intent, legacyHint: "retained" }),
  ]) {
    const s = store(raw);
    assert.throws(() => api.clearDamagedResponseRetry(taskId, raw, s));
    assert.equal(s.getItem(key), raw);
  }
});
test("a changed damaged or valid entry cannot be removed after the scope GET", () => {
  assert.equal(typeof api.clearDamagedResponseRetry, "function");
  for (const changed of ["{changed", JSON.stringify(intent)]) {
    const s = store("{");
    s.entries.set(key, changed);
    assert.throws(() => api.clearDamagedResponseRetry(taskId, "{", s));
    assert.equal(s.getItem(key), changed);
  }
});
test("unavailable or silently refusing storage cannot claim repaired details", () => {
  assert.equal(typeof api.clearDamagedResponseRetry, "function");
  const s = store("{");
  for (const removeItem of [
    () => {
      throw Error("denied");
    },
    () => {},
  ]) {
    assert.throws(() =>
      api.clearDamagedResponseRetry(taskId, "{", {
        getItem: s.getItem,
        removeItem,
      }),
    );
    assert.equal(s.getItem(key), "{");
  }
  assert.throws(() =>
    api.readResponseRetryRecord(taskId, {
      getItem: () => {
        throw Error("denied");
      },
    }),
  );
});
test("repair readback preserves a new valid entry instead of claiming success", () => {
  assert.equal(typeof api.clearDamagedResponseRetry, "function");
  const s = store("{");
  assert.throws(() =>
    api.clearDamagedResponseRetry(taskId, "{", {
      getItem: s.getItem,
      removeItem: () => {
        s.entries.set(key, JSON.stringify(intent));
      },
    }),
  );
  assert.equal(s.getItem(key), JSON.stringify(intent));
});
test("invalid repair scope never reads or removes another browser entry", () => {
  assert.equal(typeof api.clearDamagedResponseRetry, "function");
  for (const id of [0, -1, NaN, Infinity, 1.5]) {
    let reads = 0,
      removes = 0;
    assert.throws(() =>
      api.clearDamagedResponseRetry(id, "{", {
        getItem: () => {
          reads++;
          return "{";
        },
        removeItem: () => {
          removes++;
        },
      }),
    );
    assert.equal(reads, 0);
    assert.equal(removes, 0);
  }
});
test("a failed readback after removal cannot confirm repair", () => {
  const s = store("{");
  let removed = false;
  assert.throws(() =>
    api.clearDamagedResponseRetry(taskId, "{", {
      getItem: (k) => {
        if (removed) throw Error("readback denied");
        return s.getItem(k);
      },
      removeItem: (k) => {
        s.removeItem(k);
        removed = true;
      },
    }),
  );
  assert.equal(removed, true);
  assert.equal(s.getItem(key), null);
});
