import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  tasksTable,
  codexTaskSessionsTable as sessions,
  codexSessionRecoveriesTable as recoveries,
  sourceChangesTable,
} from "@workspace/db";
import {
  CodexTaskError,
  type CodexCleanupState,
  type CodexTaskBinding,
  type CodexTaskSession,
  type CodexReportedUsage,
  runCodexTask,
  type CodexTaskPorts,
} from "./codex-task-adapter";
import type { CodexTaskAuthority } from "./codex-task-authority";

type Row = typeof sessions.$inferSelect;
type Result = Awaited<ReturnType<typeof runCodexTask>>;
interface Input {
  authority: CodexTaskAuthority;
  agentId: number;
  workspace: string;
  storageDirectory: string;
  executableDigest: string;
}
/** Backend-only pending-action ownership. Never expose this bearer-like
 * session token to a browser or tool; a consuming transaction must recheck
 * it with the current session, task/agent/attempt lease, account and policy. */
export interface CodexApprovalSessionFence {
  readonly taskId: number;
  readonly agentId: number;
  readonly revision: number;
  readonly ownerToken: string;
  readonly attemptId: string;
  readonly leaseOwner: string;
  readonly policyRevision: number;
  readonly registrationId: string;
  readonly registrationRevision: number;
  readonly admissionVersion: number;
}
/** An exclusively claimed private runtime home, not a browser/tool payload.
 * Complete only with runCodexTask's terminal result AFTER awaited owned cleanup.
 * A crash, failed cleanup or uncertain turn requires explicit recovery; this
 * map never takes over a running claim based on an elapsed clock. */
export interface OwnedCodexTaskSession {
  readonly home: string;
  readRuntimeHome(scope: {
    binding: CodexTaskBinding;
    workspace: string;
    storageDirectory: string;
    model: string;
    executableDigest: string;
  }): Promise<string>;
  readSession(): Promise<CodexTaskSession | null>;
  assertCurrent(binding?: CodexTaskBinding): Promise<void>;
  readApprovalFence(
    binding: CodexTaskBinding,
  ): Promise<Readonly<CodexApprovalSessionFence>>;
  complete(result: Result): Promise<void>;
  uncertain(cleanupState?: CodexCleanupState): Promise<void>;
}
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_:-]{1,160}$/u.test(value);
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const canonical = (value: unknown): value is string =>
  typeof value === "string" &&
  Buffer.byteLength(value) <= 4096 &&
  path.isAbsolute(value) &&
  path.resolve(value) === value &&
  !value.includes("\0");
function sameBinding(left: CodexTaskBinding, right: CodexTaskBinding) {
  return (
    !!right &&
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
    ).every((key) => left[key] === right[key])
  );
}
function usage(value: unknown): value is CodexReportedUsage | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const result = value as CodexReportedUsage;
  return (
    [result.promptTokens, result.completionTokens, result.totalTokens].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) &&
    result.totalTokens >= result.promptTokens &&
    result.totalTokens >= result.completionTokens
  );
}
function recordedUsage(row: Row): CodexReportedUsage | null {
  if (
    row.promptTokens === null ||
    row.completionTokens === null ||
    row.totalTokens === null
  )
    return null;
  return {
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
  };
}
const lost = (): never => {
  throw new CodexTaskError("ownership_lost");
};
const protocol = (): never => {
  throw new CodexTaskError("protocol");
};

/** Scope comes solely from the backend's source workspace and live authority.
 * Registration identity is immutable in protected registration storage. A
 * successful checkpoint can be rebound to a new attempt and a newer token
 * revision for that identity; permissions/model/host/admission must be exact.
 * This row lock is session ownership, not atomic admission of external effects. */
