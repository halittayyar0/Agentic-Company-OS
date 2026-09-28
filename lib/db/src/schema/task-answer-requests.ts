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

// Deliberately independent of task deletion. A request identity can never be reused.
// Answer text is redacted in activity; receipts retain only the intent hash.
export const taskAnswerRequestsTable = pgTable(
  "task_answer_requests",
  {
    requestId: uuid("request_id").primaryKey(),
    taskId: integer("task_id").notNull(),
    questionId: uuid("question_id").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("task_answer_requests_task_created_idx").on(
      table.taskId,
      table.createdAt,
    ),
    check("task_answer_requests_task_check", sql`${table.taskId} > 0`),
    check(
      "task_answer_requests_hash_check",
      sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "task_answer_requests_response_check",
      sql`jsonb_typeof(${table.response}) = 'object' AND coalesce(${table.response}->>'outcome' IN ('accepted','rejected'), false)`,
    ),
  ],
);
