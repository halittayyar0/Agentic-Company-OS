import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { approvalRequestsTable } from "./approval-requests";
import { messagesTable } from "./messages";
import { tasksTable } from "./tasks";

export const runtimeInstanceRoles = ["api", "worker", "combined"] as const;
export type RuntimeInstanceRole = (typeof runtimeInstanceRoles)[number];

export const runtimeInstanceStates = [
  "starting",
  "healthy",
  "draining",
  "stale",
  "stopped",
] as const;
export type RuntimeInstanceState = (typeof runtimeInstanceStates)[number];

export const taskAttemptStates = [
  "claimed",
  "running",
  "succeeded",
  "retrying",
  "blocked",
  "lost",
] as const;
export type TaskAttemptState = (typeof taskAttemptStates)[number];

export const operationSideEffectClasses = [
  "read_only",
  "transactional",
  "idempotent",
  "at_most_once",
  "approval_at_most_once",
] as const;
export type OperationSideEffectClass =
  (typeof operationSideEffectClasses)[number];

export const operationReceiptStates = [
  "reserved",
  "running",
  "succeeded",
  "failed",
  "unknown",
] as const;
export type OperationReceiptState = (typeof operationReceiptStates)[number];

export const operationExecutionKinds = [
  "task_step",
  "approved_action",
  "chat_turn",
] as const;
export type OperationExecutionKind = (typeof operationExecutionKinds)[number];

export const operationInvocationStates = [
  "claimed",
  "running",
  "succeeded",
  "failed",
  "unknown",
] as const;
export type OperationInvocationState =
  (typeof operationInvocationStates)[number];

export const operationReconciliationDecisions = [
  "confirmed_applied",
  "confirmed_not_applied",
] as const;
export type OperationReconciliationDecision =
  (typeof operationReconciliationDecisions)[number];

export const runtimeTruthStates = [
  "live",
  "degraded",
  "stale",
  "offline",
  "emergency_stopped",
  "local_demo",
] as const;
export type RuntimeTruthState = (typeof runtimeTruthStates)[number];

export const providerMetricsCoverageValues = ["partial", "complete"] as const;
export type ProviderMetricsCoverage =
  (typeof providerMetricsCoverageValues)[number];

export const runtimeInstancesTable = pgTable(
  "runtime_instances",
  {
    id: text("id").primaryKey(),
    role: text("role").$type<RuntimeInstanceRole>().notNull(),
    state: text("state")
      .$type<RuntimeInstanceState>()
      .notNull()
      .default("starting"),
    hostname: text("hostname").notNull(),
    processId: integer("process_id").notNull(),
    buildVersion: text("build_version").notNull(),
    capabilities: jsonb("capabilities")
      .$type<Record<string, boolean>>()
      .notNull()
      .default({}),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    drainingAt: timestamp("draining_at", { withTimezone: true }),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    schedulerEnabled: boolean("scheduler_enabled").notNull().default(false),
    lastSchedulerTickAt: timestamp("last_scheduler_tick_at", {
      withTimezone: true,
    }),
  },
  (table) => [
    index("runtime_instances_last_heartbeat_idx").on(table.lastHeartbeatAt),
    index("runtime_instances_role_heartbeat_idx").on(
      table.role,
      table.lastHeartbeatAt,
    ),
    index("runtime_instances_state_idx").on(table.state),
    check(
      "runtime_instances_role_check",
      sql`${table.role} in ('api', 'worker', 'combined')`,
    ),
    check(
      "runtime_instances_state_check",
      sql`${table.state} in ('starting', 'healthy', 'draining', 'stale', 'stopped')`,
    ),
    check("runtime_instances_process_id_check", sql`${table.processId} > 0`),
  ],
);