export async function claimCodexTaskSession(
  input: Input,
): Promise<OwnedCodexTaskSession> {
  const authority = input.authority;
  const binding = Object.freeze({ ...authority.binding });
  const { agentId, workspace, storageDirectory, executableDigest } = input;
  const model = authority.model;
  const sourceChange = authority.sourceChange
    ? Object.freeze({
        id: authority.sourceChange.id,
        revision: authority.sourceChange.revision,
      })
    : null;
  if (
    !positive(agentId) ||
    !positive(binding.taskId) ||
    !positive(binding.policyRevision) ||
    !positive(binding.registrationRevision) ||
    !identifier(binding.attemptId) ||
    !identifier(binding.leaseOwner) ||
    !identifier(binding.registrationId) ||
    !identifier(binding.accountId) ||
    !Number.isSafeInteger(binding.admissionVersion) ||
    binding.admissionVersion < 0 ||
    !canonical(workspace) ||
    !canonical(storageDirectory) ||
    workspace === storageDirectory ||
    (path.relative(storageDirectory, workspace).split(path.sep)[0] !== ".." &&
      !path.isAbsolute(path.relative(storageDirectory, workspace))) ||
    (path.relative(workspace, storageDirectory).split(path.sep)[0] !== ".." &&
      !path.isAbsolute(path.relative(workspace, storageDirectory))) ||
    !/^[a-f0-9]{64}$/u.test(executableDigest) ||
    (sourceChange !== null &&
      (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        sourceChange.id,
      ) ||
        !positive(sourceChange.revision))) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(model)
  )
    protocol();
  let closed = false;
  async function checkBinding() {
    if (closed) lost();
    try {
      const current = await authority.readBinding();
      if (!current || !sameBinding(binding, current)) lost();
    } catch {
      return lost();
    }
  }
  await checkBinding();
  const context = await authority.readLaunchContext().catch(lost);
  if (
    context.registration.id !== binding.registrationId ||
    context.registration.revision !== binding.registrationRevision ||
    context.registration.accountId !== binding.accountId ||
    context.policy.revision !== binding.policyRevision
  )
    lost();
  const hostId = context.registration.hostId;
  const token = randomUUID();
  let row: Row;
  try {
    row = await db.transaction(async (tx) => {
      // Never call the renewing authority inside a DB transaction: its actual
      // heartbeat opens a transaction of its own. Only metadata reads/locks
      // occur here; live authority is checked on both sides of admission.
      const [task] = await tx
        .select({ owner: tasksTable.ownerAgentId })
        .from(tasksTable)
        .where(eq(tasksTable.id, binding.taskId));
      if (!task || task.owner !== agentId) return lost();
      // Lock the same source row as source check/apply/rollback admission.
      // The operator either observes this running session or wins the source
      // transition first and prevents this session from being admitted.
      const sourceRows = await tx
        .select({
          id: sourceChangesTable.id,
          revision: sourceChangesTable.revision,
          agentId: sourceChangesTable.agentId,
          state: sourceChangesTable.state,
        })
        .from(sourceChangesTable)
        .where(eq(sourceChangesTable.taskId, binding.taskId))
        .orderBy(sourceChangesTable.id)
        .limit(2)
        .for("update");
      if (
        sourceChange
          ? sourceRows.length !== 1 ||
            sourceRows[0].id !== sourceChange.id ||
            sourceRows[0].revision !== sourceChange.revision ||
            sourceRows[0].agentId !== agentId ||
            sourceRows[0].state !== "draft"
          : sourceRows.length !== 0
      )
        return lost();
      await tx
        .insert(sessions)
        .values({
          taskId: binding.taskId,
          agentId,
          revision: 1,
          state: "running",
          ownerToken: token,
          attemptId: binding.attemptId,
          leaseOwner: binding.leaseOwner,
          policyRevision: binding.policyRevision,
          registrationId: binding.registrationId,
          registrationRevision: binding.registrationRevision,
          admissionVersion: binding.admissionVersion,
          hostId,
          cwd: workspace,
          storageDirectory,
          home: path.join(storageDirectory, randomUUID()),
          model,
          executableDigest,
          sourceChangeId: sourceChange?.id ?? null,
          sourceChangeRevision: sourceChange?.revision ?? null,
        })
        .onConflictDoNothing();
      const [current] = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.taskId, binding.taskId))
        .for("update");
      if (!current) return lost();
      if (current.ownerToken === token) return current;
      if (current.state === "reset") {
        const [recovery] = await tx
          .select()
          .from(recoveries)
          .where(
            and(
              eq(recoveries.taskId, binding.taskId),
              eq(recoveries.expectedRevision, current.revision - 1),
              sql`${recoveries.response}->>'outcome' = 'accepted'`,
            ),
          )
          .limit(2);
        if (
          current.ownerToken !== null ||
          current.revision >= Number.MAX_SAFE_INTEGER ||
          !["verified", "not_launched"].includes(current.cleanupState) ||
          current.cleanupAt === null ||
          current.threadId !== null ||
          current.lastTurnId !== null ||
          current.totalTokens !== null ||
          !recovery ||
          recovery.response.outcome !== "accepted" ||
          recovery.snapshot?.home !== current.home ||
          recovery.snapshot?.revision !== current.revision - 1
        )
          return lost();
        const [fresh] = await tx
          .update(sessions)
          .set({
            state: "running",
            ownerToken: token,
            revision: current.revision + 1,
            agentId,
            attemptId: binding.attemptId,
            leaseOwner: binding.leaseOwner,
            policyRevision: binding.policyRevision,
            registrationId: binding.registrationId,
            registrationRevision: binding.registrationRevision,
            admissionVersion: binding.admissionVersion,
            hostId,
            cwd: workspace,
            storageDirectory,
            home: path.join(storageDirectory, randomUUID()),
            model,
            executableDigest,
            sourceChangeId: sourceChange?.id ?? null,
            sourceChangeRevision: sourceChange?.revision ?? null,
            cleanupState: "unknown",
            cleanupAt: null,
            threadId: null,
            lastTurnId: null,
            promptTokens: null,
            completionTokens: null,
            totalTokens: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(sessions.taskId, binding.taskId),
              eq(sessions.revision, current.revision),
            ),
          )
          .returning();
        return fresh ?? lost();
      }
      if (
        current.state !== "ready" ||
        current.sourceChangeId !== (sourceChange?.id ?? null) ||
        current.sourceChangeRevision !== (sourceChange?.revision ?? null) ||
        current.cleanupState !== "verified" ||
        current.ownerToken !== null ||
        current.agentId !== agentId ||
        current.cwd !== workspace ||
        current.storageDirectory !== storageDirectory ||
        current.model !== model ||
        current.hostId !== hostId ||
        current.executableDigest !== executableDigest ||
        current.policyRevision !== binding.policyRevision ||
        current.registrationId !== binding.registrationId ||
        current.registrationRevision > binding.registrationRevision ||
        current.admissionVersion !== binding.admissionVersion ||
        current.revision >= Number.MAX_SAFE_INTEGER ||
        !canonical(current.home) ||
        path.dirname(current.home) !== storageDirectory ||
        !/^[a-f0-9-]{36}$/u.test(path.basename(current.home))
      )
        return lost();
      const [claimed] = await tx
        .update(sessions)
        .set({
          state: "running",
          cleanupState: "unknown",
          cleanupAt: null,
          ownerToken: token,
          revision: current.revision + 1,
          attemptId: binding.attemptId,
          leaseOwner: binding.leaseOwner,
          registrationRevision: binding.registrationRevision,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sessions.taskId, binding.taskId),
            eq(sessions.revision, current.revision),
          ),
        )
        .returning();
      return claimed ?? lost();
    });
  } catch {
    return lost();
  }
  const fence = () =>
    and(
      eq(sessions.taskId, binding.taskId),
      eq(sessions.ownerToken, token),
      eq(sessions.revision, row.revision),
      eq(sessions.state, "running"),
    );
  const sameOwnerScope = (current: Row) =>
    (
      [
        "taskId",
        "agentId",
        "attemptId",
        "leaseOwner",
        "policyRevision",
        "registrationId",
        "registrationRevision",
        "admissionVersion",
        "hostId",
        "cwd",
        "storageDirectory",
        "home",
        "model",
        "executableDigest",
        "sourceChangeId",
        "sourceChangeRevision",
        "threadId",
        "lastTurnId",
        "promptTokens",
        "completionTokens",
        "totalTokens",
        "cleanupState",
      ] as const
    ).every((key) => current[key] === row[key]);
  async function uncertain(cleanupState: CodexCleanupState = "unknown") {
    if (!["unknown", "not_launched", "verified"].includes(cleanupState))
      protocol();
    if (closed) return;
    try {
      await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(sessions)
          .where(fence())
          .for("update");
        if (!current || !sameOwnerScope(current)) return lost();
        await tx
          .update(sessions)
          .set({
            state: "uncertain",
            cleanupState,
            cleanupAt: cleanupState === "unknown" ? null : new Date(),
            ownerToken: null,
            revision: row.revision + 1,
            updatedAt: new Date(),
          })
          .where(fence());
      });
      closed = true;
    } catch {
      return lost();
    }
  }
  try {
    await checkBinding();
  } catch {
    await uncertain();
    return lost();
  }
  async function assertCurrent(selected?: CodexTaskBinding) {
    if (selected && !sameBinding(binding, selected)) lost();
    await checkBinding();
    try {
      const [current] = await db.select().from(sessions).where(fence());
      if (!current || !sameOwnerScope(current)) lost();
    } catch {
      return lost();
    }
  }
  return Object.freeze({
    home: row.home,
    readRuntimeHome: async (
      scope: Parameters<OwnedCodexTaskSession["readRuntimeHome"]>[0],
    ) => {
      await assertCurrent();
      if (
        !sameBinding(binding, scope.binding) ||
        scope.workspace !== workspace ||
        scope.storageDirectory !== storageDirectory ||
        scope.model !== model ||
        scope.executableDigest !== executableDigest
      )
        lost();
      return row.home;
    },
    assertCurrent,
    readApprovalFence: async (selected: CodexTaskBinding) => {
      if (!selected || !sameBinding(binding, selected)) lost();
      await assertCurrent(selected);
      return Object.freeze({
        taskId: binding.taskId,
        agentId,
        revision: row.revision,
        ownerToken: token,
        attemptId: binding.attemptId,
        leaseOwner: binding.leaseOwner,
        policyRevision: binding.policyRevision,
        registrationId: binding.registrationId,
        registrationRevision: binding.registrationRevision,
        admissionVersion: binding.admissionVersion,
      });
    },
    readSession: async () => {
      await assertCurrent();
      return row.threadId
        ? {
            threadId: row.threadId,
            binding: { ...binding },
            cwd: workspace,
            usage: recordedUsage(row),
          }
        : null;
    },
    complete: async (result: Result) => {
      if (
        !result ||
        result.status !== "completed" ||
        result.proofScope !== "codex_turn" ||
        result.deliverableVerified !== false ||
        !identifier(result.threadId) ||
        !identifier(result.turnId) ||
        !result.session ||
        result.session.threadId !== result.threadId ||
        !sameBinding(binding, result.session.binding) ||
        result.session.cwd !== workspace ||
        !usage(result.session.usage) ||
        (row.threadId && result.threadId !== row.threadId) ||
        result.turnId === row.lastTurnId
      )
        protocol();
      // Capture primitives before any await. A caller cannot mutate the
      // already validated terminal identity/counters during the DB fence.
      const threadId = result.threadId,
        turnId = result.turnId;
      const before = recordedUsage(row),
        after = result.session.usage ? { ...result.session.usage } : null;
      if (
        before &&
        after &&
        (after.promptTokens < before.promptTokens ||
          after.completionTokens < before.completionTokens ||
          after.totalTokens < before.totalTokens)
      )
        protocol();
      await assertCurrent();
      try {
        const [saved] = await db.transaction(async (tx) => {
          const [current] = await tx
            .select()
            .from(sessions)
            .where(fence())
            .for("update");
          if (
            !current ||
            !sameOwnerScope(current) ||
            current.revision >= Number.MAX_SAFE_INTEGER
          )
            return lost();
          return tx
            .update(sessions)
            .set({
              state: "ready",
              cleanupState: "verified",
              cleanupAt: new Date(),
              ownerToken: null,
              revision: current.revision + 1,
              threadId,
              lastTurnId: turnId,
              promptTokens: after?.promptTokens ?? null,
              completionTokens: after?.completionTokens ?? null,
              totalTokens: after?.totalTokens ?? null,
              updatedAt: new Date(),
            })
            .where(fence())
            .returning();
        });
        if (!saved) lost();
        try {
          await checkBinding();
        } catch {
          // Do not overwrite a later legitimate claim while rejecting this
          // caller's late result. This check is not external-effect admission.
          await db
            .update(sessions)
            .set({
              state: "uncertain",
              revision: saved.revision + 1,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(sessions.taskId, binding.taskId),
                eq(sessions.revision, saved.revision),
                eq(sessions.state, "ready"),
              ),
            );
          return lost();
        }
        closed = true;
      } catch {
        return lost();
      }
    },
    uncertain,
  });
}

