import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { agentsTable } from "./agents";
import { tasksTable } from "./tasks";

export const projectMemberRoleValues = ["coordinator", "member"] as const;
export type ProjectMemberRole = (typeof projectMemberRoleValues)[number];

/**
 * Durable, normalized membership for a root project. There is deliberately no
 * application or schema-level roster ceiling: execution fan-out is a separate
 * runtime concern and must never truncate the project's source-of-truth team.
 */
export const projectMembersTable = pgTable(
  "project_members",
  {
    taskId: integer("task_id")
      .notNull()
      .references(() => tasksTable.id, { onDelete: "cascade" }),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "restrict" }),
    memberRole: text("member_role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({
      name: "project_members_pk",
      columns: [table.taskId, table.agentId],
    }),
    index("project_members_agent_idx").on(table.agentId, table.taskId),
    uniqueIndex("project_members_one_coordinator_idx")
      .on(table.taskId)
      .where(sql`${table.memberRole} = 'coordinator'`),
    check(
      "project_members_role_check",
      sql`${table.memberRole} in ('coordinator', 'member')`,
    ),
    check(
      "project_members_ids_check",
      sql`${table.taskId} > 0 and ${table.agentId} > 0`,
    ),
  ],
);

export const insertProjectMemberSchema = createInsertSchema(
  projectMembersTable,
).omit({ joinedAt: true, updatedAt: true });

export type InsertProjectMember = z.infer<typeof insertProjectMemberSchema>;
export type ProjectMember = typeof projectMembersTable.$inferSelect;
