import {
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { agentsTable } from "./agents";

export const sourceChangesTable = pgTable(
  "source_changes",
  {
    id: uuid("id").primaryKey(),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "restrict" }),
    sourcePath: text("source_path").notNull(),
    baseCommit: text("base_commit").notNull(),
    request: text("request").notNull(),
    state: text("state").notNull().default("preparing"),
    revision: integer("revision").notNull().default(1),
    candidateCommit: text("candidate_commit"),
    candidatePath: text("candidate_path"),
    appliedCommit: text("applied_commit"),
    taskId: integer("task_id"),
    check: jsonb("check").$type<{
      command: string[];
      commands?: string[][];
      exitCode: number | null;
      output: string;
      passed: boolean;
    }>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "source_changes_state",
      sql`${table.state} IN ('preparing','draft','checking','verified','applying','applied','rolling_back','rolled_back','failed','unknown')`,
    ),
    check("source_changes_revision", sql`${table.revision} >= 1`),
  ],
);
