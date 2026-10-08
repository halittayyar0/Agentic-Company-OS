import assert from "node:assert/strict";
import test from "node:test";
import {
  readCodingRecoveryIntent,
  saveCodingRecoveryIntent,
  clearCodingRecoveryIntent,
  validateCodingRecoveryReceipt,
  codingRecoveryKey,
} from "./coding-recovery-intent";
const intent = {
  version: 1 as const,
  taskId: 51,
  requestId: "11111111-1111-4111-8111-111111111111",
  expectedRevision: 4,
};
function store() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
test("a tab retains its exact recovery identity across reload, and later requests cannot overwrite or clear it", () => {
  const s = store();
  assert.equal(saveCodingRecoveryIntent(intent, s), true);
  assert.deepEqual(readCodingRecoveryIntent(51, s), { intent, error: false });
  assert.equal(
    saveCodingRecoveryIntent({ ...intent, expectedRevision: 5 }, s),
    false,
  );
  assert.equal(
    clearCodingRecoveryIntent({ ...intent, expectedRevision: 5 }, s),
    false,
  );
  assert.equal(clearCodingRecoveryIntent(intent, s), true);
  s.setItem(codingRecoveryKey(51), '{"version":1,"taskId":52}');
  assert.equal(readCodingRecoveryIntent(51, s).error, true);
  assert.equal(saveCodingRecoveryIntent(intent, s), false);
});
test("storage failures and malformed receipts never discard the recovery identity or turn unknown effects into success", () => {
  const s = store();
  s.setItem = () => {
    throw new Error("unavailable");
  };
  assert.equal(saveCodingRecoveryIntent(intent, s), false);
  const receipt = {
    taskId: 51,
    requestId: intent.requestId,
    expectedRevision: 4,
    outcome: "accepted",
    revision: 5,
    reason: null,
    recordedAt: 1,
    taskResumed: false,
    effectsReconciled: false,
  };
  assert.equal(
    validateCodingRecoveryReceipt(receipt, intent).outcome,
    "accepted",
  );
  for (const change of [
    { requestId: "22222222-2222-4222-8222-222222222222" },
    { expectedRevision: 5 },
    { revision: 6 },
    { taskResumed: true },
    { effectsReconciled: true },
    { outcome: "rejected", reason: null },
    { outcome: "rejected", reason: "unknown" },
    { recordedAt: NaN },
  ])
    assert.throws(() =>
      validateCodingRecoveryReceipt({ ...receipt, ...change }, intent),
    );
});
