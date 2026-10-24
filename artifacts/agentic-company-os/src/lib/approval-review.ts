import type { ApprovalRequest } from "@workspace/api-client-react";
import type { ApprovalCopy } from "./approval-copy";

export function approvalExpired(
  approval: ApprovalRequest,
  now: number,
): boolean {
  if (!approval.expiresAt) return false;
  const expiry = new Date(approval.expiresAt).getTime();
  return !Number.isFinite(expiry) || expiry <= now;
}

export function hasReviewableScope(approval: ApprovalRequest): boolean {
  if (isTaskResultReview(approval)) return false;
  if (!approval.scope) return true;
  return Boolean(
    approval.scope.toolName.trim() &&
    /^[a-f0-9]{64}$/i.test(approval.scope.argsHash) &&
    approval.scope.preview?.trim() &&
    approval.expiresAt &&
    Number.isFinite(new Date(approval.expiresAt).getTime()) &&
    (approval.scope.toolName !== "vm_run_sudo_command" ||
      approval.scope.target?.trim()),
  );
}

/** The server marker never falls back to generic action approval. */
export function isTaskResultReview(approval: ApprovalRequest): boolean {
  return (
    approval.scope?.toolName === "operator_confirm_task_result" ||
    approval.resultReview !== undefined
  );
}

export function approvalReviewFingerprint(approval: ApprovalRequest): string {
  return JSON.stringify([
    approval.id,
    approval.agentId,
    approval.taskId,
    approval.category,
    approval.title,
    approval.description,
    approval.amountUsd,
    approval.status,
    approval.expiresAt,
    approval.consumedAt,
    approval.scope?.toolName,
    approval.scope?.argsHash,
    approval.scope?.target,
    approval.scope?.preview,
    approval.resultReview,
  ]);
}

export function approvalErrorCopy(error: unknown): keyof ApprovalCopy {
  const value = error as { status?: number; data?: { code?: string } } | null;
  if (value?.data?.code === "EMERGENCY_STOP_ACTIVE") return "safetyStopped";
  if (value?.data?.code === "APPROVAL_CONFIRMATION_INVALID")
    return "confirmationError";
  if (value?.status === 410) return "expiredError";
  if (value?.status === 409 || value?.status === 404) return "changedError";
  if (value?.status === 400) return "inputError";
  return "unknownError";
}
