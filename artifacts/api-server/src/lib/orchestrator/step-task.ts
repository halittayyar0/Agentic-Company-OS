import {
  getToolCopy,
  toolMessage,
  toolDispatchText,
  toolModelFailureText,
} from "./tool-localization";
import { toolReceiptLocale } from "./tool-presentation";
import { terminalMessage } from "../vm/terminal-localization";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type OpenAI from "openai";
import {
  createChatCompletion,
  DEFAULT_MAX_COMPLETION_TOKENS,
} from "@workspace/ai-server";
import {
  db,
  agentsTable,
  tasksTable,
  activityEventsTable,
  approvalRequestsTable,
  taskAttemptsTable,
} from "@workspace/db";
import { logger } from "../logger";
import { redactAuditText } from "../audit-redaction";
import type { RuntimeOperationsConfig } from "../runtime-operations-config";
import { getToolsForAgent } from "./tools";
import { executeTool, type DurableTaskLifecycleIntent } from "./execute-tool";
import { buildTaskStepSystemPrompt } from "./system-prompt";
import { readWorkspaceLocale, type WorkspaceLocale } from "../workspace-locale";
import { selectModelPlan, type ModelRouteCandidate } from "./model-select";
import {
  modelCompatibilityExhaustedError,
  ModelRoutesExhaustedError,
  runWithModelFallback,
  type ModelAttemptFailure,
} from "./model-fallback";
import {
  taskRetryDecision,
  type TaskStepFailureKind,
} from "./task-retry-policy";
import { recordCompletionUsage } from "./usage-ledger";
import {
  computerSurfaceForTool,
  deferredComputerToolMessage,
  isComputerTool,
  resolveMaxToolCallsPerRound,
  resolveMaxToolRounds,
  shouldDeferComputerTool,
} from "./tool-loop-policy";
import { computerStepDetail, recordComputerDecision } from "./computer-session";
import {
  EmergencyStopError,
  lockAndAssertExecutionAllowed,
} from "./runtime-emergency-stop";
import { toolResultForModel } from "./untrusted-tool-output";
import {
  deriveExclusiveTurnPolicy,
  evaluateExclusiveToolCall,
  exclusiveToolBlockedMessage,
  exclusiveTurnSystemPrompt,
  filterToolsForExclusiveTurn,
} from "./exclusive-turn-policy";
import {
  loseTaskAttemptAfterOwnershipLoss,
  transitionTaskAttempt,
  type ClaimedTask,
} from "./task-attempt-store";
import {
  startTaskLeaseHeartbeat,
  TaskLeaseOwnershipLostError,
  type TaskLeaseHeartbeat,
  type TaskLeaseHeartbeatRuntime,
} from "./task-lease-heartbeat";
import { assertOutstandingApprovalCapacity } from "./runtime-capacity";
import { completeOperation, markOperationRunning } from "./operation-receipts";

const MAX_CONSECUTIVE_FAILURES = Math.max(
  1,
  Math.floor(Number(process.env.MAX_CONSECUTIVE_TASK_FAILURES) || 5),
);
const TERMINAL_TASK_TOOLS = new Set([
  "complete_task",
  "request_approval",
  "request_user_input",
]);

export type TerminalTaskToolDisposition =
  "not_terminal" | "persisted" | "rejected";

export function terminalTaskToolDisposition(
  toolName: string,
  taskLifecycleEffect: "completed" | "suspended" | undefined,
): TerminalTaskToolDisposition {
  if (!TERMINAL_TASK_TOOLS.has(toolName)) return "not_terminal";
  return taskLifecycleEffect ? "persisted" : "rejected";
}
const EXCLUSIVE_TASK_LIFECYCLE_TOOLS = [
  "update_task_progress",
  "complete_task",
  "request_user_input",
] as const;

export interface StepTaskDependencies {
  runtimeOperationsConfig: RuntimeOperationsConfig;
  createCompletion?: typeof createChatCompletion;
  selectModelPlan?: typeof selectModelPlan;
  runTool?: typeof executeTool;
  locale?: WorkspaceLocale;
  leaseHeartbeatRuntime?: TaskLeaseHeartbeatRuntime;
  beforeLifecycleFinalizeRelease?: (
    tx: StepTransaction,
    intent: DurableTaskLifecycleIntent,
  ) => Promise<void>;
  beforeOwnedStepWriteTransaction?: () => Promise<void>;
  afterInitialLeaseHeartbeat?: () => void;
}

type StepTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function approvalCategoryAllowed(
  agent: typeof agentsTable.$inferSelect,
  category: "spend" | "delete" | "publish" | "external_contact" | "other",
): boolean {
  if (category === "other") return true;
  if (category === "spend") return agent.permissions.canSpend;
  if (category === "delete") return agent.permissions.canDelete;
  if (category === "publish") return agent.permissions.canPublish;
  return agent.permissions.canContactExternal;
}

