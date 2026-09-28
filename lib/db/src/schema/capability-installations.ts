import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const capabilityInstallationsTable = pgTable(
  "capability_installations",
  {
    id: text("id").primaryKey(),
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    revision: integer("revision").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "capability_installations_namespace",
      sql`${table.id} ~ '^user-[a-z0-9][a-z0-9-]{0,59}$'`,
    ),
    check("capability_installations_revision", sql`${table.revision} >= 1`),
  ],
);
export const capabilityPreferencesTable = pgTable(
  "capability_preferences",
  {
    id: integer("id").primaryKey().default(1),
    enabledPacks: jsonb("enabled_packs")
      .$type<string[]>()
      .notNull()
      .default(sql`'["data","documents","web","code","planning"]'::jsonb`),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [check("capability_preferences_singleton", sql`${table.id} = 1`)],
);
