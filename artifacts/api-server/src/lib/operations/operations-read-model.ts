import {
  activityEventsTable,
  agentsTable,
  databaseBackend,
  db,
  operationInvocationsTable,
  operationReceiptsTable,
  projectMembersTable,
  runtimeControlsTable,
  runtimeHealthSamplesTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  tasksTable,
  usageEventsTable,
  type AgentStatus,
  type OperationExecutionKind,
  type OperationInvocationState,
  type OperationReceiptState,
  type OperationSideEffectClass,
  type ProviderMetricsCoverage,
  type RuntimeInstanceRole,
  type RuntimeInstanceState,
  type RuntimeTruthState,
  type TaskAttemptState,
  type TaskStatus,
} from "@workspace/db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  max,
  min,
  or,
  sql,
  sum,
} from "drizzle-orm";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import {
  deriveRuntimeTruth,
  effectiveRuntimeState,
  type RuntimeTruth,
} from "./operations-state";
import { parseOperationsEventDetail } from "./operations-events";

const SAMPLE_LIMIT = 1_440;
const ATTEMPT_LIMIT = 200;
const RECEIPT_LIMIT = 200;
const INVOCATIONS_PER_RECEIPT = 5;
const TIMELINE_LIMIT = 100;
const EVENT_SCAN_LIMIT = 1_000;

export class OperationsProjectNotFoundError extends Error {
  constructor() {
    super("Project task not found");
    this.name = "OperationsProjectNotFoundError";
  }
}

export class OperationsRootRequiredError extends Error {
  constructor() {
    super("Operations requires a root project task");
    this.name = "OperationsRootRequiredError";
  }
}

export class OperationsReceiptNotFoundError extends Error {
  constructor() {
    super("Operation receipt not found in this project");
    this.name = "OperationsReceiptNotFoundError";
  }
}

export interface OperationsWindow {
  startAt: string;
  endAt: string;
  hours: number;
  timezone: "UTC";
}

export interface OperationsHealthSample {
  bucketAt: string;
  sampledAt: string | null;
  runtimeTruthState: RuntimeTruthState | null;
  providerMetricsCoverage: ProviderMetricsCoverage;
  healthyWorkerCount: number;
  staleWorkerCount: number;
  schedulerTickAgeMs: number | null;
  dueQueueDepth: number;
  oldestDueAgeMs: number | null;
  activeTaskCount: number;
  sleepingTaskCount: number;
  recoveringTaskCount: number;
  blockedTaskCount: number;
  approvalWaitingTaskCount: number;
  providerSuccessCount: number;
  providerErrorCount: number;
  providerP50LatencyMs: number | null;
  providerP95LatencyMs: number | null;
  recoveryCount: number;
  lostLeaseCount: number;
  taskTokens: number;
  reportedCostUsd: number;
}

export interface OperationsQueueSummary {
  dueDepth: number;
  oldestDueAgeMs: number | null;
  nextWakeAt: string | null;
}

export interface OperationsTaskCounts {
  active: number;
  sleeping: number;
  recovering: number;
  blocked: number;
  awaitingApproval: number;
}

export interface OperationsUsageSummary {
  taskTokens: number;
  reportedCostUsd: number;
  usageEvents: number;
  costReportedEvents: number;
  providerMetricsCoverage: ProviderMetricsCoverage;
}

export interface OperationsOverview {
  generatedAt: string;
  cursor: string;
  window: OperationsWindow;
  runtime: RuntimeTruth & { lastSampleAt: string | null };
  queue: OperationsQueueSummary;
  tasks: OperationsTaskCounts;
  operations: {
    reserved: number;
    running: number;
    unresolvedUnknown: number;
  };
  usage: OperationsUsageSummary;
  fleetHealthSamples: OperationsHealthSample[];
  truncation: { fleetHealthSamples: boolean };
}

export interface OperationsMember {
  agentId: number;
  name: string;
  role: string;
  avatar: { color: string; version: string | null };
  status: AgentStatus;
  presence:
    | "working"
    | "sleeping"
    | "recovering"
    | "blocked"
    | "awaiting_approval"
    | "idle";
  currentAction: string | null;
  lastActiveAt: string | null;
  activeAttemptId: string | null;
  nextWakeAt: string | null;
}

export interface OperationsAttempt {
  id: string;
  taskId: number;
  agentId: number;
  workerInstanceId: string;
  logicalExecutionId: string;
  attemptNumber: number;
  cycleNumber: number;
  state: TaskAttemptState;
  startedAt: string;
  lastHeartbeatAt: string;
  finishedAt: string | null;
  provider: string | null;
  modelId: string | null;
  failureKind: string | null;
  recoveryOfAttemptId: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reportedCostUsd: number | null;
}

export interface OperationsInvocation {
  id: string;
  state: OperationInvocationState;
  attemptId: string | null;
  workerInstanceId: string | null;
  claimedAt: string;
  lastHeartbeatAt: string;
  effectStartedAt: string | null;
  finishedAt: string | null;
  failureKind: string | null;
}

