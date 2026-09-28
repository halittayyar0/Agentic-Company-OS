import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const operatorRequestKinds = [
  "terminal_sandbox",
  "terminal_host",
  "browser_take_over",
  "browser_navigate",
  "browser_input",
  "browser_release",
  "browser_close",
] as const;
export type OperatorRequestKind = (typeof operatorRequestKinds)[number];
export const operatorRequestStates = [
  "reserved",
  "dispatched",
  "complete",
  "not_dispatched",
  "unknown",
] as const;
export type OperatorRequestState = (typeof operatorRequestStates)[number];
export const operatorRequestFailureCodes = [
  "execution_blocked",
  "authority_unavailable",
  "invalid_session",
  "transport_unavailable",
  "execution_error",
  "deadline_expired",
  "server_interrupted",
] as const;
export type OperatorRequestFailureCode =
  (typeof operatorRequestFailureCodes)[number];

// No cascade: removing an agent must not make an accepted request reusable.
// Plaintext input, browser leases/images and unstructured errors are excluded.
export const operatorRequestsTable = pgTable(
  "operator_requests",
  {
    requestId: uuid("request_id").primaryKey(),
    agentId: integer("agent_id").notNull(),
    kind: text("kind").$type<OperatorRequestKind>().notNull(),
    requestHash: text("request_hash").notNull(),
    ownerId: uuid("owner_id").notNull(),
    runtimeVersion: integer("runtime_version").notNull(),
    state: text("state").$type<OperatorRequestState>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ok: boolean("ok"),
    exitCode: integer("exit_code"),
    durationMs: integer("duration_ms"),
    failureCode: text("failure_code").$type<OperatorRequestFailureCode>(),
    resultCiphertext: text("result_ciphertext"),
    resultNonce: text("result_nonce"),
    resultAuthTag: text("result_auth_tag"),
  },
  (t) => [
    index("operator_requests_scope_idx").on(
      t.agentId,
      t.createdAt,
      t.requestId,
    ),
    index("operator_requests_active_idx").on(t.agentId, t.state, t.expiresAt),
    check(
      "operator_requests_scope_check",
      sql`${t.agentId} > 0 AND ${t.runtimeVersion} >= 0`,
    ),
    check(
      "operator_requests_kind_check",
      sql`${t.kind} IN ('terminal_sandbox','terminal_host','browser_take_over','browser_navigate','browser_input','browser_release','browser_close')`,
    ),
    check(
      "operator_requests_hash_check",
      sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "operator_requests_failure_check",
      sql`${t.failureCode} IS NULL OR ${t.failureCode} IN ('execution_blocked','authority_unavailable','invalid_session','transport_unavailable','execution_error','deadline_expired','server_interrupted')`,
    ),
    check(
      "operator_requests_cipher_check",
      sql`coalesce(( ${t.resultCiphertext} IS NULL AND ${t.resultNonce} IS NULL AND ${t.resultAuthTag} IS NULL ) OR (octet_length(${t.resultCiphertext}) BETWEEN 1 AND 8388608 AND ${t.resultCiphertext} ~ '^[A-Za-z0-9_-]+$' AND ${t.resultNonce} ~ '^[A-Za-z0-9_-]{16}$' AND ${t.resultAuthTag} ~ '^[A-Za-z0-9_-]{22}$'), false)`,
    ),
    check(
      "operator_requests_state_check",
      sql`coalesce(
    (${t.state} IN ('reserved','dispatched') AND ${t.completedAt} IS NULL AND ${t.failureCode} IS NULL AND ${t.ok} IS NULL AND ${t.exitCode} IS NULL AND ${t.durationMs} IS NULL AND ${t.resultCiphertext} IS NULL AND ((${t.state}='reserved' AND ${t.dispatchedAt} IS NULL) OR (${t.state}='dispatched' AND ${t.dispatchedAt} IS NOT NULL)))
    OR (${t.state} IN ('not_dispatched','unknown') AND ${t.completedAt} IS NOT NULL AND ${t.failureCode} IS NOT NULL AND ${t.ok} IS NULL AND ${t.exitCode} IS NULL AND ${t.durationMs} IS NULL AND ${t.resultCiphertext} IS NULL AND ((${t.state}='not_dispatched' AND ${t.dispatchedAt} IS NULL) OR (${t.state}='unknown' AND ${t.dispatchedAt} IS NOT NULL)))
    OR (${t.state}='complete' AND ${t.completedAt} IS NOT NULL AND ${t.failureCode} IS NULL AND (( ${t.kind} IN ('terminal_sandbox','terminal_host') AND ${t.ok} IS NOT NULL AND (${t.ok}=false OR ${t.exitCode}=0) AND ${t.durationMs} BETWEEN 0 AND 86400000 AND ${t.resultCiphertext} IS NOT NULL ) OR ( ${t.kind} NOT IN ('terminal_sandbox','terminal_host') AND ${t.ok} IS NULL AND ${t.exitCode} IS NULL AND ${t.durationMs} IS NULL AND ${t.resultCiphertext} IS NULL )))
  , false)`,
    ),
  ],
);
export type OperatorRequestRow = typeof operatorRequestsTable.$inferSelect;
