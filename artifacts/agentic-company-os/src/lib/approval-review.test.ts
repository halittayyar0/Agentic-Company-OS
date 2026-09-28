import assert from "node:assert/strict";
import test from "node:test";
import type { ApprovalRequest } from "@workspace/api-client-react";
import {
  approvalExpired,
  hasReviewableScope,
  approvalReviewFingerprint,
  approvalErrorCopy,
} from "./approval-review";
import { loadApprovalCopy } from "./approval-copy";
import { LOCALES } from "./i18n";

const request: ApprovalRequest = {
  id: 1,
  taskId: 2,
  agentId: 3,
  category: "other",
  title: "Original title 原文",
  description: "Original request",
  amountUsd: null,
  status: "pending",
  decisionNote: null,
  createdAt: "2026-09-27T00:00:00Z",
  resolvedAt: null,
  consumedAt: null,
  expiresAt: "2026-09-27T01:00:00Z",
  scope: {
    toolName: "vm_run_sudo_command",
    argsHash: "a".repeat(64),
    target: "host:account",
    preview: "printf 'original command'",
  },
};
test("review fails closed for malformed or expired scoped permissions", () => {
  const expiry = Date.parse(request.expiresAt!);
  assert.equal(approvalExpired(request, expiry - 1), false);
  assert.equal(approvalExpired(request, expiry), true);
  assert.equal(approvalExpired({ ...request, expiresAt: "invalid" }, 0), true);
  assert.equal(hasReviewableScope(request), true);
  for (const patch of [
    { preview: " " },
    { argsHash: "short" },
    { target: "" },
    { toolName: "" },
  ])
    assert.equal(
      hasReviewableScope({
        ...request,
        scope: { ...request.scope!, ...patch },
      }),
      false,
    );
  assert.equal(hasReviewableScope({ ...request, expiresAt: null }), false);
  assert.equal(
    hasReviewableScope({ ...request, scope: null, expiresAt: null }),
    true,
  );
});
test("review fingerprint binds the visible action, owner, lifecycle and expiry", () => {
  const original = approvalReviewFingerprint(request);
  for (const patch of [
    { agentId: 4 },
    { taskId: 5 },
    { expiresAt: null },
    { consumedAt: request.createdAt },
    { status: "approved" as const },
    { amountUsd: "100" },
    { title: "New title" },
  ])
    assert.notEqual(
      approvalReviewFingerprint({ ...request, ...patch }),
      original,
    );
  for (const patch of [
    { preview: "new command" },
    { target: "host:other" },
    { argsHash: "b".repeat(64) },
    { toolName: "other" },
  ])
    assert.notEqual(
      approvalReviewFingerprint({
        ...request,
        scope: { ...request.scope!, ...patch },
      }),
      original,
    );
  assert.equal(
    approvalReviewFingerprint({ ...request, decisionNote: "user draft" }),
    original,
  );
});
test("coded approval failures select translated recovery without displaying raw server text", () => {
  assert.equal(
    approvalErrorCopy({ status: 423, data: { code: "EMERGENCY_STOP_ACTIVE" } }),
    "safetyStopped",
  );
  assert.equal(
    approvalErrorCopy({
      status: 400,
      data: { code: "APPROVAL_CONFIRMATION_INVALID" },
    }),
    "confirmationError",
  );
  for (const status of [404, 409])
    assert.equal(approvalErrorCopy({ status }), "changedError");
  assert.equal(approvalErrorCopy({ status: 410 }), "expiredError");
  assert.equal(
    approvalErrorCopy(new Error("Untrusted backend text")),
    "unknownError",
  );
});
test("all seven approval packs have complete nonempty keys and preserve the original request", async () => {
  const english = await loadApprovalCopy("en");
  const original = JSON.stringify(request);
  for (const locale of LOCALES) {
    const copy = await loadApprovalCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(english).sort());
    for (const value of Object.values(copy)) assert.ok(value.trim());
    if (locale !== "en")
      assert.notEqual(copy.approvedHelp, english.approvedHelp);
  }
  assert.equal(JSON.stringify(request), original);
});
