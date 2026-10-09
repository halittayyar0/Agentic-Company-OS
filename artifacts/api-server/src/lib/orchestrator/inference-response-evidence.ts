import { eq, sql } from "drizzle-orm";
import {
  db,
  inferenceAttemptsTable as attempts,
  inferenceResponseEvidenceTable as evidenceTable,
} from "@workspace/db";
import type { ResponseUsageEvidence } from "@workspace/ai-server";
import { InferenceAccountingError } from "./inference-accounting-errors";
import { poisonInferenceEvidence } from "./inference-evidence-poison";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Trusted invocation callback only; recording never clears a fence or edits
 * a usage receipt. Correction/reader integration is a separate atomic step. */
export async function recordInferenceResponseEvidence(
  attemptId: string,
  invocationOwnerId: string,
  evidence: ResponseUsageEvidence,
): Promise<void> {
  const usage = evidence?.usage;
  const counters = [
    usage?.prompt_tokens,
    usage?.completion_tokens,
    usage?.total_tokens,
  ];
  const rawCost = evidence?.provider === "openrouter" ? usage?.cost : undefined;
  const cost = typeof rawCost === "number" ? rawCost.toFixed(6) : null;
  if (!uuid.test(attemptId) || !uuid.test(invocationOwnerId))
    throw new InferenceAccountingError("conflict", attemptId);
  const invalid =
    typeof evidence?.model !== "string" ||
    typeof evidence?.provider !== "string" ||
    typeof evidence?.responseId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,256}$/.test(evidence.responseId) ||
    !counters.every(
      (n) =>
        typeof n === "number" &&
        Number.isSafeInteger(n) &&
        n >= 0 &&
        n <= 2147483647,
    ) ||
    Number(usage?.total_tokens) <
      Number(usage?.prompt_tokens) + Number(usage?.completion_tokens) ||
    (rawCost !== undefined &&
      rawCost !== null &&
      (typeof rawCost !== "number" ||
        !Number.isFinite(rawCost) ||
        rawCost < 0 ||
        rawCost >= 1_000_000 ||
        (rawCost > 0 && Number(cost) === 0) ||
        Number(cost) >= 1_000_000));
  const values = {
    attemptId,
    invocationOwnerId,
    modelId: evidence?.model,
    provider: evidence?.provider,
    responseId: evidence?.responseId,
    promptTokens: usage?.prompt_tokens,
    completionTokens: usage?.completion_tokens,
    totalTokens: usage?.total_tokens,
    reportedCostUsd: cost,
  };
  for (let retry = 0; retry < 3; retry++) {
    try {
      const consistent = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT id FROM inference_attempts WHERE id=${attemptId}::uuid FOR UPDATE`,
        );
        const [attempt] = await tx
          .select()
          .from(attempts)
          .where(eq(attempts.id, attemptId));
        if (
          !attempt ||
          !attempt.invocationOwnerId ||
          attempt.invocationOwnerId !== invocationOwnerId ||
          attempt.evidenceConflictAt ||
          !attempt.dispatchedAt ||
          !["dispatched", "uncertain", "accounted"].includes(attempt.state)
        )
          throw new InferenceAccountingError("conflict", attemptId);
        const poison = async () => {
          await poisonInferenceEvidence(tx, attempt);
          return false;
        };
        if (
          invalid ||
          attempt.modelId !== values.modelId ||
          attempt.provider !== values.provider
        )
          return poison();
        const [inserted] = await tx
          .insert(evidenceTable)
          .values(values)
          .onConflictDoNothing()
          .returning();
        const saved =
          inserted ??
          (
            await tx
              .select()
              .from(evidenceTable)
              .where(eq(evidenceTable.attemptId, attemptId))
          )[0];
        if (
          !saved ||
          Object.entries(values).some(
            ([key, value]) => saved[key as keyof typeof saved] !== value,
          )
        )
          return poison();
        return true;
      });
      if (!consistent)
        throw new InferenceAccountingError("conflict", attemptId);
      return;
    } catch (error) {
      if (error instanceof InferenceAccountingError) throw error;
      if (retry === 2) throw new InferenceAccountingError("storage", attemptId);
    }
  }
}
