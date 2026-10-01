import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Independent of task deletion: request identities never become reusable.
export const taskBudgetResumeRequestsTable = pgTable(
  "task_budget_resume_requests",
  {
    requestId: uuid("request_id").primaryKey(),
    taskId: integer("task_id").notNull(),
    rootTaskId: integer("root_task_id").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("task_budget_resume_requests_task_created_idx").on(
      table.taskId,
      table.createdAt,
    ),
    check(
      "task_budget_resume_requests_task_check",
      sql`${table.taskId} > 0 AND ${table.rootTaskId} > 0`,
    ),
    check(
      "task_budget_resume_requests_hash_check",
      sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "task_budget_resume_requests_response_check",
      sql`jsonb_typeof(${table.response}) = 'object' AND coalesce(${table.response}->>'outcome' IN ('accepted','rejected'), false) AND octet_length(${table.response}::text) <= 32768`,
    ),
  ],
);