export interface OperationsReceipt {
  id: string;
  operationKey: string;
  taskId: number | null;
  agentId: number;
  originAttemptId: string | null;
  executionKind: OperationExecutionKind;
  sideEffectClass: OperationSideEffectClass;
  state: OperationReceiptState;
  toolName: string;
  reservedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  failureKind: string | null;
  reconciliation: {
    eligible: boolean;
    decision: "confirmed_applied" | "confirmed_not_applied" | null;
    reconciledAt: string | null;
  };
  invocations: OperationsInvocation[];
}

export interface OperationsReceiptReview {
  projectId: number;
  receipt: OperationsReceipt;
  audit: {
    receiptId: string;
    state: "unknown";
    decision: "confirmed_applied" | "confirmed_not_applied";
    note: string;
    actorId: string;
    reconciledAt: string;
  } | null;
}

export interface OperationsTimelineItem {
  id: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  occurredAt: string;
  taskId: number | null;
  agentId: number | null;
  attemptId: string | null;
  receiptId: string | null;
}

export interface ProjectOperationsSnapshot {
  generatedAt: string;
  cursor: string;
  window: OperationsWindow;
  rootTask: { id: number; title: string; status: TaskStatus };
  runtime: OperationsOverview["runtime"];
  queue: OperationsQueueSummary;
  taskCounts: OperationsTaskCounts;
  members: OperationsMember[];
  attempts: OperationsAttempt[];
  receipts: OperationsReceipt[];
  incidents: OperationsTimelineItem[];
  milestones: OperationsTimelineItem[];
  usage: OperationsUsageSummary;
  fleetHealthSamples: OperationsHealthSample[];
  limits: {
    attempts: 200;
    receipts: 200;
    invocationsPerReceipt: 5;
    incidents: 100;
    milestones: 100;
    samples: 1440;
  };
  truncation: {
    attempts: boolean;
    receipts: boolean;
    incidents: boolean;
    milestones: boolean;
    fleetHealthSamples: boolean;
  };
}

export interface OperationsRuntimeInstance {
  id: string;
  role: RuntimeInstanceRole;
  persistedState: RuntimeInstanceState;
  effectiveState: RuntimeInstanceState;
  buildVersion: string;
  capabilities: Record<string, boolean>;
  schedulerEnabled: boolean;
  startedAt: string;
  lastHeartbeatAt: string;
  heartbeatAgeMs: number;
  lastSchedulerTickAt: string | null;
  schedulerTickAgeMs: number | null;
  drainingAt: string | null;
  stoppedAt: string | null;
}

function requireWindowHours(windowHours: number): number {
  if (!Number.isInteger(windowHours) || windowHours < 1 || windowHours > 168) {
    throw new TypeError("windowHours must be an integer from 1 to 168");
  }
  return windowHours;
}

function windowFor(
  now: Date,
  windowHours: number,
): {
  window: OperationsWindow;
  start: Date;
} {
  const hours = requireWindowHours(windowHours);
  const start = new Date(now.getTime() - hours * 60 * 60_000);
  return {
    start,
    window: {
      startAt: start.toISOString(),
      endAt: now.toISOString(),
      hours,
      timezone: "UTC",
    },
  };
}

