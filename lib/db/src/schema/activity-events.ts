import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { agentsTable } from "./agents";
import { tasksTable } from "./tasks";

export const activityEventTypeValues = [
  "task_created",
  "task_delegated",
  "task_status_changed",
  "subagent_created",
  "progress_update",
  "judge_review",
  "approval_requested",
  "approval_resolved",
  "note",
  "error",
  "vm_command",
  "vm_file",
  "operations_changed",
] as const;
export type ActivityEventType = (typeof activityEventTypeValues)[number];

export const activityEventSeverityValues = [
  "info",
  "warning",
  "critical",
] as const;
export type ActivityEventSeverity =
  (typeof activityEventSeverityValues)[number];

export const activityEventsTable = pgTable(
  "activity_events",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id").references(() => agentsTable.id, {
      onDelete: "set null",
    }),
    taskId: integer("task_id").references(() => tasksTable.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    summary: text("summary").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    severity: text("severity").notNull().default("info"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("activity_events_created_idx").on(table.createdAt, table.id),
    index("activity_events_agent_created_idx").on(
      table.agentId,
      table.createdAt,
    ),
    index("activity_events_task_created_idx").on(table.taskId, table.createdAt),
    index("activity_events_operations_id_idx")
      .on(table.id)
      .where(sql`${table.type} = 'operations_changed'`),
    index("activity_events_operations_task_id_idx")
      .on(table.taskId, table.id)
      .where(sql`${table.type} = 'operations_changed'`),
    check(
      "activity_events_type_check",
      sql`${table.type} in ('task_created', 'task_delegated', 'task_status_changed', 'subagent_created', 'progress_update', 'judge_review', 'approval_requested', 'approval_resolved', 'note', 'error', 'vm_command', 'vm_file', 'operations_changed')`,
    ),
    check(
      "activity_events_severity_check",
      sql`${table.severity} in ('info', 'warning', 'critical')`,
    ),
  ],
);

export const insertActivityEventSchema = createInsertSchema(
  activityEventsTable,
).omit({
  id: true,
  createdAt: true,
});
export type InsertActivityEvent = z.infer<typeof insertActivityEventSchema>;
export type ActivityEvent = typeof activityEventsTable.$inferSelect;
