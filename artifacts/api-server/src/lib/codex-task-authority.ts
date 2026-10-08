import { and, eq } from "drizzle-orm";
import {
  db,
  agentsTable,
  tasksTable,
  taskAttemptsTable,
  runtimeInstancesTable,
  executionPolicyTable,
  runtimeControlsTable,
  codexActionApprovalsTable,
  approvalRequestsTable,
  codexTaskSessionsTable,
  sourceChangesTable,
} from "@workspace/db";
import { PlanInferenceError } from "@workspace/ai-server";
import type { ChatGPTRegistration } from "@workspace/ai-server/chatgpt-plan-types";
import { createChatGPTPlanAccountResolver } from "./chatgpt-plan-runtime";
import { CodexTaskError, type CodexTaskBinding } from "./codex-task-adapter";
import { policyAllowsTool } from "./execution-policy";
import { readRuntimeOperationsConfig } from "./runtime-operations-config";
import type { ToolRuntimeContext } from "./orchestrator/execute-tool";

type PlanRuntime = Parameters<typeof createChatGPTPlanAccountResolver>[0];
type Policy = typeof executionPolicyTable.$inferSelect;
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_:-]{1,160}$/u.test(value);
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export interface CodexTaskAuthority {
  readonly binding: Readonly<CodexTaskBinding>;
  /** The existing server-selected plan model, without the app namespace. */
  readonly model: string;
  /** Backend-only admitted source record; absent only in isolated test seams.
   * null binds ordinary tasks to the absence of a source-change workspace. */
  readonly sourceChange?: Readonly<{ id: string; revision: number }> | null;
  readBinding(): Promise<CodexTaskBinding | null>;
  /** Backend-only, immediately before prepare/launch. Never put this value in
   * tool output, a session map, a receipt, an argv or a browser response. */
  readLaunchContext(): Promise<{
    registration: ChatGPTRegistration;
    policy: Policy;
  }>;
}

/** Reuses the orchestrator's actual task claim and heartbeat. Account renewal
 * occurs once during admission; later checks are durable reads, never model
 * requests or implicit token/account replacement. Lost ownership is terminal.
 * This is a live fence, not a replacement for transactional effect admission. */
