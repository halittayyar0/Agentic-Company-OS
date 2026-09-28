import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Kept independently of the live roster: deleting an agent must never allow
// an old installation request to create a replacement team on replay.
export const workforceInstallationsTable = pgTable(
  "workforce_installations",
  {
    requestId: uuid("request_id").primaryKey(),
    requestHash: text("request_hash").notNull(),
    blueprintKey: text("blueprint_key").notNull(),
    blueprintVersion: integer("blueprint_version").notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "workforce_installations_hash_check",
      sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "workforce_installations_version_check",
      sql`${table.blueprintVersion} >= 1`,
    ),
    check(
      "workforce_installations_response_check",
      sql`jsonb_typeof(${table.response}) = 'object'`,
    ),
  ],
);
