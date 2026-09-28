import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export interface CustomExecutionPermissions {
  files: boolean;
  terminal: boolean;
  browser: boolean;
  delegation: boolean;
  sudo: boolean;
}

export const executionPolicyTable = pgTable(
  "execution_policy",
  {
    id: integer("id").primaryKey().default(1),
    mode: text("mode").notNull().default("approval"),
    custom: jsonb("custom").$type<CustomExecutionPermissions>(),
    revision: integer("revision").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("execution_policy_singleton", sql`${table.id} = 1`),
    check("execution_policy_revision", sql`${table.revision} >= 1`),
    check(
      "execution_policy_mode",
      sql`${table.mode} IN ('read_only', 'approval', 'full_access', 'custom')`,
    ),
  ],
);
