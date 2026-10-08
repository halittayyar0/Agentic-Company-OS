import { Router, type IRouter } from "express";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import {
  db,
  agentsTable,
  approvalRequestsTable,
  tasksTable,
  activityEventsTable,
  approvalStatusValues,
  type ApprovalScope,
} from "@workspace/db";
import {
  ListApprovalsResponse,
  ResolveApprovalBody,
  ResolveApprovalResponse,
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
    res.json(ListApprovalsResponse.parse(approvals));
  });

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
      if (approval.status !== "pending") {
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
            .select({ isActive: agentsTable.isActive })
            .from(agentsTable)
            .where(eq(agentsTable.id, approval.agentId));
          const [liveTask] = await tx
            .select({ status: tasksTable.status })
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

      res.json(ResolveApprovalResponse.parse(updated));
    },
  );

  return router;
}
export default createApprovalsRouter();
