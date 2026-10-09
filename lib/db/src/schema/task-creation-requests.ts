import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const taskCreationFailureCodes = [
  "EMERGENCY_STOP_ACTIVE",
  "AGENT_UNAVAILABLE",
  "RUNTIME_CAPACITY_EXCEEDED",
  "EXECUTION_POLICY_DENIED",
] as const;
export type TaskCreationFailureCode = (typeof taskCreationFailureCodes)[number];

// No cascade or expiration: removing work must never recycle its start identity.
// Only a digest and narrow outcome are stored; the original brief stays on tasks.
export const taskCreationRequestsTable = pgTable(
  "task_creation_requests",
  {
    requestId: uuid("request_id").primaryKey(),
    requestHash: text("request_hash").notNull(),
    state: text("state").$type<"created" | "rejected">().notNull(),
    taskId: integer("task_id"),
    failureCode: text("failure_code").$type<TaskCreationFailureCode>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "task_creation_requests_hash_check",
      sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "task_creation_requests_outcome_check",
      sql`coalesce(
    (${t.state} = 'created' AND ${t.taskId} > 0 AND ${t.failureCode} IS NULL)
    OR (${t.state} = 'rejected' AND ${t.taskId} IS NULL AND ${t.failureCode} IN ('EMERGENCY_STOP_ACTIVE','AGENT_UNAVAILABLE','RUNTIME_CAPACITY_EXCEEDED','EXECUTION_POLICY_DENIED')),
    false)`,
    ),
  ],
);
