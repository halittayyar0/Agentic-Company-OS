import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Singleton, database-coordinated runtime control plane.
 *
 * The row is intentionally persisted instead of held in process memory so a
 * restart or another API replica cannot accidentally resume autonomous work.
 */
export const runtimeControlsTable = pgTable(
  "runtime_controls",
  {
    id: integer("id").primaryKey().default(1),
    emergencyStopEnabled: boolean("emergency_stop_enabled")
      .notNull()
      .default(false),
    emergencyStopReason: text("emergency_stop_reason"),
    version: integer("version").notNull().default(1),
    updatedBy: text("updated_by").notNull().default("system"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("runtime_controls_singleton_check", sql`${table.id} = 1`),
    check("runtime_controls_version_check", sql`${table.version} >= 1`),
  ],
);

export type RuntimeControl = typeof runtimeControlsTable.$inferSelect;
