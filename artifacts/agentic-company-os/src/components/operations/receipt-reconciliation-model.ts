import * as z from "zod/v4-mini";
import type { OperationsCopy } from "../../lib/operations-copy";
import { operationNoteBytes } from "../../lib/operation-recovery";

export type ReconciliationFormValues = {
  decision: "" | "confirmed_applied" | "confirmed_not_applied";
  note: string;
};
export function createReceiptReconciliationSchema(copy: OperationsCopy) {
  return z.object({
    decision: z
      .enum(["", "confirmed_applied", "confirmed_not_applied"])
      .check(
        z.refine((value) => value !== "", { error: copy.decisionRequired }),
      ),
    note: z.string().check(
      z.trim(),
      z.minLength(1, copy.noteRequired),
      z.refine((value) => operationNoteBytes(value) <= 2000, {
        error: copy.noteLong.replace("{count}", "2000"),
      }),
    ),
  });
}

export type ReceiptReview =
  | { kind: "eligible" | "missing" | "ineligible" }
  | {
      kind: "recorded";
      decision: "confirmed_applied" | "confirmed_not_applied";
    };
export function classifyReceiptReview(
  projectId: number,
  receiptId: string,
  snapshot: {
    rootTask: { id: number };
    receipts: {
      id: string;
      state: string;
      reconciliation: { eligible: boolean; decision: string | null };
    }[];
  },
): ReceiptReview {
  if (snapshot.rootTask.id !== projectId) return { kind: "missing" };
  const receipt = snapshot.receipts.find((row) => row.id === receiptId);
  if (!receipt) return { kind: "missing" };
  const decision = receipt.reconciliation.decision;
  if (decision === "confirmed_applied" || decision === "confirmed_not_applied")
    return { kind: "recorded", decision };
  return {
    kind:
      receipt.state === "unknown" &&
      receipt.reconciliation.eligible &&
      decision === null
        ? "eligible"
        : "ineligible",
  };
}
