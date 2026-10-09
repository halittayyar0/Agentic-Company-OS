import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Private historical session metadata and immutable operator receipts.
 * Independent of task deletion so a request UUID never becomes reusable.
 * No owner token, prompt, native transcript or credentials belong here. */
export const codexSessionRecoveriesTable = pgTable(
  "codex_session_recoveries",
  {
    requestId: uuid("request_id").primaryKey(),
    taskId: integer("task_id").notNull(),
    expectedRevision: bigint("expected_revision", { mode: "number" }).notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("codex_session_recoveries_task_created").on(
      table.taskId,
      table.createdAt,
    ),
    check(
      "codex_session_recoveries_scope",
      sql`${table.taskId}>0 AND ${table.expectedRevision} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "codex_session_recoveries_response",
      sql`jsonb_typeof(${table.response})='object' AND coalesce(${table.response}->>'outcome' IN ('accepted','rejected'),false) AND octet_length(${table.response}::text)<=32768`,
    ),
    check(
      "codex_session_recoveries_snapshot",
      sql`((${table.response}->>'outcome'='rejected' AND ${table.snapshot} IS NULL) OR (${table.response}->>'outcome'='accepted' AND ${table.snapshot} IS NOT NULL AND jsonb_typeof(${table.snapshot})='object' AND NOT (${table.snapshot} ?| ARRAY['ownerToken','accountId','credentials','text','prompt']) AND octet_length(${table.snapshot}::text)<=32768))`,
    ),
  ],
);
