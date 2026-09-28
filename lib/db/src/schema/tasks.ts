import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { agentsTable } from "./agents";

export const taskStatusValues = [
  "pending",
  "planning",
  "in_progress",
  "awaiting_approval",
  "blocked",
  "completed",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = (typeof taskStatusValues)[number];

export const taskPriorityValues = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof taskPriorityValues)[number];

export const taskAutonomyModeValues = ["finite", "continuous"] as const;
export type TaskAutonomyMode = (typeof taskAutonomyModeValues)[number];

export const taskBlockedReasonValues = [
  "user_input",
  "budget",
  "runtime_failure",
  "approval_rejected",
  "approval_expired",
  "approval_outcome_unknown",
  "operation_outcome_unknown",
  "approval_action_failed",
  "owner_inactive",
] as const;
export type TaskBlockedReason = (typeof taskBlockedReasonValues)[number];

export const tasksTable = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    brief: text("brief").notNull(),
    status: text("status").notNull().default("pending"),
    priority: text("priority").notNull().default("normal"),
    ownerAgentId: integer("owner_agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "restrict" }),
    assignedByAgentId: integer("assigned_by_agent_id").references(
      () => agentsTable.id,
      { onDelete: "set null" },
    ),
    createdByUser: boolean("created_by_user").notNull().default(false),
    parentTaskId: integer("parent_task_id").references(
      (): import("drizzle-orm/pg-core").AnyPgColumn => tasksTable.id,
      { onDelete: "set null" },
    ),
    progressPercent: integer("progress_percent").notNull().default(0),
    tokensUsed: integer("tokens_used").notNull().default(0),
    estimatedCostUsd: numeric("estimated_cost_usd", {
      precision: 12,
      scale: 6,
    }),
    resultSummary: text("result_summary"),
    // A manual agent selection is snapshotted when the task is created. This
    // keeps unattended/continuous work on the user-selected primary model even
    // if the agent's later chat default changes. Null deliberately means
    // "inherit automatic routing at each scheduler step".
    executionModelId: text("execution_model_id"),
    lastModelId: text("last_model_id"),
    lastModelProvider: text("last_model_provider"),
    modelFallbackCount: integer("model_fallback_count").notNull().default(0),
    autonomyMode: text("autonomy_mode").notNull().default("finite"),
    cadenceSeconds: integer("cadence_seconds"),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    recoveryCount: integer("recovery_count").notNull().default(0),
    cycleCount: integer("cycle_count").notNull().default(0),
    lastCycleCompletedAt: timestamp("last_cycle_completed_at", {
      withTimezone: true,
    }),
    lastSteppedAt: timestamp("last_stepped_at", { withTimezone: true }),
    stepAttempts: integer("step_attempts").notNull().default(0),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    blockedReason: text("blocked_reason"),
    userInputQuestionId: uuid("user_input_question_id"),
    userInputQuestion: text("user_input_question"),
    userInputOwnerAgentId: integer("user_input_owner_agent_id"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("tasks_owner_updated_idx").on(table.ownerAgentId, table.updatedAt),
    index("tasks_assigned_by_idx").on(table.assignedByAgentId),
    index("tasks_parent_created_idx").on(table.parentTaskId, table.createdAt),
    index("tasks_status_created_idx").on(table.status, table.createdAt),
    index("tasks_scheduler_idx").on(
      table.status,
      table.nextAttemptAt,
      table.leaseExpiresAt,
      table.updatedAt,
    ),
    check(
      "tasks_status_check",
      sql`${table.status} in ('pending', 'planning', 'in_progress', 'awaiting_approval', 'blocked', 'completed', 'failed', 'cancelled')`,
    ),
    check(
      "tasks_priority_check",
      sql`${table.priority} in ('low', 'normal', 'high', 'urgent')`,
    ),
    check(
      "tasks_autonomy_mode_check",
      sql`${table.autonomyMode} in ('finite', 'continuous')`,
    ),
    check(
      "tasks_cadence_seconds_check",
      sql`${table.cadenceSeconds} is null or ${table.cadenceSeconds} between 60 and 604800`,
    ),
    check(
      "tasks_progress_percent_check",
      sql`${table.progressPercent} between 0 and 100`,
    ),
    check("tasks_tokens_used_check", sql`${table.tokensUsed} >= 0`),
    check("tasks_step_attempts_check", sql`${table.stepAttempts} >= 0`),
    check(
      "tasks_consecutive_failures_check",
      sql`${table.consecutiveFailures} >= 0`,
    ),
    check("tasks_recovery_count_check", sql`${table.recoveryCount} >= 0`),
    check("tasks_cycle_count_check", sql`${table.cycleCount} >= 0`),
    check(
      "tasks_blocked_reason_check",
      sql`${table.blockedReason} is null or (${table.status} = 'blocked' and ${table.blockedReason} in ('user_input', 'budget', 'runtime_failure', 'approval_rejected', 'approval_expired', 'approval_outcome_unknown', 'operation_outcome_unknown', 'approval_action_failed', 'owner_inactive'))`,
    ),
    check(
      "tasks_model_fallback_count_check",
      sql`${table.modelFallbackCount} >= 0`,
    ),
    check(
      "tasks_estimated_cost_check",
      sql`${table.estimatedCostUsd} is null or ${table.estimatedCostUsd} >= 0`,
    ),
  ],
);

export const insertTaskSchema = createInsertSchema(tasksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