/** The production driver returns only after owned process cleanup. Persist
 * that terminal checkpoint here; failures become uncertain, never a replayable
 * successful session or proof that the application's task was delivered. */
export async function runCodexTaskInSession(
  session: OwnedCodexTaskSession,
  input: Parameters<typeof runCodexTask>[0],
  ports: CodexTaskPorts,
  lifecycle: {
    beforeCheckpoint?(result: Result): Promise<void>;
    checkpointTimeoutMs?: number;
  } = {},
): Promise<Result> {
  input = { ...input, binding: Object.freeze({ ...input.binding }) };
  const checkpointTimeout = lifecycle.checkpointTimeoutMs ?? 10_000;
  if (
    !Number.isSafeInteger(checkpointTimeout) ||
    checkpointTimeout < 20 ||
    checkpointTimeout > 30_000
  )
    throw new CodexTaskError("protocol");
  let result: Result | undefined;
  try {
    await session.assertCurrent(input.binding);
    const previous = await session.readSession();
    result = await runCodexTask(
      { ...input, resume: previous !== null },
      {
        ...ports,
        readBinding: async () => {
          await session.assertCurrent(input.binding);
          return ports.readBinding();
        },
        readSession: () => session.readSession(),
        prepare: async (binding) => {
          await session.assertCurrent(binding);
          const prepared = await ports.prepare(binding);
          if (
            !prepared.permissions ||
            path.dirname(prepared.permissions.configuration.file) !==
              session.home
          )
            throw new CodexTaskError("unsupported_capability");
          return prepared;
        },
      },
    );
    if (lifecycle.beforeCheckpoint) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          lifecycle.beforeCheckpoint(result),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new CodexTaskError("timeout")),
              checkpointTimeout,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    await session.complete(result);
    return result;
  } catch (error) {
    const cleanupState = result
      ? "verified"
      : error instanceof CodexTaskError
        ? error.cleanupState
        : "unknown";
    await session.uncertain(cleanupState).catch(() => {});
    if (error instanceof CodexTaskError)
      throw new CodexTaskError(
        error.kind,
        result?.usage ?? error.usage,
        result?.actionReceipts ?? error.actionReceipts,
        result !== undefined || error.requestStarted,
        cleanupState,
      );
    throw new CodexTaskError(
      "ownership_lost",
      result?.usage ?? null,
      result?.actionReceipts ?? [],
      result !== undefined,
      cleanupState,
    );
  }
}
