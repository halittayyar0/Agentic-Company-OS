import { eq } from "drizzle-orm";
import {
  db,
  inferenceAttemptsTable as attempts,
  type InferenceAttempt,
} from "@workspace/db";
import { appendOperationsChanged } from "../operations/operations-events";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** A settled marker may have a newer active successor. Preserve its physical
 * settled state to avoid active-scope uniqueness collisions; every admission
 * and status reader treats conflict metadata as an independent durable fence. */
export async function poisonInferenceEvidence(
  tx: Transaction,
  attempt: InferenceAttempt,
): Promise<void> {
  await tx
    .update(attempts)
    .set({
      state: attempt.state === "accounted" ? "accounted" : "uncertain",
      settledAt: new Date(),
      evidenceConflictAt: new Date(),
    })
    .where(eq(attempts.id, attempt.id));
  if (!attempt.evidenceConflictAt)
    await appendOperationsChanged(tx, {
      kind: "reconciliation_recorded",
      attemptId: attempt.id,
      state: "unknown",
    });
}
