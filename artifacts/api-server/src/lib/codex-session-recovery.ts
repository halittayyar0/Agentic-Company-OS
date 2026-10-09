import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  agentsTable,
  tasksTable,
  codexTaskSessionsTable as sessions,
  codexSessionRecoveriesTable as recoveries,
  codexActionApprovalsTable as native,
  approvalRequestsTable,
  activityEventsTable,
} from "@workspace/db";
import { lockRuntimeControlState } from "./orchestrator/runtime-emergency-stop";
import {
  CodexRecoveryInput,
  CodexRecoveryReceipt,
  CodexRecoveryStatus,
} from "./codex-session-recovery-contract";
import { codexRecoveryAudit } from "./codex-session-recovery-copy";
import type { WorkspaceLocale } from "./workspace-locale";

type Task = typeof tasksTable.$inferSelect;
type Session = typeof sessions.$inferSelect;
type Agent = typeof agentsTable.$inferSelect;
type Reason = NonNullable<
  ReturnType<typeof CodexRecoveryReceipt.parse>["reason"]
>;
export class CodexRecoveryScopeConflict extends Error {
  constructor() {
    super("recovery_scope_conflict");
  }
}
function eligibility(
  task: Task | undefined,
  agent: Agent | undefined,
  session: Session | undefined,
  pending: boolean,
): Reason | null {
  if (!task) return "task_missing";
  if (!session) return "session_missing";
  if (session.revision >= Number.MAX_SAFE_INTEGER - 1)
    return "revision_exhausted";
  if (session.state === "running" || session.ownerToken !== null)
    return "session_running";
  if (session.state === "reset") return "already_reset";
  if (
    !["ready", "uncertain"].includes(session.state) ||
    !["verified", "not_launched"].includes(session.cleanupState) ||
    session.cleanupAt === null
  )
    return "cleanup_unknown";
  if (
    !agent ||
    task.ownerAgentId !== agent.id ||
    !["blocked", "completed", "failed", "cancelled"].includes(task.status) ||
    task.leaseOwner !== null ||
    task.leaseExpiresAt !== null ||
    agent.currentTaskId === task.id
  )
    return "task_active";
  if (pending) return "native_pending";
  return null;
}
const taskIdentity = (taskId: number) => {
  if (!Number.isSafeInteger(taskId) || taskId <= 0)
    throw new Error("invalid_recovery_task");
};
function publicReceipt(row: typeof recoveries.$inferSelect) {
  const receipt = CodexRecoveryReceipt.parse(row.response);
  if (
    receipt.requestId !== row.requestId ||
    receipt.taskId !== row.taskId ||
    receipt.expectedRevision !== row.expectedRevision
  )
    throw new Error("invalid_recovery_receipt");
  return receipt;
}
export async function readCodexSessionRecoveryReceipt(
  taskId: number,
  requestId: string,
) {
  taskIdentity(taskId);
  CodexRecoveryInput.shape.requestId.parse(requestId);
  const [row] = await db
    .select()
    .from(recoveries)
    .where(
      and(eq(recoveries.taskId, taskId), eq(recoveries.requestId, requestId)),
    );
  return row ? publicReceipt(row) : null;
}
export async function readCodexSessionRecovery(taskId: number) {
  taskIdentity(taskId);
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId));
  if (!task) return null;
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.taskId, taskId));
  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, task.ownerAgentId));
  const pending = await db
    .select({ id: native.approvalId })
    .from(native)
    .where(
      and(
        eq(native.taskId, taskId),
        inArray(native.state, ["awaiting", "consumed"]),
      ),
    )
    .limit(1);
  const reason = eligibility(task, agent, session, pending.length > 0);
  return CodexRecoveryStatus.parse({
    taskId,
    sessionState: session?.state ?? "none",
    revision: session?.revision ?? null,
    cleanupState: session?.cleanupState ?? null,
    canReset: reason === null,
    reason,
    requiresRevalidation: true,
  });
}
/** Operator metadata transition only. Never starts inference, queues work,
 * resolves uncertain effects, deletes homes or imports another authority. */
