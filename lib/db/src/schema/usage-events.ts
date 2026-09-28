import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { agentsTable } from "./agents";
import { tasksTable } from "./tasks";

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
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    reportedCostUsd: numeric("reported_cost_usd", { precision: 12, scale: 6 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("usage_events_created_idx").on(table.createdAt),
    index("usage_events_agent_created_idx").on(table.agentId, table.createdAt),
    index("usage_events_task_created_idx").on(table.taskId, table.createdAt),
    check(
      "usage_events_kind_check",
      sql`${table.kind} in ('chat', 'task_step', 'judge')`,
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
