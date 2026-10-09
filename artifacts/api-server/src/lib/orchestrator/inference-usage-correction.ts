import { eq, sql } from "drizzle-orm";
import {
  db,
  inferenceAttemptsTable as attempts,
  inferenceResponseEvidenceTable as evidence,
  usageEventsTable as receipts,
  inferenceUsageCorrectionsTable as corrections,
} from "@workspace/db";
import { InferenceAccountingError } from "./inference-accounting-errors";
import { poisonInferenceEvidence } from "./inference-evidence-poison";
import { appendOperationsChanged } from "../operations/operations-events";
import { logger } from "../logger";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Caller holds marker lock; no task, lease, output, permission or replay writes.
 * Return conflict instead of throwing so durable poison survives commit. */
export async function applyInferenceUsageCorrection(
  tx: Transaction,
  id: string,
): Promise<"applied" | "pending" | "conflict"> {
  const [attempt] = await tx.select().from(attempts).where(eq(attempts.id, id));
  if (
    !attempt ||
    attempt.evidenceConflictAt ||
    !attempt.invocationOwnerId ||
    !attempt.dispatchedAt
  )
    return "conflict";
  const [late] = await tx
    .select()
    .from(evidence)
    .where(eq(evidence.attemptId, id));
  const [original] = await tx
    .select()
    .from(receipts)
    .where(eq(receipts.ordinaryInferenceId, id));
  if (!late || !original) return "pending";
  const valid =
    late.invocationOwnerId === attempt.invocationOwnerId &&
    late.modelId === attempt.modelId &&
    late.provider === attempt.provider &&
    original.agentId === attempt.agentId &&
    original.taskId === attempt.taskId &&
    original.modelId === attempt.modelId &&
    original.provider === attempt.provider &&
    original.kind === attempt.kind &&
    original.inferenceKey === null &&
    late.promptTokens >= original.promptTokens &&
    late.completionTokens >= original.completionTokens &&
    late.totalTokens >= original.totalTokens &&
    (original.usageReported !== true ||
      (late.promptTokens === original.promptTokens &&
        late.completionTokens === original.completionTokens &&
        late.totalTokens === original.totalTokens)) &&
    (original.reportedCostUsd === null ||
      late.reportedCostUsd === null ||
      Number(late.reportedCostUsd) >= Number(original.reportedCostUsd));
  if (!valid) {
    await poisonInferenceEvidence(tx, attempt);
    return "conflict";
  }
  if (
    original.usageReported === true &&
    (late.reportedCostUsd === null ||
      late.reportedCostUsd === original.reportedCostUsd)
  ) {
    await tx
      .update(attempts)
      .set({ state: "accounted", settledAt: new Date() })
      .where(eq(attempts.id, id));
    return "applied";
  }
  const [inserted] = await tx
    .insert(corrections)
    .values({ attemptId: id, receiptId: original.id })
    .onConflictDoNothing()
    .returning();
  const saved =
    inserted ??
    (
      await tx.select().from(corrections).where(eq(corrections.attemptId, id))
    )[0];
  if (!saved || saved.receiptId !== original.id) {
    await poisonInferenceEvidence(tx, attempt);
    return "conflict";
  }
  if (inserted)
    await appendOperationsChanged(tx, {
      kind: "reconciliation_recorded",
      attemptId: id,
      receiptId: String(original.id),
    });
  await tx
    .update(attempts)
    .set({ state: "accounted", settledAt: new Date() })
    .where(eq(attempts.id, id));
  return "applied";
}
/** Bounded restart catch-up: consumes saved evidence only. Partial/missing or
 * poisoned evidence stays fenced. Errors cannot trigger a provider request. */
export async function reconcileSavedInferenceEvidence(
  limit = 20,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid evidence recovery batch size");
  const candidates = await db.execute(sql`SELECT i.id FROM inference_attempts i
    JOIN inference_response_evidence e ON e.attempt_id=i.id
    JOIN usage_events u ON u.ordinary_inference_id=i.id
    WHERE i.state IN ('dispatched','uncertain') AND i.evidence_conflict_at IS NULL
    ORDER BY i.created_at,i.id LIMIT ${limit}`);
  let applied = 0;
  for (const row of candidates.rows) {
    const id = String(row.id);
    try {
      if ((await reconcileInferenceResponseEvidence(id)) === "applied")
        applied++;
    } catch {
      logger.error(
        { attemptId: id, code: "INFERENCE_ACCOUNTING_REQUIRED" },
        "Saved inference evidence remains fenced after failed reconciliation",
      );
    }
  }
  return applied;
}
/** Internal recovery consumes trusted persisted evidence. Never accepts token
 * totals from a browser and never requests inference to reconstruct billing. */
export async function reconcileInferenceResponseEvidence(
  id: string,
): Promise<"applied" | "pending"> {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
  )
    throw new InferenceAccountingError("conflict", id);
  for (let retry = 0; retry < 3; retry++) {
    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT id FROM inference_attempts WHERE id=${id}::uuid FOR UPDATE`,
        );
        return applyInferenceUsageCorrection(tx, id);
      });
      if (result === "conflict")
        throw new InferenceAccountingError("conflict", id);
      return result;
    } catch (error) {
      if (error instanceof InferenceAccountingError) throw error;
      if (retry === 2) throw new InferenceAccountingError("storage", id);
    }
  }
  throw new InferenceAccountingError("storage", id);
}