function dateString(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

const PUBLIC_FAILURE_KINDS = new Set([
  "api_restarted",
  "api_restarted_after_dispatch",
  "binding_unavailable",
  "effect_not_started",
  "effect_outcome_unknown",
  "emergency_stop",
  "idempotent_effect_failed",
  "invalid_result_envelope",
  "lease_expired",
  "lease_lost",
  "operation_outcome_unknown",
  "owner_inactive",
  "read_only_execution_failed",
  "transactional_mutation_failed",
]);

function publicFailureKind(value: string | null): string | null {
  if (!value) return null;
  return PUBLIC_FAILURE_KINDS.has(value) ? value : "other";
}

function publicLabel(value: string | null, maximum = 128): string | null {
  if (!value) return null;
  return value.normalize("NFC").slice(0, maximum);
}

async function currentCursor(): Promise<string> {
  const [row] = await db
    .select({ id: max(activityEventsTable.id) })
    .from(activityEventsTable)
    .where(eq(activityEventsTable.type, "operations_changed"));
  return String(numberValue(row?.id));
}

function healthSample(
  row: typeof runtimeHealthSamplesTable.$inferSelect,
): OperationsHealthSample {
  return {
    bucketAt: row.bucketAt.toISOString(),
    sampledAt: dateString(row.sampledAt),
    runtimeTruthState: row.runtimeTruthState,
    providerMetricsCoverage: row.providerMetricsCoverage,
    healthyWorkerCount: row.healthyWorkerCount,
    staleWorkerCount: row.staleWorkerCount,
    schedulerTickAgeMs: row.schedulerTickAgeMs,
    dueQueueDepth: row.dueQueueDepth,
    oldestDueAgeMs: row.oldestDueAgeMs,
    activeTaskCount: row.activeTaskCount,
    sleepingTaskCount: row.sleepingTaskCount,
    recoveringTaskCount: row.recoveringTaskCount,
    blockedTaskCount: row.blockedTaskCount,
    approvalWaitingTaskCount: row.approvalWaitingTaskCount,
    providerSuccessCount: row.providerSuccessCount,
    providerErrorCount: row.providerErrorCount,
    providerP50LatencyMs: row.providerP50LatencyMs,
    providerP95LatencyMs: row.providerP95LatencyMs,
    recoveryCount: row.recoveryCount,
    lostLeaseCount: row.lostLeaseCount,
    taskTokens: row.taskTokens,
    reportedCostUsd: numberValue(row.reportedCostUsd),
  };
}

async function loadHealthSamples(start: Date): Promise<{
  samples: OperationsHealthSample[];
  truncated: boolean;
}> {
  const rows = await db
    .select()
    .from(runtimeHealthSamplesTable)
    .where(gte(runtimeHealthSamplesTable.bucketAt, start))
    .orderBy(desc(runtimeHealthSamplesTable.bucketAt))
    .limit(SAMPLE_LIMIT + 1);
  return {
    samples: rows.slice(0, SAMPLE_LIMIT).reverse().map(healthSample),
    truncated: rows.length > SAMPLE_LIMIT,
  };
}

async function loadRuntimeTruth(input: {
  now: Date;
  start: Date;
  workerStaleAfterMs: number;
  lastSampleAt: string | null;
}): Promise<OperationsOverview["runtime"]> {
  const backend: "postgresql" | "pglite" =
    databaseBackend === "postgresql" ? "postgresql" : "pglite";
  const [instances, controls] = await Promise.all([
    db
      .select({
        id: runtimeInstancesTable.id,
        role: runtimeInstancesTable.role,
        state: runtimeInstancesTable.state,
        schedulerEnabled: runtimeInstancesTable.schedulerEnabled,
        lastHeartbeatAt: runtimeInstancesTable.lastHeartbeatAt,
        lastSchedulerTickAt: runtimeInstancesTable.lastSchedulerTickAt,
      })
      .from(runtimeInstancesTable)
      .where(
        or(
          inArray(runtimeInstancesTable.state, [
            "starting",
            "healthy",
            "draining",
          ]),
          gte(runtimeInstancesTable.lastHeartbeatAt, input.start),
        ),
      ),
    db
      .select({
        emergencyStopEnabled: runtimeControlsTable.emergencyStopEnabled,
      })
      .from(runtimeControlsTable)
      .where(eq(runtimeControlsTable.id, 1))
      .limit(1),
  ]);
  const truth = deriveRuntimeTruth({
    now: input.now,
    databaseBackend: backend,
    emergencyStopEnabled: controls[0]?.emergencyStopEnabled ?? true,
    workerStaleAfterMs: input.workerStaleAfterMs,
    instances,
  });
  return { ...truth, lastSampleAt: input.lastSampleAt };
}

function taskScope(taskIds?: readonly number[]) {
  return taskIds ? inArray(tasksTable.id, [...taskIds]) : undefined;
}

async function loadQueueAndTaskCounts(input: {
  now: Date;
  schedulerTickMs: number;
  taskIds?: readonly number[];
}): Promise<{ queue: OperationsQueueSummary; tasks: OperationsTaskCounts }> {
  const selectionCutoff = new Date(input.now.getTime() - input.schedulerTickMs);
  const due = and(
    inArray(tasksTable.status, ["pending", "planning", "in_progress"]),
    or(
      isNull(tasksTable.lastSteppedAt),
      lt(tasksTable.lastSteppedAt, selectionCutoff),
    ),
    or(
      isNull(tasksTable.nextAttemptAt),
      lt(tasksTable.nextAttemptAt, input.now),
    ),
    or(
      isNull(tasksTable.leaseExpiresAt),
      lt(tasksTable.leaseExpiresAt, input.now),
    ),
    eq(agentsTable.isActive, true),
    or(
      isNull(agentsTable.runLeaseExpiresAt),
      lt(agentsTable.runLeaseExpiresAt, input.now),
    ),
  );
  const scope = taskScope(input.taskIds);
  const [row] = await db
    .select({
      dueDepth: sql<number>`count(*) filter (where ${due})`,
      oldestDueAt: sql<Date | null>`min(coalesce(${tasksTable.nextAttemptAt}, ${tasksTable.lastSteppedAt}, ${tasksTable.createdAt})) filter (where ${due})`,
      nextWakeAt: sql<Date | null>`min(${tasksTable.nextAttemptAt}) filter (where ${tasksTable.status} in ('pending', 'planning', 'in_progress') and ${tasksTable.nextAttemptAt} > ${input.now})`,
      active: sql<number>`count(*) filter (where ${tasksTable.status} in ('pending', 'planning', 'in_progress') and ${tasksTable.leaseExpiresAt} > ${input.now})`,
      sleeping: sql<number>`count(*) filter (where ${tasksTable.status} in ('pending', 'planning', 'in_progress') and ${tasksTable.autonomyMode} = 'continuous' and ${tasksTable.nextAttemptAt} > ${input.now} and (${tasksTable.leaseExpiresAt} is null or ${tasksTable.leaseExpiresAt} <= ${input.now}))`,
      recovering: sql<number>`count(*) filter (where ${tasksTable.status} in ('pending', 'planning', 'in_progress') and ${tasksTable.recoveryCount} > 0 and (${tasksTable.leaseExpiresAt} is null or ${tasksTable.leaseExpiresAt} <= ${input.now}) and (${tasksTable.nextAttemptAt} is null or ${tasksTable.nextAttemptAt} <= ${input.now}))`,
      blocked: sql<number>`count(*) filter (where ${tasksTable.status} = 'blocked')`,
      awaitingApproval: sql<number>`count(*) filter (where ${tasksTable.status} = 'awaiting_approval')`,
    })
    .from(tasksTable)
    .innerJoin(agentsTable, eq(agentsTable.id, tasksTable.ownerAgentId))
    .where(scope);
  const oldestDueAt = row?.oldestDueAt ?? null;
  return {
    queue: {
      dueDepth: numberValue(row?.dueDepth),
      oldestDueAgeMs: oldestDueAt
        ? Math.max(0, input.now.getTime() - new Date(oldestDueAt).getTime())
        : null,
      nextWakeAt: row?.nextWakeAt
        ? new Date(row.nextWakeAt).toISOString()
        : null,
    },
    tasks: {
      active: numberValue(row?.active),
      sleeping: numberValue(row?.sleeping),
      recovering: numberValue(row?.recovering),
      blocked: numberValue(row?.blocked),
      awaitingApproval: numberValue(row?.awaitingApproval),
    },
  };
}

async function loadOperationCounts(taskIds?: readonly number[]) {
  const [row] = await db
    .select({
      reserved: sql<number>`count(*) filter (where ${operationReceiptsTable.state} = 'reserved')`,
      running: sql<number>`count(*) filter (where ${operationReceiptsTable.state} = 'running')`,
      unresolvedUnknown: sql<number>`count(*) filter (where ${operationReceiptsTable.state} = 'unknown' and ${operationReceiptsTable.reconciliationDecision} is null)`,
    })
    .from(operationReceiptsTable)
    .where(
      taskIds
        ? inArray(operationReceiptsTable.taskId, [...taskIds])
        : undefined,
    );
  return {
    reserved: numberValue(row?.reserved),
    running: numberValue(row?.running),
    unresolvedUnknown: numberValue(row?.unresolvedUnknown),
  };
}

async function loadUsage(
  start: Date,
  taskIds?: readonly number[],
): Promise<OperationsUsageSummary> {
  const [row] = await db
    .select({
      events: count(),
      tokens: sum(usageEventsTable.totalTokens),
      reportedCost: sum(usageEventsTable.reportedCostUsd),
      costReportedEvents: count(usageEventsTable.reportedCostUsd),
    })
    .from(usageEventsTable)
    .where(
      and(
        gte(usageEventsTable.createdAt, start),
        eq(usageEventsTable.kind, "task_step"),
        taskIds
          ? inArray(usageEventsTable.taskId, [...taskIds])
          : sql`${usageEventsTable.taskId} is not null`,
      ),
    );
  return {
    taskTokens: numberValue(row?.tokens),
    reportedCostUsd: Number(numberValue(row?.reportedCost).toFixed(6)),
    usageEvents: numberValue(row?.events),
    costReportedEvents: numberValue(row?.costReportedEvents),
    // The durable ledger currently records successful completions only and has
    // no error/latency row, so complete provider health must not be claimed.
    providerMetricsCoverage: "partial",
  };
}

export async function getOperationsOverview(
  input: {
    now?: Date;
    windowHours?: number;
    workerStaleAfterMs?: number;
    schedulerTickMs?: number;
    cursor?: string;
  } = {},
): Promise<OperationsOverview> {
  const now = input.now ?? new Date();
  const config = readRuntimeOperationsConfig();
  const { start, window } = windowFor(now, input.windowHours ?? 24);
  const cursor = input.cursor ?? (await currentCursor());
  const [{ samples, truncated }, queueAndTasks, operations, usage] =
    await Promise.all([
      loadHealthSamples(start),
      loadQueueAndTaskCounts({
        now,
        schedulerTickMs: input.schedulerTickMs ?? config.schedulerTickMs,
      }),
      loadOperationCounts(),
      loadUsage(start),
    ]);
  const lastSampleAt = samples.at(-1)?.sampledAt ?? null;
  const runtime = await loadRuntimeTruth({
    now,
    start,
    workerStaleAfterMs: input.workerStaleAfterMs ?? config.workerStaleAfterMs,
    lastSampleAt,
  });
  return {
    generatedAt: now.toISOString(),
    cursor,
    window,
    runtime,
    queue: queueAndTasks.queue,
    tasks: queueAndTasks.tasks,
    operations,
    usage,
    fleetHealthSamples: samples,
    truncation: { fleetHealthSamples: truncated },
  };
}

async function projectTaskIds(rootTaskId: number): Promise<number[]> {
  const result = (await db.execute(sql`
    WITH RECURSIVE project_tasks(id) AS (
      SELECT ${tasksTable.id}
        FROM ${tasksTable}
       WHERE ${tasksTable.id} = ${rootTaskId}
      UNION
      SELECT child.id
        FROM ${tasksTable} child
        JOIN project_tasks parent ON child.parent_task_id = parent.id
    )
    SELECT id FROM project_tasks ORDER BY id
  `)) as unknown as { rows: Array<{ id: number }> };
  return result.rows.map((row) => Number(row.id));
}

async function loadAttempts(taskIds: readonly number[], start: Date) {
  const rows = await db
    .select({
      id: taskAttemptsTable.id,
      taskId: taskAttemptsTable.taskId,
      agentId: taskAttemptsTable.agentId,
      workerInstanceId: taskAttemptsTable.workerInstanceId,
      logicalExecutionId: taskAttemptsTable.logicalExecutionId,
      attemptNumber: taskAttemptsTable.attemptNumber,
      cycleNumber: taskAttemptsTable.cycleNumber,
      state: taskAttemptsTable.state,
      startedAt: taskAttemptsTable.startedAt,
      lastHeartbeatAt: taskAttemptsTable.lastHeartbeatAt,
      finishedAt: taskAttemptsTable.finishedAt,
      provider: taskAttemptsTable.provider,
      modelId: taskAttemptsTable.modelId,
      failureKind: taskAttemptsTable.failureKind,
      recoveryOfAttemptId: taskAttemptsTable.recoveryOfAttemptId,
      promptTokens: taskAttemptsTable.promptTokens,
      completionTokens: taskAttemptsTable.completionTokens,
      totalTokens: taskAttemptsTable.totalTokens,
      reportedCostUsd: taskAttemptsTable.reportedCostUsd,
    })
    .from(taskAttemptsTable)
    .where(
      and(
        inArray(taskAttemptsTable.taskId, [...taskIds]),
        or(
          gte(taskAttemptsTable.startedAt, start),
          inArray(taskAttemptsTable.state, [
            "claimed",
            "running",
            "retrying",
            "blocked",
          ]),
        ),
      ),
    )
    .orderBy(desc(taskAttemptsTable.startedAt), desc(taskAttemptsTable.id))
    .limit(ATTEMPT_LIMIT + 1);
  return {
    truncated: rows.length > ATTEMPT_LIMIT,
    attempts: rows
      .slice(0, ATTEMPT_LIMIT)
      .map((attempt): OperationsAttempt => ({
        ...attempt,
        logicalExecutionId: String(attempt.logicalExecutionId),
        startedAt: attempt.startedAt.toISOString(),
        lastHeartbeatAt: attempt.lastHeartbeatAt.toISOString(),
        finishedAt: dateString(attempt.finishedAt),
        provider: publicLabel(attempt.provider),
        modelId: publicLabel(attempt.modelId),
        failureKind: publicFailureKind(attempt.failureKind),
        reportedCostUsd:
          attempt.reportedCostUsd === null
            ? null
            : numberValue(attempt.reportedCostUsd),
      })),
  };
}

async function loadReceipts(
  taskIds: readonly number[],
  start: Date,
  exactReceiptId?: string,
) {
  const limit = exactReceiptId === undefined ? RECEIPT_LIMIT : 1;
  const rows = await db
    .select({
      id: operationReceiptsTable.id,
      operationKey: operationReceiptsTable.operationKey,
      taskId: operationReceiptsTable.taskId,
      agentId: operationReceiptsTable.agentId,
      originAttemptId: operationReceiptsTable.originAttemptId,
      executionKind: operationReceiptsTable.executionKind,
      sideEffectClass: operationReceiptsTable.sideEffectClass,
      state: operationReceiptsTable.state,
      toolName: operationReceiptsTable.toolName,
      reservedAt: operationReceiptsTable.reservedAt,
      startedAt: operationReceiptsTable.startedAt,
      finishedAt: operationReceiptsTable.finishedAt,
      failureKind: operationReceiptsTable.failureKind,
      reconciliationDecision: operationReceiptsTable.reconciliationDecision,
      reconciliationNote:
        exactReceiptId === undefined
          ? sql<string | null>`NULL`
          : operationReceiptsTable.reconciliationNote,
      reconciliationActorId:
        exactReceiptId === undefined
          ? sql<string | null>`NULL`
          : operationReceiptsTable.reconciliationActorId,
      reconciledAt: operationReceiptsTable.reconciledAt,
    })
    .from(operationReceiptsTable)
    .where(
      and(
        inArray(operationReceiptsTable.taskId, [...taskIds]),
        exactReceiptId === undefined
          ? or(
              gte(operationReceiptsTable.reservedAt, start),
              inArray(operationReceiptsTable.state, ["reserved", "running"]),
              and(
                eq(operationReceiptsTable.state, "unknown"),
                isNull(operationReceiptsTable.reconciliationDecision),
              ),
            )
          : eq(operationReceiptsTable.id, exactReceiptId),
      ),
    )
    .orderBy(
      desc(operationReceiptsTable.reservedAt),
      desc(operationReceiptsTable.id),
    )
    .limit(limit + 1);
  const kept = rows.slice(0, limit);
  const receiptIds = kept.map((receipt) => receipt.id);
  const invocationRows =
    receiptIds.length === 0
      ? []
      : await db
          .select({
            id: operationInvocationsTable.id,
            receiptId: operationInvocationsTable.receiptId,
            state: operationInvocationsTable.state,
            attemptId: operationInvocationsTable.attemptId,
            workerInstanceId: operationInvocationsTable.workerInstanceId,
            claimedAt: operationInvocationsTable.claimedAt,
            lastHeartbeatAt: operationInvocationsTable.lastHeartbeatAt,
            effectStartedAt: operationInvocationsTable.effectStartedAt,
            finishedAt: operationInvocationsTable.finishedAt,
            failureKind: operationInvocationsTable.failureKind,
          })
          .from(operationInvocationsTable)
          .where(inArray(operationInvocationsTable.receiptId, receiptIds))
          .orderBy(
            desc(operationInvocationsTable.claimedAt),
            desc(operationInvocationsTable.id),
          )
          .limit(limit * INVOCATIONS_PER_RECEIPT + 1);
  const invocationsByReceipt = new Map<string, OperationsInvocation[]>();
  for (const invocation of invocationRows) {
    const list = invocationsByReceipt.get(invocation.receiptId) ?? [];
    if (list.length >= INVOCATIONS_PER_RECEIPT) continue;
    list.push({
      id: invocation.id,
      state: invocation.state,
      attemptId: invocation.attemptId,
      workerInstanceId: invocation.workerInstanceId,
      claimedAt: invocation.claimedAt.toISOString(),
      lastHeartbeatAt: invocation.lastHeartbeatAt.toISOString(),
      effectStartedAt: dateString(invocation.effectStartedAt),
      finishedAt: dateString(invocation.finishedAt),
      failureKind: publicFailureKind(invocation.failureKind),
    });
    invocationsByReceipt.set(invocation.receiptId, list);
  }
  // Audit text is returned only by the authenticated exact-receipt endpoint,
  // never by a bounded project snapshot. It comes from the same receipt row.
  let audit: OperationsReceiptReview["audit"] = null;
  const exact = exactReceiptId === undefined ? undefined : kept[0];
  if (exact && exact.reconciliationDecision !== null) {
    if (
      exact.state !== "unknown" ||
      exact.reconciliationNote === null ||
      exact.reconciliationActorId === null ||
      exact.reconciledAt === null
    ) {
      throw new Error("Incomplete immutable reconciliation evidence");
    }
    audit = {
      receiptId: exact.id,
      state: "unknown",
      decision: exact.reconciliationDecision,
      note: exact.reconciliationNote,
      actorId: exact.reconciliationActorId,
      reconciledAt: exact.reconciledAt.toISOString(),
    };
  }
  return {
    audit,
    truncated: rows.length > limit,
    receipts: kept.map((receipt): OperationsReceipt => ({
      id: receipt.id,
      operationKey: receipt.operationKey,
      taskId: receipt.taskId,
      agentId: receipt.agentId,
      originAttemptId: receipt.originAttemptId,
      executionKind: receipt.executionKind,
      sideEffectClass: receipt.sideEffectClass,
      state: receipt.state,
      toolName: publicLabel(receipt.toolName, 128) ?? "unknown",
      reservedAt: receipt.reservedAt.toISOString(),
      startedAt: dateString(receipt.startedAt),
      finishedAt: dateString(receipt.finishedAt),
      failureKind: publicFailureKind(receipt.failureKind),
      reconciliation: {
        eligible:
          receipt.state === "unknown" &&
          receipt.reconciliationDecision === null,
        decision: receipt.reconciliationDecision,
        reconciledAt: dateString(receipt.reconciledAt),
      },
      invocations: invocationsByReceipt.get(receipt.id) ?? [],
    })),
  };
}

async function loadProjectTaskPresence(taskIds: readonly number[]) {
  return db
    .select({
      id: tasksTable.id,
      ownerAgentId: tasksTable.ownerAgentId,
      status: tasksTable.status,
      recoveryCount: tasksTable.recoveryCount,
      nextAttemptAt: tasksTable.nextAttemptAt,
      leaseExpiresAt: tasksTable.leaseExpiresAt,
    })
    .from(tasksTable)
    .where(inArray(tasksTable.id, [...taskIds]));
}

async function loadMembers(input: {
  rootTaskId: number;
  now: Date;
  taskRows: Awaited<ReturnType<typeof loadProjectTaskPresence>>;
  attempts: OperationsAttempt[];
}): Promise<OperationsMember[]> {
  const rows = await db
    .select({
      agentId: agentsTable.id,
      name: agentsTable.name,
      role: agentsTable.role,
      avatarColor: agentsTable.avatarColor,
      avatarVersion: agentsTable.avatarVersion,
      status: agentsTable.status,
      currentAction: agentsTable.currentAction,
      lastActiveAt: agentsTable.lastActiveAt,
      memberRole: projectMembersTable.memberRole,
    })
    .from(projectMembersTable)
    .innerJoin(agentsTable, eq(agentsTable.id, projectMembersTable.agentId))
    .where(eq(projectMembersTable.taskId, input.rootTaskId))
    .orderBy(asc(projectMembersTable.joinedAt), asc(agentsTable.id));
  return rows.map((member) => {
    const ownedTasks = input.taskRows.filter(
      (task) => task.ownerAgentId === member.agentId,
    );
    const activeAttempt = input.attempts.find(
      (attempt) =>
        attempt.agentId === member.agentId &&
        (attempt.state === "claimed" || attempt.state === "running"),
    );
    const hasLiveLease = ownedTasks.some(
      (task) =>
        task.leaseExpiresAt &&
        task.leaseExpiresAt.getTime() > input.now.getTime(),
    );
    const nextWake = ownedTasks
      .map((task) => task.nextAttemptAt)
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => left.getTime() - right.getTime())[0];
    let presence: OperationsMember["presence"] = "idle";
    if (activeAttempt && hasLiveLease) presence = "working";
    else if (ownedTasks.some((task) => task.status === "awaiting_approval"))
      presence = "awaiting_approval";
    else if (ownedTasks.some((task) => task.status === "blocked"))
      presence = "blocked";
    else if (
      ownedTasks.some(
        (task) =>
          task.recoveryCount > 0 &&
          (!task.nextAttemptAt ||
            task.nextAttemptAt.getTime() <= input.now.getTime()),
      )
    )
      presence = "recovering";
    else if (nextWake && nextWake.getTime() > input.now.getTime())
      presence = "sleeping";
    return {
      agentId: member.agentId,
      name: member.name.slice(0, 200),
      role: member.role.slice(0, 200),
      avatar: { color: member.avatarColor, version: member.avatarVersion },
      status: member.status as AgentStatus,
      presence,
      currentAction: publicLabel(member.currentAction, 200),
      lastActiveAt: dateString(member.lastActiveAt),
      activeAttemptId: activeAttempt?.id ?? null,
      nextWakeAt: dateString(nextWake ?? null),
    };
  });
}