export async function recoverCodexSession(
  taskId: number,
  value: unknown,
  locale: WorkspaceLocale,
) {
  taskIdentity(taskId);
  const parsed = CodexRecoveryInput.parse(value);
  const input = { ...parsed, requestId: parsed.requestId.toLowerCase() };
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout='5s'`);
    await tx.execute(sql`SET LOCAL statement_timeout='10s'`);
    // Control -> owner agent -> live approvals -> task -> session -> native.
    // Global control also serializes duplicate request identities across API replicas.
    // Recovery is allowed during emergency stop because it cannot resume work.
    await lockRuntimeControlState(tx);
    const [prior] = await tx
      .select()
      .from(recoveries)
      .where(eq(recoveries.requestId, input.requestId));
    if (prior) {
      if (
        prior.taskId !== taskId ||
        prior.expectedRevision !== input.expectedRevision
      )
        throw new CodexRecoveryScopeConflict();
      return publicReceipt(prior);
    }
    const [identity] = await tx
      .select({ owner: tasksTable.ownerAgentId })
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId));
    const [agent] = identity
      ? await tx
          .select()
          .from(agentsTable)
          .where(eq(agentsTable.id, identity.owner))
          .for("update")
      : [];
    const pending = await tx
      .select({ id: native.approvalId })
      .from(native)
      .where(
        and(
          eq(native.taskId, taskId),
          inArray(native.state, ["awaiting", "consumed"]),
        ),
      )
      .limit(2);
    if (pending.length)
      await tx
        .select({ id: approvalRequestsTable.id })
        .from(approvalRequestsTable)
        .where(
          inArray(
            approvalRequestsTable.id,
            pending.map((r) => r.id),
          ),
        )
        .orderBy(approvalRequestsTable.id)
        .for("update");
    const [task] = await tx
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .for("update");
    const [session] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.taskId, taskId))
      .for("update");
    const live = await tx
      .select({ id: native.approvalId })
      .from(native)
      .where(
        and(
          eq(native.taskId, taskId),
          inArray(native.state, ["awaiting", "consumed"]),
        ),
      )
      .limit(2)
      .for("update");
    const reason: Reason | null =
      session && session.revision !== input.expectedRevision
        ? "revision_changed"
        : eligibility(task, agent, session, live.length > 0);
    const now = new Date();
    const receipt = CodexRecoveryReceipt.parse({
      requestId: input.requestId,
      taskId,
      expectedRevision: input.expectedRevision,
      outcome: reason ? "rejected" : "accepted",
      reason,
      revision: reason
        ? (session?.revision ?? null)
        : input.expectedRevision + 1,
      recordedAt: now.getTime(),
      taskResumed: false,
      effectsReconciled: false,
    });
    const snapshot = reason
      ? null
      : (() => {
          const { ownerToken: _ownerToken, ...metadata } = session!;
          return JSON.parse(JSON.stringify(metadata)) as Record<
            string,
            unknown
          >;
        })();
    await tx.insert(recoveries).values({
      requestId: input.requestId,
      taskId,
      expectedRevision: input.expectedRevision,
      response: receipt,
      snapshot,
      createdAt: now,
    });
    if (!reason) {
      await tx
        .update(sessions)
        .set({
          state: "reset",
          revision: input.expectedRevision + 1,
          threadId: null,
          lastTurnId: null,
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(sessions.taskId, taskId),
            eq(sessions.revision, input.expectedRevision),
          ),
        );
      await tx.insert(activityEventsTable).values({
        taskId,
        agentId: task!.ownerAgentId,
        type: "note",
        summary: codexRecoveryAudit[locale],
        detail: {
          actor: "operator",
          kind: "codex_session_recovery",
          requestId: input.requestId,
          previousRevision: input.expectedRevision,
          revision: receipt.revision,
          taskResumed: false,
          effectsReconciled: false,
        },
        severity: "warning",
      });
    }
    return receipt;
  });
}