export async function createCodexTaskAuthority(
  context: ToolRuntimeContext,
  runtime: PlanRuntime,
  options: { now?: () => number; signal?: AbortSignal } = {},
): Promise<CodexTaskAuthority> {
  const operation = context.operationIdentity;
  const selectedModel = context.turnModelId;
  if (
    !positive(context.taskId) ||
    !positive(context.agent?.id) ||
    !identifier(context.runtimeAttemptId) ||
    !identifier(context.taskLeaseOwner) ||
    typeof context.assertTaskLease !== "function" ||
    context.transactionalExecutor ||
    operation?.executionKind !== "task_step" ||
    operation.originAttemptId !== context.runtimeAttemptId ||
    operation.agentLeaseOwner !== context.taskLeaseOwner ||
    !identifier(operation.runtimeInstanceId) ||
    !identifier(operation.logicalExecutionId) ||
    typeof selectedModel !== "string" ||
    !/^chatgpt:[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(selectedModel)
  )
    throw new CodexTaskError("unsupported_capability");

  // Capture primitives and the original heartbeat callback. A mutable tool
  // context cannot rebind an already running child to a different attempt.
  const taskId = context.taskId,
    agentId = context.agent.id;
  const attemptId = context.runtimeAttemptId,
    leaseOwner = context.taskLeaseOwner;
  const workerId = operation.runtimeInstanceId,
    logicalId = operation.logicalExecutionId;
  const assertLease = context.assertTaskLease;
  const now = options.now ?? Date.now,
    signal = options.signal;
  const { workerStaleAfterMs, taskLeaseMs } = readRuntimeOperationsConfig();
  let lost = false;
  let admittedBinding: Readonly<CodexTaskBinding> | undefined;
  let sourceCaptured = false;
  let admittedSourceChange: Readonly<{ id: string; revision: number }> | null =
    null;
  const fail = (): never => {
    lost = true;
    throw new CodexTaskError("ownership_lost");
  };
  function clock() {
    const current = now();
    if (
      !Number.isSafeInteger(current) ||
      current < 0 ||
      signal?.aborted ||
      lost
    )
      fail();
    return current;
  }
  async function readScope(expectedRevision?: number) {
    clock();
    const rows = await db
      .select({
        task: tasksTable,
        agent: agentsTable,
        attempt: taskAttemptsTable,
        worker: runtimeInstancesTable,
        policy: executionPolicyTable,
        controls: runtimeControlsTable,
        nativeApproval: codexActionApprovalsTable,
        approval: approvalRequestsTable,
        session: codexTaskSessionsTable,
        sourceChange: {
          id: sourceChangesTable.id,
          agentId: sourceChangesTable.agentId,
          state: sourceChangesTable.state,
          revision: sourceChangesTable.revision,
        },
      })
      .from(taskAttemptsTable)
      .innerJoin(tasksTable, eq(tasksTable.id, taskAttemptsTable.taskId))
      .innerJoin(agentsTable, eq(agentsTable.id, taskAttemptsTable.agentId))
      .innerJoin(
        runtimeInstancesTable,
        eq(runtimeInstancesTable.id, taskAttemptsTable.workerInstanceId),
      )
      .innerJoin(executionPolicyTable, eq(executionPolicyTable.id, 1))
      .innerJoin(runtimeControlsTable, eq(runtimeControlsTable.id, 1))
      // One SELECT snapshot binds awaiting status to its actual owned native
      // review. Separate reads can incorrectly stop a valid decision that
      // commits between the task snapshot and the approval lookup.
      .leftJoin(
        codexActionApprovalsTable,
        and(
          eq(codexActionApprovalsTable.taskId, tasksTable.id),
          eq(codexActionApprovalsTable.state, "awaiting"),
        ),
      )
      .leftJoin(
        approvalRequestsTable,
        eq(approvalRequestsTable.id, codexActionApprovalsTable.approvalId),
      )
      .leftJoin(
        codexTaskSessionsTable,
        eq(codexTaskSessionsTable.taskId, tasksTable.id),
      )
      .leftJoin(
        sourceChangesTable,
        eq(sourceChangesTable.taskId, tasksTable.id),
      )
      .where(
        and(
          eq(taskAttemptsTable.id, attemptId),
          eq(tasksTable.id, taskId),
          eq(agentsTable.id, agentId),
        ),
      )
      .limit(2);
    if (rows.length !== 1) fail();
    const row = rows[0],
      sourceChange = row.sourceChange;
    if (
      sourceChange &&
      (sourceChange.agentId !== agentId ||
        sourceChange.state !== "draft" ||
        !positive(sourceChange.revision))
    )
      fail();
    if (!sourceCaptured) {
      admittedSourceChange = sourceChange
        ? Object.freeze({
            id: sourceChange.id,
            revision: sourceChange.revision,
          })
        : null;
      sourceCaptured = true;
    } else if (
      (sourceChange?.id ?? null) !== (admittedSourceChange?.id ?? null) ||
      (sourceChange?.revision ?? null) !==
        (admittedSourceChange?.revision ?? null)
    )
      fail();
    const current = clock();
    const { task, agent, attempt, worker, policy, controls } = row;
    const review = row.nativeApproval,
      approval = row.approval,
      session = row.session,
      admitted = admittedBinding;
    const ownsNativeWait =
      admitted &&
      expectedRevision === admitted.policyRevision &&
      review &&
      approval &&
      session &&
      review.taskId === taskId &&
      review.agentId === agentId &&
      review.attemptId === attemptId &&
      review.leaseOwner === leaseOwner &&
      review.policyRevision === admitted.policyRevision &&
      review.registrationId === admitted.registrationId &&
      review.registrationRevision === admitted.registrationRevision &&
      review.admissionVersion === admitted.admissionVersion &&
      review.expiresAt.getTime() > current &&
      approval.taskId === taskId &&
      approval.agentId === agentId &&
      ["pending", "approved"].includes(approval.status) &&
      approval.consumedAt === null &&
      approval.actionPayload === null &&
      approval.scope?.argsHash === review.actionDigest &&
      approval.scope.toolName ===
        (review.effectType === "commandExecution"
          ? "codex_native_command"
          : "codex_native_patch") &&
      approval.expiresAt?.getTime() === review.expiresAt.getTime() &&
      session.state === "running" &&
      session.agentId === agentId &&
      session.ownerToken === review.sessionOwnerToken &&
      session.revision === review.sessionRevision &&
      session.attemptId === attemptId &&
      session.leaseOwner === leaseOwner &&
      session.policyRevision === review.policyRevision &&
      session.registrationId === review.registrationId &&
      session.registrationRevision === review.registrationRevision &&
      session.admissionVersion === review.admissionVersion;
    const fresh = (date: Date, limit: number) =>
      Number.isFinite(date.getTime()) &&
      date.getTime() > current - limit &&
      date.getTime() <= current + 5000;
    if (
      controls.emergencyStopEnabled ||
      task.ownerAgentId !== agentId ||
      task.lastModelId !== selectedModel ||
      task.lastModelProvider !== "chatgpt" ||
      (!["pending", "planning", "in_progress"].includes(task.status) &&
        !(task.status === "awaiting_approval" && ownsNativeWait)) ||
      task.leaseOwner !== leaseOwner ||
      !task.leaseExpiresAt ||
      task.leaseExpiresAt.getTime() <= current ||
      !agent.isActive ||
      agent.status !== "working" ||
      agent.currentTaskId !== taskId ||
      agent.runLeaseOwner !== leaseOwner ||
      !agent.runLeaseExpiresAt ||
      agent.runLeaseExpiresAt.getTime() <= current ||
      agent.permissions.canUseTerminal !== true ||
      attempt.leaseOwner !== leaseOwner ||
      attempt.workerInstanceId !== workerId ||
      attempt.logicalExecutionId !== logicalId ||
      !["claimed", "running"].includes(attempt.state) ||
      !fresh(attempt.lastHeartbeatAt, taskLeaseMs) ||
      worker.id !== workerId ||
      !["worker", "combined"].includes(worker.role) ||
      worker.state !== "healthy" ||
      !fresh(worker.lastHeartbeatAt, workerStaleAfterMs) ||
      !policyAllowsTool(policy, "vm_run_command") ||
      (expectedRevision !== undefined && policy.revision !== expectedRevision)
    )
      fail();
    return policy;
  }
  async function checkedScope(expectedRevision?: number) {
    // Check expiry BEFORE calling the renewing heartbeat: an expired claim
    // must not become eligible merely because this adapter asks to launch.
    try {
      const before = await readScope(expectedRevision);
      await assertLease("Codex task authority");
      return await readScope(expectedRevision ?? before.revision);
    } catch {
      return fail();
    }
  }
  const admittedPolicy = await checkedScope();
  const registration = await createChatGPTPlanAccountResolver(runtime, { now })(
    signal,
  );
  if (!registration) throw new PlanInferenceError("sign_in_required");
  await checkedScope(admittedPolicy.revision);
  const binding = Object.freeze({
    taskId,
    attemptId,
    leaseOwner,
    policyRevision: admittedPolicy.revision,
    registrationId: registration.id,
    registrationRevision: registration.revision,
    accountId: registration.accountId,
    admissionVersion: registration.planAdmissionVersion ?? 0,
  });
  admittedBinding = binding;
  const clientId = registration.clientId,
    subject = registration.subject,
    hostId = registration.hostId;
  const store = await runtime.store();
  async function checkedAccount() {
    const account = await store.readActiveRegistration();
    const current = clock();
    if (
      !account?.credentials ||
      account.id !== binding.registrationId ||
      account.revision !== binding.registrationRevision ||
      account.accountId !== binding.accountId ||
      account.clientId !== clientId ||
      account.subject !== subject ||
      account.hostId !== hostId ||
      (account.planAdmissionVersion ?? 0) !== binding.admissionVersion ||
      !Number.isFinite(account.credentials.expiresAt) ||
      account.credentials.expiresAt <= current ||
      !account.credentials.grants.includes("resource.invoke") ||
      !account.credentials.grants.includes("chatgpt.tokens.use.direct") ||
      (account.planPause &&
        (account.planPause.retryAt === null ||
          account.planPause.retryAt > current))
    )
      return fail();
    return account;
  }
  async function readLaunchContext() {
    try {
      await checkedAccount();
      const policy = await checkedScope(binding.policyRevision);
      // Recheck selection after the renewing lease transaction. Rotation is
      // refused for this child; only a newly admitted attempt gets new tokens.
      return { registration: await checkedAccount(), policy };
    } catch {
      return fail();
    }
  }
  await readLaunchContext();
  return Object.freeze({
    binding,
    model: selectedModel.slice("chatgpt:".length),
    sourceChange: admittedSourceChange,
    readBinding: async () => {
      try {
        await readLaunchContext();
        return binding;
      } catch {
        lost = true;
        return null;
      }
    },
    readLaunchContext,
  });
}