function isIncident(item: OperationsTimelineItem, state?: string): boolean {
  return (
    item.kind === "recovery_recorded" ||
    item.kind === "runtime_control_changed" ||
    item.kind === "reconciliation_recorded" ||
    ["failed", "lost", "stale", "unknown"].includes(state ?? "")
  );
}

async function loadTimeline(taskIds: readonly number[], start: Date) {
  const rows = await db
    .select({
      id: activityEventsTable.id,
      taskId: activityEventsTable.taskId,
      agentId: activityEventsTable.agentId,
      severity: activityEventsTable.severity,
      detail: activityEventsTable.detail,
      createdAt: activityEventsTable.createdAt,
    })
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.type, "operations_changed"),
        inArray(activityEventsTable.taskId, [...taskIds]),
        gte(activityEventsTable.createdAt, start),
      ),
    )
    .orderBy(desc(activityEventsTable.id))
    .limit(EVENT_SCAN_LIMIT + 1);
  const incidents: OperationsTimelineItem[] = [];
  const milestones: OperationsTimelineItem[] = [];
  for (const row of rows.slice(0, EVENT_SCAN_LIMIT)) {
    const detail = parseOperationsEventDetail(row.detail);
    if (!detail) continue;
    const item: OperationsTimelineItem = {
      id: String(row.id),
      kind: detail.kind,
      severity:
        row.severity === "warning" || row.severity === "critical"
          ? row.severity
          : "info",
      occurredAt: row.createdAt.toISOString(),
      taskId: row.taskId,
      agentId: row.agentId,
      attemptId: detail.attemptId ?? null,
      receiptId: detail.receiptId ?? null,
    };
    (isIncident(item, detail.state) ? incidents : milestones).push(item);
  }
  return {
    incidents: incidents.slice(0, TIMELINE_LIMIT),
    milestones: milestones.slice(0, TIMELINE_LIMIT),
    incidentsTruncated:
      incidents.length > TIMELINE_LIMIT || rows.length > EVENT_SCAN_LIMIT,
    milestonesTruncated:
      milestones.length > TIMELINE_LIMIT || rows.length > EVENT_SCAN_LIMIT,
  };
}

