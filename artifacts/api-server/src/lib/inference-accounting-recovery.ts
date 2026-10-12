import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { readInferenceAccountingStatus } from "./inference-accounting-status";
import { applyInferenceUsageCorrection } from "./orchestrator/inference-usage-correction";

export class AccountingRecoveryConflict extends Error {}

/** Operator applies already saved, invocation-bound evidence. No browser-supplied
 * usage, provider request, task resume, lease, budget or effect mutation. */
export async function reconcileScopedInferenceEvidence(
  scopeType: "task" | "agent",
  scopeId: number,
  attemptId: string,
) {
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM inference_attempts WHERE id=${attemptId}::uuid FOR UPDATE`,
    );
    const snapshot = await readInferenceAccountingStatus(
      scopeType,
      scopeId,
      new Date(),
      tx,
    );
    const attempt = snapshot?.attempts.find((a) => a.id === attemptId);
    if (!attempt) return "conflict" as const;
    if (attempt.state === "accounted" && attempt.usage?.usageReported)
      return "applied" as const;
    if (!attempt.savedEvidenceAvailable) return "pending" as const;
    return applyInferenceUsageCorrection(tx, attemptId);
  });
  // Throw after commit so conflicting evidence retains its durable fence.
  if (outcome === "conflict") throw new AccountingRecoveryConflict();
  return { scopeType, scopeId, attemptId, outcome };
}