async function applyDurableTaskLifecycleIntent(
  tx: StepTransaction,
  task: ClaimedTask,
  agent: typeof agentsTable.$inferSelect,
  intent: DurableTaskLifecycleIntent,
  locale: WorkspaceLocale,
): Promise<Record<string, unknown>> {
  const copy = getToolCopy(locale);
  const text = toolMessage.bind(null, locale);
  if (intent.kind === "complete") {
    const allowActiveContinuousChildren =
      intent.allowActiveContinuousChildren === true &&
      intent.continuous &&
      task.autonomyMode === "continuous";
    const [unresolvedSubtask] = await tx
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.parentTaskId, task.id),
          inArray(tasksTable.status, [
            "pending",
            "planning",
            "in_progress",
            "awaiting_approval",
            "blocked",
          ]),
          ...(allowActiveContinuousChildren
            ? [eq(tasksTable.autonomyMode, "finite")]
            : []),
        ),
      )
      .limit(1);
    if (unresolvedSubtask) throw new TaskLeaseOwnershipLostError();
    const [updated] = await tx
      .update(tasksTable)
      .set({
        status: intent.continuous ? "in_progress" : "completed",
        progressPercent: intent.continuous ? 0 : 100,
        resultSummary: intent.resultSummary,
        completedAt: intent.continuous ? null : intent.cycleCompletedAt,
        nextAttemptAt: intent.nextRunAt,
        consecutiveFailures: 0,
        lastError: null,
        blockedReason: null,
        ...(intent.continuous
          ? {
              cycleCount: sql`${tasksTable.cycleCount} + 1`,
              lastCycleCompletedAt: intent.cycleCompletedAt,
            }
          : {}),
      })
      .where(
        and(
          eq(tasksTable.id, task.id),
          eq(tasksTable.ownerAgentId, agent.id),
          eq(tasksTable.leaseOwner, task.leaseOwner),
          inArray(tasksTable.status, ["pending", "planning", "in_progress"]),
        ),
      )
      .returning();
    if (!updated) throw new TaskLeaseOwnershipLostError();
    await tx.insert(activityEventsTable).values({
      agentId: agent.id,
      taskId: task.id,
      type: "task_status_changed",
      summary: text(
        intent.continuous
          ? "teamCycleActivity"
          : intent.judgeVerdict === "warn"
            ? "teamCompletionWarnActivity"
            : "teamCompletionActivity",
        { summary: redactAuditText(intent.resultSummary, 1_500, true) },
      ),
      detail: intent.continuous
        ? {
            status: "in_progress",
            autonomyMode: "continuous",
            cycleCount: updated.cycleCount,
            cycleCompletedAt: intent.cycleCompletedAt.toISOString(),
            nextRunAt: intent.nextRunAt!.toISOString(),
            judgeVerdict: intent.judgeVerdict,
          }
        : { status: "completed", judgeVerdict: intent.judgeVerdict },
      severity: intent.judgeVerdict === "warn" ? "warning" : "info",
    });
    if (updated.parentTaskId && !intent.continuous) {
      await tx.insert(activityEventsTable).values({
        taskId: updated.parentTaskId,
        agentId: updated.assignedByAgentId,
        type: "progress_update",
        summary: redactAuditText(
          text("teamChildCompletedActivity", {
            name: agent.name,
            title: updated.title,
            summary: intent.resultSummary,
          }),
          2_000,
          true,
        ),
        detail: { completedSubtaskId: updated.id },
        severity: "info",
      });
    }
    return {
      taskId: task.id,
      status: intent.continuous ? "in_progress" : "completed",
    };
  }

  if (intent.kind === "approval") {
    if (!approvalCategoryAllowed(agent, intent.category)) {
      throw new TaskLeaseOwnershipLostError();
    }
    await assertOutstandingApprovalCapacity(tx);
    const [suspended] = await tx
      .update(tasksTable)
      .set({ status: "awaiting_approval", blockedReason: null })
      .where(
        and(
          eq(tasksTable.id, task.id),
          eq(tasksTable.ownerAgentId, agent.id),
          eq(tasksTable.leaseOwner, task.leaseOwner),
          inArray(tasksTable.status, ["pending", "planning", "in_progress"]),
        ),
      )
      .returning({ id: tasksTable.id });
    if (!suspended) throw new TaskLeaseOwnershipLostError();
    const [approval] = await tx
      .insert(approvalRequestsTable)
      .values({
        taskId: task.id,
        agentId: agent.id,
        category: intent.category,
        title: intent.title,
        description: intent.description,
        amountUsd: intent.amountUsd,
        scope: intent.scope,
        actionPayload: intent.actionPayload,
        browserRuntimeInstanceId:
          intent.browserBinding?.runtimeInstanceId ?? null,
        browserSessionId: intent.browserBinding?.sessionId ?? null,
        browserSessionEpoch: intent.browserBinding?.sessionEpoch ?? null,
        browserSnapshotMarker: intent.browserBinding?.snapshotMarker ?? null,
        browserBindingHash: intent.browserBinding?.bindingHash ?? null,
        expiresAt: intent.expiresAt,
      })
      .returning({ id: approvalRequestsTable.id });
    if (!approval) throw new TaskLeaseOwnershipLostError();
    await tx.insert(activityEventsTable).values({
      agentId: agent.id,
      taskId: task.id,
      type: "approval_requested",
      summary: text("teamApprovalActivity", {
        title: redactAuditText(intent.title, 500, true),
      }),
      detail: {
        approvalId: approval.id,
        category: intent.category,
        amountUsd: intent.amountUsd,
        toolName: intent.scope?.toolName ?? null,
        target:
          intent.scope?.toolName === "browser_click" ||
          intent.scope?.toolName === "browser_type"
            ? null
            : intent.scope?.target
              ? redactAuditText(intent.scope.target, 500)
              : null,
        expiresAt: intent.expiresAt?.toISOString() ?? null,
        judgeVerdict: intent.judgeVerdict,
      },
      severity: "warning",
    });
    return { approvalId: approval.id };
  }

  const questionId = randomUUID();
  const safeQuestion = redactAuditText(intent.question, 1_000, true);
  const [blocked] = await tx
    .update(tasksTable)
    .set({
      status: "blocked",
      blockedReason: "user_input",
      userInputQuestionId: questionId,
      userInputQuestion: safeQuestion,
      userInputOwnerAgentId: agent.id,
      lastError: copy.teamInputWaiting,
      nextAttemptAt: null,
    })
    .where(
      and(
        eq(tasksTable.id, task.id),
        eq(tasksTable.ownerAgentId, agent.id),
        eq(tasksTable.leaseOwner, task.leaseOwner),
        inArray(tasksTable.status, ["pending", "planning", "in_progress"]),
      ),
    )
    .returning({ id: tasksTable.id });
  if (!blocked) throw new TaskLeaseOwnershipLostError();
  await tx.insert(activityEventsTable).values({
    agentId: agent.id,
    taskId: task.id,
    type: "note",
    summary: text("teamQuestionActivity", { question: safeQuestion }),
    detail: { question: safeQuestion, questionId },
    severity: "warning",
  });
  return { taskId: task.id, status: "blocked" };
}

