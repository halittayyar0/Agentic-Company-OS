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
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { agentsTable } from "./agents";
import { tasksTable } from "./tasks";

export const companyMessageSenderTypeValues = ["founder", "agent"] as const;
export type CompanyMessageSenderType =
  (typeof companyMessageSenderTypeValues)[number];

export const companyMessageSourceValues = [
  "operator",
  "meeting",
  "room_reply",
  "agent_tool",
] as const;
export type CompanyMessageSource = (typeof companyMessageSourceValues)[number];

/**
 * Channels are durable objects even though the first product surface exposes
 * only the canonical company room. Keeping the room separate from its
 * messages avoids baking a magic string into every message row and leaves a
 * safe path for future, explicitly-created channels.
 */
export const companyChannelsTable = pgTable(
  "company_channels",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("company_channels_key_idx").on(table.key)],
);

/**
 * Explicit room roster. Membership is intentionally not capped by the schema
 * or API; response fan-out is bounded independently at dispatch time.
 */
export const companyChannelMembersTable = pgTable(
  "company_channel_members",
  {
    channelId: integer("channel_id")
      .notNull()
      .references(() => companyChannelsTable.id, { onDelete: "cascade" }),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "company_channel_members_pk",
      columns: [table.channelId, table.agentId],
    }),
    index("company_channel_members_agent_idx").on(table.agentId),
  ],
);

export const companyMessagesTable = pgTable(
  "company_messages",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id")
      .notNull()
      .references(() => companyChannelsTable.id, { onDelete: "restrict" }),
    senderType: text("sender_type").notNull(),
    senderAgentId: integer("sender_agent_id").references(() => agentsTable.id, {
      onDelete: "restrict",
    }),
    content: text("content").notNull(),
    source: text("source").notNull(),
    taskId: integer("task_id").references(() => tasksTable.id, {
      onDelete: "set null",
    }),
    replyToMessageId: integer("reply_to_message_id").references(
      (): AnyPgColumn => companyMessagesTable.id,
      { onDelete: "set null" },
    ),
    modelId: text("model_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("company_messages_channel_created_idx").on(
      table.channelId,
      table.createdAt,
      table.id,
    ),
    index("company_messages_sender_created_idx").on(
      table.senderAgentId,
      table.createdAt,
    ),
    index("company_messages_task_idx").on(table.taskId),
    check(
      "company_messages_sender_type_check",
      sql`${table.senderType} in ('founder', 'agent')`,
    ),
    check(
      "company_messages_source_check",
      sql`${table.source} in ('operator', 'meeting', 'room_reply', 'agent_tool')`,
    ),
    check(
      "company_messages_sender_identity_check",
      sql`(${table.senderType} = 'founder' and ${table.senderAgentId} is null and ${table.source} = 'operator') or (${table.senderType} = 'agent' and ${table.senderAgentId} is not null and ${table.source} in ('meeting', 'room_reply', 'agent_tool'))`,
    ),
    check(
      "company_messages_content_check",
      sql`char_length(btrim(${table.content})) between 1 and 4000`,
    ),
  ],
);

export const insertCompanyChannelSchema = createInsertSchema(
  companyChannelsTable,
).omit({ id: true, createdAt: true });
export const insertCompanyMessageSchema = createInsertSchema(
  companyMessagesTable,
).omit({ id: true, createdAt: true });
export const insertCompanyChannelMemberSchema = createInsertSchema(
  companyChannelMembersTable,
).omit({ joinedAt: true });

export type InsertCompanyChannel = z.infer<typeof insertCompanyChannelSchema>;
export type CompanyChannel = typeof companyChannelsTable.$inferSelect;
export type InsertCompanyMessage = z.infer<typeof insertCompanyMessageSchema>;
export type CompanyMessage = typeof companyMessagesTable.$inferSelect;
export type InsertCompanyChannelMember = z.infer<
  typeof insertCompanyChannelMemberSchema
>;
export type CompanyChannelMember =
  typeof companyChannelMembersTable.$inferSelect;
