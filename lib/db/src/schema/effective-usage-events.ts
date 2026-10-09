import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { pgView } from "drizzle-orm/pg-core";
import { usageEventsTable as receipts } from "./usage-events";
import { inferenceResponseEvidenceTable as evidence } from "./inference-response-evidence";
import { inferenceUsageCorrectionsTable as corrections } from "./inference-usage-corrections";
import { inferenceAttemptsTable as attempts } from "./inference-attempts";
/** Every receipt contributes once, at its original time and outcome. Writers
 * continue using usage_events. Evidence alone never changes a reader. */
export const effectiveUsageEventsView = pgView("effective_usage_events").as(
  (qb) =>
    qb
      .select({
        ...getTableColumns(receipts),
        promptTokens:
          sql<number>`case when ${evidence.attemptId} is not null then ${evidence.promptTokens} else ${receipts.promptTokens} end`.as(
            "prompt_tokens",
          ),
        completionTokens:
          sql<number>`case when ${evidence.attemptId} is not null then ${evidence.completionTokens} else ${receipts.completionTokens} end`.as(
            "completion_tokens",
          ),
        totalTokens:
          sql<number>`case when ${evidence.attemptId} is not null then ${evidence.totalTokens} else ${receipts.totalTokens} end`.as(
            "total_tokens",
          ),
        usageReported: sql<
          boolean | null
        >`case when ${attempts.evidenceConflictAt} is not null then false when ${evidence.attemptId} is not null then true else ${receipts.usageReported} end`.as(
          "usage_reported",
        ),
        reportedCostUsd: sql<
          string | null
        >`coalesce(${evidence.reportedCostUsd},${receipts.reportedCostUsd})`.as(
          "reported_cost_usd",
        ),
      })
      .from(receipts)
      .leftJoin(attempts, eq(attempts.id, receipts.ordinaryInferenceId))
      .leftJoin(
        corrections,
        and(
          eq(corrections.receiptId, receipts.id),
          eq(corrections.attemptId, receipts.ordinaryInferenceId),
        ),
      )
      .leftJoin(
        evidence,
        and(
          eq(evidence.attemptId, corrections.attemptId),
          eq(evidence.modelId, receipts.modelId),
          eq(evidence.provider, receipts.provider),
        ),
      ),
);
