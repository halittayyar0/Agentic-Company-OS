import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  db,
  agentsTable,
  tasksTable,
  approvalRequestsTable,
  runtimeControlsTable,
  activityEventsTable,
} from "@workspace/db";
import { readExecutionPolicy } from "../execution-policy";
import { canonicalArgumentHash, reserveOperation } from "./operation-receipts";

const executable = new Set([
  "vm_run_command",
  "vm_run_sudo_command",
  "browser_click",
  "browser_type",
]);
// A bounded round-robin scan prevents old, ineligible business approvals from
// permanently hiding executable requests beyond the first page. This cursor
// conveys no authority; every candidate is revalidated under database locks.
let candidateCursor = 0;

/** Full-access policy authorizes exact single-use receipts, never raw commands. */
export async function approvePolicyActions(): Promise<number> {
  if ((await readExecutionPolicy()).mode !== "full_access") return 0;
  const candidates = await db
    .select({
      id: approvalRequestsTable.id,
      agentId: approvalRequestsTable.agentId,
      taskId: approvalRequestsTable.taskId,
    })
    .from(approvalRequestsTable)
    .where(
      and(
        eq(approvalRequestsTable.status, "pending"),
        gt(approvalRequestsTable.id, candidateCursor),
      ),
    )
    .orderBy(approvalRequestsTable.id)
    .limit(50);
  candidateCursor = candidates.at(-1)?.id ?? 0;
  let count = 0;
  for (const candidate of candidates) {
    count += await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM ${runtimeControlsTable} WHERE ${runtimeControlsTable.id} = 1 FOR UPDATE`,
      );
      const [control] = await tx
        .select()
        .from(runtimeControlsTable)
        .where(eq(runtimeControlsTable.id, 1));
      const policy = await readExecutionPolicy(tx);
      if (
        !control ||
        control.emergencyStopEnabled ||
        policy.mode !== "full_access"
      )
        return 0;
      await tx.execute(
        sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${candidate.agentId} FOR UPDATE`,
      );
      await tx.execute(
        sql`SELECT id FROM ${approvalRequestsTable} WHERE ${approvalRequestsTable.id} = ${candidate.id} FOR UPDATE`,
      );
      await tx.execute(
        sql`SELECT id FROM ${tasksTable} WHERE ${tasksTable.id} = ${candidate.taskId} FOR UPDATE`,
      );
      const [agent] = await tx
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, candidate.agentId));
      const [approval] = await tx
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, candidate.id));
      const [task] = await tx
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, candidate.taskId));
      const now = new Date();
      const payload = approval?.actionPayload;
      if (
        !agent?.isActive ||
        task?.status !== "awaiting_approval" ||
        !approval ||
        approval.status !== "pending" ||
        approval.consumedAt ||
        approval.bindingInvalidatedAt ||
        !approval.expiresAt ||
        approval.expiresAt <= now ||
        !payload ||
        !approval.scope ||
        !executable.has(payload.toolName) ||
        payload.toolName !== approval.scope.toolName ||
        canonicalArgumentHash(payload.args) !== approval.scope.argsHash
      )
        return 0;
      const [resolved] = await tx
        .update(approvalRequestsTable)
        .set({
          status: "approved",
          resolvedAt: now,
          automaticPolicyRevision: policy.revision,
          decisionNote: "Authorized by operator full-access policy",
        })
        .where(
          and(
            eq(approvalRequestsTable.id, candidate.id),
            eq(approvalRequestsTable.status, "pending"),
            isNull(approvalRequestsTable.consumedAt),
            gt(approvalRequestsTable.expiresAt, now),
          ),
        )
        .returning();
      if (!resolved) return 0;
      await reserveOperation(
        {
          canonicalVersion: 1,
          executionKind: "approved_action",
          logicalExecutionId: `approval:${resolved.id}`,
          toolName: payload.toolName,
          args: payload.args,
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
          now,
        },
        tx,
      );
      await tx.insert(activityEventsTable).values({
        agentId: resolved.agentId,
        taskId: resolved.taskId,
        type: "approval_resolved",
        summary: "Action authorized by full-access policy",
        severity: "info",
        detail: {
          policyRevision: policy.revision,
          approvalId: resolved.id,
          toolName: payload.toolName,
          argsHash: approval.scope.argsHash,
          actionQueued: true,
        },
      });
      return 1;
    });
  }
  return count;
}
