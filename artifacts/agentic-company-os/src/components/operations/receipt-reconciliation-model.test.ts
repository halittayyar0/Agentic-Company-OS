import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyReceiptReview,
  createReceiptReconciliationSchema,
} from "./receipt-reconciliation-model";
import copy from "../../lib/operations-copy/operations-en";

test("reconciliation uses a real schema with field paths, trim and a bounded note", () => {
  const schema = createReceiptReconciliationSchema(copy);
  const invalid = schema.safeParse({ decision: "", note: " " });
  assert.equal(invalid.success, false);
  if (!invalid.success)
    assert.deepEqual(
      invalid.error.issues.map((i) => i.path),
      [["decision"], ["note"]],
    );
  assert.deepEqual(
    schema.parse({ decision: "confirmed_applied", note: "  external proof  " }),
    { decision: "confirmed_applied", note: "external proof" },
  );
  assert.equal(
    schema.safeParse({ decision: "confirmed_applied", note: "x".repeat(2001) })
      .success,
    false,
  );
  assert.equal(
    schema.safeParse({ decision: "confirmed_applied", note: "界".repeat(667) })
      .success,
    false,
  );
  assert.equal(
    schema.safeParse({ decision: "confirmed_applied", note: "界".repeat(666) })
      .success,
    true,
  );
});
test("read-only reconciliation review requires exact project and receipt, no inference from missing data", () => {
  const row = {
    id: "original",
    state: "unknown",
    reconciliation: { eligible: true, decision: null },
  };
  const snap = { rootTask: { id: 101 }, receipts: [row] };
  assert.equal(classifyReceiptReview(101, "original", snap).kind, "eligible");
  assert.equal(classifyReceiptReview(102, "original", snap).kind, "missing");
  assert.equal(classifyReceiptReview(101, "another", snap).kind, "missing");
  assert.equal(
    classifyReceiptReview(101, "original", {
      ...snap,
      receipts: [{ ...row, state: "running" }],
    }).kind,
    "ineligible",
  );
  const recorded = classifyReceiptReview(101, "original", {
    ...snap,
    receipts: [
      {
        ...row,
        reconciliation: { eligible: false, decision: "confirmed_applied" },
      },
    ],
  });
  assert.deepEqual(recorded, {
    kind: "recorded",
    decision: "confirmed_applied",
  });
});
