import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { approvalRequestsTable } from "./approval-requests";
import { codexTaskSessionsTable } from "./codex-task-sessions";
import { agentsTable } from "./agents";

/** Backend-only live native review/receipt metadata. The public approval row
 * holds the bounded exact preview; actionPayload MUST remain null so the
 * ordinary approved-action executor cannot repeat a Codex effect. An accepted
 * human decision, consumed capability and terminal native receipt are distinct.
 * Current support serializes human prompts within one owned task session. */
export const codexActionApprovalsTable = pgTable(
  "codex_action_approvals",
  {
    approvalId: integer("approval_id")
      .primaryKey()
      .references(() => approvalRequestsTable.id, { onDelete: "cascade" }),
    taskId: integer("task_id")
      .notNull()
      .references(() => codexTaskSessionsTable.taskId, { onDelete: "cascade" }),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "restrict" }),
    sessionRevision: bigint("session_revision", { mode: "number" }).notNull(),
    sessionOwnerToken: uuid("session_owner_token").notNull(),
    attemptId: text("attempt_id").notNull(),
    leaseOwner: text("lease_owner").notNull(),
    policyRevision: integer("policy_revision").notNull(),
    registrationId: text("registration_id").notNull(),
    registrationRevision: bigint("registration_revision", {
      mode: "number",
    }).notNull(),
    admissionVersion: integer("admission_version").notNull(),
    threadId: text("thread_id").notNull(),
    turnId: text("turn_id").notNull(),
    itemId: text("item_id").notNull(),
    requestKey: text("request_key").notNull(),
    actionStartedAtMs: bigint("action_started_at_ms", {
      mode: "number",
    }).notNull(),
    actionRevision: integer("action_revision").notNull(),
    actionDigest: text("action_digest").notNull(),
    effectType: text("effect_type").notNull(),
    state: text("state").notNull(),
    decision: text("decision"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    invalidationReason: text("invalidation_reason"),
    nativeStatus: text("native_status"),
    nativeExitCode: integer("native_exit_code"),
    nativeCompletedAtMs: bigint("native_completed_at_ms", { mode: "number" }),
  },
  (table) => [
    uniqueIndex("codex_action_approvals_live_task")
      .on(table.taskId)
      .where(sql`${table.state} IN ('awaiting','consumed')`),
    uniqueIndex("codex_action_approvals_native_request").on(
      table.sessionOwnerToken,
      table.threadId,
      table.turnId,
      table.requestKey,
    ),
    index("codex_action_approvals_task_created").on(
      table.taskId,
      table.createdAt,
    ),
    check(
      "codex_action_approvals_bounds",
      sql`${table.sessionRevision} BETWEEN 1 AND 9007199254740991 AND ${table.registrationRevision} BETWEEN 1 AND 9007199254740991 AND ${table.policyRevision} > 0 AND ${table.admissionVersion} >= 0 AND ${table.actionRevision} > 0 AND ${table.actionStartedAtMs} BETWEEN 0 AND 9007199254740991 AND ${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "codex_action_approvals_scope",
      sql`${table.attemptId} ~ '^[a-zA-Z0-9_:-]{1,160}$' AND ${table.leaseOwner} ~ '^[a-zA-Z0-9_:-]{1,160}$' AND ${table.registrationId} ~ '^[a-zA-Z0-9_:-]{1,160}$' AND ${table.threadId} ~ '^[a-zA-Z0-9_:-]{1,160}$' AND ${table.turnId} ~ '^[a-zA-Z0-9_:-]{1,160}$' AND ${table.itemId} ~ '^[a-zA-Z0-9_:-]{1,160}$' AND ${table.requestKey} ~ '^(string:[a-zA-Z0-9_:-]{1,160}|number:[0-9]{1,16})$' AND ${table.actionDigest} ~ '^[a-f0-9]{64}$' AND ${table.effectType} IN ('commandExecution','fileChange')`,
    ),
    check(
      "codex_action_approvals_invalidation",
      sql`((${table.invalidatedAt} IS NULL AND ${table.invalidationReason} IS NULL AND ${table.state} NOT IN ('invalidated','uncertain')) OR (${table.invalidatedAt} IS NOT NULL AND ${table.invalidationReason} IS NOT NULL AND ${table.invalidationReason} ~ '^[a-z_]{1,80}$' AND ${table.state} IN ('invalidated','uncertain')))`,
    ),
    check(
      "codex_action_approvals_consumption",
      sql`((${table.state} IN ('awaiting','invalidated') AND ${table.consumedAt} IS NULL AND ${table.decision} IS NULL) OR (${table.state} IN ('consumed','receipted','uncertain') AND ${table.consumedAt} IS NOT NULL AND ${table.decision} IS NOT NULL AND ${table.decision} IN ('accept','decline','cancel')))`,
    ),
    check(
      "codex_action_approvals_receipt",
      sql`((${table.state} <> 'receipted' AND ${table.nativeStatus} IS NULL AND ${table.nativeExitCode} IS NULL AND ${table.nativeCompletedAtMs} IS NULL) OR (${table.state} = 'receipted' AND ${table.nativeStatus} IS NOT NULL AND ${table.nativeStatus} IN ('completed','failed','declined') AND ${table.nativeCompletedAtMs} IS NOT NULL AND ${table.nativeCompletedAtMs} BETWEEN ${table.actionStartedAtMs} AND 9007199254740991 AND ((${table.effectType} = 'fileChange' AND ${table.nativeExitCode} IS NULL) OR (${table.effectType} = 'commandExecution' AND (${table.nativeStatus} <> 'completed' OR (${table.nativeExitCode} IS NOT NULL AND ${table.nativeExitCode} = 0)))) AND (${table.decision} = 'accept' OR ${table.nativeStatus} <> 'completed')))`,
    ),
  ],
);
