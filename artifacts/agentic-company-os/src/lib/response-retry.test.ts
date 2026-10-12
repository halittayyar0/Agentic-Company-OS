import assert from "node:assert/strict";
import test from "node:test";
import {
  readResponseRetryIntent,
  saveResponseRetryIntent,
  clearResponseRetryIntent,
  validateResponseRetryReceipt,
} from "./response-retry";
const intent = {
  taskId: 101,
  blockedAttemptId: "14a81fd4-654e-4440-bfa0-aa7a5352a311",
};
const other = {
  ...intent,
  blockedAttemptId: "29a81fd4-654e-4440-bfa0-aa7a5352a311",
};
function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
}
test("response retry identity survives a reload and can only be cleared within its exact scope", () => {
  const store = storage();
  saveResponseRetryIntent(intent, store);
  assert.deepEqual(readResponseRetryIntent(intent.taskId, store), intent);
  assert.equal(readResponseRetryIntent(102, store), null);
  assert.throws(() => saveResponseRetryIntent(other, store));
  assert.throws(() => clearResponseRetryIntent(other, store));
  assert.deepEqual(readResponseRetryIntent(intent.taskId, store), intent);
  clearResponseRetryIntent(intent, store);
  assert.equal(readResponseRetryIntent(intent.taskId, store), null);
});
test("a storage write without readback cannot authorize sending", () => {
  assert.throws(() =>
    saveResponseRetryIntent(intent, { getItem: () => null, setItem: () => {} }),
  );
});
test("corrupt or foreign saved retry does not silently become a new request", () => {
  for (const raw of [
    "{",
    JSON.stringify({ ...intent, taskId: 102 }),
    JSON.stringify({ ...intent, blockedAttemptId: "unknown" }),
  ])
    assert.throws(() => readResponseRetryIntent(101, { getItem: () => raw }));
});
test("only a bound historical acceptance receipt confirms the retry", () => {
  const valid = {
    ...intent,
    outcome: "accepted",
    recordedAt: "2026-10-11T08:00:00.000Z",
  };
  assert.deepEqual(validateResponseRetryReceipt(valid, intent), valid);
  for (const value of [
    null,
    {},
    { ...valid, ...other },
    { ...valid, taskId: 102 },
    { ...valid, outcome: "rejected" },
    { ...valid, recordedAt: "invalid" },
  ])
    assert.throws(() => validateResponseRetryReceipt(value, intent));
});