async function withOwnedStepWrite<T>(
  task: ClaimedTask,
  heartbeat: TaskLeaseHeartbeat,
  callback: (tx: StepTransaction) => Promise<T>,
  beforeTransaction?: () => Promise<void>,
): Promise<T> {
  await heartbeat.assertOwned();
  await beforeTransaction?.();
  return db.transaction(async (tx) => {
    await lockAndAssertExecutionAllowed(tx);
    const [agent] = await tx
      .update(agentsTable)
      .set({ runLeaseExpiresAt: sql`${agentsTable.runLeaseExpiresAt}` })
      .where(
        and(
          eq(agentsTable.id, task.ownerAgentId),
          eq(agentsTable.isActive, true),
          eq(agentsTable.runLeaseOwner, task.leaseOwner),
        ),
      )
      .returning({ id: agentsTable.id });
    if (!agent) throw new TaskLeaseOwnershipLostError();
    const [ownedTask] = await tx
      .update(tasksTable)
      .set({ leaseExpiresAt: sql`${tasksTable.leaseExpiresAt}` })
      .where(
        and(
          eq(tasksTable.id, task.id),
          eq(tasksTable.ownerAgentId, task.ownerAgentId),
          eq(tasksTable.leaseOwner, task.leaseOwner),
        ),
      )
      .returning({ id: tasksTable.id });
    if (!ownedTask) throw new TaskLeaseOwnershipLostError();
    const [attempt] = await tx
      .update(taskAttemptsTable)
      .set({ lastHeartbeatAt: sql`${taskAttemptsTable.lastHeartbeatAt}` })
      .where(
        and(
          eq(taskAttemptsTable.id, task.runtimeAttemptId),
          eq(taskAttemptsTable.taskId, task.id),
          eq(taskAttemptsTable.agentId, task.ownerAgentId),
          eq(taskAttemptsTable.leaseOwner, task.leaseOwner),
          eq(taskAttemptsTable.state, "running"),
        ),
      )
      .returning({ id: taskAttemptsTable.id });
    if (!attempt) throw new TaskLeaseOwnershipLostError();
    return callback(tx);
  });
}

