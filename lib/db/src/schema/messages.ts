import {
  check,
  index,
  integer,
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

export const messageRoleValues = ["user", "agent", "system"] as const;
export type MessageRole = (typeof messageRoleValues)[number];

export const messagesTable = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "restrict" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    taskId: integer("task_id").references(() => tasksTable.id, {
      onDelete: "set null",
    }),
    modelId: text("model_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("messages_agent_created_idx").on(
      table.agentId,
      table.createdAt,
      table.id,
    ),
    index("messages_task_created_idx").on(table.taskId, table.createdAt),
    check(
      "messages_role_check",
      sql`${table.role} in ('user', 'agent', 'system')`,
    ),
  ],
);

export const insertMessageSchema = createInsertSchema(messagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
