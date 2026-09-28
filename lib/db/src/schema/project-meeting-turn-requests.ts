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

// Intentionally no foreign keys: deleting a project must not make an accepted
// request identity reusable. A receipt is retained with the workspace backup.
export const projectMeetingTurnRequestsTable = pgTable(
  "project_meeting_turn_requests",
  {
    requestId: uuid("request_id").primaryKey(),
    projectId: integer("project_id").notNull(),
    meetingId: integer("meeting_id").notNull(),
    requestHash: text("request_hash").notNull(),
    state: text("state").notNull(),
    leaseOwner: uuid("lease_owner").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
    }).notNull(),
    httpStatus: integer("http_status"),
    response: jsonb("response").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("project_meeting_turn_scope_idx").on(
      table.projectId,
      table.meetingId,
      table.createdAt,
    ),
    index("project_meeting_turn_running_idx").on(
      table.state,
      table.leaseExpiresAt,
    ),
    check(
      "project_meeting_turn_scope_check",
      sql`${table.projectId} > 0 AND ${table.meetingId} > 0`,
    ),
    check(
      "project_meeting_turn_hash_check",
      sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "project_meeting_turn_state_check",
      sql`${table.state} IN ('running', 'complete', 'unconfirmed')`,
    ),
    check(
      "project_meeting_turn_response_check",
      sql`coalesce((${table.state} = 'complete' AND ${table.httpStatus} BETWEEN 200 AND 599 AND jsonb_typeof(${table.response}) = 'object') OR (${table.state} IN ('running', 'unconfirmed') AND ${table.httpStatus} IS NULL AND ${table.response} IS NULL), false)`,
    ),
  ],
);
export type ProjectMeetingTurnRequest =
  typeof projectMeetingTurnRequestsTable.$inferSelect;
