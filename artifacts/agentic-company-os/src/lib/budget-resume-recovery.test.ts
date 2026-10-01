import assert from "node:assert/strict";
import test from "node:test";
import {
  budgetResumeKey,
  readBudgetResumeIntent,
  saveBudgetResumeIntent,
  clearBudgetResumeIntent,
  validateBudgetResumeReceipt,
  type BudgetResumeIntent,
} from "./budget-resume-recovery";
const intent: BudgetResumeIntent = {
  version: 1,
  taskId: 11,
  rootTaskId: 10,
  requestId: "11111111-1111-4111-8111-111111111111",
};
function store() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
const receipt = {
  requestId: intent.requestId,
  taskId: 11,
  rootTaskId: 10,
  outcome: "accepted",
  reason: null,
  queuedTaskIds: [10, 11],
  queuedCount: 2,
  stillPausedCount: 0,
  recordedAt: "2026-10-01T02:00:00.000Z",
};
test("a saved budget intent cannot be overwritten or cleared by a different root scope", () => {
  const s = store();
  assert.equal(saveBudgetResumeIntent(intent, s), true);
  assert.equal(saveBudgetResumeIntent({ ...intent, rootTaskId: 12 }, s), false);
  assert.equal(
    clearBudgetResumeIntent({ ...intent, rootTaskId: 12 }, s),
    false,
  );
  assert.deepEqual(readBudgetResumeIntent(11, s).intent, intent);
  assert.equal(clearBudgetResumeIntent(intent, s), true);
});
test("invalid new identities fail before damaging the stored recovery marker", () => {
  const s = store();
  assert.equal(saveBudgetResumeIntent({ ...intent, rootTaskId: 0 }, s), false);
  assert.equal(s.getItem(budgetResumeKey(11)), null);
});
test("budget receipts require a real timestamp and exact task, root and request binding", () => {
  assert.deepEqual(validateBudgetResumeReceipt(receipt, intent), receipt);
  for (const change of [
    { recordedAt: "1" },
    { recordedAt: "not a date" },
    { taskId: 12 },
    { rootTaskId: 12 },
    { requestId: "22222222-2222-4222-8222-222222222222" },
    { queuedTaskIds: [10, 10] },
    { queuedCount: 0 },
    { stillPausedCount: 1000 },
    { outcome: "accepted", reason: "nothing_eligible" },
    {
      outcome: "rejected",
      queuedCount: 0,
      queuedTaskIds: [],
      reason: "invented",
    },
  ])
    assert.throws(() =>
      validateBudgetResumeReceipt({ ...receipt, ...change }, intent),
    );
});
test("malformed or oversized stored budget identities are preserved and block replacement", () => {
  for (const raw of [
    "{",
    "x".repeat(513),
    JSON.stringify({ ...intent, taskId: 12 }),
  ]) {
    const s = store();
    s.data.set(budgetResumeKey(11), raw);
    assert.equal(readBudgetResumeIntent(11, s).error, true);
    assert.equal(saveBudgetResumeIntent(intent, s), false);
    assert.equal(clearBudgetResumeIntent(intent, s), false);
    assert.equal(s.getItem(budgetResumeKey(11)), raw);
  }
});
test("storage failures never claim a saved or cleared budget identity", () => {
  const blocked = {
    getItem: () => {
      throw Error("storage");
    },
    setItem: () => {
      throw Error("storage");
    },
    removeItem: () => {
      throw Error("storage");
    },
  };
  assert.equal(readBudgetResumeIntent(11, blocked).error, true);
  assert.equal(saveBudgetResumeIntent(intent, blocked), false);
  assert.equal(clearBudgetResumeIntent(intent, blocked), false);
});
