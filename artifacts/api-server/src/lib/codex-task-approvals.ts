import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  agentsTable,
  tasksTable,
  taskAttemptsTable,
  runtimeInstancesTable,
  executionPolicyTable,
  chatgptRegistrationsTable,
  chatgptRegistrationLocksTable,
  approvalRequestsTable as approvals,
  codexTaskSessionsTable as sessions,
  codexActionApprovalsTable as native,
  activityEventsTable,
  type ApprovalRequest,
} from "@workspace/db";
import {
  lockRuntimeControlState,
  type RuntimeTransaction,
} from "./orchestrator/runtime-emergency-stop";
import { redactApprovalCapabilityScope } from "./orchestrator/approval-capability-redaction";
import { readRuntimeOperationsConfig } from "./runtime-operations-config";
import { policyAllowsTool } from "./execution-policy";
import { CodexTaskError, type CodexTaskBinding } from "./codex-task-adapter";
import type { CodexTaskAuthority } from "./codex-task-authority";
import type { OwnedCodexTaskSession } from "./codex-task-session";
import {
  createCodexActionTracker,
  type CodexActionReceipt,
  type CodexExactApprovalRequest,
} from "./codex-action-scope";

type Row = typeof native.$inferSelect;
type Claim = Pick<
  Row,
  | "taskId"
  | "agentId"
  | "sessionRevision"
  | "sessionOwnerToken"
  | "attemptId"
  | "leaseOwner"
  | "policyRevision"
  | "registrationId"
  | "registrationRevision"
  | "admissionVersion"
  | "effectType"
>;
const labels = {
  en: [
    "Review Codex command",
    "Review Codex file changes",
    "Review the complete scope. Your decision authorizes this native action once.",
  ],
  tr: [
    "Codex komutunu incele",
    "Codex dosya değişikliklerini incele",
    "Kapsamın tamamını incele. Kararın bu yerel işleme bir kez izin verir.",
  ],
  de: [
    "Codex-Befehl prüfen",
    "Codex-Dateiänderungen prüfen",
    "Prüfe den vollständigen Umfang. Deine Entscheidung erlaubt diese Aktion einmalig.",
  ],
  ru: [
    "Проверьте команду Codex",
    "Проверьте изменения файлов Codex",
    "Проверьте все детали. Решение разрешает это действие только один раз.",
  ],
  "zh-CN": [
    "检查 Codex 命令",
    "检查 Codex 文件更改",
    "请检查完整范围。你的决定仅授权本次操作。",
  ],
  "zh-TW": [
    "檢查 Codex 命令",
    "檢查 Codex 檔案變更",
    "請檢查完整範圍。你的決定僅授權本次操作。",
  ],
  ar: [
    "راجع أمر Codex",
    "راجع تغييرات ملفات Codex",
    "راجع النطاق كاملاً. يجيز قرارك هذا الإجراء مرة واحدة فقط.",
  ],
} as const;
const receiptLabels = {
  en: "Codex action ended",
  tr: "Codex işlemi sona erdi",
  de: "Codex-Aktion beendet",
  ru: "Действие Codex завершено",
  "zh-CN": "Codex 操作已结束",
  "zh-TW": "Codex 操作已結束",
  ar: "انتهى إجراء Codex",
} as const;
export class CodexApprovalConflict extends Error {
  constructor() {
    super("Native approval scope or ownership changed");
    this.name = "CodexApprovalConflict";
  }
}
const conflict = (): never => {
  throw new CodexApprovalConflict();
};
const fail = (
  kind:
    | "protocol"
    | "ownership_lost"
    | "cancelled"
    | "timeout"
    | "unsupported_capability" = "ownership_lost",
): never => {
  throw new CodexTaskError(kind);
};
const nativeTool = (type: string) =>
  type === "commandExecution" ? "codex_native_command" : "codex_native_patch";
