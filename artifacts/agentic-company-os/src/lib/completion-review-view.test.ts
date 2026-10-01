import assert from "node:assert/strict";
import test from "node:test";
import { completionReviewView } from "./completion-review-view";
function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    source: "persisted_runtime_metadata",
    taskId: 77,
    cycleNumber: 0,
    receiptTotal: 1,
    receiptCounts: [
      { state: "failed", reconciliationDecision: null, count: 1 },
    ],
    receiptsTruncated: false,
    receipts: [
      {
        id: "receipt-1",
        tool: "vm_run_command",
        state: "failed",
        executionKind: "task_step",
        reconciliationDecision: null,
        ok: false,
        exitCode: 1,
        stdout: "PRIVATE_OUTPUT",
        arguments: { secret: "PRIVATE_ARGUMENT" },
      },
    ],
    childTotal: 1,
    childCounts: [{ status: "failed", count: 1 }],
    childrenTruncated: false,
    children: [{ id: 88, status: "failed", report: "PRIVATE_REPORT" }],
    ...overrides,
  };
}
test("only scoped runtime snapshots project into a review view", () => {
  for (const value of [
    null,
    [],
    {},
    snapshot({ source: "agent_report" }),
    snapshot({ taskId: 999 }),
    snapshot({ cycleNumber: -1 }),
    snapshot({ cycleNumber: 1.2 }),
  ])
    assert.equal(completionReviewView(value, 77), null);
  assert.equal(completionReviewView(snapshot(), null), null);
  const result = completionReviewView(snapshot(), 77)!;
  assert.equal(result.cycleNumber, 0);
  assert.equal(result.receipts[0].ok, false);
  assert.equal(result.receipts[0].exitCode, 1);
  assert.equal(result.children[0].status, "failed");
  assert.ok(!JSON.stringify(result).includes("PRIVATE_"));
});
test("inconsistent, duplicate or invalid state counts do not invent a complete snapshot", () => {
  for (const overrides of [
    { receiptTotal: 2 },
    { childTotal: 2 },
    { receiptTotal: Number.MAX_SAFE_INTEGER + 1 },
    {
      receiptCounts: [
        { state: "unknown_future", reconciliationDecision: null, count: 1 },
      ],
    },
    {
      receiptCounts: [
        { state: "failed", reconciliationDecision: "guessed", count: 1 },
      ],
    },
    {
      receiptCounts: [
        { state: "failed", reconciliationDecision: null, count: 0.5 },
      ],
    },
    {
      receiptTotal: 2,
      receiptCounts: Array(2).fill({
        state: "failed",
        reconciliationDecision: null,
        count: 1,
      }),
    },
    {
      childTotal: 2,
      childCounts: Array(2).fill({ status: "failed", count: 1 }),
    },
  ])
    assert.equal(completionReviewView(snapshot(overrides), 77), null);
});
test("samples stay bounded, count coverage remains full and unreadable samples stay disclosed", () => {
  const source = snapshot({
    receiptTotal: 20,
    receiptCounts: [
      { state: "failed", reconciliationDecision: null, count: 20 },
    ],
    receipts: Array.from({ length: 20 }, (_, i) => ({
      ...snapshot().receipts[0],
      id: `receipt-${i}`,
    })),
    childTotal: 10,
    childCounts: [{ status: "failed", count: 10 }],
    children: Array.from({ length: 10 }, (_, i) => ({
      id: 100 + i,
      status: "failed",
    })),
  });
  const result = completionReviewView(source, 77)!;
  assert.equal(result.receiptTotal, 20);
  assert.equal(result.receipts.length, 12);
  assert.equal(result.receiptsTruncated, true);
  assert.equal(result.childTotal, 10);
  assert.equal(result.children.length, 8);
  assert.equal(result.childrenTruncated, true);
  const unreadable = completionReviewView(
    snapshot({
      receipts: [{ ...snapshot().receipts[0], id: "https://user:SECRET@host" }],
      children: [{ id: "SECRET", status: "failed" }],
    }),
    77,
  )!;
  assert.equal(unreadable.receipts.length, 0);
  assert.equal(unreadable.children.length, 0);
  assert.equal(unreadable.receiptsTruncated, true);
  assert.equal(unreadable.childrenTruncated, true);
});
test("answer-only snapshots remain empty without requiring invented tool evidence", () => {
  const result = completionReviewView(
    snapshot({
      receiptTotal: 0,
      receiptCounts: [],
      receipts: [],
      childTotal: 0,
      childCounts: [],
      children: [],
    }),
    77,
  )!;
  assert.equal(result.receiptTotal, 0);
  assert.equal(result.receiptsTruncated, false);
});

test("sample states cannot contradict the full recorded state counts", () => {
  assert.equal(
    completionReviewView(
      snapshot({
        receipts: [{ ...snapshot().receipts[0], state: "succeeded" }],
      }),
      77,
    ),
    null,
  );
  assert.equal(
    completionReviewView(
      snapshot({ children: [{ id: 88, status: "completed" }] }),
      77,
    ),
    null,
  );
  assert.equal(
    completionReviewView(
      snapshot({
        receiptTotal: 2,
        receiptCounts: [
          { state: "failed", reconciliationDecision: null, count: 1 },
          { state: "succeeded", reconciliationDecision: null, count: 1 },
        ],
        receipts: [
          { ...snapshot().receipts[0] },
          { ...snapshot().receipts[0], id: "receipt-2" },
        ],
      }),
      77,
    ),
    null,
  );
});
