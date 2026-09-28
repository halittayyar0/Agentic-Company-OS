import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { agentsTable } from "./agents";
import { tasksTable } from "./tasks";

export const projectMeetingStatusValues = [
  "draft",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type ProjectMeetingStatus = (typeof projectMeetingStatusValues)[number];

export const projectMeetingSpeakerTypeValues = ["founder", "agent"] as const;
export type ProjectMeetingSpeakerType =
  (typeof projectMeetingSpeakerTypeValues)[number];

export const projectMeetingActionStatusValues = [
  "open",
  "in_progress",
  "done",
  "cancelled",
] as const;
export type ProjectMeetingActionStatus =
  (typeof projectMeetingActionStatusValues)[number];

/**
 * A meeting is deliberately a child of a project (the product's task record),
 * never a global company object. All API access is additionally scoped by the
 * same task id so knowing a meeting id cannot cross a project boundary.
 */
export const projectMeetingsTable = pgTable(
  "project_meetings",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasksTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    agenda: text("agenda"),
    status: text("status").notNull().default("draft"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("project_meetings_task_created_idx").on(
      table.taskId,
      table.createdAt,
      table.id,
    ),
    index("project_meetings_task_status_idx").on(table.taskId, table.status),
    check("project_meetings_task_id_check", sql`${table.taskId} > 0`),
    check(
      "project_meetings_title_check",
      sql`char_length(btrim(${table.title})) between 1 and 200`,
    ),
    check(
      "project_meetings_agenda_check",
      sql`${table.agenda} is null or char_length(${table.agenda}) <= 12000`,
    ),
    check(
      "project_meetings_summary_check",
      sql`${table.summary} is null or char_length(${table.summary}) <= 30000`,
    ),
    check(
      "project_meetings_status_check",
      sql`${table.status} in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled')`,
    ),
    check(
      "project_meetings_time_order_check",
      sql`${table.endedAt} is null or ${table.startedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
  ],
);

/** A normalized join has no product-level participant ceiling. */
export const projectMeetingParticipantsTable = pgTable(
  "project_meeting_participants",
  {
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => projectMeetingsTable.id, { onDelete: "cascade" }),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "restrict" }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "project_meeting_participants_pk",
      columns: [table.meetingId, table.agentId],
    }),
    index("project_meeting_participants_agent_idx").on(table.agentId),
    check(
      "project_meeting_participants_ids_check",
      sql`${table.meetingId} > 0 and ${table.agentId} > 0`,
    ),
  ],
);

export const projectMeetingTranscriptTable = pgTable(
  "project_meeting_transcript",
  {
    id: serial("id").primaryKey(),
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => projectMeetingsTable.id, { onDelete: "cascade" }),
    speakerType: text("speaker_type").notNull(),
    speakerAgentId: integer("speaker_agent_id").references(
      () => agentsTable.id,
      { onDelete: "restrict" },
    ),
    content: text("content").notNull(),
    replyToTranscriptId: integer("reply_to_transcript_id").references(
      (): AnyPgColumn => projectMeetingTranscriptTable.id,
      { onDelete: "set null" },
    ),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("project_meeting_transcript_order_idx").on(
      table.meetingId,
      table.occurredAt,
      table.id,
    ),
    check(
      "project_meeting_transcript_speaker_check",
      sql`(${table.speakerType} = 'founder' and ${table.speakerAgentId} is null) or (${table.speakerType} = 'agent' and ${table.speakerAgentId} is not null)`,
    ),
    check(
      "project_meeting_transcript_content_check",
      sql`char_length(btrim(${table.content})) between 1 and 12000`,
    ),
  ],
);

export const projectMeetingDecisionsTable = pgTable(
  "project_meeting_decisions",
  {
    id: serial("id").primaryKey(),
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => projectMeetingsTable.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    rationale: text("rationale"),
    ownerAgentId: integer("owner_agent_id").references(() => agentsTable.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("project_meeting_decisions_meeting_idx").on(
      table.meetingId,
      table.createdAt,
      table.id,
    ),
    check(
      "project_meeting_decisions_content_check",
      sql`char_length(btrim(${table.content})) between 1 and 12000`,
    ),
    check(
      "project_meeting_decisions_rationale_check",
      sql`${table.rationale} is null or char_length(${table.rationale}) <= 12000`,
    ),
  ],
);

export const projectMeetingActionItemsTable = pgTable(
  "project_meeting_action_items",
  {
    id: serial("id").primaryKey(),
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => projectMeetingsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    details: text("details"),
    ownerAgentId: integer("owner_agent_id").references(() => agentsTable.id, {
      onDelete: "restrict",
    }),
    status: text("status").notNull().default("open"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("project_meeting_actions_meeting_status_idx").on(
      table.meetingId,
      table.status,
      table.id,
    ),
    index("project_meeting_actions_owner_idx").on(table.ownerAgentId),
    check(
      "project_meeting_actions_title_check",
      sql`char_length(btrim(${table.title})) between 1 and 500`,
    ),
    check(
      "project_meeting_actions_details_check",
      sql`${table.details} is null or char_length(${table.details}) <= 12000`,
    ),
    check(
      "project_meeting_actions_status_check",
      sql`${table.status} in ('open', 'in_progress', 'done', 'cancelled')`,
    ),
    check(
      "project_meeting_actions_completion_check",
      sql`(${table.status} = 'done' and ${table.completedAt} is not null) or (${table.status} <> 'done' and ${table.completedAt} is null)`,
    ),
  ],
);

export const insertProjectMeetingSchema = createInsertSchema(
  projectMeetingsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export const insertProjectMeetingParticipantSchema = createInsertSchema(
  projectMeetingParticipantsTable,
).omit({ addedAt: true });
export const insertProjectMeetingTranscriptSchema = createInsertSchema(
  projectMeetingTranscriptTable,
).omit({ id: true, createdAt: true });
export const insertProjectMeetingDecisionSchema = createInsertSchema(
  projectMeetingDecisionsTable,
).omit({ id: true, createdAt: true });
export const insertProjectMeetingActionItemSchema = createInsertSchema(
  projectMeetingActionItemsTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertProjectMeeting = z.infer<typeof insertProjectMeetingSchema>;
export type ProjectMeeting = typeof projectMeetingsTable.$inferSelect;
export type ProjectMeetingParticipant =
  typeof projectMeetingParticipantsTable.$inferSelect;
export type ProjectMeetingTranscript =
  typeof projectMeetingTranscriptTable.$inferSelect;
export type ProjectMeetingDecision =
  typeof projectMeetingDecisionsTable.$inferSelect;
export type ProjectMeetingActionItem =
  typeof projectMeetingActionItemsTable.$inferSelect;
