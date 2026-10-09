import { sql } from "drizzle-orm";
import {
  check,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { inferenceAttemptsTable } from "./inference-attempts";

/** One immutable parsed-response observation; no prompts/content/secrets. */
export const inferenceResponseEvidenceTable = pgTable(
  "inference_response_evidence",
  {
    attemptId: uuid("attempt_id")
      .primaryKey()
      .references(() => inferenceAttemptsTable.id, { onDelete: "restrict" }),
    invocationOwnerId: uuid("invocation_owner_id").notNull(),
    modelId: text("model_id").notNull(),
    provider: text("provider").notNull(),
    responseId: text("response_id").notNull(),
    promptTokens: integer("prompt_tokens").notNull(),
    completionTokens: integer("completion_tokens").notNull(),
    totalTokens: integer("total_tokens").notNull(),
    reportedCostUsd: numeric("reported_cost_usd", { precision: 12, scale: 6 }),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "inference_response_evidence_route_check",
      sql`length(${table.modelId}) BETWEEN 1 AND 256 AND length(${table.provider}) BETWEEN 1 AND 32 AND length(${table.responseId}) BETWEEN 1 AND 256 AND ${table.responseId} ~ '^[A-Za-z0-9._:-]+$'`,
    ),
    check(
      "inference_response_evidence_tokens_check",
      sql`${table.promptTokens} >= 0 AND ${table.completionTokens} >= 0 AND ${table.totalTokens} >= ${table.promptTokens}::bigint + ${table.completionTokens}::bigint`,
    ),
    check(
      "inference_response_evidence_cost_check",
      sql`${table.reportedCostUsd} IS NULL OR ${table.reportedCostUsd} >= 0`,
    ),
  ],
);
