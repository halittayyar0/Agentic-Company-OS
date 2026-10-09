import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Durable uncertainty survives worker/agent/task deletion. IDs here are audit
 * identities, deliberately not cascading foreign keys. No prompt or secrets. */
export const inferenceAttemptsTable = pgTable(
  "inference_attempts",
  {
    id: uuid("id").primaryKey(),
    agentId: integer("agent_id").notNull(),
    taskId: integer("task_id"),
    scopeKey: text("scope_key").notNull(),
    modelId: text("model_id").notNull(),
    provider: text("provider").notNull(),
    kind: text("kind").notNull(),
    /** Correlation only; legacy markers remain null, never manufactured owners. */
    invocationOwnerId: uuid("invocation_owner_id"),
    /** Conflicting response evidence cannot be cleared by a later exact retry. */
    evidenceConflictAt: timestamp("evidence_conflict_at", {
      withTimezone: true,
    }),
    state: text("state").notNull().default("reserved"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    requestDeadlineAt: timestamp("request_deadline_at", {
      withTimezone: true,
    }).notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("inference_attempts_unsettled_scope_unique")
      .on(table.scopeKey)
      .where(sql`${table.state} IN ('reserved','dispatched','uncertain')`),
    uniqueIndex("inference_attempts_unsettled_agent_unique")
      .on(table.agentId)
      .where(sql`${table.state} IN ('reserved','dispatched','uncertain')`),
    index("inference_attempts_state_created_idx").on(
      table.state,
      table.createdAt,
    ),
    check(
      "inference_attempts_scope_check",
      sql`${table.scopeKey} ~ '^(task|agent):[1-9][0-9]{0,9}$' AND ${table.agentId} > 0 AND (${table.taskId} IS NULL OR ${table.taskId} > 0)`,
    ),
    check(
      "inference_attempts_route_check",
      sql`length(${table.modelId}) BETWEEN 1 AND 256 AND length(${table.provider}) BETWEEN 1 AND 32 AND ${table.kind} IN ('chat','task_step','judge')`,
    ),
    check(
      "inference_attempts_state_check",
      sql`(${table.state} IN ('reserved','not_dispatched') AND ${table.dispatchedAt} IS NULL) OR (${table.state} IN ('dispatched','accounted','uncertain') AND ${table.dispatchedAt} IS NOT NULL)`,
    ),
    check(
      "inference_attempts_settlement_check",
      sql`(${table.state} IN ('accounted','uncertain','not_dispatched')) = (${table.settledAt} IS NOT NULL)`,
    ),
  ],
);
export type InferenceAttempt = typeof inferenceAttemptsTable.$inferSelect;
