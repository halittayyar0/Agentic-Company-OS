import * as z from "zod/v4-mini";
import { controlPlaneFetch } from "./auth";
import {
  OperationRecoveryError,
  operationNoteBytes,
  readOperationIntent,
  type OperationIntent,
  type OperationStore,
} from "./operation-recovery";

const decision = z.enum(["confirmed_applied", "confirmed_not_applied"]);
const timestamp = z
  .string()
  .check(z.refine((s) => Number.isFinite(Date.parse(s))));
const auditSchema = z.object({
  receiptId: z.string(),
  state: z.literal("unknown"),
  decision,
  note: z.string().check(
    z.minLength(1),
    z.refine((s) => s === s.trim() && operationNoteBytes(s) <= 2000),
  ),
  actorId: z.string().check(z.minLength(1)),
  reconciledAt: timestamp,
});
const reviewSchema = z.object({
  projectId: z.number(),
  receipt: z.object({
    id: z.string(),
    state: z.enum(["reserved", "running", "succeeded", "failed", "unknown"]),
    reconciliation: z.object({
      eligible: z.boolean(),
      decision: z.nullable(decision),
      reconciledAt: z.nullable(timestamp),
    }),
  }),
  audit: z.nullable(auditSchema),
});
export type OperationAudit = z.infer<typeof auditSchema>;
export type ExactOperationReview =
  | { kind: "eligible" | "ineligible" }
  | {
      kind: "recorded";
      decision: OperationAudit["decision"];
      audit: OperationAudit;
    };

export async function readOperationReceipt(
  projectId: number,
  receiptId: string,
): Promise<ExactOperationReview> {
  const value = reviewSchema.parse(
    await controlPlaneFetch<unknown>(
      `/api/tasks/${projectId}/operations/receipts/${encodeURIComponent(receiptId)}`,
      { method: "GET", signal: AbortSignal.timeout(20_000) },
    ),
  );
  const { receipt, audit } = value;
  const r = receipt.reconciliation;
  if (value.projectId !== projectId || receipt.id !== receiptId)
    throw new OperationRecoveryError("invalid");
  if (audit) {
    if (
      audit.receiptId !== receiptId ||
      receipt.state !== "unknown" ||
      r.eligible ||
      r.decision !== audit.decision ||
      r.reconciledAt !== audit.reconciledAt
    )
      throw new OperationRecoveryError("invalid");
    return { kind: "recorded", decision: audit.decision, audit };
  }
  if (
    r.decision !== null ||
    r.reconciledAt !== null ||
    (r.eligible && receipt.state !== "unknown")
  )
    throw new OperationRecoveryError("invalid");
  return {
    kind: receipt.state === "unknown" && r.eligible ? "eligible" : "ineligible",
  };
}

export async function dispatchOperationIntent(
  intent: OperationIntent,
  store?: OperationStore,
): Promise<OperationAudit> {
  if (
    JSON.stringify(readOperationIntent(intent.projectId, store)) !==
    JSON.stringify(intent)
  )
    throw new OperationRecoveryError("pending");
  const result = auditSchema.parse(
    await controlPlaneFetch<unknown>(
      `/api/ops/receipts/${encodeURIComponent(intent.receiptId)}/reconcile`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: intent.decision, note: intent.note }),
        signal: AbortSignal.timeout(20_000),
      },
    ),
  );
  if (
    result.receiptId !== intent.receiptId ||
    result.decision !== intent.decision
  )
    throw new OperationRecoveryError("invalid");
  return result;
}
