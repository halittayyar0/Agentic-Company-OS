import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { agentsTable } from "./agents";

export const agentAvatarsTable = pgTable(
  "agent_avatars",
  {
    agentId: integer("agent_id")
      .primaryKey()
      .references(() => agentsTable.id, { onDelete: "cascade" }),
    mimeType: text("mime_type").notNull(),
    imageBase64: text("image_base64").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "agent_avatars_mime_type_check",
      sql`${table.mimeType} in ('image/png', 'image/jpeg', 'image/webp')`,
    ),
    check(
      "agent_avatars_image_size_check",
      sql`char_length(${table.imageBase64}) <= 90000`,
    ),
  ],
);

export type AgentAvatarRecord = typeof agentAvatarsTable.$inferSelect;
