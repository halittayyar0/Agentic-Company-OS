import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { agentsTable } from "./agents";
import { tasksTable } from "./tasks";
import { inferenceAttemptsTable } from "./inference-attempts";

/** Immutable per-completion accounting ledger used for honest daily metrics. */
export const usageEventsTable = pgTable(
  "usage_events",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "restrict" }),
    taskId: integer("task_id").references(() => tasksTable.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    modelId: text("model_id").notNull(),
    provider: text("provider").notNull(),
    /** Backend-generated correlation for the optional native coding inference.
     * Null preserves ordinary completions and historical immutable receipts. */
    inferenceKey: text("inference_key"),
    /** Ordinary inference correlation is separate from the restricted native
     * Codex key. Null keeps historical receipts and native accounting intact. */
    ordinaryInferenceId: uuid("ordinary_inference_id").references(
      () => inferenceAttemptsTable.id,
      { onDelete: "restrict" },
    ),
    // Null retains unknown provenance for receipts written before this field.
    usageReported: boolean("usage_reported"),
    outcome: text("outcome").notNull().default("completed"),
    failureKind: text("failure_kind"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    reportedCostUsd: numeric("reported_cost_usd", { precision: 12, scale: 6 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("usage_events_ordinary_inference_unique")
      .on(table.ordinaryInferenceId)
      .where(sql`${table.ordinaryInferenceId} IS NOT NULL`),
    check(
      "usage_events_correlation_kind_check",
      sql`${table.inferenceKey} IS NULL OR ${table.ordinaryInferenceId} IS NULL`,
    ),
    uniqueIndex("usage_events_inference_key_unique")
      .on(table.inferenceKey)
      .where(sql`${table.inferenceKey} IS NOT NULL`),
    check(
      "usage_events_inference_key_check",
      sql`${table.inferenceKey} IS NULL OR (${table.inferenceKey} ~ '^codex:[a-f0-9]{64}$' AND ${table.provider} = 'chatgpt' AND ${table.kind} = 'task_step')`,
    ),
    index("usage_events_created_idx").on(table.createdAt),
    index("usage_events_agent_created_idx").on(table.agentId, table.createdAt),
    index("usage_events_task_created_idx").on(table.taskId, table.createdAt),
    check(
      "usage_events_kind_check",
      sql`${table.kind} in ('chat', 'task_step', 'judge')`,
    ),
    check(
      "usage_events_outcome_check",
      sql`${table.outcome} in ('completed', 'failed')`,
    ),
    check(
      "usage_events_failure_check",
      sql`(${table.outcome} = 'completed' and ${table.failureKind} is null) or
      (${table.outcome} = 'failed' and ${table.failureKind} is not null and length(${table.failureKind}) between 1 and 64 and ${table.usageReported} is not null)`,
    ),
    check("usage_events_prompt_tokens_check", sql`${table.promptTokens} >= 0`),
    check(
      "usage_events_completion_tokens_check",
      sql`${table.completionTokens} >= 0`,
    ),
    check("usage_events_total_tokens_check", sql`${table.totalTokens} >= 0`),
    check(
      "usage_events_reported_cost_check",
      sql`${table.reportedCostUsd} is null or ${table.reportedCostUsd} >= 0`,
    ),
  ],
);

export type UsageEvent = typeof usageEventsTable.$inferSelect;