export async function getProjectOperationReceipt(input: {
  rootTaskId: number;
  receiptId: string;
}): Promise<OperationsReceiptReview> {
  const [root] = await db
    .select({ id: tasksTable.id, parentTaskId: tasksTable.parentTaskId })
    .from(tasksTable)
    .where(eq(tasksTable.id, input.rootTaskId))
    .limit(1);
  if (!root) throw new OperationsProjectNotFoundError();
  if (root.parentTaskId !== null) throw new OperationsRootRequiredError();
  const taskIds = await projectTaskIds(root.id);
  // Exact identity replaces the history-window predicate and list cap.
  const result = await loadReceipts(taskIds, new Date(0), input.receiptId);
  const receipt = result.receipts[0];
  if (!receipt) throw new OperationsReceiptNotFoundError();
  return { projectId: root.id, receipt, audit: result.audit };
}

export async function getProjectOperations(input: {
  rootTaskId: number;
  now?: Date;
  windowHours?: number;
  workerStaleAfterMs?: number;
  schedulerTickMs?: number;
}): Promise<ProjectOperationsSnapshot> {
  const now = input.now ?? new Date();
  const { start, window } = windowFor(now, input.windowHours ?? 24);
  const [root] = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
      parentTaskId: tasksTable.parentTaskId,
    })
    .from(tasksTable)
    .where(eq(tasksTable.id, input.rootTaskId))
    .limit(1);
  if (!root) throw new OperationsProjectNotFoundError();
  if (root.parentTaskId !== null) throw new OperationsRootRequiredError();

  // Read the high-water mark before any source rows. A concurrent commit can
  // then cause at most one duplicate invalidation, never a skipped mutation.
  const cursor = await currentCursor();
  const taskIds = await projectTaskIds(root.id);
  const config = readRuntimeOperationsConfig();
  const [
    attemptResult,
    receiptResult,
    taskRows,
    queueAndTasks,
    timeline,
    usage,
    overview,
  ] = await Promise.all([
    loadAttempts(taskIds, start),
    loadReceipts(taskIds, start),
    loadProjectTaskPresence(taskIds),
    loadQueueAndTaskCounts({
      now,
      schedulerTickMs: input.schedulerTickMs ?? config.schedulerTickMs,
      taskIds,
    }),
    loadTimeline(taskIds, start),
    loadUsage(start, taskIds),
    getOperationsOverview({
      now,
      windowHours: window.hours,
      workerStaleAfterMs: input.workerStaleAfterMs ?? config.workerStaleAfterMs,
      schedulerTickMs: input.schedulerTickMs ?? config.schedulerTickMs,
      cursor,
    }),
  ]);
  const members = await loadMembers({
    rootTaskId: root.id,
    now,
    taskRows,
    attempts: attemptResult.attempts,
  });
  return {
    generatedAt: now.toISOString(),
    cursor,
    window,
    rootTask: {
      id: root.id,
      title: root.title.slice(0, 300),
      status: root.status as TaskStatus,
    },
    runtime: overview.runtime,
    queue: queueAndTasks.queue,
    taskCounts: queueAndTasks.tasks,
    members,
    attempts: attemptResult.attempts,
    receipts: receiptResult.receipts,
    incidents: timeline.incidents,
    milestones: timeline.milestones,
    usage,
    fleetHealthSamples: overview.fleetHealthSamples,
    limits: {
      attempts: ATTEMPT_LIMIT,
      receipts: RECEIPT_LIMIT,
      invocationsPerReceipt: INVOCATIONS_PER_RECEIPT,
      incidents: TIMELINE_LIMIT,
      milestones: TIMELINE_LIMIT,
      samples: SAMPLE_LIMIT,
    },
    truncation: {
      attempts: attemptResult.truncated,
      receipts: receiptResult.truncated,
      incidents: timeline.incidentsTruncated,
      milestones: timeline.milestonesTruncated,
      fleetHealthSamples: overview.truncation.fleetHealthSamples,
    },
  };
}