export const taskAttemptsTable = pgTable(
  "task_attempts",
  {
    id: text("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasksTable.id, { onDelete: "restrict" }),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "restrict" }),
    workerInstanceId: text("worker_instance_id")
      .notNull()
      .references(() => runtimeInstancesTable.id, { onDelete: "restrict" }),
    leaseOwner: text("lease_owner").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    cycleNumber: integer("cycle_number").notNull(),
    state: text("state").$type<TaskAttemptState>().notNull().default("claimed"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    modelId: text("model_id"),
    provider: text("provider"),
    failureKind: text("failure_kind"),
    sanitizedError: text("sanitized_error"),
    recoveryOfAttemptId: text("recovery_of_attempt_id").references(
      (): import("drizzle-orm/pg-core").AnyPgColumn => taskAttemptsTable.id,
      { onDelete: "set null" },
    ),
    logicalExecutionId: uuid("logical_execution_id").defaultRandom().notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    reportedCostUsd: numeric("reported_cost_usd", {
      precision: 12,
      scale: 6,
    }),
  },
  (table) => [
    index("task_attempts_task_id_idx").on(table.taskId),
    index("task_attempts_task_started_idx").on(
      table.taskId,
      table.startedAt,
      table.id,
    ),
    index("task_attempts_worker_instance_id_idx").on(table.workerInstanceId),
    index("task_attempts_state_idx").on(table.state),
    index("task_attempts_state_heartbeat_idx").on(
      table.state,
      table.lastHeartbeatAt,
    ),
    check(
      "task_attempts_state_check",
      sql`${table.state} in ('claimed', 'running', 'succeeded', 'retrying', 'blocked', 'lost')`,
    ),
    check(
      "task_attempts_attempt_number_check",
      sql`${table.attemptNumber} > 0`,
    ),
    check("task_attempts_cycle_number_check", sql`${table.cycleNumber} >= 0`),
    check("task_attempts_prompt_tokens_check", sql`${table.promptTokens} >= 0`),
    check(
      "task_attempts_completion_tokens_check",
      sql`${table.completionTokens} >= 0`,
    ),
    check("task_attempts_total_tokens_check", sql`${table.totalTokens} >= 0`),
    check(
      "task_attempts_reported_cost_check",
      sql`${table.reportedCostUsd} is null or ${table.reportedCostUsd} >= 0`,
    ),
  ],
);

export const operationReceiptsTable = pgTable(
  "operation_receipts",
  {
    id: text("id").primaryKey(),
    canonicalVersion: integer("canonical_version").notNull().default(1),
    operationKey: text("operation_key").notNull(),
    replayKey: text("replay_key"),
    executionKind: text("execution_kind")
      .$type<OperationExecutionKind>()
      .notNull(),
    logicalExecutionId: text("logical_execution_id").notNull(),
    taskId: integer("task_id").references(() => tasksTable.id, {
      onDelete: "restrict",
    }),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "restrict" }),
    approvalId: integer("approval_id").references(
      () => approvalRequestsTable.id,
      { onDelete: "restrict" },
    ),
    sourceMessageId: integer("source_message_id").references(
      () => messagesTable.id,
      { onDelete: "restrict" },
    ),
    originAttemptId: text("origin_attempt_id").references(
      () => taskAttemptsTable.id,
      { onDelete: "restrict" },
    ),
    sideEffectClass: text("side_effect_class")
      .$type<OperationSideEffectClass>()
      .notNull(),
    state: text("state")
      .$type<OperationReceiptState>()
      .notNull()
      .default("reserved"),
    toolName: text("tool_name").notNull(),
    argumentHash: text("argument_hash").notNull(),
    externalIdempotencyKey: text("external_idempotency_key"),
    reservedAt: timestamp("reserved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    resultSummary: text("result_summary"),
    resultData: jsonb("result_data").$type<Record<string, unknown>>(),
    failureKind: text("failure_kind"),
    sanitizedError: text("sanitized_error"),
    reconciliationDecision: text(
      "reconciliation_decision",
    ).$type<OperationReconciliationDecision>(),
    reconciliationNote: text("reconciliation_note"),
    reconciliationActorId: text("reconciliation_actor_id"),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("operation_receipts_operation_key_unique").on(
      table.operationKey,
    ),
    uniqueIndex("operation_receipts_replay_key_unique").on(table.replayKey),
    uniqueIndex("operation_receipts_external_idempotency_key_unique").on(
      table.externalIdempotencyKey,
    ),
    index("operation_receipts_task_id_idx").on(table.taskId),
    index("operation_receipts_task_reserved_idx").on(
      table.taskId,
      table.reservedAt,
      table.id,
    ),
    index("operation_receipts_agent_id_idx").on(table.agentId),
    index("operation_receipts_approval_id_idx").on(table.approvalId),
    index("operation_receipts_source_message_id_idx").on(table.sourceMessageId),
    index("operation_receipts_origin_attempt_id_idx").on(table.originAttemptId),
    index("operation_receipts_state_idx").on(table.state),
    check(
      "operation_receipts_canonical_version_check",
      sql`${table.canonicalVersion} > 0`,
    ),
    check(
      "operation_receipts_execution_kind_check",
      sql`(
        (${table.executionKind} = 'task_step' and ${table.taskId} is not null and ${table.originAttemptId} is not null and ${table.approvalId} is null and ${table.sourceMessageId} is null)
        or (${table.executionKind} = 'approved_action' and ${table.taskId} is not null and ${table.originAttemptId} is null and ${table.approvalId} is not null and ${table.sourceMessageId} is null)
        or (${table.executionKind} = 'chat_turn' and ${table.originAttemptId} is null and ${table.approvalId} is null and ${table.sourceMessageId} is not null)
      )`,
    ),
    check(
      "operation_receipts_side_effect_class_check",
      sql`${table.sideEffectClass} in ('read_only', 'transactional', 'idempotent', 'at_most_once', 'approval_at_most_once')`,
    ),
    check(
      "operation_receipts_state_check",
      sql`${table.state} in ('reserved', 'running', 'succeeded', 'failed', 'unknown')`,
    ),
    check(
      "operation_receipts_replay_key_check",
      sql`((${table.sideEffectClass} = 'read_only' and ${table.replayKey} is null) or (${table.sideEffectClass} <> 'read_only' and ${table.replayKey} is not null))`,
    ),
    check(
      "operation_receipts_state_timestamps_check",
      sql`(
        (${table.state} = 'reserved' and ${table.startedAt} is null and ${table.finishedAt} is null)
        or (${table.state} = 'running' and ${table.startedAt} is not null and ${table.finishedAt} is null)
        or (${table.state} in ('succeeded', 'failed', 'unknown') and ${table.finishedAt} is not null)
      )`,
    ),
    check(
      "operation_receipts_reconciliation_check",
      sql`(
        (${table.reconciliationDecision} is null and ${table.reconciliationNote} is null and ${table.reconciliationActorId} is null and ${table.reconciledAt} is null)
        or (${table.state} = 'unknown' and ${table.reconciliationDecision} in ('confirmed_applied', 'confirmed_not_applied') and ${table.reconciliationNote} is not null and ${table.reconciliationActorId} is not null and ${table.reconciledAt} is not null)
      )`,
    ),
    check(
      "operation_receipts_bounded_text_check",
      sql`octet_length(${table.operationKey}) <= 1024
        and (${table.replayKey} is null or octet_length(${table.replayKey}) <= 1024)
        and octet_length(${table.logicalExecutionId}) <= 256
        and octet_length(${table.toolName}) <= 256
        and octet_length(${table.argumentHash}) <= 256
        and (${table.externalIdempotencyKey} is null or octet_length(${table.externalIdempotencyKey}) <= 1024)
        and (${table.resultSummary} is null or octet_length(${table.resultSummary}) <= 4096)
        and (${table.failureKind} is null or octet_length(${table.failureKind}) <= 256)
        and (${table.sanitizedError} is null or octet_length(${table.sanitizedError}) <= 4096)
        and (${table.reconciliationNote} is null or octet_length(${table.reconciliationNote}) between 1 and 2000)
        and (${table.reconciliationActorId} is null or octet_length(${table.reconciliationActorId}) between 1 and 256)`,
    ),
    check(
      "operation_receipts_bounded_result_data_check",
      sql`${table.resultData} is null or octet_length(${table.resultData}::text) <= 16384`,
    ),
  ],
);

export const operationInvocationsTable = pgTable(
  "operation_invocations",
  {
    id: text("id").primaryKey(),
    receiptId: text("receipt_id")
      .notNull()
      .references(() => operationReceiptsTable.id, { onDelete: "restrict" }),
    executionKind: text("execution_kind")
      .$type<OperationExecutionKind>()
      .notNull(),
    state: text("state")
      .$type<OperationInvocationState>()
      .notNull()
      .default("claimed"),
    attemptId: text("attempt_id").references(() => taskAttemptsTable.id, {
      onDelete: "restrict",
    }),
    workerInstanceId: text("worker_instance_id").references(
      () => runtimeInstancesTable.id,
      { onDelete: "restrict" },
    ),
    modelToolCallId: text("model_tool_call_id"),
    leaseOwner: text("lease_owner").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
    }).notNull(),
    taskLeaseOwner: text("task_lease_owner"),
    agentLeaseOwner: text("agent_lease_owner"),
    claimedAt: timestamp("claimed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectStartedAt: timestamp("effect_started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    failureKind: text("failure_kind"),
    sanitizedError: text("sanitized_error"),
  },
  (table) => [
    index("operation_invocations_receipt_id_idx").on(table.receiptId),
    index("operation_invocations_receipt_claimed_idx").on(
      table.receiptId,
      table.claimedAt,
      table.id,
    ),
    index("operation_invocations_attempt_id_idx").on(table.attemptId),
    index("operation_invocations_worker_instance_id_idx").on(
      table.workerInstanceId,
    ),
    index("operation_invocations_state_idx").on(table.state),
    uniqueIndex("operation_invocations_one_active_per_receipt")
      .on(table.receiptId)
      .where(sql`${table.state} in ('claimed', 'running')`),
    check(
      "operation_invocations_execution_kind_check",
      sql`(
        (${table.executionKind} = 'task_step' and ${table.attemptId} is not null and ${table.workerInstanceId} is not null and ${table.taskLeaseOwner} is not null and ${table.agentLeaseOwner} is not null)
        or (${table.executionKind} = 'approved_action' and ${table.attemptId} is null and ${table.workerInstanceId} is not null and ${table.taskLeaseOwner} is null and ${table.agentLeaseOwner} is not null)
        or (${table.executionKind} = 'chat_turn' and ${table.attemptId} is null and ${table.taskLeaseOwner} is null and ${table.agentLeaseOwner} is not null)
      )`,
    ),
    check(
      "operation_invocations_state_check",
      sql`${table.state} in ('claimed', 'running', 'succeeded', 'failed', 'unknown')`,
    ),
    check(
      "operation_invocations_state_timestamps_check",
      sql`(
        (${table.state} = 'claimed' and ${table.effectStartedAt} is null and ${table.finishedAt} is null)
        or (${table.state} = 'running' and ${table.effectStartedAt} is not null and ${table.finishedAt} is null)
        or (${table.state} = 'failed' and ${table.finishedAt} is not null)
        or (${table.state} in ('succeeded', 'unknown') and ${table.effectStartedAt} is not null and ${table.finishedAt} is not null)
      )`,
    ),
    check(
      "operation_invocations_bounded_text_check",
      sql`octet_length(${table.leaseOwner}) <= 1024
        and (${table.taskLeaseOwner} is null or octet_length(${table.taskLeaseOwner}) <= 1024)
        and octet_length(${table.agentLeaseOwner}) <= 1024
        and (${table.modelToolCallId} is null or octet_length(${table.modelToolCallId}) <= 512)
        and (${table.failureKind} is null or octet_length(${table.failureKind}) <= 256)
        and (${table.sanitizedError} is null or octet_length(${table.sanitizedError}) <= 4096)`,
    ),
  ],
);

