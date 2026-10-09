import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { tasksTable } from "./tasks";

/** Backend-only ownership/checkpoint metadata. No prompts, messages, account
 * profile, credentials or raw app-server events are stored here. The immutable
 * protected registration ID supplies account identity without a plaintext ID. */
export const codexTaskSessionsTable = pgTable(
  "codex_task_sessions",
  {
    taskId: integer("task_id")
      .primaryKey()
      .references(() => tasksTable.id, { onDelete: "cascade" }),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "restrict" }),
    revision: bigint("revision", { mode: "number" }).notNull(),
    state: text("state").notNull(),
    cleanupState: text("cleanup_state").notNull().default("unknown"),
    cleanupAt: timestamp("cleanup_at", { withTimezone: true }),
    ownerToken: uuid("owner_token"),
    attemptId: text("attempt_id").notNull(),
    leaseOwner: text("lease_owner").notNull(),
    policyRevision: integer("policy_revision").notNull(),
    registrationId: text("registration_id").notNull(),
    registrationRevision: bigint("registration_revision", {
      mode: "number",
    }).notNull(),
    admissionVersion: integer("admission_version").notNull(),
    hostId: text("host_id").notNull(),
    cwd: text("cwd").notNull(),
    storageDirectory: text("storage_directory").notNull(),
    home: text("home").notNull(),
    model: text("model").notNull(),
    executableDigest: text("executable_digest").notNull(),
    // Preserve the source workspace's admission version independently of
    // source row lifetime and of the original repository path.
    sourceChangeId: uuid("source_change_id"),
    sourceChangeRevision: integer("source_change_revision"),
    threadId: text("thread_id"),
    lastTurnId: text("last_turn_id"),
    promptTokens: bigint("prompt_tokens", { mode: "number" }),
    completionTokens: bigint("completion_tokens", { mode: "number" }),
    totalTokens: bigint("total_tokens", { mode: "number" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "codex_task_sessions_source_workspace",
      sql`(${table.sourceChangeId} IS NULL AND ${table.sourceChangeRevision} IS NULL) OR (${table.sourceChangeId} IS NOT NULL AND ${table.sourceChangeRevision} IS NOT NULL AND ${table.sourceChangeRevision} > 0)`,
    ),
    check(
      "codex_task_sessions_cleanup",
      sql`${table.cleanupState} IN ('unknown','not_launched','verified') AND ((${table.cleanupState} = 'unknown' AND ${table.cleanupAt} IS NULL) OR (${table.cleanupState} <> 'unknown' AND ${table.cleanupAt} IS NOT NULL)) AND (${table.state} <> 'running' OR ${table.cleanupState} = 'unknown')`,
    ),
    check(
      "codex_task_sessions_state",
      sql`${table.state} IN ('running','ready','uncertain','reset') AND ((${table.state} = 'running' AND ${table.ownerToken} IS NOT NULL) OR (${table.state} <> 'running' AND ${table.ownerToken} IS NULL))`,
    ),
    check(
      "codex_task_sessions_revision",
      sql`${table.revision} BETWEEN 1 AND 9007199254740991 AND ${table.registrationRevision} BETWEEN 1 AND 9007199254740991 AND ${table.policyRevision} > 0 AND ${table.admissionVersion} >= 0`,
    ),
    check(
      "codex_task_sessions_identifiers",
      sql`${table.attemptId} ~ '^[a-zA-Z0-9_:-]{1,160}$' AND ${table.leaseOwner} ~ '^[a-zA-Z0-9_:-]{1,160}$' AND ${table.registrationId} ~ '^[a-zA-Z0-9_:-]{1,160}$' AND octet_length(${table.hostId}) BETWEEN 1 AND 512 AND octet_length(${table.model}) BETWEEN 1 AND 160 AND ${table.executableDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "codex_task_sessions_paths",
      sql`octet_length(${table.cwd}) BETWEEN 1 AND 4096 AND octet_length(${table.storageDirectory}) BETWEEN 1 AND 4096 AND octet_length(${table.home}) BETWEEN 1 AND 4096`,
    ),
    check(
      "codex_task_sessions_checkpoint",
      sql`((${table.threadId} IS NULL AND ${table.lastTurnId} IS NULL AND ${table.promptTokens} IS NULL AND ${table.completionTokens} IS NULL AND ${table.totalTokens} IS NULL) OR (${table.threadId} IS NOT NULL AND ${table.lastTurnId} IS NOT NULL AND ${table.threadId} ~ '^[a-zA-Z0-9_:-]{1,160}$' AND ${table.lastTurnId} ~ '^[a-zA-Z0-9_:-]{1,160}$'))`,
    ),
    check(
      "codex_task_sessions_usage",
      sql`((${table.promptTokens} IS NULL AND ${table.completionTokens} IS NULL AND ${table.totalTokens} IS NULL) OR (${table.promptTokens} IS NOT NULL AND ${table.completionTokens} IS NOT NULL AND ${table.totalTokens} IS NOT NULL AND ${table.promptTokens} BETWEEN 0 AND 9007199254740991 AND ${table.completionTokens} BETWEEN 0 AND 9007199254740991 AND ${table.totalTokens} BETWEEN 0 AND 9007199254740991 AND ${table.totalTokens} >= ${table.promptTokens} AND ${table.totalTokens} >= ${table.completionTokens}))`,
    ),
  ],
);