export async function stepTask(
  task: ClaimedTask,
  dependencies: StepTaskDependencies,
): Promise<void> {
  const createCompletion =
    dependencies.createCompletion ?? createChatCompletion;
  const createModelPlan = dependencies.selectModelPlan ?? selectModelPlan;
  const runTool = dependencies.runTool ?? executeTool;
  const locale = dependencies.locale ?? (await readWorkspaceLocale());
  const statusCopy = getToolCopy(locale);
  const computerLoopId = `task-step:${randomUUID()}`;
  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, task.ownerAgentId));

  if (!agent || !agent.isActive) {
    try {
      await db.transaction(async (tx) => {
        await lockAndAssertExecutionAllowed(tx);
        const [releasedAgent] = await tx
          .update(agentsTable)
          .set({
            currentTaskId: null,
            currentAction: null,
            runLeaseOwner: null,
            runLeaseExpiresAt: null,
          })
          .where(
            and(
              eq(agentsTable.id, task.ownerAgentId),
              eq(agentsTable.runLeaseOwner, task.leaseOwner),
            ),
          )
          .returning({ id: agentsTable.id });
        if (!releasedAgent) throw new TaskLeaseOwnershipLostError();
        const [persisted] = await tx
          .update(tasksTable)
          .set({
            status: "failed",
            lastSteppedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
          })
          .where(
            and(
              eq(tasksTable.id, task.id),
              eq(tasksTable.ownerAgentId, task.ownerAgentId),
              eq(tasksTable.leaseOwner, task.leaseOwner),
            ),
          )
          .returning({ id: tasksTable.id });
        if (!persisted) throw new TaskLeaseOwnershipLostError();
        const attempt = await transitionTaskAttempt(
          {
            attemptId: task.runtimeAttemptId,
            taskId: task.id,
            agentId: task.ownerAgentId,
            leaseOwner: task.leaseOwner,
            from: ["claimed"],
            state: "blocked",
            failureKind: "owner_inactive",
            sanitizedError: statusCopy.taskOwnerMissing,
          },
          tx,
        );
        if (!attempt) throw new TaskLeaseOwnershipLostError();
        await tx.insert(activityEventsTable).values({
          taskId: task.id,
          type: "error",
          summary: statusCopy.taskOwnerMissing,
          severity: "critical",
        });
      });
    } catch (error) {
      if (
        error instanceof TaskLeaseOwnershipLostError ||
        error instanceof EmergencyStopError
      ) {
        return;
      }
      throw error;
    }
    return;
  }

  if (!task.leaseOwner || agent.runLeaseOwner !== task.leaseOwner) {
    logger.warn(
      { taskId: task.id, agentId: agent.id },
      "Refusing to step a task without matching task and agent leases",
    );
    await loseTaskAttemptAfterOwnershipLoss({
      attemptId: task.runtimeAttemptId,
      taskId: task.id,
      agentId: agent.id,
      leaseOwner: task.leaseOwner,
      failureKind: "lease_lost",
      sanitizedError: statusCopy.taskLeaseMismatch,
    });
    return;
  }

  const attemptStarted = await db.transaction(async (tx) => {
    await lockAndAssertExecutionAllowed(tx);
    const [ownedAgent] = await tx
      .update(agentsTable)
      .set({ runLeaseExpiresAt: sql`${agentsTable.runLeaseExpiresAt}` })
      .where(
        and(
          eq(agentsTable.id, agent.id),
          eq(agentsTable.isActive, true),
          eq(agentsTable.runLeaseOwner, task.leaseOwner),
        ),
      )
      .returning({ id: agentsTable.id });
    if (!ownedAgent) throw new TaskLeaseOwnershipLostError();
    const [ownedTask] = await tx
      .update(tasksTable)
      .set({ leaseExpiresAt: sql`${tasksTable.leaseExpiresAt}` })
      .where(
        and(
          eq(tasksTable.id, task.id),
          eq(tasksTable.ownerAgentId, agent.id),
          eq(tasksTable.leaseOwner, task.leaseOwner),
        ),
      )
      .returning({ id: tasksTable.id });
    if (!ownedTask) throw new TaskLeaseOwnershipLostError();
    const transitioned = await transitionTaskAttempt(
      {
        attemptId: task.runtimeAttemptId,
        taskId: task.id,
        agentId: agent.id,
        leaseOwner: task.leaseOwner,
        from: ["claimed"],
        state: "running",
      },
      tx,
    );
    if (!transitioned) throw new TaskLeaseOwnershipLostError();
    return true;
  });
  if (!attemptStarted) return;

  const leaseHeartbeat = startTaskLeaseHeartbeat({
    taskId: task.id,
    agentId: agent.id,
    attemptId: task.runtimeAttemptId,
    leaseOwner: task.leaseOwner,
    config: dependencies.runtimeOperationsConfig,
    runtime: dependencies.leaseHeartbeatRuntime,
  });
  const persistOwnedStepWrite = <T>(
    callback: (tx: StepTransaction) => Promise<T>,
  ) =>
    withOwnedStepWrite(
      task,
      leaseHeartbeat,
      callback,
      dependencies.beforeOwnedStepWriteTransaction,
    );

  let totalTokens = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let reportedCostUsd = 0;
  let reportedCostSeen = false;
  let toolUsed = false;
  let stepError: string | null = null;
  let stepFailureKind: TaskStepFailureKind | null = null;
  let exhaustedModelFailures: ReadonlyArray<ModelAttemptFailure> = [];
  let attemptDisposition: "succeeded" | "blocked" | null = null;
  let attemptModelId: string | null = null;
  let attemptProvider: string | null = null;
  let pendingLifecycleIntent: DurableTaskLifecycleIntent | null = null;
  let operationOutcomeUnknown = false;
  let operationUnknownReceiptId: string | null = null;
  let operationDeferred = false;
  let operationDeferredReceiptId: string | null = null;
  let ownershipLost = false;

  try {
    await leaseHeartbeat.assertOwned(statusCopy.taskAnalyzing);
    dependencies.afterInitialLeaseHeartbeat?.();
    const derivedPolicy = deriveExclusiveTurnPolicy(
      `${task.title}\n${task.brief}`,
    );
    const exclusivePolicy = derivedPolicy
      ? {
          ...derivedPolicy,
          allowedTools: [
            ...new Set([
              ...derivedPolicy.allowedTools,
              ...EXCLUSIVE_TASK_LIFECYCLE_TOOLS,
            ]),
          ],
        }
      : null;
    const baseSystemPrompt = await buildTaskStepSystemPrompt(
      agent,
      task,
      locale,
    );
    const systemPrompt = exclusivePolicy
      ? `${baseSystemPrompt}\n\n${exclusiveTurnSystemPrompt(exclusivePolicy, locale)}`
      : baseSystemPrompt;
    const tools = filterToolsForExclusiveTurn(
      await getToolsForAgent(agent, true),
      exclusivePolicy,
    );
    const maxToolRounds = resolveMaxToolRounds(
      "task",
      tools.map((tool) => tool.function.name),
    );
    const maxToolCallsPerRound = resolveMaxToolCallsPerRound();
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: statusCopy.taskAdvanceInstruction,
      },
    ];
    const modelPlan = createModelPlan({
      purpose: "execution_step",
      agentDepth: agent.depth,
      complexityHint: agent.depth <= 1 ? "high" : "normal",
      agent: { modelMode: agent.modelMode, modelId: agent.modelId },
      taskExecutionModelId: task.executionModelId,
    });
    let activeRoutes = [...modelPlan.routes];
    let passiveResponsesForRoute = 0;
    let lifecycleRejectionsForRoute = 0;
    let toolRejectionsForRoute = 0;
    const recordedFallbackRoutes = new Set<string>();

    const activateRoute = async (
      route: ModelRouteCandidate,
      reason:
        | "provider_failure"
        | "passive_response"
        | "protocol_incompatibility"
        | "lifecycle_rejection"
        | "tool_rejection",
    ): Promise<void> => {
      const key = `${route.provider}:${route.modelId}`;
      if (
        route.modelId === modelPlan.primary.modelId ||
        recordedFallbackRoutes.has(key)
      ) {
        return;
      }
      await persistOwnedStepWrite(async (tx) => {
        const [persisted] = await tx
          .update(tasksTable)
          .set({
            lastModelId: route.modelId,
            lastModelProvider: route.provider,
            modelFallbackCount: sql`${tasksTable.modelFallbackCount} + 1`,
          })
          .where(
            and(
              eq(tasksTable.id, task.id),
              eq(tasksTable.ownerAgentId, agent.id),
              eq(tasksTable.leaseOwner, task.leaseOwner),
            ),
          )
          .returning({ id: tasksTable.id });
        if (!persisted) throw new TaskLeaseOwnershipLostError();
        await tx.insert(activityEventsTable).values({
          agentId: agent.id,
          taskId: task.id,
          type: "note",
          summary: toolMessage(locale, "modelFallback", {
            model: route.modelId,
          }),
          detail: {
            runtimeEvent: "model_fallback_activated",
            reason,
            primaryModelId: modelPlan.primary.modelId,
            fallbackModelId: route.modelId,
            fallbackProvider: route.provider,
            freeOnly: modelPlan.freeOnly,
          },
          severity: "warning",
        });
      });
      recordedFallbackRoutes.add(key);
    };

    for (let round = 0; round < maxToolRounds; round++) {
      await leaseHeartbeat.assertOwned(
        toolMessage(locale, "taskPlanning", {
          round: round + 1,
          total: maxToolRounds,
        }),
      );

      const routed = await runWithModelFallback({
        routes: activeRoutes,
        execute: async (route) => {
          await leaseHeartbeat.assertOwned(
            toolMessage(locale, "taskModelRunning", { model: route.modelId }),
          );
          const result = await createCompletion({
            model: route.modelId,
            messages,
            tools,
            maxTokens: DEFAULT_MAX_COMPLETION_TOKENS,
          });
          try {
            await leaseHeartbeat.assertOwned();
          } catch (error) {
            await recordCompletionUsage({
              completion: result.completion,
              provider: result.provider,
              modelId: route.modelId,
              agentId: agent.id,
              taskId: task.id,
              kind: "task_step",
            });
            throw error;
          }
          if (!result.completion.choices[0]?.message) {
            const compatibilityError = new Error(
              "Unsupported empty model completion response",
            ) as Error & { status: number };
            compatibilityError.status = 422;
            throw compatibilityError;
          }
          return result;
        },
        onFailure: async (failure) => {
          await leaseHeartbeat.assertOwned();
          await persistOwnedStepWrite(async (tx) => {
            const [persisted] = await tx
              .update(tasksTable)
              .set({
                lastModelId: failure.route.modelId,
                lastModelProvider: failure.route.provider,
                lastError: redactAuditText(
                  toolModelFailureText(locale, failure),
                  2_000,
                ),
              })
              .where(
                and(
                  eq(tasksTable.id, task.id),
                  eq(tasksTable.ownerAgentId, agent.id),
                  eq(tasksTable.leaseOwner, task.leaseOwner),
                ),
              )
              .returning({ id: tasksTable.id });
            if (!persisted) throw new TaskLeaseOwnershipLostError();
            if (!failure.retrySameRoute && failure.nextRoute) {
              await tx.insert(activityEventsTable).values({
                agentId: agent.id,
                taskId: task.id,
                type: "error",
                summary: toolMessage(locale, "modelRouteFailed", {
                  model: failure.nextRoute.modelId,
                }),
                detail: {
                  runtimeEvent: "model_route_failed",
                  modelId: failure.route.modelId,
                  provider: failure.route.provider,
                  failureKind: failure.kind,
                  attempt: failure.attempt,
                  nextModelId: failure.nextRoute.modelId,
                },
                severity: "warning",
              });
            }
          });
        },
      });
      const { completion, provider } = routed.value;
      const model = routed.route.modelId;
      attemptModelId = model;
      attemptProvider = provider;
      await persistOwnedStepWrite(async (tx) => {
        const [persisted] = await tx
          .update(tasksTable)
          .set({
            lastModelId: model,
            lastModelProvider: provider,
          })
          .where(
            and(
              eq(tasksTable.id, task.id),
              eq(tasksTable.ownerAgentId, agent.id),
              eq(tasksTable.leaseOwner, task.leaseOwner),
            ),
          )
          .returning({ id: tasksTable.id });
        if (!persisted) throw new TaskLeaseOwnershipLostError();
      });
      if (routed.route.modelId !== modelPlan.primary.modelId) {
        await activateRoute(routed.route, "provider_failure");
      }
      const originalRouteIndex = modelPlan.routes.findIndex(
        (route) =>
          route.modelId === routed.route.modelId &&
          route.provider === routed.route.provider,
      );
      activeRoutes = [
        routed.route,
        ...modelPlan.routes.slice(Math.max(0, originalRouteIndex + 1)),
      ];
      const usage = await recordCompletionUsage({
        completion,
        provider,
        modelId: model,
        agentId: agent.id,
        taskId: task.id,
        kind: "task_step",
      });
      promptTokens += usage.promptTokens;
      completionTokens += usage.completionTokens;
      totalTokens += usage.totalTokens;
      if (usage.reportedCostUsd !== null) {
        reportedCostSeen = true;
        reportedCostUsd += usage.reportedCostUsd;
      }

      const assistantMessage = completion.choices[0]?.message;
      if (!assistantMessage) break;

      const toolCalls = assistantMessage.tool_calls ?? [];
      if (toolCalls.length === 0) {
        if (!toolUsed && assistantMessage.content) {
          await persistOwnedStepWrite(async (tx) => {
            await tx.insert(activityEventsTable).values({
              agentId: agent.id,
              taskId: task.id,
              type: "note",
              summary: redactAuditText(assistantMessage.content!, 2_000),
              severity: "info",
            });
          });
        }
        if (round < maxToolRounds - 1 && passiveResponsesForRoute === 0) {
          passiveResponsesForRoute += 1;
          messages.push({
            role: "assistant",
            content: assistantMessage.content ?? null,
          });
          messages.push({
            role: "user",
            content: statusCopy.taskOpenInstruction,
          });
          continue;
        }
        const fallbackAfterPassive = activeRoutes[1];
        if (round < maxToolRounds - 1 && fallbackAfterPassive) {
          await activateRoute(fallbackAfterPassive, "passive_response");
          activeRoutes = activeRoutes.slice(1);
          passiveResponsesForRoute = 0;
          messages.push({
            role: "assistant",
            content: assistantMessage.content ?? null,
          });
          messages.push({
            role: "user",
            content: statusCopy.taskPassiveFallbackInstruction,
          });
          continue;
        }
        throw modelCompatibilityExhaustedError(
          routed.route,
          "passive_lifecycle_response",
        );
      }
      passiveResponsesForRoute = 0;
      if (toolCalls.length > maxToolCallsPerRound) {
        const fallbackAfterProtocolFailure = activeRoutes[1];
        if (round < maxToolRounds - 1 && fallbackAfterProtocolFailure) {
          await activateRoute(
            fallbackAfterProtocolFailure,
            "protocol_incompatibility",
          );
          activeRoutes = activeRoutes.slice(1);
          messages.push({
            role: "user",
            content: toolMessage(locale, "taskBatchFallbackInstruction", {
              count: toolCalls.length,
              limit: maxToolCallsPerRound,
            }),
          });
          continue;
        }
        throw modelCompatibilityExhaustedError(
          routed.route,
          "tool_batch_limit_exceeded",
        );
      }

      messages.push({
        role: "assistant",
        content: assistantMessage.content ?? null,
        tool_calls: toolCalls,
      });

      let taskTerminated = false;
      let lifecycleToolRejected = false;
      let succeededToolCall = false;
      let rejectedToolCall = false;
      let computerToolExecutedInBatch = false;
      for (const [toolIndex, toolCall] of toolCalls.entries()) {
        if (toolCall.type !== "function") {
          rejectedToolCall = true;
          continue;
        }
        const toolName = toolCall.function.name;
        if (exclusivePolicy) {
          const scopeDecision = evaluateExclusiveToolCall(
            exclusivePolicy,
            toolName,
            toolCall.function.arguments,
          );
          if (!scopeDecision.allowed) {
            const blockedMessage = exclusiveToolBlockedMessage(
              exclusivePolicy,
              toolName,
              scopeDecision.explanation,
              locale,
              scopeDecision.reason,
            );
            await persistOwnedStepWrite(async (tx) => {
              await tx.insert(activityEventsTable).values({
                agentId: agent.id,
                taskId: task.id,
                type: "note",
                summary: redactAuditText(blockedMessage, 1_000),
                detail: {
                  guard: "exclusive_turn_scope",
                  outcome: "blocked_before_execution",
                  blockedTool: toolName,
                  allowedFamilies: [...exclusivePolicy.families],
                },
                severity: "warning",
              });
            });
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: toolResultForModel(toolName, blockedMessage),
            });
            rejectedToolCall = true;
            continue;
          }
        }
        if (shouldDeferComputerTool(toolName, computerToolExecutedInBatch)) {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: deferredComputerToolMessage(toolName, locale),
          });
          continue;
        }
        if (isComputerTool(toolName)) {
          await leaseHeartbeat.assertOwned();
          computerToolExecutedInBatch = true;
          const decision = recordComputerDecision(
            agent.id,
            computerSurfaceForTool(toolName),
            toolName,
          );
          await persistOwnedStepWrite(async (tx) => {
            await tx.insert(activityEventsTable).values({
              agentId: agent.id,
              taskId: task.id,
              type: "note",
              summary: redactAuditText(
                terminalMessage(locale, "computerSelected", {
                  name: agent.name,
                  tool: toolName,
                }),
                500,
              ),
              detail: computerStepDetail(decision, { selectedTool: toolName }),
              severity: "info",
            });
          });
        }
        await leaseHeartbeat.assertOwned(toolDispatchText(locale, toolName));
        const result = await runTool(
          {
            agent,
            locale,
            taskId: task.id,
            taskLeaseOwner: task.leaseOwner,
            runtimeAttemptId: task.runtimeAttemptId,
            assertTaskLease: (action) => leaseHeartbeat.assertOwned(action),
            attachOperationInvocation: (input) =>
              leaseHeartbeat.attachOperationInvocation(input),
            detachOperationInvocation: (invocationId) =>
              leaseHeartbeat.detachOperationInvocation(invocationId),
            computerLoopId,
            exclusiveTurnPolicy: exclusivePolicy ?? undefined,
            operationIdentity: {
              executionKind: "task_step",
              logicalExecutionId: task.logicalExecutionId,
              runtimeInstanceId: task.runtimeInstanceId,
              originAttemptId: task.runtimeAttemptId,
              sourceMessageId: null,
              modelToolCallId: toolCall.id,
              callSlot: `round:${round}:tool:${toolIndex}`,
              agentLeaseOwner: task.leaseOwner,
            },
          },
          toolName,
          toolCall.function.arguments,
        );
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResultForModel(toolName, result.content),
        });
        if (
          result.toolOutcome === "unknown" ||
          result.toolOutcome === "outcome_unknown"
        ) {
          operationOutcomeUnknown = true;
          operationUnknownReceiptId = result.receiptId ?? null;
          attemptDisposition = "blocked";
          taskTerminated = true;
          break;
        }
        if (result.toolOutcome === "deferred") {
          operationDeferred = true;
          operationDeferredReceiptId = result.receiptId ?? null;
          taskTerminated = true;
          break;
        }
        await leaseHeartbeat.assertOwned();
        if (result.toolOutcome === "succeeded") {
          toolUsed = true;
          succeededToolCall = true;
        } else if (result.toolOutcome === "rejected") {
          rejectedToolCall = true;
        }
        if (result.durableTaskLifecycleIntent) {
          pendingLifecycleIntent = result.durableTaskLifecycleIntent;
          taskTerminated = true;
          attemptDisposition =
            result.durableTaskLifecycleIntent.kind === "complete"
              ? "succeeded"
              : "blocked";
          break;
        }
        const lifecycleDisposition = terminalTaskToolDisposition(
          toolName,
          result.taskLifecycleEffect,
        );
        if (lifecycleDisposition !== "not_terminal") {
          taskTerminated = lifecycleDisposition === "persisted";
          lifecycleToolRejected = lifecycleDisposition === "rejected";
          if (result.taskLifecycleEffect === "completed") {
            attemptDisposition = "succeeded";
          } else if (result.taskLifecycleEffect === "suspended") {
            attemptDisposition = "blocked";
          }
          // Approval and user-input tools deliberately suspend the task. Do
          // not execute later calls emitted in the same model batch: they were
          // proposed before the required human decision existed. A rejected
          // lifecycle call also ends this batch, but receives one bounded
          // correction round instead of being mistaken for durable success.
          break;
        }
      }

      if (taskTerminated) break;
      if (lifecycleToolRejected) {
        lifecycleRejectionsForRoute += 1;
        if (round < maxToolRounds - 1 && lifecycleRejectionsForRoute < 2) {
          continue;
        }
        const fallbackAfterLifecycleRejection = activeRoutes[1];
        if (round < maxToolRounds - 1 && fallbackAfterLifecycleRejection) {
          await activateRoute(
            fallbackAfterLifecycleRejection,
            "lifecycle_rejection",
          );
          activeRoutes = activeRoutes.slice(1);
          passiveResponsesForRoute = 0;
          lifecycleRejectionsForRoute = 0;
          messages.push({
            role: "user",
            content: statusCopy.taskLifecycleFallbackInstruction,
          });
          continue;
        }
        throw modelCompatibilityExhaustedError(
          routed.route,
          "lifecycle_tool_rejected",
        );
      }
      if (!succeededToolCall && rejectedToolCall) {
        toolRejectionsForRoute += 1;
        if (round < maxToolRounds - 1 && toolRejectionsForRoute < 2) {
          messages.push({
            role: "user",
            content: statusCopy.taskToolRetryInstruction,
          });
          continue;
        }
        const fallbackAfterToolRejection = activeRoutes[1];
        if (round < maxToolRounds - 1 && fallbackAfterToolRejection) {
          await activateRoute(fallbackAfterToolRejection, "tool_rejection");
          activeRoutes = activeRoutes.slice(1);
          passiveResponsesForRoute = 0;
          lifecycleRejectionsForRoute = 0;
          toolRejectionsForRoute = 0;
          messages.push({
            role: "user",
            content: statusCopy.taskToolFallbackInstruction,
          });
          continue;
        }
        throw modelCompatibilityExhaustedError(
          routed.route,
          "tool_calls_rejected",
        );
      }
      if (succeededToolCall) toolRejectionsForRoute = 0;
    }
  } catch (error) {
    if (
      error instanceof EmergencyStopError ||
      error instanceof TaskLeaseOwnershipLostError
    ) {
      ownershipLost = true;
      await leaseHeartbeat.assertOwned().catch(() => undefined);
      logger.warn(
        {
          taskId: task.id,
          agentId: agent.id,
          attemptId: task.runtimeAttemptId,
        },
        "Task step stopped after durable ownership loss",
      );
    } else if (error instanceof ModelRoutesExhaustedError) {
      stepFailureKind = "model_routes_exhausted";
      exhaustedModelFailures = error.failures;
      stepError = error.message;
    } else {
      stepFailureKind = "runtime";
      stepError =
        error instanceof Error
          ? redactAuditText(error.message, 2_000)
          : statusCopy.taskUnknownError;
    }
    if (!ownershipLost) {
      logger.error(
        { error, taskId: task.id, agentId: agent.id },
        "Task step failed",
      );
    }
  } finally {
    try {
      if (!ownershipLost) {
        const finishedAt = new Date();
        const failureCount = stepError ? task.consecutiveFailures + 1 : 0;
        const persistentProviderFailure =
          stepFailureKind === "model_routes_exhausted";
        const retryDecision = stepError
          ? taskRetryDecision({
              autonomyMode: task.autonomyMode,
              failureKind: stepFailureKind ?? "runtime",
              consecutiveFailures: failureCount,
              maxConsecutiveRuntimeFailures: MAX_CONSECUTIVE_FAILURES,
            })
          : null;
        const shouldBlock = retryDecision?.shouldBlock ?? false;
        const retryDelayMs = retryDecision?.retryDelayMs ?? 0;
        const nextRetryAt =
          stepError && !shouldBlock
            ? new Date(finishedAt.getTime() + retryDelayMs)
            : operationDeferred
              ? new Date(
                  finishedAt.getTime() +
                    dependencies.runtimeOperationsConfig.schedulerTickMs,
                )
              : null;
        const safeLastError = stepError
          ? redactAuditText(
              persistentProviderFailure && exhaustedModelFailures.length > 0
                ? exhaustedModelFailures
                    .map((failure) => toolModelFailureText(locale, failure))
                    .join("; ")
                : stepError,
              2_000,
            )
          : operationOutcomeUnknown
            ? `${terminalMessage(locale, "taskUnknownStopped")}${operationUnknownReceiptId ? ` ${toolMessage(locale, "receiptLabel", { id: operationUnknownReceiptId })}.` : ""}`
            : operationDeferred
              ? `${terminalMessage(locale, "taskDeferred")}${operationDeferredReceiptId ? ` ${toolMessage(locale, "receiptLabel", { id: operationDeferredReceiptId })}.` : ""}`
              : null;
        const attemptState = stepError
          ? shouldBlock
            ? ("blocked" as const)
            : ("retrying" as const)
          : operationDeferred
            ? ("retrying" as const)
            : (attemptDisposition ?? "succeeded");

        await leaseHeartbeat.assertOwned();
        await db.transaction(async (tx) => {
          await lockAndAssertExecutionAllowed(tx);
          const lifecycleFinalization =
            pendingLifecycleIntent?.operationFinalization;
          let lifecycleLocale = locale;
          if (lifecycleFinalization) {
            // The judge/provider work already finished outside this
            // transaction. Crossing the transactional effect boundary here
            // makes the lifecycle mutation and receipt success one commit.
            const running = await markOperationRunning(
              { ...lifecycleFinalization, now: finishedAt },
              tx,
            );
            lifecycleLocale = toolReceiptLocale(running.receipt) ?? locale;
          }
          await tx.execute(
            sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${agent.id} FOR UPDATE`,
          );
          await tx.execute(
            sql`SELECT id FROM ${tasksTable} WHERE ${tasksTable.id} = ${task.id} FOR UPDATE`,
          );
          await tx.execute(
            sql`SELECT id FROM ${taskAttemptsTable} WHERE ${taskAttemptsTable.id} = ${task.runtimeAttemptId} FOR UPDATE`,
          );
          const [liveAgent] = await tx
            .select()
            .from(agentsTable)
            .where(eq(agentsTable.id, agent.id));
          if (
            !liveAgent?.isActive ||
            liveAgent.runLeaseOwner !== task.leaseOwner ||
            liveAgent.currentTaskId !== task.id
          ) {
            throw new TaskLeaseOwnershipLostError();
          }
          const [liveTask] = await tx
            .select()
            .from(tasksTable)
            .where(eq(tasksTable.id, task.id));
          if (
            !liveTask ||
            liveTask.ownerAgentId !== agent.id ||
            liveTask.leaseOwner !== task.leaseOwner
          ) {
            throw new TaskLeaseOwnershipLostError();
          }
          const [liveAttempt] = await tx
            .select()
            .from(taskAttemptsTable)
            .where(eq(taskAttemptsTable.id, task.runtimeAttemptId));
          if (
            !liveAttempt ||
            liveAttempt.taskId !== task.id ||
            liveAttempt.agentId !== agent.id ||
            liveAttempt.leaseOwner !== task.leaseOwner ||
            liveAttempt.state !== "running"
          ) {
            throw new TaskLeaseOwnershipLostError();
          }
          if (pendingLifecycleIntent) {
            const lifecycleResultData = await applyDurableTaskLifecycleIntent(
              tx,
              task,
              liveAgent,
              pendingLifecycleIntent,
              lifecycleLocale,
            );
            await dependencies.beforeLifecycleFinalizeRelease?.(
              tx,
              pendingLifecycleIntent,
            );
            if (lifecycleFinalization) {
              await completeOperation(
                {
                  ...lifecycleFinalization,
                  resultData: lifecycleResultData,
                  now: finishedAt,
                },
                tx,
              );
            }
          }
          const [releasedAgent] = await tx
            .update(agentsTable)
            .set({
              status: "idle",
              currentTaskId: null,
              currentAction: null,
              lastActiveAt: finishedAt,
              runLeaseOwner: null,
              runLeaseExpiresAt: null,
            })
            .where(
              and(
                eq(agentsTable.id, agent.id),
                eq(agentsTable.runLeaseOwner, task.leaseOwner),
              ),
            )
            .returning({ id: agentsTable.id });
          if (!releasedAgent) throw new TaskLeaseOwnershipLostError();

          const [releasedTask] = await tx
            .update(tasksTable)
            .set({
              lastSteppedAt: finishedAt,
              lastHeartbeatAt: finishedAt,
              tokensUsed: task.tokensUsed + totalTokens,
              consecutiveFailures: failureCount,
              ...(stepError
                ? { nextAttemptAt: nextRetryAt }
                : operationDeferred
                  ? { nextAttemptAt: nextRetryAt }
                  : operationOutcomeUnknown
                    ? { nextAttemptAt: null }
                    : {}),
              ...(stepError
                ? { lastError: safeLastError }
                : operationDeferred
                  ? { lastError: safeLastError }
                  : operationOutcomeUnknown
                    ? { lastError: safeLastError }
                    : attemptDisposition === "blocked"
                      ? {}
                      : { lastError: null }),
              leaseOwner: null,
              leaseExpiresAt: null,
              ...(shouldBlock
                ? {
                    status: "blocked",
                    blockedReason: "runtime_failure" as const,
                  }
                : operationOutcomeUnknown
                  ? {
                      status: "blocked",
                      blockedReason: "operation_outcome_unknown" as const,
                    }
                  : {}),
              ...(reportedCostSeen
                ? {
                    estimatedCostUsd: (
                      Number(task.estimatedCostUsd ?? "0") + reportedCostUsd
                    ).toFixed(6),
                  }
                : {}),
            })
            .where(
              and(
                eq(tasksTable.id, task.id),
                eq(tasksTable.ownerAgentId, agent.id),
                eq(tasksTable.leaseOwner, task.leaseOwner),
              ),
            )
            .returning({ id: tasksTable.id });
          if (!releasedTask) throw new TaskLeaseOwnershipLostError();

          const transitioned = await transitionTaskAttempt(
            {
              attemptId: task.runtimeAttemptId,
              taskId: task.id,
              agentId: agent.id,
              leaseOwner: task.leaseOwner,
              from: ["running"],
              state: attemptState,
              now: finishedAt,
              modelId: attemptModelId,
              provider: attemptProvider,
              failureKind: operationOutcomeUnknown
                ? "operation_outcome_unknown"
                : operationDeferred
                  ? "operation_deferred"
                  : stepError
                    ? stepFailureKind
                    : null,
              sanitizedError: safeLastError,
              promptTokens,
              completionTokens,
              totalTokens,
              reportedCostUsd: reportedCostSeen ? reportedCostUsd : null,
            },
            tx,
          );
          if (!transitioned) throw new TaskLeaseOwnershipLostError();

          if (stepError) {
            await tx.insert(activityEventsTable).values({
              agentId: agent.id,
              taskId: task.id,
              type: "error",
              summary: shouldBlock
                ? toolMessage(locale, "taskBlocked", { count: failureCount })
                : persistentProviderFailure
                  ? toolMessage(locale, "taskProviderRetry", {
                      at: nextRetryAt!.toISOString(),
                    })
                  : toolMessage(locale, "taskRuntimeRetry", {
                      at: nextRetryAt!.toISOString(),
                    }),
              detail: {
                runtimeEvent: shouldBlock
                  ? "task_blocked_after_runtime_failures"
                  : "task_retry_scheduled",
                attemptId: task.runtimeAttemptId,
                failureKind: stepFailureKind,
                consecutiveFailures: failureCount,
                nextAttemptAt: nextRetryAt?.toISOString() ?? null,
                remainsActive: !shouldBlock,
                lastError: safeLastError,
                modelAttempts: exhaustedModelFailures.map((failure) => ({
                  modelId: failure.route.modelId,
                  provider: failure.route.provider,
                  kind: failure.kind,
                  attempt: failure.attempt,
                })),
              },
              severity: shouldBlock ? "critical" : "warning",
            });
          } else if (operationOutcomeUnknown) {
            await tx.insert(activityEventsTable).values({
              agentId: agent.id,
              taskId: task.id,
              type: "error",
              summary: terminalMessage(locale, "taskUnknownStopped"),
              detail: {
                runtimeEvent: "operation_outcome_unknown",
                receiptId: operationUnknownReceiptId,
                replayBlocked: true,
              },
              severity: "critical",
            });
          } else if (operationDeferred) {
            await tx.insert(activityEventsTable).values({
              agentId: agent.id,
              taskId: task.id,
              type: "note",
              summary: terminalMessage(locale, "taskDeferred"),
              detail: {
                runtimeEvent: "operation_deferred",
                receiptId: operationDeferredReceiptId,
                nextAttemptAt: nextRetryAt?.toISOString() ?? null,
              },
              severity: "info",
            });
          }
        });
      }
    } catch (error) {
      if (
        error instanceof EmergencyStopError ||
        error instanceof TaskLeaseOwnershipLostError
      ) {
        ownershipLost = true;
        await leaseHeartbeat.assertOwned().catch(() => undefined);
      } else {
        logger.error(
          { error, taskId: task.id, agentId: agent.id },
          "Failed to persist fenced task-step terminal state",
        );
      }
    } finally {
      await leaseHeartbeat.stop();
    }
  }
}
