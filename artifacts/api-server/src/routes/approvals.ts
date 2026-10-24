import { Router, type IRouter } from "express";
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import {
  db,
  agentsTable,
  approvalRequestsTable,
  tasksTable,
  taskAttemptsTable,
  activityEventsTable,
  approvalStatusValues,
  type ApprovalScope,
} from "@workspace/db";
import {
  ListApprovalsResponse,
  ResolveApprovalBody,
  ResolveApprovalResponse,
  GetTaskResultReviewResponse,
} from "@workspace/api-zod";
import { reserveOperation } from "../lib/orchestrator/operation-receipts";
import { scrubExpiredApprovals } from "../lib/orchestrator/sudo-approval-retention";
import { redactApprovalCapabilityScope } from "../lib/orchestrator/approval-capability-redaction";
import {
  validateCodexApprovalDecision,
  CodexApprovalConflict,
} from "../lib/codex-task-approvals";
import {
  parseCursorPage,
  parseOptionalEnum,
  parsePositiveInteger,
  setNextCursor,
} from "../lib/http-params";
import {
  createOperatorAuth,
  readOperatorAuthOptions,
  readOperatorAuditId,
} from "../lib/operator-auth";
import {
  assertCompletionProposalEvidence,
  isTaskResultReview,
  resultReviewMetadata,
  ResultReviewConflict,
} from "../lib/task-result-review";
import {
  readCompletionProposal,
  completionProposalDigest,
} from "../lib/task-result-review-proposal";
import { parseTaskResultFormat } from "@workspace/db/task-result-format";
import { taskResultReviewCopy } from "../lib/task-result-review-copy";

import {
  EmergencyStopError,
  lockRuntimeControlState,
} from "../lib/orchestrator/runtime-emergency-stop";

const decisionLabels = {
  tr: { approved: "Onay kaydedildi", rejected: "Ret kaydedildi" },
  en: { approved: "Approval recorded", rejected: "Rejection recorded" },
  de: { approved: "Genehmigung erfasst", rejected: "Ablehnung erfasst" },
  ru: { approved: "Одобрение сохранено", rejected: "Отклонение сохранено" },
  "zh-CN": { approved: "已记录批准", rejected: "已记录拒绝" },
  "zh-TW": { approved: "已記錄核准", rejected: "已記錄拒絕" },
  ar: { approved: "تم تسجيل الموافقة", rejected: "تم تسجيل الرفض" },
} as const;

