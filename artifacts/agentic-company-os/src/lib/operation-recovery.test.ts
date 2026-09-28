import assert from "node:assert/strict";
import test from "node:test";
import {
  operationIntentKey,
  readOperationIntent,
  readOperationIntentRaw,
  prepareOperationIntent,
  acknowledgeOperationIntent,
  clearDamagedOperationIntent,
  readOperationDraft,
  saveOperationDraft,
  operationDraftKey,
} from "./operation-recovery";

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
const input = {
  projectId: 1,
  receiptId: "receipt-a",
  decision: "confirmed_applied" as const,
  note: "  Source 原文 — دليل  ",
};
test("a damaged companion draft cannot strand an acknowledged saved decision", () => {
  const s = store();
  const intent = prepareOperationIntent(input, s);
  s.data.set(operationDraftKey(1, "receipt-a"), "damaged original draft");
  assert.equal(acknowledgeOperationIntent(intent, s), true);
  assert.equal(readOperationIntent(1, s), null);
  assert.equal(
    s.data.get(operationDraftKey(1, "receipt-a")),
    "damaged original draft",
  );
});
test("reconciliation saves normalized immutable intent before any retry, with one pending receipt per project", () => {
  const s = store();
  saveOperationDraft(
    1,
    "receipt-a",
    { decision: input.decision, note: input.note },
    s,
  );
  const pending = prepareOperationIntent({ ...input }, s);
  assert.equal(pending.note, input.note.trim());
  assert.equal(pending.draftId, readOperationDraft(1, "receipt-a", s)?.draftId);
  assert.deepEqual(readOperationIntent(1, s), pending);
  pending.note = "Mutated local object";
  assert.equal(readOperationIntent(1, s)?.note, input.note.trim());
  assert.throws(
    () => prepareOperationIntent({ ...input, receiptId: "receipt-b" }, s),
    /pending/,
  );
  assert.equal(
    prepareOperationIntent({ ...input, projectId: 2 }, s).projectId,
    2,
  );
});
test("reconciliation acknowledges only its exact identity and preserves newer drafts or pending records", () => {
  const s = store();
  saveOperationDraft(
    1,
    "receipt-a",
    { decision: input.decision, note: input.note },
    s,
  );
  const first = prepareOperationIntent(input, s);
  saveOperationDraft(
    1,
    "receipt-a",
    { decision: input.decision, note: "Newer unsent evidence" },
    s,
  );
  assert.equal(acknowledgeOperationIntent(first, s), true);
  assert.equal(readOperationIntent(1, s), null);
  assert.equal(
    readOperationDraft(1, "receipt-a", s)?.note,
    "Newer unsent evidence",
  );
  const second = prepareOperationIntent(
    { ...input, note: "Newer unsent evidence" },
    s,
  );
  assert.equal(acknowledgeOperationIntent(first, s), false);
  assert.deepEqual(readOperationIntent(1, s), second);
  assert.throws(
    () =>
      acknowledgeOperationIntent({ ...second, note: "Changed evidence" }, s),
    /invalid/,
  );
  assert.equal(acknowledgeOperationIntent(second, s), true);
  assert.equal(readOperationDraft(1, "receipt-a", s), null);
});
test("damaged or wrong-scope recovery stays visible and cannot be overwritten or cleared after replacement", () => {
  const s = store();
  s.data.set(operationIntentKey(1), '{"broken":');
  assert.equal(readOperationIntentRaw(1, s), '{"broken":');
  assert.throws(() => readOperationIntent(1, s), /invalid/);
  assert.throws(() => prepareOperationIntent(input, s), /invalid/);
  clearDamagedOperationIntent(1, '{"broken":', s);
  const valid = prepareOperationIntent(input, s);
  assert.throws(
    () => clearDamagedOperationIntent(1, '{"broken":', s),
    /pending/,
  );
  for (const mutation of [
    { projectId: 2 },
    { version: 9 },
    { extra: true },
    { receiptId: " " },
    { note: " unnormalized " },
    { decision: "maybe" },
  ]) {
    const raw = JSON.stringify({ ...valid, ...mutation });
    s.data.set(operationIntentKey(1), raw);
    assert.throws(() => readOperationIntent(1, s), /invalid/);
    assert.equal(readOperationIntentRaw(1, s), raw);
  }
});
test("failed or silently dropped storage cannot prepare an intent; multilingual limits match the server bytes", () => {
  const s = store();
  assert.throws(
    () =>
      prepareOperationIntent(input, {
        ...s,
        setItem: () => {
          throw Error("quota");
        },
      }),
    /storage/,
  );
  assert.throws(
    () => prepareOperationIntent(input, { ...s, setItem: () => {} }),
    /storage/,
  );
  assert.throws(
    () => prepareOperationIntent({ ...input, note: "界".repeat(667) }, s),
    /invalid/,
  );
  assert.equal(
    prepareOperationIntent({ ...input, note: "界".repeat(666) }, s).note.length,
    666,
  );
});
test("drafts preserve exact unsent whitespace and remain scoped to their receipt", () => {
  const s = store();
  const draft = saveOperationDraft(
    1,
    "receipt:/一",
    { decision: "", note: "  原文\n  " },
    s,
  );
  assert.deepEqual(readOperationDraft(1, "receipt:/一", s), draft);
  assert.equal(readOperationDraft(1, "receipt-a", s), null);
  assert.equal(readOperationDraft(2, "receipt:/一", s), null);
  s.data.set(operationDraftKey(1, "receipt-a"), JSON.stringify(draft));
  assert.throws(() => readOperationDraft(1, "receipt-a", s), /invalid/);
});
