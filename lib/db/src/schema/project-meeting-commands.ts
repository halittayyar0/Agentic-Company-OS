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

export const meetingCommandKinds = [
  "create",
  "update",
  "transcript",
  "decision",
  "action",
  "action-update",
  "complete",
] as const;
export type MeetingCommandKind = (typeof meetingCommandKinds)[number];
export type MeetingCommandResult = {
  requestId: string;
  projectId: number;
  meetingId: number | null;
  kind: MeetingCommandKind;
  entityId: number | null;
  ok: boolean;
  code?: string;
  error?: string;
};

// No cascade: accepted command identities survive deletion of their records.
// Only completed transactions are visible. Receipts never copy meeting text.
export const projectMeetingCommandsTable = pgTable(
  "project_meeting_commands",
  {
    requestId: uuid("request_id").primaryKey(),
    projectId: integer("project_id").notNull(),
    meetingId: integer("meeting_id"),
    kind: text("kind").$type<MeetingCommandKind>().notNull(),
    requestHash: text("request_hash").notNull(),
    httpStatus: integer("http_status").notNull(),
    response: jsonb("response").$type<MeetingCommandResult>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("project_meeting_commands_scope_idx").on(
      t.projectId,
      t.createdAt,
      t.requestId,
    ),
    check(
      "project_meeting_commands_scope_check",
      sql`${t.projectId}>0 AND (${t.meetingId} IS NULL OR ${t.meetingId}>0)`,
    ),
    check(
      "project_meeting_commands_kind_check",
      sql`${t.kind} IN ('create','update','transcript','decision','action','action-update','complete')`,
    ),
    check(
      "project_meeting_commands_hash_check",
      sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "project_meeting_commands_status_check",
      sql`${t.httpStatus} IN (200,201,400,404,409)`,
    ),
    check(
      "project_meeting_commands_response_check",
      sql`coalesce(jsonb_typeof(${t.response})='object' AND octet_length(${t.response}::text)<=2048 AND ${t.response}->>'requestId'=${t.requestId}::text AND ${t.response}->>'projectId'=${t.projectId}::text AND (${t.response}->>'meetingId') IS NOT DISTINCT FROM ${t.meetingId}::text AND ${t.response}->>'kind'=${t.kind} AND ((${t.httpStatus}<300 AND ${t.response}->>'ok'='true' AND (${t.response}->>'entityId')::bigint>0 AND ${t.meetingId}>0) OR (${t.httpStatus}>=400 AND ${t.response}->>'ok'='false' AND ${t.response}->'entityId'='null'::jsonb)),false)`,
    ),
  ],
);
