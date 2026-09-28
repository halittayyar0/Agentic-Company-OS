import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { agentsTable } from "./agents";
import { runtimeInstancesTable } from "./runtime-operations";
import { tasksTable } from "./tasks";

export const approvalCategoryValues = [
  "spend",
  "delete",
  "publish",
  "external_contact",
  "other",
] as const;
export type ApprovalCategory = (typeof approvalCategoryValues)[number];

export const approvalStatusValues = [
  "pending",
  "approved",
  "rejected",
] as const;
export type ApprovalStatus = (typeof approvalStatusValues)[number];

export interface ApprovalScope {
  toolName: string;
  argsHash: string;
  target?: string | null;
  preview?: string | null;
}

export interface ApprovalActionPayload {
  toolName: string;
  args: Record<string, unknown>;
  /**
   * Server-derived lifecycle intent. An approval requested from an existing
   * task resumes that task; a chat-created, single-action approval owns a
   * synthetic task that can be completed when the exact action succeeds.
   * Older rows omit this field and are handled conservatively as `resume`.
   */
  taskDisposition?: "resume" | "complete";
}

export const approvalRequestsTable = pgTable(
  "approval_requests",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasksTable.id, { onDelete: "restrict" }),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "restrict" }),
    category: text("category").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    amountUsd: numeric("amount_usd", { precision: 10, scale: 2 }),
    scope: jsonb("scope").$type<ApprovalScope>(),
    // Internal-only capability payload. API response schemas deliberately omit
    // it; the server consumes it once after an explicit approval decision.
    actionPayload: jsonb("action_payload").$type<ApprovalActionPayload>(),
    status: text("status").notNull().default("pending"),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    browserRuntimeInstanceId: text("browser_runtime_instance_id").references(
      () => runtimeInstancesTable.id,
      { onDelete: "restrict" },
    ),
    browserSessionId: text("browser_session_id"),
    browserSessionEpoch: integer("browser_session_epoch"),
    browserSnapshotMarker: text("browser_snapshot_marker"),
    browserBindingHash: text("browser_binding_hash"),
    bindingInvalidatedAt: timestamp("binding_invalidated_at", {
      withTimezone: true,
    }),
    bindingInvalidationReason: text("binding_invalidation_reason"),
  },
  (table) => [
    index("approval_requests_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    index("approval_requests_agent_created_idx").on(
      table.agentId,
      table.createdAt,
    ),
    index("approval_requests_task_created_idx").on(
      table.taskId,
      table.createdAt,
    ),
    index("approval_requests_status_expiry_idx").on(
      table.status,
      table.expiresAt,
    ),
    check(
      "approval_requests_category_check",
      sql`${table.category} in ('spend', 'delete', 'publish', 'external_contact', 'other')`,
    ),
    check(
      "approval_requests_status_check",
      sql`${table.status} in ('pending', 'approved', 'rejected')`,
    ),
    check(
      "approval_requests_amount_check",
      sql`${table.amountUsd} is null or ${table.amountUsd} >= 0`,
    ),
    check(
      "approval_requests_browser_binding_check",
      sql`(
        (${table.browserRuntimeInstanceId} is null and ${table.browserSessionId} is null and ${table.browserSessionEpoch} is null and ${table.browserSnapshotMarker} is null and ${table.browserBindingHash} is null)
        or (${table.browserRuntimeInstanceId} is not null and ${table.browserSessionId} is not null and ${table.browserSessionEpoch} is not null and ${table.browserSessionEpoch} >= 0 and ${table.browserSnapshotMarker} is not null and ${table.browserBindingHash} is not null)
      )`,
    ),
    check(
      "approval_requests_binding_invalidation_check",
      sql`((${table.bindingInvalidatedAt} is null and ${table.bindingInvalidationReason} is null) or (${table.bindingInvalidatedAt} is not null and ${table.bindingInvalidationReason} is not null and ${table.browserBindingHash} is not null))`,
    ),
    check(
      "approval_requests_capability_payload_check",
      sql`(${table.consumedAt} is null or ${table.actionPayload} is null)
        and (${table.bindingInvalidatedAt} is null or ${table.actionPayload} is null)
        and (${table.status} <> 'rejected' or ${table.actionPayload} is null)`,
    ),
    check(
      "approval_requests_binding_bounds_check",
      sql`(${table.browserSessionId} is null or octet_length(${table.browserSessionId}) between 1 and 256)
        and (${table.browserSnapshotMarker} is null or octet_length(${table.browserSnapshotMarker}) between 1 and 512)
        and (${table.browserBindingHash} is null or octet_length(${table.browserBindingHash}) between 1 and 256)
        and (${table.bindingInvalidationReason} is null or octet_length(${table.bindingInvalidationReason}) between 1 and 512)`,
    ),
  ],
);

export const insertApprovalRequestSchema = createInsertSchema(
  approvalRequestsTable,
).omit({
  id: true,
  createdAt: true,
  resolvedAt: true,
});
export type InsertApprovalRequest = z.infer<typeof insertApprovalRequestSchema>;
export type ApprovalRequest = typeof approvalRequestsTable.$inferSelect;