export interface ApprovalDecisionDependencies {
  now?: () => Date;
  afterDecisionLocks?: () => Promise<void>;
  resultReviewAuth?: Pick<
    ReturnType<typeof createOperatorAuth>,
    "enabled" | "authenticate"
  >;
}
class ApprovalDecisionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function createApprovalsRouter(
  dependencies: ApprovalDecisionDependencies = {},
): IRouter {
  const router: IRouter = Router();
  // Protect credential checks and approval queries even when this router is
  // mounted independently. Never let an untrusted forwarding header choose
  // the bucket. Production retains the earlier, broader API/login limits.
  router.use(
    "/approvals",
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      keyGenerator: (req) =>
        ipKeyGenerator(req.socket.remoteAddress ?? "unknown"),
      standardHeaders: "draft-6",
      legacyHeaders: false,
      message: { error: "Too many requests" },
    }),
  );
  const resultReviewAuth =
    dependencies.resultReviewAuth ??
    createOperatorAuth(readOperatorAuthOptions());
  const requireResultReviewAuth = (
    req: Parameters<typeof resultReviewAuth.authenticate>[0],
    res: import("express").Response,
  ): boolean => {
    res.setHeader("Cache-Control", "no-store");
    if (!resultReviewAuth.enabled) {
      res.status(503).json({
        code: "TASK_RESULT_REVIEW_AUTH_REQUIRED",
        error:
          "Configure operator credential authentication before reviewing task results",
      });
      return false;
    }
    if (!resultReviewAuth.authenticate(req).authenticated) {
      res.status(401).json({
        code: "TASK_RESULT_REVIEW_UNAUTHENTICATED",
        error: "Operator authentication required",
      });
      return false;
    }
    return true;
  };
  class ApprovalResolutionConflict extends Error {}

  function approvalEventScope(
    scope: ApprovalScope | null,
  ): Record<string, unknown> | null {
    if (!scope) return null;
    const browserScoped =
      scope.toolName === "browser_click" || scope.toolName === "browser_type";
    return {
      toolName: scope.toolName,
      argsHash: scope.argsHash,
      target: browserScoped ? null : (scope.target ?? null),
    };
  }

  router.get("/approvals", async (req, res): Promise<void> => {
    await scrubExpiredApprovals();
    const status = parseOptionalEnum(
      req.query.status,
      "status",
      approvalStatusValues,
    );
    const page = parseCursorPage(req.query);
    if (!status.ok) {
      res.status(400).json({ error: status.error });
      return;
    }
    if (!page.ok) {
      res.status(400).json({ error: page.error });
      return;
    }
    const conditions = [];
    if (status.value !== undefined) {
      conditions.push(eq(approvalRequestsTable.status, status.value));
    }
    if (page.value.beforeId !== undefined) {
      conditions.push(lt(approvalRequestsTable.id, page.value.beforeId));
    }

    const rows = await db
      .select()
      .from(approvalRequestsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(approvalRequestsTable.id))
      .limit(page.value.limit + 1);

    const hasMore = rows.length > page.value.limit;
    const approvals = rows.slice(0, page.value.limit);
    setNextCursor(res, approvals, hasMore);
    res.json(
      ListApprovalsResponse.parse(
        approvals.map((approval) => ({
          ...approval,
          ...resultReviewMetadata(approval),
        })),
      ),
    );
  });

  router.get(
    "/approvals/:approvalId/result-review",
    async (req, res): Promise<void> => {
      if (!requireResultReviewAuth(req, res)) return;
      const id = parsePositiveInteger(req.params.approvalId, "approvalId");
      if (!id.ok) {
        res.status(400).json({ code: "APPROVAL_INPUT_INVALID" });
        return;
      }
      await scrubExpiredApprovals();
      try {
        const result = await db.transaction(
          async (tx) => {
            const [approval] = await tx
              .select()
              .from(approvalRequestsTable)
              .where(eq(approvalRequestsTable.id, id.value));
            if (!approval || !isTaskResultReview(approval)) return null;
            const proposal = readCompletionProposal(
              approval.completionProposal,
            );
            const now = dependencies.now?.() ?? new Date();
            if (
              !proposal ||
              approval.status !== "pending" ||
              approval.consumedAt ||
              !approval.expiresAt ||
              approval.expiresAt <= now ||
              approval.actionPayload ||
              approval.automaticPolicyRevision !== null ||
              completionProposalDigest(proposal) !== approval.scope?.argsHash
            )
              throw new ResultReviewConflict();
            const [task] = await tx
              .select()
              .from(tasksTable)
              .where(eq(tasksTable.id, approval.taskId));
            const [owner] = await tx
              .select()
              .from(agentsTable)
              .where(eq(agentsTable.id, approval.agentId));
            if (!task || !owner || task.status !== "awaiting_approval")
              throw new ResultReviewConflict();
            const requirements = await assertCompletionProposalEvidence(
              tx,
              proposal,
              task,
              owner,
            );
            return {
              approvalId: approval.id,
              taskId: task.id,
              cycleNumber: proposal.cycleNumber,
              proposalHash: completionProposalDigest(proposal),
              resultSummary: proposal.resultSummary,
              resultFormat: parseTaskResultFormat(task.resultFormat),
              judgeReasonCode: proposal.judgeReasonCode,
              expiresAt: approval.expiresAt,
              requirements,
            };
          },
          { isolationLevel: "repeatable read", accessMode: "read only" },
        );
        if (!result) {
          res.status(404).json({ code: "TASK_RESULT_REVIEW_NOT_FOUND" });
          return;
        }
        res.json(GetTaskResultReviewResponse.parse(result));
      } catch (error) {
        if (!(error instanceof ResultReviewConflict)) throw error;
        res.status(409).json({ code: error.code, error: error.message });
      }
    },
  );

  router.post(
    "/approvals/:approvalId/decision",
    async (req, res): Promise<void> => {
      const parsedApprovalId = parsePositiveInteger(
        req.params.approvalId,
        "approvalId",
      );
      if (!parsedApprovalId.ok) {
        res.status(400).json({ error: parsedApprovalId.error });
        return;
      }
      const approvalId = parsedApprovalId.value;
      const parsed = ResolveApprovalBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.message,
          code: "APPROVAL_INPUT_INVALID",
        });
        return;
      }

      await scrubExpiredApprovals();

      const [approval] = await db
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, approvalId));
      if (!approval) {
        res.status(404).json({
          error: "Approval request not found",
          code: "APPROVAL_NOT_FOUND",
        });
        return;
      }
      if (isTaskResultReview(approval) && !requireResultReviewAuth(req, res))
        return;
      if (approval.status !== "pending") {
        if (
          isTaskResultReview(approval) &&
          approval.status === parsed.data.decision &&
          (approval.status === "rejected" ||
            (parsed.data.confirmTaskResult === true &&
              parsed.data.expectedArgsHash === approval.scope?.argsHash &&
              approval.consumedAt))
        ) {
          res.json(
            ResolveApprovalResponse.parse({
              ...approval,
              ...resultReviewMetadata(approval),
            }),
          );
          return;
        }
        if (
          parsed.data.decision === "approved" &&
          /approval expired$/iu.test(approval.decisionNote ?? "")
        ) {
          res.status(410).json({
            error: "Approval request has expired",
            code: "APPROVAL_EXPIRED",
          });
          return;
        }
        res.status(409).json({
          error: "Approval request already resolved",
          code: "APPROVAL_ALREADY_RESOLVED",
        });
        return;
      }

      if (
        parsed.data.decision === "approved" &&
        approval.expiresAt &&
        approval.expiresAt.getTime() <= Date.now()
      ) {
        await scrubExpiredApprovals();
        res.status(410).json({
          error: "Approval request has expired",
          code: "APPROVAL_EXPIRED",
        });
        return;
      }

      const status = parsed.data.decision;
      const note = parsed.data.note ?? null;

      let updated = approval;
      try {
        updated = await db.transaction(async (tx) => {
          const control = await lockRuntimeControlState(tx);
          if (status === "approved" && control.emergencyStopEnabled)
            throw new EmergencyStopError(control);
          // Runtime control precedes the agent -> approval -> task lock order
          // shared with cancellation, deactivation and action consumption.
          await tx.execute(
            sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${approval.agentId} FOR UPDATE`,
          );
          await tx.execute(
            sql`SELECT id FROM ${approvalRequestsTable} WHERE ${approvalRequestsTable.id} = ${approvalId} FOR UPDATE`,
          );
          await tx.execute(
            sql`SELECT id FROM ${tasksTable} WHERE ${tasksTable.id} = ${approval.taskId} FOR UPDATE`,
          );
          await dependencies.afterDecisionLocks?.();
          const [liveApproval] = await tx
            .select()
            .from(approvalRequestsTable)
            .where(eq(approvalRequestsTable.id, approvalId));
          const [liveAgent] = await tx
            .select()
            .from(agentsTable)
            .where(eq(agentsTable.id, approval.agentId));
          const [liveTask] = await tx
            .select()
            .from(tasksTable)
            .where(eq(tasksTable.id, approval.taskId));
          const decisionNow = dependencies.now?.() ?? new Date();
          if (
            status === "approved" &&
            liveApproval?.expiresAt &&
            liveApproval.expiresAt.getTime() <= decisionNow.getTime()
          )
            throw new ApprovalDecisionError(
              410,
              "APPROVAL_EXPIRED",
              "Approval request has expired",
            );
          if (
            !liveApproval ||
            liveApproval.status !== "pending" ||
            liveApproval.consumedAt !== null ||
            liveApproval.bindingInvalidatedAt !== null ||
            !liveAgent?.isActive ||
            liveTask?.status !== "awaiting_approval"
          ) {
            throw new ApprovalResolutionConflict();
          }
          if (isTaskResultReview(liveApproval)) {
            if (
              !resultReviewAuth.enabled ||
              !resultReviewAuth.authenticate(req).authenticated
            )
              throw new ApprovalDecisionError(
                401,
                "TASK_RESULT_REVIEW_UNAUTHENTICATED",
                "Operator authentication required",
              );
            if (status === "approved") {
              if (
                parsed.data.confirmTaskResult !== true ||
                !parsed.data.expectedArgsHash
              )
                throw new ApprovalDecisionError(
                  400,
                  "TASK_RESULT_REVIEW_CONFIRMATION_REQUIRED",
                  "Explicit result confirmation and the reviewed digest are required",
                );
              const proposal = readCompletionProposal(
                liveApproval.completionProposal,
              );
              if (
                !proposal ||
                completionProposalDigest(proposal) !==
                  parsed.data.expectedArgsHash ||
                completionProposalDigest(proposal) !==
                  liveApproval.scope?.argsHash ||
                liveApproval.actionPayload !== null ||
                liveApproval.automaticPolicyRevision !== null
              )
                throw new ResultReviewConflict();
              if (
                liveTask.leaseOwner !== null ||
                liveAgent.runLeaseOwner !== null ||
                liveAgent.currentTaskId !== null
              )
                throw new ResultReviewConflict();
              const [activeAttempt] = await tx
                .select({ id: taskAttemptsTable.id })
                .from(taskAttemptsTable)
                .where(
                  and(
                    eq(taskAttemptsTable.agentId, liveAgent.id),
                    inArray(taskAttemptsTable.state, ["claimed", "running"]),
                  ),
                )
                .limit(1);
              if (activeAttempt) throw new ResultReviewConflict();
              await assertCompletionProposalEvidence(
                tx,
                proposal,
                liveTask,
                liveAgent,
              );
              const continuous = liveTask.autonomyMode === "continuous";
              await tx
                .update(tasksTable)
                .set({
                  status: continuous ? "in_progress" : "completed",
                  resultSummary: proposal.resultSummary,
                  completionAuthority: "operator",
                  progressPercent: continuous ? 0 : 100,
                  completedAt: continuous ? null : decisionNow,
                  nextAttemptAt: continuous
                    ? new Date(
                        decisionNow.getTime() +
                          (liveTask.cadenceSeconds ?? 3600) * 1000,
                      )
                    : null,
                  consecutiveFailures: 0,
                  lastError: null,
                  blockedReason: null,
                  ...(continuous
                    ? {
                        cycleCount: liveTask.cycleCount + 1,
                        lastCycleCompletedAt: decisionNow,
                      }
                    : {}),
                })
                .where(eq(tasksTable.id, liveTask.id));
            } else {
              await tx
                .update(tasksTable)
                .set({
                  status: "blocked",
                  blockedReason: "approval_rejected",
                  nextAttemptAt: null,
                })
                .where(eq(tasksTable.id, liveTask.id));
            }
            const [resolved] = await tx
              .update(approvalRequestsTable)
              .set({
                status,
                decisionNote: note,
                resolvedAt: decisionNow,
                consumedAt: status === "approved" ? decisionNow : null,
                completionProposal: null,
              })
              .where(eq(approvalRequestsTable.id, liveApproval.id))
              .returning();
            if (!resolved) throw new ApprovalResolutionConflict();
            const reviewCopy = taskResultReviewCopy(parsed.data.locale ?? "tr");
            await tx.insert(activityEventsTable).values({
              agentId: liveAgent.id,
              taskId: liveTask.id,
              type: "approval_resolved",
              summary:
                status === "approved"
                  ? reviewCopy.confirmed
                  : reviewCopy.rejected,
              detail: {
                runtimeEvent: "task_result_review_resolved",
                approvalId: resolved.id,
                decision: status,
                completionAuthority: status === "approved" ? "operator" : null,
                actorKind: "operator",
                actorId: readOperatorAuditId(),
                proposalHash: resolved.scope?.argsHash,
                actionQueued: false,
                judgeVerdict: "block",
                cycleNumber: liveTask.cycleCount,
              },
              severity: status === "approved" ? "info" : "warning",
            });
            if (status === "approved") {
              await tx.insert(activityEventsTable).values({
                agentId: liveAgent.id,
                taskId: liveTask.id,
                type: "task_status_changed",
                summary: reviewCopy.confirmed,
                severity: "info",
                detail: {
                  runtimeEvent: "task_result_operator_confirmed",
                  approvalId: resolved.id,
                  status:
                    liveTask.autonomyMode === "continuous"
                      ? "in_progress"
                      : "completed",
                  completionAuthority: "operator",
                  judgeVerdict: "block",
                  judgeReviewId: liveApproval.completionProposal?.judgeReviewId,
                  cycleNumber: liveTask.cycleCount,
                  actorKind: "operator",
                  actorId: readOperatorAuditId(),
                },
              });
              if (
                liveTask.parentTaskId &&
                liveTask.autonomyMode !== "continuous"
              ) {
                await tx.insert(activityEventsTable).values({
                  taskId: liveTask.parentTaskId,
                  agentId: liveTask.assignedByAgentId,
                  type: "progress_update",
                  summary: reviewCopy.confirmed,
                  severity: "info",
                  detail: {
                    completedSubtaskId: liveTask.id,
                    completionAuthority: "operator",
                  },
                });
              }
            }
            return resolved;
          }
          if (status === "approved") {
            if (
              parsed.data.expectedArgsHash !== undefined &&
              (parsed.data.expectedArgsHash?.toLowerCase() ?? null) !==
                (liveApproval.scope?.argsHash.toLowerCase() ?? null)
            )
              throw new ApprovalDecisionError(
                409,
                "APPROVAL_SCOPE_CHANGED",
                "The reviewed scope changed",
              );
            if (
              liveApproval.scope?.toolName === "vm_run_sudo_command" &&
              parsed.data.confirmation?.toLowerCase() !==
                liveApproval.scope.argsHash.slice(0, 8).toLowerCase()
            )
              throw new ApprovalDecisionError(
                400,
                "APPROVAL_CONFIRMATION_INVALID",
                "The command digest confirmation does not match",
              );
          }
          await validateCodexApprovalDecision(
            tx,
            liveApproval,
            decisionNow,
            parsed.data.expectedArgsHash,
            status === "approved",
          );
          const [resolved] = await tx
            .update(approvalRequestsTable)
            .set({
              status,
              decisionNote: note,
              resolvedAt: decisionNow,
              ...(status === "rejected"
                ? {
                    actionPayload: null,
                    scope: redactApprovalCapabilityScope(
                      liveApproval.scope,
                      "REJECTED",
                    ),
                  }
                : {}),
            })
            .where(
              and(
                eq(approvalRequestsTable.id, approvalId),
                eq(approvalRequestsTable.status, "pending"),
                ...(status === "approved"
                  ? [
                      or(
                        isNull(approvalRequestsTable.expiresAt),
                        gt(approvalRequestsTable.expiresAt, decisionNow),
                      )!,
                    ]
                  : []),
              ),
            )
            .returning();
          if (!resolved) throw new ApprovalResolutionConflict();

          const nextTaskStatus =
            status === "rejected"
              ? "blocked"
              : resolved.actionPayload
                ? "awaiting_approval"
                : "in_progress";
          const [task] = await tx
            .update(tasksTable)
            .set({
              status: nextTaskStatus,
              blockedReason: status === "rejected" ? "approval_rejected" : null,
            })
            .where(
              and(
                eq(tasksTable.id, resolved.taskId),
                eq(tasksTable.status, "awaiting_approval"),
              ),
            )
            .returning({ id: tasksTable.id });
          if (!task) throw new ApprovalResolutionConflict();

          if (status === "approved" && resolved.actionPayload) {
            await reserveOperation(
              {
                canonicalVersion: 1,
                executionKind: "approved_action",
                logicalExecutionId: `approval:${resolved.id}`,
                toolName: resolved.actionPayload.toolName,
                args: resolved.actionPayload.args,
                physical: {
                  attemptId: null,
                  workerInstanceId: resolved.browserRuntimeInstanceId,
                  modelToolCallId: null,
                  callSlot: "approved-action:0",
                },
                taskId: resolved.taskId,
                agentId: resolved.agentId,
                approvalId: resolved.id,
                sourceMessageId: null,
                originAttemptId: null,
                sideEffectClass: "approval_at_most_once",
                externalIdempotencyKey: `approval:${resolved.id}`,
                now: decisionNow,
              },
              tx,
            );
          }

          await tx.insert(activityEventsTable).values({
            agentId: resolved.agentId,
            taskId: resolved.taskId,
            type: "approval_resolved",
            summary: `${decisionLabels[parsed.data.locale ?? "tr"][status]}: ${resolved.title}`,
            detail: {
              locale: parsed.data.locale ?? "tr",
              decisionNote: note,
              scope: approvalEventScope(resolved.scope),
              expiresAt: resolved.expiresAt?.toISOString() ?? null,
              actionQueued:
                status === "approved" && Boolean(resolved.actionPayload),
            },
            severity: status === "approved" ? "info" : "warning",
          });
          return resolved;
        });
      } catch (error) {
        if (error instanceof ResultReviewConflict) {
          res.status(409).json({ code: error.code, error: error.message });
          return;
        }
        if (error instanceof CodexApprovalConflict) {
          res.status(409).json({
            error: "Native approval scope or ownership changed",
            code: "APPROVAL_BINDING_CHANGED",
          });
          return;
        }
        if (error instanceof EmergencyStopError) {
          res
            .status(423)
            .json({ error: "Emergency stop is active", code: error.code });
          return;
        }
        if (error instanceof ApprovalDecisionError) {
          res
            .status(error.status)
            .json({ error: error.message, code: error.code });
          return;
        }
        if (error instanceof ApprovalResolutionConflict) {
          const [latest] = await db
            .select()
            .from(approvalRequestsTable)
            .where(eq(approvalRequestsTable.id, approvalId));
          if (
            status === "approved" &&
            latest?.status === "pending" &&
            latest.expiresAt &&
            latest.expiresAt.getTime() <=
              (dependencies.now?.() ?? new Date()).getTime()
          ) {
            res.status(410).json({
              error: "Approval request has expired",
              code: "APPROVAL_EXPIRED",
            });
          } else {
            res.status(409).json({
              error: "Task or approval changed concurrently",
              code: "APPROVAL_STATE_CHANGED",
            });
          }
          return;
        }
        throw error;
      }

      res.json(
        ResolveApprovalResponse.parse({
          ...updated,
          ...resultReviewMetadata(updated),
        }),
      );
    },
  );

  return router;
}
export default createApprovalsRouter();
