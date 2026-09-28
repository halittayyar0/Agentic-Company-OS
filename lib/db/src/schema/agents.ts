import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tasksTable } from "./tasks";

export const agentStatusValues = [
  "idle",
  "working",
  "blocked",
  "archived",
] as const;
export type AgentStatus = (typeof agentStatusValues)[number];

export const agentModelModeValues = ["auto", "manual"] as const;
export type AgentModelMode = (typeof agentModelModeValues)[number];

export interface AgentPermissions {
  canCreateSubAgents: boolean;
  canDelegate: boolean;
  canSpend: boolean;
  canDelete: boolean;
  canPublish: boolean;
  canContactExternal: boolean;
  canBrowse: boolean;
  canUseTerminal: boolean;
  /**
   * Allows the agent to propose a full-authority host-shell command. Every
   * invocation is still gated by ALLOW_AGENT_SUDO and an exact, single-use
   * human approval.
   */
  canUseSudo: boolean;
}

export const defaultAgentPermissions: AgentPermissions = {
  canCreateSubAgents: false,
  canDelegate: false,
  canSpend: false,
  canDelete: false,
  canPublish: false,
  canContactExternal: false,
  canBrowse: true,
  canUseTerminal: true,
  canUseSudo: false,
};

export const agentsTable = pgTable(
  "agents",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    department: text("department"),
    parentAgentId: integer("parent_agent_id").references(
      (): AnyPgColumn => agentsTable.id,
      { onDelete: "set null" },
    ),
    depth: integer("depth").notNull().default(0),
    status: text("status").notNull().default("idle"),
    currentTaskId: integer("current_task_id").references(
      (): AnyPgColumn => tasksTable.id,
      { onDelete: "set null" },
    ),
    currentAction: text("current_action"),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    runLeaseOwner: text("run_lease_owner"),
    runLeaseExpiresAt: timestamp("run_lease_expires_at", {
      withTimezone: true,
    }),
    systemPrompt: text("system_prompt").notNull(),
    isCustomPrompt: boolean("is_custom_prompt").notNull().default(false),
    templateKey: text("template_key"),
    // Server-managed capability identity. API create/update payloads must never
    // accept this value from a caller.
    isRootCeo: boolean("is_root_ceo").notNull().default(false),
    modelMode: text("model_mode").notNull().default("auto"),
    modelId: text("model_id"),
    avatarColor: text("avatar_color").notNull().default("#6366f1"),
    avatarVersion: text("avatar_version"),
    permissions: jsonb("permissions")
      .$type<AgentPermissions>()
      .notNull()
      .default(defaultAgentPermissions),
    createdByAgentId: integer("created_by_agent_id").references(
      (): AnyPgColumn => agentsTable.id,
      { onDelete: "set null" },
    ),
    createdByUser: boolean("created_by_user").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("agents_parent_agent_idx").on(table.parentAgentId),
    index("agents_current_task_idx").on(table.currentTaskId),
    index("agents_created_by_agent_idx").on(table.createdByAgentId),
    index("agents_scheduler_idx").on(
      table.isActive,
      table.status,
      table.runLeaseExpiresAt,
    ),
    uniqueIndex("agents_single_root_ceo_idx")
      .on(table.isRootCeo)
      .where(sql`${table.isRootCeo} = true`),
    check(
      "agents_status_check",
      sql`${table.status} in ('idle', 'working', 'blocked', 'archived')`,
    ),
    check(
      "agents_model_mode_check",
      sql`${table.modelMode} in ('auto', 'manual')`,
    ),
    check(
      "agents_avatar_version_check",
      sql`${table.avatarVersion} is null or char_length(${table.avatarVersion}) <= 64`,
    ),
    check("agents_depth_check", sql`${table.depth} >= 0`),
  ],
);

export const insertAgentSchema = createInsertSchema(agentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agentsTable.$inferSelect;