export const runtimeHealthSamplesTable = pgTable(
  "runtime_health_samples",
  {
    bucketAt: timestamp("bucket_at", { withTimezone: true }).primaryKey(),
    // These fields intentionally remain nullable for pre-0017 rows. Backfilling
    // them would manufacture historical sampler ownership or health truth.
    sampledAt: timestamp("sampled_at", { withTimezone: true }),
    sampledByInstanceId: text("sampled_by_instance_id").references(
      () => runtimeInstancesTable.id,
      { onDelete: "restrict" },
    ),
    runtimeTruthState: text("runtime_truth_state").$type<RuntimeTruthState>(),
    providerMetricsCoverage: text("provider_metrics_coverage")
      .$type<ProviderMetricsCoverage>()
      .notNull()
      .default("partial"),
    healthyWorkerCount: integer("healthy_worker_count").notNull().default(0),
    staleWorkerCount: integer("stale_worker_count").notNull().default(0),
    schedulerTickAgeMs: integer("scheduler_tick_age_ms"),
    dueQueueDepth: integer("due_queue_depth").notNull().default(0),
    oldestDueAgeMs: integer("oldest_due_age_ms"),
    activeTaskCount: integer("active_task_count").notNull().default(0),
    sleepingTaskCount: integer("sleeping_task_count").notNull().default(0),
    recoveringTaskCount: integer("recovering_task_count").notNull().default(0),
    blockedTaskCount: integer("blocked_task_count").notNull().default(0),
    approvalWaitingTaskCount: integer("approval_waiting_task_count")
      .notNull()
      .default(0),
    providerSuccessCount: integer("provider_success_count")
      .notNull()
      .default(0),
    providerErrorCount: integer("provider_error_count").notNull().default(0),
    providerP50LatencyMs: integer("provider_p50_latency_ms"),
    providerP95LatencyMs: integer("provider_p95_latency_ms"),
    recoveryCount: integer("recovery_count").notNull().default(0),
    lostLeaseCount: integer("lost_lease_count").notNull().default(0),
    taskTokens: integer("task_tokens").notNull().default(0),
    reportedCostUsd: numeric("reported_cost_usd", {
      precision: 12,
      scale: 6,
    })
      .notNull()
      .default("0"),
  },
  (table) => [
    index("runtime_health_samples_bucket_idx").on(table.bucketAt),
    check(
      "runtime_health_samples_nonnegative_counts_check",
      sql`${table.healthyWorkerCount} >= 0 and ${table.staleWorkerCount} >= 0 and ${table.dueQueueDepth} >= 0 and ${table.activeTaskCount} >= 0 and ${table.sleepingTaskCount} >= 0 and ${table.recoveringTaskCount} >= 0 and ${table.blockedTaskCount} >= 0 and ${table.approvalWaitingTaskCount} >= 0 and ${table.providerSuccessCount} >= 0 and ${table.providerErrorCount} >= 0 and ${table.recoveryCount} >= 0 and ${table.lostLeaseCount} >= 0 and ${table.taskTokens} >= 0`,
    ),
    check(
      "runtime_health_samples_nonnegative_ages_check",
      sql`${table.schedulerTickAgeMs} is null or ${table.schedulerTickAgeMs} >= 0`,
    ),
    check(
      "runtime_health_samples_nonnegative_oldest_due_age_check",
      sql`${table.oldestDueAgeMs} is null or ${table.oldestDueAgeMs} >= 0`,
    ),
    check(
      "runtime_health_samples_nonnegative_p50_latency_check",
      sql`${table.providerP50LatencyMs} is null or ${table.providerP50LatencyMs} >= 0`,
    ),
    check(
      "runtime_health_samples_nonnegative_p95_latency_check",
      sql`${table.providerP95LatencyMs} is null or ${table.providerP95LatencyMs} >= 0`,
    ),
    check(
      "runtime_health_samples_latency_percentiles_check",
      sql`${table.providerP50LatencyMs} is null or ${table.providerP95LatencyMs} is null or ${table.providerP50LatencyMs} <= ${table.providerP95LatencyMs}`,
    ),
    check(
      "runtime_health_samples_reported_cost_check",
      sql`${table.reportedCostUsd} >= 0`,
    ),
    check(
      "runtime_health_samples_truth_state_check",
      sql`${table.runtimeTruthState} is null or ${table.runtimeTruthState} in ('live', 'degraded', 'stale', 'offline', 'emergency_stopped', 'local_demo')`,
    ),
    check(
      "runtime_health_samples_provider_coverage_check",
      sql`${table.providerMetricsCoverage} in ('partial', 'complete')`,
    ),
  ],
);

export type RuntimeInstance = typeof runtimeInstancesTable.$inferSelect;
export type InsertRuntimeInstance = typeof runtimeInstancesTable.$inferInsert;
export type TaskAttempt = typeof taskAttemptsTable.$inferSelect;
export type InsertTaskAttempt = typeof taskAttemptsTable.$inferInsert;
export type OperationReceipt = typeof operationReceiptsTable.$inferSelect;
export type InsertOperationReceipt = typeof operationReceiptsTable.$inferInsert;
export type OperationInvocation = typeof operationInvocationsTable.$inferSelect;
export type InsertOperationInvocation =
  typeof operationInvocationsTable.$inferInsert;
export type RuntimeHealthSample = typeof runtimeHealthSamplesTable.$inferSelect;
export type InsertRuntimeHealthSample =
  typeof runtimeHealthSamplesTable.$inferInsert;
