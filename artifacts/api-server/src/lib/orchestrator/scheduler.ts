import { randomUUID } from "node:crypto";
import { approvePolicyActions } from "./policy-approvals";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  activityEventsTable,
  agentsTable,
  approvalRequestsTable,
  operationInvocationsTable,
  operationReceiptsTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  tasksTable,
  type Task,
} from "@workspace/db";
import { logger } from "../logger";
import type { RuntimeOperationsConfig } from "../runtime-operations-config";
import { stepTask } from "./step-task";
import {
  executeApprovedAction,
  finalizeSucceededApprovedActionReceipt,
  persistApprovedActionOutcomeUnknown,
} from "./execute-tool";
import { recoverInterruptedOperation } from "./operation-receipts";
import { scrubExpiredApprovals } from "./sudo-approval-retention";
import { readTaskSpendAdmission } from "./task-spend-admission";
import { readWorkspaceLocale } from "../workspace-locale";
import { getToolCopy, toolMessage } from "./tool-localization";
import {
  assertExecutionAllowed,
  EmergencyStopError,
  lockAndAssertExecutionAllowed,
  lockRuntimeControlState,
  synchronizeEmergencyStopForThisProcess,
} from "./runtime-emergency-stop";
import {
  assertRuntimeClaimHandle,
  lockAndAssertRuntimeCanClaim,
  recordStaleRuntimeIncidents,
  RuntimeClaimAdmissionError,
  type RuntimeInstanceHandle,
} from "./runtime-instance-registry";
import {
  createTaskAttempt,
  recoveryParentForTask,
  transitionTaskAttempt,
  type ClaimedTask,
} from "./task-attempt-store";

const CONCURRENCY = 3;
const MAX_TASKS_PER_TICK = CONCURRENCY;

class ClaimConflictError extends Error {}

function positiveNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalPositiveInteger(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "" || raw.trim() === "0") {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

// A lifetime step count is not a completion signal. By default finite work
// continues until complete_task, a real human-input/approval boundary, or a
// token/cost circuit breaker. Operators may still opt into a hard step cap.
const MAX_TASK_STEPS = optionalPositiveInteger("MAX_TASK_STEPS");
const MAX_TASK_TOKENS = Math.floor(positiveNumber("MAX_TASK_TOKENS", 100_000));
const MAX_TASK_REPORTED_COST_USD = positiveNumber(
  "MAX_TASK_REPORTED_COST_USD",
  1,
);

const ACTIVE_STATUSES = ["pending", "planning", "in_progress"] as const;
const activeStatusCondition = () =>
  inArray(tasksTable.status, ACTIVE_STATUSES as unknown as string[]);
const noPendingFiniteChildren = () => sql`NOT EXISTS (
  SELECT 1 FROM tasks child WHERE child.parent_task_id = ${tasksTable.id}
    AND child.autonomy_mode = 'finite'
    AND child.status IN ('pending', 'planning', 'in_progress', 'awaiting_approval')
)`;
const leaseAvailable = (now: Date) =>
  or(isNull(tasksTable.leaseExpiresAt), lt(tasksTable.leaseExpiresAt, now));
const agentLeaseAvailable = (now: Date) =>
  or(
    isNull(agentsTable.runLeaseExpiresAt),
    lt(agentsTable.runLeaseExpiresAt, now),
  );

interface SchedulerContext {
  runtime: RuntimeInstanceHandle;
  config: RuntimeOperationsConfig;
  acceptingClaims: boolean;
  activeOwnedSteps: number;
  livenessWrite: Promise<void> | null;
  runClaimedTask?: ClaimAndStepDueTasksDependencies["runClaimedTask"];
}

let timer: ReturnType<typeof setInterval> | null = null;
let schedulerContext: SchedulerContext | null = null;
let activeTick: Promise<void> | null = null;

export interface ClaimDueTasksOptions {
  maxClaims?: number;
  beforeCandidateTransaction?: (candidate: Task) => Promise<void>;
  afterCandidateLocksBeforeClaim?: (candidate: Task) => Promise<void>;
}

export async function claimDueTasks(
  runtime: RuntimeInstanceHandle,
  config: RuntimeOperationsConfig,
  options: ClaimDueTasksOptions = {},
): Promise<ClaimedTask[]> {
  if (config.role === "api") {
    throw new Error("API runtime cannot claim scheduler tasks");
  }
  assertRuntimeClaimHandle(runtime);
  const locale = await readWorkspaceLocale();
  const copy = getToolCopy(locale);
  const selectionNow = new Date();
  const selectionCutoff = new Date(
    selectionNow.getTime() - config.schedulerTickMs,
  );
  const maxClaims = Math.min(
    MAX_TASKS_PER_TICK,
    Math.max(0, Math.floor(options.maxClaims ?? MAX_TASKS_PER_TICK)),
  );
  const rankedDueTasks = db
    .select({
      taskId: tasksTable.id,
      updatedAt: tasksTable.updatedAt,
      ownerRank:
        sql<number>`row_number() over (partition by ${tasksTable.ownerAgentId} order by ${tasksTable.updatedAt} asc, ${tasksTable.id} asc)`.as(
          "owner_rank",
        ),
    })
    .from(tasksTable)
    .innerJoin(agentsTable, eq(agentsTable.id, tasksTable.ownerAgentId))
    .where(
      and(
        activeStatusCondition(),
        noPendingFiniteChildren(),
        or(
          isNull(tasksTable.lastSteppedAt),
          lt(tasksTable.lastSteppedAt, selectionCutoff),
        ),
        or(
          isNull(tasksTable.nextAttemptAt),
          lt(tasksTable.nextAttemptAt, selectionNow),
        ),
        leaseAvailable(selectionNow),
        eq(agentsTable.isActive, true),
        agentLeaseAvailable(selectionNow),
      ),
    )
    .as("ranked_due_tasks");
  const candidateRows = await db
    .select({ task: tasksTable })
    .from(rankedDueTasks)
    .innerJoin(tasksTable, eq(tasksTable.id, rankedDueTasks.taskId))
    .where(eq(rankedDueTasks.ownerRank, 1))
    .orderBy(asc(rankedDueTasks.updatedAt), asc(rankedDueTasks.taskId))
    .limit(MAX_TASKS_PER_TICK);
  const candidates = candidateRows.map((row) => row.task);

  const uniqueOwners = new Set<number>();
  const claimed: ClaimedTask[] = [];
  for (const candidate of candidates) {
    if (claimed.length >= maxClaims) break;
    if (uniqueOwners.has(candidate.ownerAgentId)) continue;
    uniqueOwners.add(candidate.ownerAgentId);

    const leaseOwner = `${runtime.id}:${candidate.id}:${randomUUID()}`;
    try {
      await options.beforeCandidateTransaction?.(candidate);
      const claimedTask = await db.transaction(async (tx) => {
        await lockAndAssertExecutionAllowed(tx);
        await lockAndAssertRuntimeCanClaim(tx, runtime, config);
        await tx.execute(
          sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${candidate.ownerAgentId} FOR UPDATE`,
        );
        await tx.execute(
          sql`SELECT id FROM ${tasksTable} WHERE ${tasksTable.id} = ${candidate.id} FOR UPDATE`,
        );
        await tx.execute(
          sql`SELECT id FROM ${operationReceiptsTable}
              WHERE ${operationReceiptsTable.taskId} = ${candidate.id}
                AND ${operationReceiptsTable.executionKind} = 'approved_action'
              ORDER BY id
              FOR UPDATE`,
        );
        const [liveAgent] = await tx
          .select({
            isActive: agentsTable.isActive,
            runLeaseExpiresAt: agentsTable.runLeaseExpiresAt,
          })
          .from(agentsTable)
          .where(eq(agentsTable.id, candidate.ownerAgentId));
        const [liveTask] = await tx
          .select()
          .from(tasksTable)
          .where(eq(tasksTable.id, candidate.id));
        await options.afterCandidateLocksBeforeClaim?.(candidate);
        const claimNow = new Date();
        const claimCutoff = new Date(
          claimNow.getTime() - config.schedulerTickMs,
        );
        const leaseExpiresAt = new Date(
          claimNow.getTime() + config.taskLeaseMs,
        );
        if (
          !liveAgent?.isActive ||
          (liveAgent.runLeaseExpiresAt !== null &&
            liveAgent.runLeaseExpiresAt.getTime() >= claimNow.getTime()) ||
          !liveTask ||
          liveTask.ownerAgentId !== candidate.ownerAgentId ||
          !ACTIVE_STATUSES.includes(
            liveTask.status as (typeof ACTIVE_STATUSES)[number],
          ) ||
          (liveTask.lastSteppedAt !== null &&
            liveTask.lastSteppedAt.getTime() >= claimCutoff.getTime()) ||
          (liveTask.nextAttemptAt !== null &&
            liveTask.nextAttemptAt.getTime() >= claimNow.getTime()) ||
          (liveTask.leaseExpiresAt !== null &&
            liveTask.leaseExpiresAt.getTime() >= claimNow.getTime())
        ) {
          throw new ClaimConflictError();
        }
        const [readyParent] = await tx
          .select({ id: tasksTable.id })
          .from(tasksTable)
          .where(
            and(eq(tasksTable.id, liveTask.id), noPendingFiniteChildren()),
          );
        if (!readyParent) throw new ClaimConflictError();
        // An expired lease is not proof that its physical attempt reached a
        // terminal state. Recovery owns that transition and its accounting.
        // Serialize behind it in task -> attempt order, then defer this claim
        // while the exact current attempt is still active.
        await tx.execute(
          sql`SELECT id FROM ${taskAttemptsTable}
              WHERE ${taskAttemptsTable.taskId} = ${liveTask.id}
                AND ${taskAttemptsTable.agentId} = ${liveTask.ownerAgentId}
                AND ${taskAttemptsTable.attemptNumber} = ${liveTask.stepAttempts}
                AND ${taskAttemptsTable.state} IN ('claimed', 'running')
              ORDER BY ${taskAttemptsTable.startedAt} DESC
              FOR UPDATE`,
        );
        const [activeAttempt] = await tx
          .select({ id: taskAttemptsTable.id })
          .from(taskAttemptsTable)
          .where(
            and(
              eq(taskAttemptsTable.taskId, liveTask.id),
              eq(taskAttemptsTable.agentId, liveTask.ownerAgentId),
              eq(taskAttemptsTable.attemptNumber, liveTask.stepAttempts),
              inArray(taskAttemptsTable.state, ["claimed", "running"]),
            ),
          )
          .orderBy(desc(taskAttemptsTable.startedAt))
          .limit(1);
        if (activeAttempt) throw new ClaimConflictError();

        const [claimedAgent] = await tx
          .update(agentsTable)
          .set({
            runLeaseOwner: leaseOwner,
            runLeaseExpiresAt: leaseExpiresAt,
            status: "working",
            currentTaskId: candidate.id,
            currentAction: copy.schedulerClaimed,
            lastActiveAt: claimNow,
          })
          .where(
            and(
              eq(agentsTable.id, candidate.ownerAgentId),
              eq(agentsTable.isActive, true),
              agentLeaseAvailable(claimNow),
            ),
          )
          .returning({ id: agentsTable.id });
        if (!claimedAgent) throw new ClaimConflictError();

        const [task] = await tx
          .update(tasksTable)
          .set({
            status: "in_progress",
            leaseOwner,
            leaseExpiresAt,
            lastSteppedAt: claimNow,
            lastHeartbeatAt: claimNow,
            stepAttempts: sql`${tasksTable.stepAttempts} + 1`,
          })
          .where(
            and(
              eq(tasksTable.id, candidate.id),
              eq(tasksTable.ownerAgentId, candidate.ownerAgentId),
              activeStatusCondition(),
              or(
                isNull(tasksTable.lastSteppedAt),
                lt(tasksTable.lastSteppedAt, claimCutoff),
              ),
              or(
                isNull(tasksTable.nextAttemptAt),
                lt(tasksTable.nextAttemptAt, claimNow),
              ),
              leaseAvailable(claimNow),
            ),
          )
          .returning();
        if (!task) throw new ClaimConflictError();

        const recoveryOfAttemptId = await recoveryParentForTask(task, tx);
        const attempt = await createTaskAttempt(
          {
            task: { ...task, leaseOwner },
            workerInstanceId: runtime.id,
            recoveryOfAttemptId,
            now: claimNow,
          },
          tx,
        );

        if (task.assignedByAgentId !== null && task.stepAttempts === 1) {
          await tx.insert(activityEventsTable).values({
            agentId: task.ownerAgentId,
            taskId: task.id,
            type: "task_status_changed",
            summary: copy.schedulerAccepted,
            detail: {
              status: "in_progress",
              delegationLifecycle: "accepted",
              fromAgentId: task.ownerAgentId,
              toAgentId: task.assignedByAgentId,
            },
            severity: "info",
          });
        }
        return {
          ...task,
          leaseOwner,
          runtimeAttemptId: attempt.id,
          runtimeInstanceId: runtime.id,
          logicalExecutionId: attempt.logicalExecutionId,
        } satisfies ClaimedTask;
      });
      claimed.push(claimedTask);
    } catch (error) {
      if (error instanceof ClaimConflictError) continue;
      if (error instanceof EmergencyStopError) break;
      if (error instanceof RuntimeClaimAdmissionError) break;
      throw error;
    }
  }
  return claimed;
}

export async function enforceTaskBudgets(): Promise<void> {
  const locale = await readWorkspaceLocale();
  const now = new Date();
  const active = await db
    .select()
    .from(tasksTable)
    .where(and(activeStatusCondition(), leaseAvailable(now)));

  for (const task of active) {
    const admission = await readTaskSpendAdmission(
      task,
      {
        maxSteps: MAX_TASK_STEPS,
        maxTokens: MAX_TASK_TOKENS,
        maxReportedCostUsd: MAX_TASK_REPORTED_COST_USD,
      },
      locale,
      now,
    );
    const reason = admission.reason;
    if (!reason) continue;

    const [blocked] = await db
      .update(tasksTable)
      .set({
        status: "blocked",
        blockedReason: "budget",
        lastError: reason,
        nextAttemptAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(tasksTable.id, task.id),
          activeStatusCondition(),
          leaseAvailable(now),
        ),
      )
      .returning({ id: tasksTable.id });
    if (blocked) {
      await db.insert(activityEventsTable).values({
        agentId: task.ownerAgentId,
        taskId: task.id,
        type: "error",
        summary: toolMessage(locale, "schedulerBudgetStopped", { reason }),
        detail: {
          stepAttempts: task.stepAttempts,
          tokensUsed: admission.tokensUsed,
          reportedCostUsd: admission.reportedCostUsd,
          costCoverage: admission.costCoverage,
          materializedTokensUsed: task.tokensUsed,
          materializedReportedCostUsd: task.estimatedCostUsd,
          usageSource: admission.usageSource,
        },
        severity: "critical",
      });
    }
  }
}

async function executeApprovedActionBacklog(
  runtime: RuntimeInstanceHandle,
  config: RuntimeOperationsConfig,
): Promise<void> {
  const now = new Date();
  const queued = await db
    .select({ id: approvalRequestsTable.id })
    .from(approvalRequestsTable)
    .innerJoin(tasksTable, eq(tasksTable.id, approvalRequestsTable.taskId))
    .where(
      and(
        eq(approvalRequestsTable.status, "approved"),
        isNull(approvalRequestsTable.consumedAt),
        isNull(approvalRequestsTable.bindingInvalidatedAt),
        isNotNull(approvalRequestsTable.actionPayload),
        gt(approvalRequestsTable.expiresAt, now),
        or(
          isNull(approvalRequestsTable.browserRuntimeInstanceId),
          eq(approvalRequestsTable.browserRuntimeInstanceId, runtime.id),
        ),
        eq(tasksTable.status, "awaiting_approval"),
      ),
    )
    .orderBy(asc(approvalRequestsTable.resolvedAt))
    .limit(MAX_TASKS_PER_TICK);

  for (const approval of queued) {
    try {
      // Closing local admission is synchronous, so a drain that begins after
      // this backlog query but before dispatch still fences the new effect.
      assertRuntimeClaimHandle(runtime);
      const outcome = await executeApprovedAction(approval.id, config, {
        runtimeInstanceId: runtime.id,
      });
      if (outcome.status === "approval_outcome_unknown") {
        logger.error(
          { approvalId: approval.id, taskId: outcome.taskId },
          "Approved action outcome is unknown and replay is blocked",
        );
      }
    } catch (error) {
      if (error instanceof RuntimeClaimAdmissionError) break;
      const [latest] = await db
        .select({ consumedAt: approvalRequestsTable.consumedAt })
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, approval.id));
      if (latest?.consumedAt) throw error;
      logger.error(
        {
          error,
          approvalId: approval.id,
          consumed: false,
        },
        "Approved action pre-claim failure remains queued",
      );
    }
  }
}

async function reconcileApprovedActionReceipts(
  now: Date,
  dependencies: ReviveAndReleaseStaleWorkDependencies,
): Promise<void> {
  const finalizeApprovedActionReceipt =
    dependencies.finalizeApprovedActionReceipt ??
    finalizeSucceededApprovedActionReceipt;
  // A succeeded receipt is definitive evidence that dispatch completed. Only
  // rebuild the task transition from its safe result envelope; never dispatch
  // the scrubbed capability again. Rows without any receipt are pre-migration
  // consumed approvals and stay fail-closed as outcome unknown.
  const candidates = await db
    .select({
      approvalId: approvalRequestsTable.id,
      taskId: approvalRequestsTable.taskId,
      agentId: approvalRequestsTable.agentId,
      leaseOwner: tasksTable.leaseOwner,
    })
    .from(approvalRequestsTable)
    .innerJoin(tasksTable, eq(tasksTable.id, approvalRequestsTable.taskId))
    .where(
      and(
        eq(approvalRequestsTable.status, "approved"),
        isNotNull(approvalRequestsTable.consumedAt),
        eq(tasksTable.status, "awaiting_approval"),
        leaseAvailable(now),
      ),
    );
  for (const candidate of candidates) {
    const receipts = await db
      .select()
      .from(operationReceiptsTable)
      .where(
        and(
          eq(operationReceiptsTable.executionKind, "approved_action"),
          eq(operationReceiptsTable.approvalId, candidate.approvalId),
        ),
      )
      .orderBy(asc(operationReceiptsTable.id));
    const succeededReceipts = receipts.filter(
      (receipt) => receipt.state === "succeeded",
    );
    if (succeededReceipts.length > 0) {
      if (receipts.length > 1) {
        logger.error(
          {
            approvalId: candidate.approvalId,
            taskId: candidate.taskId,
            receipts: receipts.map((receipt) => ({
              id: receipt.id,
              state: receipt.state,
            })),
          },
          "Approved action has duplicate durable receipts; preserving definitive succeeded evidence",
        );
      }
      for (const succeededReceipt of succeededReceipts) {
        try {
          const finalization = await finalizeApprovedActionReceipt({
            receiptId: succeededReceipt.id,
            recovery: true,
            now,
          });
          if (
            finalization.disposition === "finalized" ||
            finalization.disposition === "already_finalized"
          ) {
            break;
          }
          logger.warn(
            {
              approvalId: candidate.approvalId,
              receiptId: succeededReceipt.id,
              disposition: finalization.disposition,
            },
            "Succeeded approved action receipt finalization remains pending",
          );
        } catch (error) {
          if (error instanceof EmergencyStopError) throw error;
          logger.error(
            {
              error,
              approvalId: candidate.approvalId,
              receiptId: succeededReceipt.id,
            },
            "Succeeded approved action could not finalize from its receipt",
          );
        }
      }
      // Any succeeded receipt is definitive proof that an effect completed.
      // Duplicate or transiently unfinalizable evidence is an integrity/retry
      // signal and must never fall through to the unknown-outcome transition.
      continue;
    } else if (
      receipts.length === 1 &&
      ["reserved", "running"].includes(receipts[0]!.state)
    ) {
      // The owner has not yet been proven stale (or the pre-effect claim was
      // just reclaimed). Leave it queued for the ordinary receipt path.
      continue;
    }

    await persistApprovedActionOutcomeUnknown({
      approvalId: candidate.approvalId,
      taskId: candidate.taskId,
      agentId: candidate.agentId,
      leaseOwner: candidate.leaseOwner,
      blockOnlyIfLeaseExpiredBefore: now,
      error: new Error(
        receipts.length === 0
          ? "Legacy consumed approved action has no durable receipt."
          : "Consumed approved action has no single recoverable durable outcome.",
      ),
    });
  }
}

async function recoverActiveOperationInvocations(
  now: Date,
  workerStaleAfterMs: number,
): Promise<void> {
  // Recovery is execution-kind agnostic. In particular, a task attempt must
  // never be requeued while an at-most-once receipt from that attempt remains
  // running, and a crashed chat turn must not leave an unreconcilable running
  // receipt forever. The receipt layer owns the canonical lock order and the
  // safe transition for each side-effect class.
  const staleActiveReceipts = await db
    .selectDistinct({ id: operationReceiptsTable.id })
    .from(operationReceiptsTable)
    .innerJoin(
      operationInvocationsTable,
      eq(operationInvocationsTable.receiptId, operationReceiptsTable.id),
    )
    .where(
      and(
        inArray(operationReceiptsTable.state, ["reserved", "running"]),
        or(
          and(
            inArray(operationInvocationsTable.state, ["claimed", "running"]),
            lte(operationInvocationsTable.leaseExpiresAt, now),
          ),
          // Older screenshot code could release a published capture for
          // retry. Fence those receipts even without another tool request.
          and(
            eq(operationReceiptsTable.toolName, "browser_save_screenshot"),
            eq(operationReceiptsTable.state, "reserved"),
            eq(operationInvocationsTable.state, "failed"),
            sql`${operationInvocationsTable.effectStartedAt} IS NOT NULL`,
          ),
        ),
      ),
    )
    .orderBy(asc(operationReceiptsTable.id));
  const runtimeStaleBefore = new Date(now.getTime() - workerStaleAfterMs);
  for (const receipt of staleActiveReceipts) {
    await recoverInterruptedOperation({
      receiptId: receipt.id,
      now,
      runtimeStaleBefore,
    });
  }
}

async function resumeResolvedApprovalTasks(now: Date): Promise<void> {
  const candidates = await db
    .select({
      id: tasksTable.id,
      ownerAgentId: tasksTable.ownerAgentId,
    })
    .from(tasksTable)
    .where(
      and(eq(tasksTable.status, "awaiting_approval"), leaseAvailable(now)),
    );
  for (const candidate of candidates) {
    try {
      await db.transaction(async (tx) => {
        await lockAndAssertExecutionAllowed(tx);
        await tx.execute(
          sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${candidate.ownerAgentId} FOR UPDATE`,
        );
        await tx.execute(
          sql`SELECT id FROM ${approvalRequestsTable} WHERE ${approvalRequestsTable.taskId} = ${candidate.id} ORDER BY id FOR UPDATE`,
        );
        await tx.execute(
          sql`SELECT id FROM ${tasksTable} WHERE ${tasksTable.id} = ${candidate.id} FOR UPDATE`,
        );
        const [liveTask] = await tx
          .select()
          .from(tasksTable)
          .where(eq(tasksTable.id, candidate.id));
        const approvals = await tx
          .select()
          .from(approvalRequestsTable)
          .where(eq(approvalRequestsTable.taskId, candidate.id));
        const [succeededApprovedReceipts, approvalResolutionEvents] =
          await Promise.all([
            tx
              .select({ id: operationReceiptsTable.id })
              .from(operationReceiptsTable)
              .where(
                and(
                  eq(operationReceiptsTable.taskId, candidate.id),
                  eq(operationReceiptsTable.executionKind, "approved_action"),
                  eq(operationReceiptsTable.state, "succeeded"),
                ),
              ),
            tx
              .select({ detail: activityEventsTable.detail })
              .from(activityEventsTable)
              .where(
                and(
                  eq(activityEventsTable.taskId, candidate.id),
                  eq(activityEventsTable.type, "approval_resolved"),
                ),
              ),
          ]);
        if (
          !liveTask ||
          liveTask.ownerAgentId !== candidate.ownerAgentId ||
          liveTask.status !== "awaiting_approval" ||
          (liveTask.leaseExpiresAt &&
            liveTask.leaseExpiresAt.getTime() >= now.getTime())
        ) {
          return;
        }
        const hasApproved = approvals.some(
          (approval) => approval.status === "approved",
        );
        const hasPending = approvals.some(
          (approval) => approval.status === "pending",
        );
        const hasQueuedAction = approvals.some(
          (approval) =>
            approval.status === "approved" &&
            approval.actionPayload !== null &&
            approval.consumedAt === null,
        );
        const hasPendingReceiptFinalization = succeededApprovedReceipts.some(
          (receipt) =>
            !approvalResolutionEvents.some(
              (event) => event.detail?.receiptId === receipt.id,
            ),
        );
        if (
          !hasApproved ||
          hasPending ||
          hasQueuedAction ||
          hasPendingReceiptFinalization
        ) {
          return;
        }
        await tx
          .update(tasksTable)
          .set({
            status: "in_progress",
            blockedReason: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(tasksTable.id, liveTask.id),
              eq(tasksTable.ownerAgentId, liveTask.ownerAgentId),
              eq(tasksTable.status, "awaiting_approval"),
              liveTask.leaseOwner === null
                ? isNull(tasksTable.leaseOwner)
                : eq(tasksTable.leaseOwner, liveTask.leaseOwner),
            ),
          );
      });
    } catch (error) {
      if (error instanceof EmergencyStopError) return;
      throw error;
    }
  }
}

export interface ReviveAndReleaseStaleWorkDependencies {
  finalizeApprovedActionReceipt?: typeof finalizeSucceededApprovedActionReceipt;
  afterExpiredTaskCandidatesSelected?: () => Promise<void>;
}

export async function reviveAndReleaseStaleWorkCore(
  workerStaleAfterMs = 15_000,
  dependencies: ReviveAndReleaseStaleWorkDependencies = {},
): Promise<void> {
  const locale = await readWorkspaceLocale();
  const copy = getToolCopy(locale);
  const now = new Date();
  await scrubExpiredApprovals(now);
  await recoverActiveOperationInvocations(now, workerStaleAfterMs);
  // A consumed capability is at-most-once. Reconcile its operator-visible
  // unknown marker before any attempt to resume ordinary approved work.
  await reconcileApprovedActionReceipts(now, dependencies);

  // First reconcile active attempts whose task or agent ownership is already
  // missing/mismatched. Emergency-stop cleanup can clear the leases before
  // the worker has persisted the attempt loss. Restrict recovery to the
  // task's current attempt number so an unrelated shadow/history row is
  // never changed.
  const orphanAttempts = await db
    .select({
      id: taskAttemptsTable.id,
      taskId: taskAttemptsTable.taskId,
      agentId: taskAttemptsTable.agentId,
    })
    .from(taskAttemptsTable)
    .innerJoin(tasksTable, eq(tasksTable.id, taskAttemptsTable.taskId))
    .innerJoin(agentsTable, eq(agentsTable.id, taskAttemptsTable.agentId))
    .where(
      and(
        inArray(taskAttemptsTable.state, ["claimed", "running"]),
        eq(taskAttemptsTable.attemptNumber, tasksTable.stepAttempts),
        or(
          isNull(tasksTable.leaseOwner),
          ne(tasksTable.leaseOwner, taskAttemptsTable.leaseOwner),
          isNull(tasksTable.leaseExpiresAt),
          lt(tasksTable.leaseExpiresAt, now),
          isNull(agentsTable.runLeaseOwner),
          ne(agentsTable.runLeaseOwner, taskAttemptsTable.leaseOwner),
          isNull(agentsTable.runLeaseExpiresAt),
          lt(agentsTable.runLeaseExpiresAt, now),
        ),
      ),
    );
  for (const candidate of orphanAttempts) {
    await db.transaction(async (tx) => {
      const runtimeControl = await lockRuntimeControlState(tx);
      await tx.execute(
        sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${candidate.agentId} FOR UPDATE`,
      );
      await tx.execute(
        sql`SELECT id FROM ${tasksTable} WHERE ${tasksTable.id} = ${candidate.taskId} FOR UPDATE`,
      );
      await tx.execute(
        sql`SELECT id FROM ${taskAttemptsTable} WHERE ${taskAttemptsTable.id} = ${candidate.id} FOR UPDATE`,
      );
      const [liveAgent] = await tx
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, candidate.agentId));
      const [liveTask] = await tx
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, candidate.taskId));
      const [liveAttempt] = await tx
        .select()
        .from(taskAttemptsTable)
        .where(eq(taskAttemptsTable.id, candidate.id));
      if (
        !liveAgent ||
        !liveTask ||
        !liveAttempt ||
        liveAttempt.taskId !== liveTask.id ||
        liveAttempt.agentId !== liveAgent.id ||
        liveAttempt.attemptNumber !== liveTask.stepAttempts ||
        (liveAttempt.state !== "claimed" && liveAttempt.state !== "running")
      ) {
        return;
      }
      const taskLeaseHealthy =
        liveTask.leaseOwner === liveAttempt.leaseOwner &&
        Boolean(
          liveTask.leaseExpiresAt &&
          liveTask.leaseExpiresAt.getTime() > now.getTime(),
        );
      const agentLeaseHealthy =
        liveAgent.runLeaseOwner === liveAttempt.leaseOwner &&
        Boolean(
          liveAgent.runLeaseExpiresAt &&
          liveAgent.runLeaseExpiresAt.getTime() > now.getTime(),
        );
      if (taskLeaseHealthy && agentLeaseHealthy) return;

      // Holding the exact attempt row prevents a concurrent operation claim
      // from appearing between this check and the lost/requeue transition.
      // Any still-active invocation is either currently owned or waiting for
      // the generic recovery pass to classify it; requeueing its task here
      // could overlap an at-most-once effect that already crossed its boundary.
      const [activeOperation] = await tx
        .select({ id: operationInvocationsTable.id })
        .from(operationInvocationsTable)
        .innerJoin(
          operationReceiptsTable,
          eq(operationReceiptsTable.id, operationInvocationsTable.receiptId),
        )
        .where(
          and(
            eq(operationInvocationsTable.attemptId, liveAttempt.id),
            eq(operationInvocationsTable.executionKind, "task_step"),
            eq(operationReceiptsTable.executionKind, "task_step"),
            eq(operationReceiptsTable.originAttemptId, liveAttempt.id),
            inArray(operationInvocationsTable.state, ["claimed", "running"]),
            inArray(operationReceiptsTable.state, ["reserved", "running"]),
          ),
        )
        .limit(1);
      if (activeOperation) return;

      const lost = await transitionTaskAttempt(
        {
          attemptId: liveAttempt.id,
          taskId: liveTask.id,
          agentId: liveAgent.id,
          leaseOwner: liveAttempt.leaseOwner,
          from: ["claimed", "running"],
          state: "lost",
          now,
          failureKind: "lease_expired",
          sanitizedError:
            "Task ownership disappeared before the attempt reached a terminal transition.",
        },
        tx,
      );
      if (!lost) throw new ClaimConflictError();

      const recoverableTaskOwner =
        liveTask.leaseOwner === null ||
        liveTask.leaseOwner === liveAttempt.leaseOwner;
      const interrupted =
        recoverableTaskOwner &&
        ACTIVE_STATUSES.includes(
          liveTask.status as (typeof ACTIVE_STATUSES)[number],
        );
      let recovered: { id: number; recoveryCount: number } | undefined;
      if (recoverableTaskOwner) {
        [recovered] = await tx
          .update(tasksTable)
          .set({
            leaseOwner: null,
            leaseExpiresAt: null,
            ...(interrupted
              ? {
                  nextAttemptAt: runtimeControl.emergencyStopEnabled
                    ? liveTask.nextAttemptAt
                    : now,
                  recoveryCount: sql`${tasksTable.recoveryCount} + 1`,
                  lastError: runtimeControl.emergencyStopEnabled
                    ? copy.schedulerRecoveryPausedNote
                    : copy.schedulerRecoveryNote,
                }
              : {}),
          })
          .where(
            and(
              eq(tasksTable.id, liveTask.id),
              eq(tasksTable.stepAttempts, liveAttempt.attemptNumber),
              liveTask.leaseOwner === null
                ? isNull(tasksTable.leaseOwner)
                : eq(tasksTable.leaseOwner, liveAttempt.leaseOwner),
            ),
          )
          .returning({
            id: tasksTable.id,
            recoveryCount: tasksTable.recoveryCount,
          });
        if (!recovered) throw new ClaimConflictError();
      }

      await tx
        .update(agentsTable)
        .set({
          runLeaseOwner: null,
          runLeaseExpiresAt: null,
          status: "idle",
          currentTaskId: null,
          currentAction: null,
        })
        .where(
          and(
            eq(agentsTable.id, liveAgent.id),
            eq(agentsTable.runLeaseOwner, liveAttempt.leaseOwner),
          ),
        );

      if (interrupted && recovered) {
        await tx.insert(activityEventsTable).values({
          agentId: liveAgent.id,
          taskId: liveTask.id,
          type: "task_status_changed",
          summary: runtimeControl.emergencyStopEnabled
            ? copy.schedulerRecoveryPaused
            : copy.schedulerRecovered,
          detail: {
            recoveryCount: recovered.recoveryCount,
            reason: "expired_lease",
            lostAttemptId: liveAttempt.id,
          },
          severity: "warning",
          createdAt: now,
        });
      }
    });
  }

  // Compatibility cleanup for an expired task whose exact attempt is
  // already terminal (including a committed future continuous cadence) or
  // absent on a pre-attempt row. Lock and reread in canonical order.
  const expiredTasks = await db
    .select({
      id: tasksTable.id,
      ownerAgentId: tasksTable.ownerAgentId,
      leaseOwner: tasksTable.leaseOwner,
    })
    .from(tasksTable)
    .where(lt(tasksTable.leaseExpiresAt, now));
  await dependencies.afterExpiredTaskCandidatesSelected?.();
  for (const candidate of expiredTasks) {
    if (!candidate.leaseOwner) continue;
    const expiredLeaseOwner = candidate.leaseOwner;
    await db.transaction(async (tx) => {
      const runtimeControl = await lockRuntimeControlState(tx);
      await tx.execute(
        sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${candidate.ownerAgentId} FOR UPDATE`,
      );
      await tx.execute(
        sql`SELECT id FROM ${tasksTable} WHERE ${tasksTable.id} = ${candidate.id} FOR UPDATE`,
      );
      const [liveTask] = await tx
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, candidate.id));
      if (
        !liveTask ||
        liveTask.ownerAgentId !== candidate.ownerAgentId ||
        liveTask.leaseOwner !== expiredLeaseOwner ||
        !liveTask.leaseExpiresAt ||
        liveTask.leaseExpiresAt.getTime() >= now.getTime()
      ) {
        return;
      }
      const [attemptSnapshot] = await tx
        .select()
        .from(taskAttemptsTable)
        .where(
          and(
            eq(taskAttemptsTable.taskId, liveTask.id),
            eq(taskAttemptsTable.agentId, liveTask.ownerAgentId),
            eq(taskAttemptsTable.leaseOwner, expiredLeaseOwner),
            eq(taskAttemptsTable.attemptNumber, liveTask.stepAttempts),
          ),
        )
        .orderBy(desc(taskAttemptsTable.startedAt))
        .limit(1);
      if (attemptSnapshot) {
        await tx.execute(
          sql`SELECT id FROM ${taskAttemptsTable} WHERE ${taskAttemptsTable.id} = ${attemptSnapshot.id} FOR UPDATE`,
        );
      }
      const [attempt] = attemptSnapshot
        ? await tx
            .select()
            .from(taskAttemptsTable)
            .where(eq(taskAttemptsTable.id, attemptSnapshot.id))
        : [];
      const activeAttempt =
        attempt?.state === "claimed" || attempt?.state === "running"
          ? attempt
          : null;
      if (activeAttempt) {
        // The exact attempt row is locked, so a concurrent claim cannot appear
        // after this check. Preserve any still-active durable operation until
        // the generic recovery pass has classified its effect boundary.
        const [activeOperation] = await tx
          .select({ id: operationInvocationsTable.id })
          .from(operationInvocationsTable)
          .innerJoin(
            operationReceiptsTable,
            eq(operationReceiptsTable.id, operationInvocationsTable.receiptId),
          )
          .where(
            and(
              eq(operationInvocationsTable.attemptId, activeAttempt.id),
              eq(operationInvocationsTable.executionKind, "task_step"),
              eq(operationReceiptsTable.executionKind, "task_step"),
              eq(operationReceiptsTable.originAttemptId, activeAttempt.id),
              inArray(operationInvocationsTable.state, ["claimed", "running"]),
              inArray(operationReceiptsTable.state, ["reserved", "running"]),
            ),
          )
          .limit(1);
        if (activeOperation) return;
      }
      const committedContinuousCadence = Boolean(
        attempt &&
        !activeAttempt &&
        liveTask.autonomyMode === "continuous" &&
        liveTask.nextAttemptAt &&
        liveTask.nextAttemptAt.getTime() > now.getTime(),
      );
      const interrupted =
        ACTIVE_STATUSES.includes(
          liveTask.status as (typeof ACTIVE_STATUSES)[number],
        ) && !committedContinuousCadence;
      if (activeAttempt) {
        const lost = await transitionTaskAttempt(
          {
            attemptId: activeAttempt.id,
            taskId: liveTask.id,
            agentId: liveTask.ownerAgentId,
            leaseOwner: expiredLeaseOwner,
            from: ["claimed", "running"],
            state: "lost",
            now,
            failureKind: "lease_expired",
            sanitizedError:
              "Task lease expired before the attempt reached a terminal transition.",
          },
          tx,
        );
        if (!lost) throw new ClaimConflictError();
      }
      const [recovered] = await tx
        .update(tasksTable)
        .set({
          leaseOwner: null,
          leaseExpiresAt: null,
          ...(interrupted
            ? {
                nextAttemptAt: runtimeControl.emergencyStopEnabled
                  ? liveTask.nextAttemptAt
                  : now,
                recoveryCount: sql`${tasksTable.recoveryCount} + 1`,
                lastError: runtimeControl.emergencyStopEnabled
                  ? copy.schedulerRecoveryPausedNote
                  : copy.schedulerRecoveryNote,
              }
            : {}),
        })
        .where(
          and(
            eq(tasksTable.id, liveTask.id),
            eq(tasksTable.leaseOwner, expiredLeaseOwner),
            lt(tasksTable.leaseExpiresAt, now),
          ),
        )
        .returning({
          id: tasksTable.id,
          recoveryCount: tasksTable.recoveryCount,
        });
      if (!recovered) throw new ClaimConflictError();
      await tx
        .update(agentsTable)
        .set({
          runLeaseOwner: null,
          runLeaseExpiresAt: null,
          status: "idle",
          currentTaskId: null,
          currentAction: null,
        })
        .where(
          and(
            eq(agentsTable.id, liveTask.ownerAgentId),
            eq(agentsTable.runLeaseOwner, expiredLeaseOwner),
          ),
        );
      if (interrupted) {
        await tx.insert(activityEventsTable).values({
          agentId: liveTask.ownerAgentId,
          taskId: liveTask.id,
          type: "task_status_changed",
          summary: runtimeControl.emergencyStopEnabled
            ? copy.schedulerRecoveryPaused
            : copy.schedulerRecovered,
          detail: {
            recoveryCount: recovered.recoveryCount,
            reason: "expired_lease",
            lostAttemptId: activeAttempt?.id ?? null,
          },
          severity: "warning",
          createdAt: now,
        });
      }
    });
  }

  // Compatibility cleanup for an orphaned agent lease without a matching
  // task row. Compare-and-set both the selected owner and expiry boundary so
  // a newer owner is never released.
  const expiredAgents = await db
    .select({
      id: agentsTable.id,
      runLeaseOwner: agentsTable.runLeaseOwner,
    })
    .from(agentsTable)
    .where(lt(agentsTable.runLeaseExpiresAt, now));
  for (const expiredAgent of expiredAgents) {
    if (!expiredAgent.runLeaseOwner) continue;
    const expiredRunLeaseOwner = expiredAgent.runLeaseOwner;
    await db.transaction(async (tx) => {
      await lockRuntimeControlState(tx);
      await tx.execute(
        sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${expiredAgent.id} FOR UPDATE`,
      );
      const [liveAgent] = await tx
        .select({
          runLeaseOwner: agentsTable.runLeaseOwner,
          runLeaseExpiresAt: agentsTable.runLeaseExpiresAt,
        })
        .from(agentsTable)
        .where(eq(agentsTable.id, expiredAgent.id));
      if (
        !liveAgent ||
        liveAgent.runLeaseOwner !== expiredRunLeaseOwner ||
        !liveAgent.runLeaseExpiresAt ||
        liveAgent.runLeaseExpiresAt.getTime() >= now.getTime()
      ) {
        return;
      }
      await tx
        .update(agentsTable)
        .set({
          runLeaseOwner: null,
          runLeaseExpiresAt: null,
          status: "idle",
          currentTaskId: null,
          currentAction: null,
        })
        .where(
          and(
            eq(agentsTable.id, expiredAgent.id),
            eq(agentsTable.runLeaseOwner, expiredRunLeaseOwner),
            lt(agentsTable.runLeaseExpiresAt, now),
          ),
        );
    });
  }
  await resumeResolvedApprovalTasks(now);
}

export const reviveAndReleaseStaleWork = reviveAndReleaseStaleWorkCore;

interface ClaimedTaskLifecycle {
  afterInitialLeaseHeartbeat(): void;
}

export interface ClaimAndStepDueTasksDependencies {
  beforeClaimTransaction?: (slot: number, candidate: Task) => Promise<void>;
  afterClaimLocksBeforeTimestamp?: (
    slot: number,
    candidate: Task,
  ) => Promise<void>;
  runClaimedTask?: (
    task: ClaimedTask,
    lifecycle: ClaimedTaskLifecycle,
  ) => Promise<void>;
}

export async function claimAndStepDueTasks(
  runtime: RuntimeInstanceHandle,
  config: RuntimeOperationsConfig,
  dependencies: ClaimAndStepDueTasksDependencies = {},
): Promise<void> {
  const inFlight: Promise<void>[] = [];
  const runClaimedTask =
    dependencies.runClaimedTask ??
    ((task: ClaimedTask, lifecycle: ClaimedTaskLifecycle) =>
      stepTask(task, {
        runtimeOperationsConfig: config,
        afterInitialLeaseHeartbeat: lifecycle.afterInitialLeaseHeartbeat,
      }));

  for (let slot = 0; slot < CONCURRENCY; slot += 1) {
    let task: ClaimedTask | undefined;
    try {
      [task] = await claimDueTasks(runtime, config, {
        maxClaims: 1,
        beforeCandidateTransaction: (candidate) =>
          dependencies.beforeClaimTransaction?.(slot, candidate) ??
          Promise.resolve(),
        afterCandidateLocksBeforeClaim: (candidate) =>
          dependencies.afterClaimLocksBeforeTimestamp?.(slot, candidate) ??
          Promise.resolve(),
      });
    } catch (error) {
      if (error instanceof RuntimeClaimAdmissionError) break;
      await Promise.all(inFlight);
      throw error;
    }
    if (!task) break;

    let signalInitialHeartbeat!: () => void;
    const initialHeartbeat = new Promise<void>((resolve) => {
      signalInitialHeartbeat = resolve;
    });
    let taskStep: Promise<void>;
    try {
      taskStep = runClaimedTask(task, {
        afterInitialLeaseHeartbeat: signalInitialHeartbeat,
      });
    } catch (error) {
      taskStep = Promise.reject(error);
    }
    const settledStep = taskStep.catch((error) => {
      logger.error({ error, taskId: task.id }, "Unhandled error stepping task");
    });
    inFlight.push(settledStep);

    logger.info(
      { taskId: task.id, schedulerInstance: runtime.id, slot },
      "Scheduler tick: stepping claimed task",
    );
    await Promise.race([initialHeartbeat, settledStep]);
  }

  await Promise.all(inFlight);
}

async function runTick(context: SchedulerContext): Promise<void> {
  try {
    // Each replica independently observes the persisted stop and extinguishes
    // its own process-local browser/child-process state before returning.
    await synchronizeEmergencyStopForThisProcess();
    await assertExecutionAllowed();
    await recordStaleRuntimeIncidents(context.config);
    await reviveAndReleaseStaleWorkCore(context.config.workerStaleAfterMs);
    if (!context.acceptingClaims) return;
    await approvePolicyActions();
    await executeApprovedActionBacklog(context.runtime, context.config);
    await enforceTaskBudgets();
    await db
      .update(runtimeInstancesTable)
      .set({ lastSchedulerTickAt: new Date() })
      .where(
        and(
          eq(runtimeInstancesTable.id, context.runtime.id),
          eq(runtimeInstancesTable.startedAt, context.runtime.startedAt),
        ),
      );
    if (!context.acceptingClaims) return;
    await claimAndStepDueTasks(context.runtime, context.config, {
      runClaimedTask: async (task, lifecycle) => {
        let owned = false;
        const afterInitialLeaseHeartbeat = () => {
          if (!owned) {
            owned = true;
            context.activeOwnedSteps += 1;
          }
          lifecycle.afterInitialLeaseHeartbeat();
        };
        try {
          if (context.runClaimedTask) {
            await context.runClaimedTask(task, { afterInitialLeaseHeartbeat });
          } else {
            await stepTask(task, {
              runtimeOperationsConfig: context.config,
              afterInitialLeaseHeartbeat,
            });
          }
        } finally {
          if (owned) context.activeOwnedSteps -= 1;
        }
      },
    });
  } catch (error) {
    if (error instanceof EmergencyStopError) return;
    logger.error({ error }, "Scheduler tick failed");
  }
}

function triggerTick(context: SchedulerContext): void {
  if (activeTick) {
    // The timer still polls admission while owned tasks await external results.
    // Record that liveness without starting another batch. Do not mask blocked
    // preflight/claim work, revive a stopped incarnation, or queue DB writes.
    if (
      context.acceptingClaims &&
      context.activeOwnedSteps > 0 &&
      !context.livenessWrite
    ) {
      context.livenessWrite = (async () => {
        assertRuntimeClaimHandle(context.runtime);
        await db
          .update(runtimeInstancesTable)
          .set({ lastSchedulerTickAt: new Date() })
          .where(
            and(
              eq(runtimeInstancesTable.id, context.runtime.id),
              eq(runtimeInstancesTable.startedAt, context.runtime.startedAt),
              inArray(runtimeInstancesTable.state, ["starting", "healthy"]),
              eq(runtimeInstancesTable.schedulerEnabled, true),
            ),
          );
      })()
        .catch((error) => {
          logger.warn({ error }, "Busy scheduler liveness update failed");
        })
        .finally(() => {
          context.livenessWrite = null;
        });
    }
    return;
  }
  activeTick = runTick(context).finally(() => {
    activeTick = null;
  });
}

export function startScheduler(
  runtime: RuntimeInstanceHandle,
  config: RuntimeOperationsConfig,
  dependencies: Pick<ClaimAndStepDueTasksDependencies, "runClaimedTask"> = {},
): void {
  if (timer) return;
  if (config.role === "api") {
    throw new Error("API runtime cannot start the scheduler");
  }
  const context: SchedulerContext = {
    runtime,
    config,
    acceptingClaims: true,
    activeOwnedSteps: 0,
    livenessWrite: null,
    runClaimedTask: dependencies.runClaimedTask,
  };
  schedulerContext = context;
  logger.info(
    {
      intervalMs: config.schedulerTickMs,
      schedulerInstance: runtime.id,
      budgets: {
        maxSteps: MAX_TASK_STEPS,
        maxTokens: MAX_TASK_TOKENS,
        maxReportedCostUsd: MAX_TASK_REPORTED_COST_USD,
      },
    },
    "Starting leased autonomous task scheduler",
  );
  triggerTick(context);
  timer = setInterval(() => triggerTick(context), config.schedulerTickMs);
}

export async function stopScheduler(): Promise<void> {
  const context = schedulerContext;
  if (schedulerContext) schedulerContext.acceptingClaims = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  schedulerContext = null;
  await activeTick;
  await context?.livenessWrite;
}
