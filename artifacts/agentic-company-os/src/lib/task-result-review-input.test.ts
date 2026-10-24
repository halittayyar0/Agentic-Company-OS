import assert from "node:assert/strict";
import test from "node:test";
import type { ApprovalRequest } from "@workspace/api-client-react";
import { readTaskResultReview } from "./task-result-review-input";
import { loadTaskResultReviewCopy } from "./task-result-review-copy";
import { LOCALES } from "./i18n";
const hash = "a".repeat(64);
const expiry = "2099-01-01T00:00:00.000Z";
const approval = {
  id: 21,
  taskId: 7,
  status: "pending",
  consumedAt: null,
  expiresAt: expiry,
  scope: { toolName: "operator_confirm_task_result", argsHash: hash },
  resultReview: {
    kind: "task_result",
    proposalHash: hash,
    cycleNumber: 2,
    available: true,
  },
} as ApprovalRequest;
const review = {
  approvalId: 21,
  taskId: 7,
  cycleNumber: 2,
  proposalHash: hash,
  resultSummary: "| Owner | Date |\n| --- | --- |\n| Mira | 2026-10-26 |",
  resultFormat: { kind: "table", columns: ["Owner", "Date"] },
  judgeReasonCode: "missing_required_action",
  expiresAt: expiry,
  requirements: [
    {
      kind: "tool_succeeded",
      tool: "vm_read_file",
      satisfied: true,
      available: true,
    },
  ],
};
test("review response binds exact pending approval, cycle, scope and current required operations", () => {
  assert.deepEqual(readTaskResultReview(review, approval, 0), review);
  for (const patch of [
    { approvalId: 22 },
    { taskId: 8 },
    { cycleNumber: 3 },
    { proposalHash: "b".repeat(64) },
    { expiresAt: "invalid" },
    { extra: "PRIVATE_SOURCE" },
    { judgeReasonCode: "model-prose" },
    { resultSummary: "wrong table" },
    {
      requirements: [
        {
          kind: "tool_succeeded",
          tool: "vm_read_file",
          satisfied: false,
          available: true,
        },
      ],
    },
  ])
    assert.equal(
      readTaskResultReview({ ...review, ...patch }, approval, 0),
      null,
    );
  for (const patch of [
    { status: "approved" },
    { consumedAt: expiry },
    { resultReview: undefined },
    { resultReview: { ...approval.resultReview!, available: false } },
    { scope: null },
  ])
    assert.equal(
      readTaskResultReview(
        review,
        { ...approval, ...patch } as ApprovalRequest,
        0,
      ),
      null,
    );
  assert.equal(
    readTaskResultReview(review, approval, Date.parse(expiry)),
    null,
  );
});
test("all seven result review packs have complete app-authored decision and provenance copy", async () => {
  const english = await loadTaskResultReviewCopy("en");
  for (const locale of LOCALES) {
    const copy = await loadTaskResultReviewCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(english).sort());
    assert.ok(Object.values(copy).every((value) => value.trim().length > 0));
    if (locale !== "en") assert.notEqual(copy.help, english.help);
  }
});
