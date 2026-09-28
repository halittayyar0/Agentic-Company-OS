import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { runtimeInstancesTable } from "./runtime-operations";

export const runtimeControlCommandKinds = [
  "browser_control_state",
  "browser_take_over",
  "browser_heartbeat",
  "browser_release",
  "browser_view",
  "browser_navigate",
  "browser_input",
  "browser_close",
] as const;
export type RuntimeControlCommandKind =
  (typeof runtimeControlCommandKinds)[number];

export const runtimeControlCommandStates = [
  "queued",
  "dispatched",
  "succeeded",
  "failed",
  "unknown",
  "expired",
] as const;
export type RuntimeControlCommandState =
  (typeof runtimeControlCommandStates)[number];

/**
 * Durable ownership metadata for process-local browser sessions. Raw page
 * content, URLs, screenshots, operator input and credentials never enter this
 * table (or PostgreSQL WAL).
 */
export const runtimeBrowserSessionsTable = pgTable(
  "runtime_browser_sessions",
  {
    agentId: integer("agent_id")
      .primaryKey()
      .references(() => agentsTable.id, { onDelete: "cascade" }),
    runtimeInstanceId: text("runtime_instance_id")
      .notNull()
      .references(() => runtimeInstancesTable.id, { onDelete: "cascade" }),
    runtimeStartedAt: timestamp("runtime_started_at", {
      withTimezone: true,
    }).notNull(),
    browserSessionId: text("browser_session_id").notNull(),
    browserSessionEpoch: integer("browser_session_epoch").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("runtime_browser_sessions_runtime_idx").on(table.runtimeInstanceId),
    index("runtime_browser_sessions_observed_idx").on(table.observedAt),
    check(
      "runtime_browser_sessions_epoch_check",
      sql`${table.browserSessionEpoch} > 0`,
    ),
    check(
      "runtime_browser_sessions_bounded_text_check",
      sql`octet_length(${table.browserSessionId}) between 1 and 256`,
    ),
  ],
);

/**
 * Audit/ack metadata for the in-memory encrypted command transport. The
 * payload digest proves which command was dispatched without persisting the
 * payload itself. At-most-once commands are never re-queued after dispatch.
 */
export const runtimeControlCommandsTable = pgTable(
  "runtime_control_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetRuntimeInstanceId: text("target_runtime_instance_id")
      .notNull()
      .references(() => runtimeInstancesTable.id, { onDelete: "restrict" }),
    targetRuntimeStartedAt: timestamp("target_runtime_started_at", {
      withTimezone: true,
    }).notNull(),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "restrict" }),
    kind: text("kind").$type<RuntimeControlCommandKind>().notNull(),
    state: text("state")
      .$type<RuntimeControlCommandState>()
      .notNull()
      .default("queued"),
    payloadDigest: text("payload_digest").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    resultDigest: text("result_digest"),
    failureKind: text("failure_kind"),
    sanitizedError: text("sanitized_error"),
  },
  (table) => [
    index("runtime_control_commands_target_state_idx").on(
      table.targetRuntimeInstanceId,
      table.state,
      table.requestedAt,
    ),
    index("runtime_control_commands_agent_idx").on(
      table.agentId,
      table.requestedAt,
    ),
    check(
      "runtime_control_commands_kind_check",
      sql`${table.kind} in ('browser_control_state', 'browser_take_over', 'browser_heartbeat', 'browser_release', 'browser_view', 'browser_navigate', 'browser_input', 'browser_close')`,
    ),
    check(
      "runtime_control_commands_state_check",
      sql`${table.state} in ('queued', 'dispatched', 'succeeded', 'failed', 'unknown', 'expired')`,
    ),
    check(
      "runtime_control_commands_timestamps_check",
      sql`(
        (${table.state} = 'queued' and ${table.dispatchedAt} is null and ${table.finishedAt} is null)
        or (${table.state} = 'dispatched' and ${table.dispatchedAt} is not null and ${table.finishedAt} is null)
        or (${table.state} in ('succeeded', 'failed', 'unknown', 'expired') and ${table.finishedAt} is not null)
      )`,
    ),
    check(
      "runtime_control_commands_expiry_check",
      sql`${table.expiresAt} > ${table.requestedAt}`,
    ),
    check(
      "runtime_control_commands_bounded_text_check",
      sql`octet_length(${table.payloadDigest}) between 32 and 256
        and (${table.resultDigest} is null or octet_length(${table.resultDigest}) between 32 and 256)
        and (${table.failureKind} is null or octet_length(${table.failureKind}) between 1 and 128)
        and (${table.sanitizedError} is null or octet_length(${table.sanitizedError}) between 1 and 1024)`,
    ),
  ],
);

/** Singleton encrypted desired provider configuration. */
export const providerRuntimeConfigTable = pgTable(
  "provider_runtime_config",
  {
    singletonId: integer("singleton_id").primaryKey().default(1),
    revision: bigint("revision", { mode: "number" }).notNull(),
    ciphertext: text("ciphertext").notNull(),
    nonce: text("nonce").notNull(),
    authTag: text("auth_tag").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "provider_runtime_config_singleton_check",
      sql`${table.singletonId} = 1`,
    ),
    check(
      "provider_runtime_config_revision_check",
      sql`${table.revision} >= 1`,
    ),
    check(
      "provider_runtime_config_envelope_check",
      sql`octet_length(${table.ciphertext}) between 1 and 4096
        and octet_length(${table.nonce}) between 16 and 64
        and octet_length(${table.authTag}) between 16 and 64`,
    ),
  ],
);

export const providerRuntimeConfigAckStates = ["applied", "failed"] as const;
export type ProviderRuntimeConfigAckState =
  (typeof providerRuntimeConfigAckStates)[number];

export const providerRuntimeConfigAcksTable = pgTable(
  "provider_runtime_config_acks",
  {
    runtimeInstanceId: text("runtime_instance_id")
      .primaryKey()
      .references(() => runtimeInstancesTable.id, { onDelete: "cascade" }),
    runtimeStartedAt: timestamp("runtime_started_at", {
      withTimezone: true,
    }).notNull(),
    attemptedRevision: bigint("attempted_revision", {
      mode: "number",
    }).notNull(),
    appliedRevision: bigint("applied_revision", { mode: "number" })
      .notNull()
      .default(0),
    state: text("state").$type<ProviderRuntimeConfigAckState>().notNull(),
    sanitizedError: text("sanitized_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("provider_runtime_config_acks_revision_idx").on(
      table.attemptedRevision,
      table.state,
    ),
    check(
      "provider_runtime_config_acks_state_check",
      sql`${table.state} in ('applied', 'failed')`,
    ),
    check(
      "provider_runtime_config_acks_revision_check",
      sql`${table.attemptedRevision} >= 1 and ${table.appliedRevision} >= 0 and ${table.appliedRevision} <= ${table.attemptedRevision}`,
    ),
    check(
      "provider_runtime_config_acks_error_check",
      sql`(
        (${table.state} = 'applied' and ${table.appliedRevision} = ${table.attemptedRevision} and ${table.sanitizedError} is null)
        or (${table.state} = 'failed' and ${table.sanitizedError} is not null and octet_length(${table.sanitizedError}) between 1 and 1024)
      )`,
    ),
  ],
);