export async function listRuntimeInstances(
  input: {
    now?: Date;
    windowHours?: number;
    workerStaleAfterMs?: number;
    limit?: number;
  } = {},
): Promise<{
  generatedAt: string;
  instances: OperationsRuntimeInstance[];
  truncated: boolean;
}> {
  const now = input.now ?? new Date();
  const config = readRuntimeOperationsConfig();
  const { start } = windowFor(now, input.windowHours ?? 24);
  const limit = input.limit ?? 200;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new TypeError("limit must be an integer from 1 to 200");
  }
  const rows = await db
    .select({
      id: runtimeInstancesTable.id,
      role: runtimeInstancesTable.role,
      state: runtimeInstancesTable.state,
      buildVersion: runtimeInstancesTable.buildVersion,
      capabilities: runtimeInstancesTable.capabilities,
      schedulerEnabled: runtimeInstancesTable.schedulerEnabled,
      startedAt: runtimeInstancesTable.startedAt,
      lastHeartbeatAt: runtimeInstancesTable.lastHeartbeatAt,
      lastSchedulerTickAt: runtimeInstancesTable.lastSchedulerTickAt,
      drainingAt: runtimeInstancesTable.drainingAt,
      stoppedAt: runtimeInstancesTable.stoppedAt,
    })
    .from(runtimeInstancesTable)
    .where(
      or(
        inArray(runtimeInstancesTable.state, [
          "starting",
          "healthy",
          "draining",
        ]),
        gte(runtimeInstancesTable.lastHeartbeatAt, start),
      ),
    )
    .orderBy(
      desc(runtimeInstancesTable.startedAt),
      desc(runtimeInstancesTable.id),
    )
    .limit(limit + 1);
  return {
    generatedAt: now.toISOString(),
    truncated: rows.length > limit,
    instances: rows.slice(0, limit).map((row) => {
      const heartbeatAgeMs = Math.max(
        0,
        now.getTime() - row.lastHeartbeatAt.getTime(),
      );
      return {
        id: row.id,
        role: row.role,
        persistedState: row.state,
        effectiveState: effectiveRuntimeState(
          row,
          now,
          input.workerStaleAfterMs ?? config.workerStaleAfterMs,
        ),
        buildVersion: row.buildVersion.slice(0, 128),
        capabilities: Object.fromEntries(
          Object.entries(row.capabilities).filter(
            ([key, value]) =>
              ["http", "scheduler", "browserControl"].includes(key) &&
              typeof value === "boolean",
          ),
        ),
        schedulerEnabled: row.schedulerEnabled,
        startedAt: row.startedAt.toISOString(),
        lastHeartbeatAt: row.lastHeartbeatAt.toISOString(),
        heartbeatAgeMs,
        lastSchedulerTickAt: dateString(row.lastSchedulerTickAt),
        schedulerTickAgeMs: row.lastSchedulerTickAt
          ? Math.max(0, now.getTime() - row.lastSchedulerTickAt.getTime())
          : null,
        drainingAt: dateString(row.drainingAt),
        stoppedAt: dateString(row.stoppedAt),
      };
    }),
  };
}
