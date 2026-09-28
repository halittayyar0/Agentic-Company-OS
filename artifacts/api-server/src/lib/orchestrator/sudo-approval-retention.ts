import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  agentsTable,
  approvalRequestsTable,
  db,
  tasksTable,
} from "@workspace/db";
import { lockRuntimeControlState } from "./runtime-emergency-stop";
import { redactApprovalCapabilityScope } from "./approval-capability-redaction";

export interface ScrubExpiredApprovalsDependencies {
  afterRuntimeControlLock?: () => Promise<void>;
}

class ExpiredApprovalOwnerChanged extends Error {}

/**
 * Idempotently resolves every expired scoped capability. Sudo command-bearing
 * fields receive the stronger redaction, while all expired action payloads are
 * removed so neither capacity accounting nor the UI retain a claimable ghost.
 * Each approval and its task transition commit in one transaction; a racing
 * executor wins only by consuming the approval first.
 */
export async function scrubExpiredApprovals(
  now = new Date(),
  dependencies: ScrubExpiredApprovalsDependencies = {},
): Promise<number> {
  const candidates = await db
    .select()
    .from(approvalRequestsTable)
    .where(
      and(
        inArray(approvalRequestsTable.status, ["pending", "approved"]),
        isNull(approvalRequestsTable.consumedAt),
        lte(approvalRequestsTable.expiresAt, now),
      ),
    );
  let scrubbedCount = 0;

  for (const candidate of candidates) {
    for (let ownerAttempt = 0; ownerAttempt < 3; ownerAttempt += 1) {
      const [anticipatedTask] = await db
        .select({ ownerAgentId: tasksTable.ownerAgentId })
        .from(tasksTable)
        .where(eq(tasksTable.id, candidate.taskId));
      if (!anticipatedTask) break;
      const lockedAgentIds = [candidate.agentId, anticipatedTask.ownerAgentId]
        .filter((value, index, values) => values.indexOf(value) === index)
        .sort((left, right) => left - right);
      try {
        const scrubbed = await db.transaction(async (tx) => {
          // Expiry is fail-closed bookkeeping, so it serializes on the runtime
          // control row but remains permitted while emergency stop is active.
          await lockRuntimeControlState(tx);
          await dependencies.afterRuntimeControlLock?.();
          // Canonical mutation lock order: runtime control -> agents -> approval -> task.
          for (const agentId of lockedAgentIds) {
            await tx.execute(
              sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${agentId} FOR UPDATE`,
            );
          }
          await tx.execute(
            sql`SELECT id FROM ${approvalRequestsTable} WHERE ${approvalRequestsTable.id} = ${candidate.id} FOR UPDATE`,
          );
          await tx.execute(
            sql`SELECT id FROM ${tasksTable} WHERE ${tasksTable.id} = ${candidate.taskId} FOR UPDATE`,
          );
          const [liveApproval] = await tx
            .select()
            .from(approvalRequestsTable)
            .where(eq(approvalRequestsTable.id, candidate.id));
          const [liveTask] = await tx
            .select()
            .from(tasksTable)
            .where(eq(tasksTable.id, candidate.taskId));
          if (!liveApproval || !liveTask) return false;
          if (!lockedAgentIds.includes(liveTask.ownerAgentId)) {
            throw new ExpiredApprovalOwnerChanged();
          }
          if (
            liveApproval.taskId !== liveTask.id ||
            liveApproval.agentId !== candidate.agentId ||
            (liveApproval.status !== "pending" &&
              liveApproval.status !== "approved") ||
            liveApproval.consumedAt !== null ||
            !liveApproval.expiresAt ||
            liveApproval.expiresAt.getTime() > now.getTime()
          ) {
            return false;
          }
          const isSudo = liveApproval.scope?.toolName === "vm_run_sudo_command";
          const [approval] = await tx
            .update(approvalRequestsTable)
            .set({
              status: "rejected",
              decisionNote: isSudo
                ? "Sudo approval expired"
                : "Approval expired",
              resolvedAt: now,
              actionPayload: null,
              scope: redactApprovalCapabilityScope(
                liveApproval.scope,
                "EXPIRED",
              ),
            })
            .where(
              and(
                eq(approvalRequestsTable.id, liveApproval.id),
                inArray(approvalRequestsTable.status, ["pending", "approved"]),
                isNull(approvalRequestsTable.consumedAt),
                lte(approvalRequestsTable.expiresAt, now),
              ),
            )
            .returning({ taskId: approvalRequestsTable.taskId });
          if (!approval) return false;

          if (liveTask.status === "awaiting_approval") {
            const hasDifferentLiveLease = Boolean(
              liveTask.leaseOwner &&
              liveTask.leaseExpiresAt &&
              liveTask.leaseExpiresAt.getTime() >= now.getTime(),
            );
            const [blocked] = await tx
              .update(tasksTable)
              .set({
                status: "blocked",
                blockedReason: "approval_expired",
                lastError: isSudo
                  ? "Sudo approval expired"
                  : "Approval expired",
                nextAttemptAt: null,
                ...(hasDifferentLiveLease
                  ? {}
                  : { leaseOwner: null, leaseExpiresAt: null }),
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
              )
              .returning({ id: tasksTable.id });
            if (!blocked) {
              throw new Error("Expired approval task CAS failed");
            }
          }
          return true;
        });
        if (scrubbed) scrubbedCount += 1;
        break;
      } catch (error) {
        if (error instanceof ExpiredApprovalOwnerChanged) continue;
        throw error;
      }
    }
  }

  return scrubbedCount;
}

/** @deprecated Use scrubExpiredApprovals; retained for compatibility. */
export const scrubExpiredSudoApprovals = scrubExpiredApprovals;