function sameBinding(a: CodexTaskBinding, b: CodexTaskBinding) {
  return (
    !!b &&
    (
      [
        "taskId",
        "attemptId",
        "leaseOwner",
        "policyRevision",
        "registrationId",
        "registrationRevision",
        "accountId",
        "admissionVersion",
      ] as const
    ).every((key) => a[key] === b[key])
  );
}
async function lock(tx: RuntimeTransaction, claim: Claim, approvalId?: number) {
  // Fixed backend limits keep a stale database lock from hanging a native
  // callback or owned child cleanup indefinitely.
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
  await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
  const control = await lockRuntimeControlState(tx);
  await tx.execute(
    sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${claim.agentId} FOR UPDATE`,
  );
  if (approvalId !== undefined)
    await tx.execute(
      sql`SELECT id FROM ${approvals} WHERE ${approvals.id} = ${approvalId} FOR UPDATE`,
    );
  await tx.execute(
    sql`SELECT id FROM ${tasksTable} WHERE ${tasksTable.id} = ${claim.taskId} FOR UPDATE`,
  );
  await tx.execute(
    sql`SELECT task_id FROM ${sessions} WHERE ${sessions.taskId} = ${claim.taskId} FOR UPDATE`,
  );
  if (approvalId !== undefined)
    await tx.execute(
      sql`SELECT approval_id FROM ${native} WHERE ${native.approvalId} = ${approvalId} FOR UPDATE`,
    );
  return control;
}
/** Metadata-only checks within the caller's already owned transaction. Never
 * call the renewing authority/heartbeat while holding task/session locks. */
async function live(
  tx: RuntimeTransaction,
  claim: Claim,
  now: number,
  status: "in_progress" | "awaiting_approval",
) {
  const [row] = await tx
    .select({
      session: sessions,
      task: tasksTable,
      agent: agentsTable,
      attempt: taskAttemptsTable,
      worker: runtimeInstancesTable,
      policy: executionPolicyTable,
      selectedId: chatgptRegistrationLocksTable.activeRegistrationId,
      registrationId: chatgptRegistrationsTable.id,
      registrationRevision: chatgptRegistrationsTable.revision,
    })
    .from(sessions)
    .innerJoin(tasksTable, eq(tasksTable.id, sessions.taskId))
    .innerJoin(agentsTable, eq(agentsTable.id, sessions.agentId))
    .innerJoin(taskAttemptsTable, eq(taskAttemptsTable.id, claim.attemptId))
    .innerJoin(
      runtimeInstancesTable,
      eq(runtimeInstancesTable.id, taskAttemptsTable.workerInstanceId),
    )
    .innerJoin(executionPolicyTable, eq(executionPolicyTable.id, 1))
    .innerJoin(
      chatgptRegistrationLocksTable,
      eq(chatgptRegistrationLocksTable.singletonId, 1),
    )
    .innerJoin(
      chatgptRegistrationsTable,
      sql`${chatgptRegistrationsTable.id}::text = ${claim.registrationId}`,
    )
    .where(eq(sessions.taskId, claim.taskId));
  if (!row) conflict();
  const {
    session: s,
    task: t,
    agent: a,
    attempt: attempt,
    worker: w,
    policy: p,
  } = row!;
  const limits = readRuntimeOperationsConfig();
  const fresh = (date: Date, limit: number) =>
    date.getTime() > now - limit && date.getTime() <= now + 5000;
  if (
    s.state !== "running" ||
    s.revision !== claim.sessionRevision ||
    s.ownerToken !== claim.sessionOwnerToken ||
    s.agentId !== claim.agentId ||
    s.attemptId !== claim.attemptId ||
    s.leaseOwner !== claim.leaseOwner ||
    s.policyRevision !== claim.policyRevision ||
    s.registrationId !== claim.registrationId ||
    s.registrationRevision !== claim.registrationRevision ||
    s.admissionVersion !== claim.admissionVersion ||
    row!.selectedId !== claim.registrationId ||
    row!.registrationId !== claim.registrationId ||
    row!.registrationRevision !== claim.registrationRevision ||
    p.revision !== claim.policyRevision ||
    !policyAllowsTool(
      p,
      claim.effectType === "fileChange" ? "vm_write_file" : "vm_run_command",
    ) ||
    t.ownerAgentId !== claim.agentId ||
    t.status !== status ||
    t.lastModelProvider !== "chatgpt" ||
    t.lastModelId !== `chatgpt:${s.model}` ||
    t.leaseOwner !== claim.leaseOwner ||
    !t.leaseExpiresAt ||
    t.leaseExpiresAt.getTime() <= now ||
    !a.isActive ||
    a.status !== "working" ||
    a.currentTaskId !== claim.taskId ||
    a.runLeaseOwner !== claim.leaseOwner ||
    !a.runLeaseExpiresAt ||
    a.runLeaseExpiresAt.getTime() <= now ||
    a.permissions.canUseTerminal !== true ||
    attempt.taskId !== claim.taskId ||
    attempt.agentId !== claim.agentId ||
    attempt.leaseOwner !== claim.leaseOwner ||
    !["claimed", "running"].includes(attempt.state) ||
    !fresh(attempt.lastHeartbeatAt, limits.taskLeaseMs) ||
    w.state !== "healthy" ||
    !["worker", "combined"].includes(w.role) ||
    !fresh(w.lastHeartbeatAt, limits.workerStaleAfterMs)
  )
    conflict();
}
function sameClaim(row: Row, claim: Claim) {
  return (
    [
      "taskId",
      "agentId",
      "sessionRevision",
      "sessionOwnerToken",
      "attemptId",
      "leaseOwner",
      "policyRevision",
      "registrationId",
      "registrationRevision",
      "admissionVersion",
      "effectType",
    ] as const
  ).every((key) => row[key] === claim[key]);
}
/** Existing decision router calls this only after its control/agent/approval/
 * task locks. A native review always requires its exact browser-reviewed hash,
 * has no generic executable payload, and retains its original owned attempt. */
export async function validateCodexApprovalDecision(
  tx: RuntimeTransaction,
  approval: ApprovalRequest,
  now: Date,
  expectedArgsHash: string | null | undefined,
  approved: boolean,
): Promise<boolean> {
  const [row] = await tx
    .select()
    .from(native)
    .where(eq(native.approvalId, approval.id));
  const tagged =
    approval.scope?.toolName === "codex_native_command" ||
    approval.scope?.toolName === "codex_native_patch";
  if (!row && !tagged) return false;
  if (
    !row ||
    !tagged ||
    row.state !== "awaiting" ||
    row.taskId !== approval.taskId ||
    row.agentId !== approval.agentId ||
    (row.effectType === "commandExecution" &&
      approval.scope?.toolName !== "codex_native_command") ||
    (row.effectType === "fileChange" &&
      approval.scope?.toolName !== "codex_native_patch") ||
    approval.actionPayload !== null ||
    approval.scope?.argsHash !== row.actionDigest ||
    row.expiresAt.getTime() <= now.getTime() ||
    approval.expiresAt?.getTime() !== row.expiresAt.getTime() ||
    (approved && expectedArgsHash?.toLowerCase() !== row.actionDigest)
  )
    conflict();
  await tx.execute(
    sql`SELECT task_id FROM ${sessions} WHERE ${sessions.taskId} = ${row!.taskId} FOR UPDATE`,
  );
  await tx.execute(
    sql`SELECT approval_id FROM ${native} WHERE ${native.approvalId} = ${row!.approvalId} FOR UPDATE`,
  );
  await live(tx, row!, now.getTime(), "awaiting_approval");
  if (!approved)
    await tx
      .update(native)
      .set({
        state: "invalidated",
        invalidatedAt: now,
        invalidationReason: "human_rejection",
      })
      .where(
        and(
          eq(native.approvalId, row!.approvalId),
          eq(native.state, "awaiting"),
        ),
      );
  return true;
}

export function createCodexTaskApprovalBridge(input: {
  authority: CodexTaskAuthority;
  session: OwnedCodexTaskSession;
  locale?: keyof typeof labels;
  now?: () => number;
  pollIntervalMs?: number;
  approvalTimeoutMs?: number;
}) {
  const binding = Object.freeze({ ...input.authority.binding });
  const poll = input.pollIntervalMs ?? 1000,
    timeout = input.approvalTimeoutMs ?? 5 * 60_000;
  if (
    !Number.isSafeInteger(poll) ||
    poll < 20 ||
    poll > 5000 ||
    !Number.isSafeInteger(timeout) ||
    timeout < 100 ||
    timeout > 60 * 60_000
  )
    fail("protocol");
  const now = () => {
    const value = (input.now ?? Date.now)();
    if (!Number.isSafeInteger(value) || value < 0) fail("protocol");
    return value;
  };
  const shutdown = new AbortController();
  let closed = false;
  let closeSettled = false;
  type Record = {
    claim: Claim;
    row: Row;
    preview: string;
    removeAbort: () => void;
  };
  const records = new Map<string, Record>(),
    used = new Set<string>(),
    work = new Set<Promise<unknown>>();
  async function owned() {
    if (
      !sameBinding(
        binding,
        (await input.authority.readBinding()) as CodexTaskBinding,
      )
    )
      fail();
    await input.session.assertCurrent(binding);
  }
  async function invalidate(record: Record, reason: string) {
    await db.transaction(async (tx) => {
      await lock(tx, record.claim, record.row.approvalId);
      const [row] = await tx
        .select()
        .from(native)
        .where(eq(native.approvalId, record.row.approvalId));
      if (
        !row ||
        !sameClaim(row, record.claim) ||
        !["awaiting", "consumed"].includes(row.state)
      )
        return;
      await tx
        .update(native)
        .set({
          state: row.state === "consumed" ? "uncertain" : "invalidated",
          invalidatedAt: new Date(now()),
          invalidationReason: reason,
        })
        .where(eq(native.approvalId, row.approvalId));
      const [approval] = await tx
        .select()
        .from(approvals)
        .where(eq(approvals.id, row.approvalId));
      if (approval)
        await tx
          .update(approvals)
          .set({
            status: "rejected",
            resolvedAt: new Date(now()),
            actionPayload: null,
            decisionNote: "Native action review closed",
            scope: redactApprovalCapabilityScope(approval.scope, "CANCELLED"),
          })
          .where(eq(approvals.id, row.approvalId));
      // Native can withdraw one prompt while independently completing its
      // turn. Restore only this exact live owner's still-awaiting task. Lost
      // policy/account/lease is checked again by the driver before any effect.
      const [session] = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.taskId, row.taskId));
      if (
        session?.ownerToken === row.sessionOwnerToken &&
        session.revision === row.sessionRevision
      )
        await tx
          .update(tasksTable)
          .set({
            status: reason === "native_withdrawal" ? "in_progress" : "blocked",
            blockedReason:
              reason === "native_withdrawal" ? null : "runtime_failure",
          })
          .where(
            and(
              eq(tasksTable.id, row.taskId),
              eq(tasksTable.ownerAgentId, row.agentId),
              eq(tasksTable.leaseOwner, row.leaseOwner),
              eq(tasksTable.status, "awaiting_approval"),
            ),
          );
    });
  }
  function track(promise: Promise<unknown>) {
    work.add(promise);
    void promise.finally(() => work.delete(promise)).catch(() => {});
    return promise;
  }
  async function onActionReceipt(
    receipt: CodexActionReceipt,
    submitted: CodexTaskBinding,
  ) {
    if (!sameBinding(binding, submitted) || receipt.proofScope !== "codex_item")
      fail("protocol");
    const captured = structuredClone(receipt);
    const record = [...records.values()].find(
      (value) =>
        value.row.threadId === captured.threadId &&
        value.row.turnId === captured.turnId &&
        value.row.itemId === captured.itemId,
    );
    if (!record) return; // A permitted unprompted item is handled by the turn ledger.
    if (
      record.row.actionDigest !== captured.actionDigest ||
      record.row.actionRevision !== captured.revision ||
      !["completed", "failed", "declined"].includes(captured.status) ||
      !Number.isSafeInteger(captured.completedAtMs) ||
      captured.completedAtMs < record.row.actionStartedAtMs ||
      (captured.exitCode !== null &&
        (!Number.isInteger(captured.exitCode) ||
          captured.exitCode < -2147483648 ||
          captured.exitCode > 2147483647)) ||
      (record.row.effectType === "commandExecution" &&
        captured.status === "completed" &&
        captured.exitCode !== 0) ||
      (record.row.effectType === "fileChange" && captured.exitCode !== null)
    )
      fail("protocol");
    if (captured.decision === null && captured.status === "declined") {
      // Withdrawal is not consumption. Keep the observed declined item in the
      // driver's result; never invent a consumed permission or durable receipt.
      await invalidate(record, "native_withdrawal");
      const [row] = await db
        .select()
        .from(native)
        .where(eq(native.approvalId, record.row.approvalId));
      if (
        !row ||
        !sameClaim(row, record.claim) ||
        row.state !== "invalidated" ||
        row.decision !== null
      )
        fail("protocol");
      record.removeAbort();
      return;
    }
    if (captured.decision !== "accept") fail("protocol");
    await db.transaction(async (tx) => {
      await lock(tx, record.claim, record.row.approvalId);
      const [row] = await tx
        .select()
        .from(native)
        .where(eq(native.approvalId, record.row.approvalId));
      if (
        !row ||
        !sameClaim(row, record.claim) ||
        !["consumed", "uncertain"].includes(row.state) ||
        row.decision !== "accept"
      )
        fail("protocol");
      await tx
        .update(native)
        .set({
          state: "receipted",
          invalidatedAt: null,
          invalidationReason: null,
          nativeStatus: captured.status,
          nativeExitCode: captured.exitCode,
          nativeCompletedAtMs: captured.completedAtMs,
        })
        .where(eq(native.approvalId, row.approvalId));
      await tx.insert(activityEventsTable).values({
        taskId: row.taskId,
        agentId: row.agentId,
        type: "progress_update",
        summary: receiptLabels[input.locale ?? "en"],
        detail: {
          proofScope: "codex_item",
          actionDigest: row.actionDigest,
          status: captured.status,
          exitCode: captured.exitCode,
          deliverableVerified: false,
        },
        severity: captured.status === "completed" ? "info" : "warning",
      });
    });
    record.removeAbort();
  }
  async function approve(
    original: CodexExactApprovalRequest,
    submitted: CodexTaskBinding,
    signal?: AbortSignal,
  ): Promise<"accept" | "decline" | "cancel"> {
    if (closed || !sameBinding(binding, submitted) || signal?.aborted)
      fail("cancelled");
    // Capture before any DB/heartbeat await. Only this backend port receives
    // an action; the public API accepts a decision and reviewed digest only.
    const request = structuredClone(original);
    if (Buffer.byteLength(JSON.stringify(request)) > 1024 * 1024)
      fail("protocol");
    const key = `${typeof request.id}:${request.id}`;
    if (used.has(key) || used.size >= 128) fail("protocol");
    used.add(key);
    const combined = AbortSignal.any([
      ...(signal ? [signal] : []),
      shutdown.signal,
    ]);
    const open = () => {
      if (closed || combined.aborted) fail("cancelled");
    };
    let record: Record | undefined;
    try {
      await owned();
      open();
      const fence = await input.session.readApprovalFence(binding);
      const context = await input.authority.readLaunchContext();
      open();
      const tracker = createCodexActionTracker({
        workspace:
          (
            await db
              .select({ cwd: sessions.cwd })
              .from(sessions)
              .where(eq(sessions.taskId, binding.taskId))
          )[0]?.cwd ?? "",
        deniedPaths: [input.session.home],
        secrets: [
          context.registration.credentials?.accessToken ?? "",
          context.registration.credentials?.idToken ?? "",
          context.registration.credentials?.refreshToken ?? "",
        ],
      });
      const action = request.action;
      if (
        !action ||
        action.version !== 1 ||
        !Number.isSafeInteger(action.revision) ||
        action.revision <= 0 ||
        action.revision > 2147483647 ||
        request.params.threadId !== action.threadId ||
        request.params.turnId !== action.turnId ||
        request.params.itemId !== action.itemId
      )
        fail("protocol");
      tracker.observe({
        method: "item/started",
        params: {
          threadId: action.threadId,
          turnId: action.turnId,
          startedAtMs: action.startedAtMs,
          item: {
            ...action.effect,
            id: action.itemId,
            status: "inProgress",
            source: "agent",
          },
        },
      });
      const checked = tracker.review({
        id: request.id,
        method: request.method,
        params: {
          ...request.params,
          ...(action.effect.type === "commandExecution"
            ? { command: action.effect.command, cwd: action.effect.cwd }
            : {}),
        },
      });
      const reconstructed = {
        version: 1,
        threadId: action.threadId,
        turnId: action.turnId,
        itemId: action.itemId,
        startedAtMs: action.startedAtMs,
        revision: action.revision,
        effect: checked.action.effect,
      };
      if (
        createHash("sha256")
          .update(JSON.stringify(reconstructed))
          .digest("hex") !== action.digest ||
        !checked.request.params.availableDecisions ||
        !(checked.request.params.availableDecisions as string[]).includes(
          "accept",
        )
      )
        fail("protocol");
      const preview = JSON.stringify(checked.action.effect, null, 2);
      const claim: Claim = {
        taskId: fence.taskId,
        agentId: fence.agentId,
        sessionRevision: fence.revision,
        sessionOwnerToken: fence.ownerToken,
        attemptId: fence.attemptId,
        leaseOwner: fence.leaseOwner,
        policyRevision: fence.policyRevision,
        registrationId: fence.registrationId,
        registrationRevision: fence.registrationRevision,
        admissionVersion: fence.admissionVersion,
        effectType: checked.action.effect.type,
      };
      const started = now(),
        expiresAt = new Date(started + timeout);
      const row = await db.transaction(async (tx) => {
        const control = await lock(tx, claim);
        open();
        if (control.emergencyStopEnabled) fail();
        await live(tx, claim, now(), "in_progress");
        const [active] = await tx
          .select({ id: native.approvalId })
          .from(native)
          .where(
            and(
              eq(native.taskId, binding.taskId),
              sql`${native.state} IN ('awaiting','consumed')`,
            ),
          );
        if (active) fail("unsupported_capability");
        const copy = labels[input.locale ?? "en"];
        const [approval] = await tx
          .insert(approvals)
          .values({
            taskId: claim.taskId,
            agentId: claim.agentId,
            category: "other",
            title: copy[claim.effectType === "commandExecution" ? 0 : 1],
            description: copy[2],
            actionPayload: null,
            scope: {
              toolName: nativeTool(claim.effectType),
              argsHash: action.digest,
              target:
                checked.action.effect.type === "commandExecution"
                  ? checked.action.effect.cwd
                  : null,
              preview,
            },
            createdAt: new Date(started),
            expiresAt,
          })
          .returning();
        const [saved] = await tx
          .insert(native)
          .values({
            ...claim,
            approvalId: approval.id,
            threadId: action.threadId,
            turnId: action.turnId,
            itemId: action.itemId,
            requestKey: key,
            actionStartedAtMs: action.startedAtMs,
            actionRevision: action.revision,
            actionDigest: action.digest,
            state: "awaiting",
            createdAt: new Date(started),
            expiresAt,
          })
          .returning();
        await tx
          .update(tasksTable)
          .set({ status: "awaiting_approval", blockedReason: null })
          .where(eq(tasksTable.id, claim.taskId));
        await tx.insert(activityEventsTable).values({
          taskId: claim.taskId,
          agentId: claim.agentId,
          type: "approval_requested",
          summary: copy[claim.effectType === "commandExecution" ? 0 : 1],
          detail: {
            scope: {
              toolName: nativeTool(claim.effectType),
              argsHash: action.digest,
            },
            expiresAt: expiresAt.toISOString(),
            native: true,
          },
          severity: "warning",
        });
        open();
        return saved;
      });
      record = { claim, row, preview, removeAbort: () => {} };
      records.set(key, record);
      const captured = record;
      const abort = () => {
        void track(invalidate(captured, "native_withdrawal")).catch(() => {});
      };
      combined.addEventListener("abort", abort, { once: true });
      record.removeAbort = () => combined.removeEventListener("abort", abort);
      open();
      for (;;) {
        open();
        if (now() >= expiresAt.getTime()) fail("timeout");
        try {
          await owned();
        } catch (error) {
          // An exact pending review is part of the authority fence. Its
          // deadline can cross while that asynchronous fence is read; keep
          // the expiry reason instead of misreporting a stolen task lease.
          if (!combined.aborted && now() >= expiresAt.getTime())
            fail("timeout");
          throw error;
        }
        open();
        if (now() >= expiresAt.getTime()) fail("timeout");
        const [current] = await db
          .select()
          .from(approvals)
          .where(eq(approvals.id, row.approvalId));
        if (!current || current.status === "rejected") fail();
        if (current.status === "approved") {
          await db.transaction(async (tx) => {
            const control = await lock(tx, claim, row.approvalId);
            open();
            if (control.emergencyStopEnabled) fail();
            await live(tx, claim, now(), "in_progress");
            const [capability] = await tx
              .select()
              .from(native)
              .where(eq(native.approvalId, row.approvalId));
            const [approved] = await tx
              .select()
              .from(approvals)
              .where(eq(approvals.id, row.approvalId));
            if (
              !capability ||
              !sameClaim(capability, claim) ||
              capability.state !== "awaiting" ||
              capability.actionDigest !== action.digest ||
              capability.expiresAt.getTime() <= now() ||
              !approved ||
              approved.status !== "approved" ||
              approved.consumedAt !== null ||
              approved.actionPayload !== null ||
              approved.scope?.argsHash !== action.digest ||
              approved.scope?.preview !== preview ||
              approved.scope?.toolName !== nativeTool(claim.effectType) ||
              approved.expiresAt?.getTime() !== expiresAt.getTime()
            )
              fail();
            await tx
              .update(native)
              .set({
                state: "consumed",
                decision: "accept",
                consumedAt: new Date(now()),
              })
              .where(
                and(
                  eq(native.approvalId, row.approvalId),
                  eq(native.state, "awaiting"),
                ),
              );
            await tx
              .update(approvals)
              .set({
                consumedAt: new Date(now()),
                scope: redactApprovalCapabilityScope(
                  approved.scope,
                  "CANCELLED",
                ),
              })
              .where(
                and(
                  eq(approvals.id, row.approvalId),
                  eq(approvals.status, "approved"),
                ),
              );
            open();
          });
          await owned();
          open();
          return "accept";
        }
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            combined.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, poll);
          combined.addEventListener("abort", done, { once: true });
          if (combined.aborted) done();
        });
      }
    } catch (error) {
      if (record) {
        record.removeAbort();
        try {
          await invalidate(
            record,
            combined.aborted
              ? "native_withdrawal"
              : error instanceof CodexTaskError && error.kind === "timeout"
                ? "expired"
                : "ownership_lost",
          );
        } catch {
          throw new CodexTaskError("cleanup_failed");
        }
      }
      if (error instanceof CodexTaskError) throw error;
      return fail(
        error instanceof CodexApprovalConflict ? "ownership_lost" : "protocol",
      );
    }
  }
  return {
    approve: (
      request: CodexExactApprovalRequest,
      submitted: CodexTaskBinding,
      signal?: AbortSignal,
    ) => {
      const promise = approve(request, submitted, signal);
      track(promise);
      return promise;
    },
    onActionReceipt: (
      receipt: CodexActionReceipt,
      submitted: CodexTaskBinding,
    ) => {
      const promise = onActionReceipt(receipt, submitted);
      track(promise);
      return promise;
    },
    close: async () => {
      if (closeSettled) return;
      closed = true;
      shutdown.abort();
      await Promise.allSettled([...work]);
      let failed = false;
      for (const record of records.values()) {
        record.removeAbort();
        try {
          await invalidate(record, "bridge_closed");
        } catch {
          failed = true;
        }
      }
      if (failed) throw new CodexTaskError("cleanup_failed");
      closeSettled = true;
    },
  };
}
