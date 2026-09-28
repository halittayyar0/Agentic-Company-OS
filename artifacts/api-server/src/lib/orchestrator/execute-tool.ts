import { resolveLocalProgram } from "../capabilities/local-program";
import { hasLocalizedToolOutput, toolReceiptLocale } from "./tool-presentation";
import { withToolPolicy, ExecutionPolicyDenied } from "../execution-policy";
import { CAPABILITY_TOOL_NAMES, isCapabilityTool } from "../capabilities/names";
import {
  assertPackEnabled,
  discoverExtensions,
  executeInstalledTool,
  personalSkillGuides,
  readCapabilityPacks,
} from "../capabilities/extension-store";
import {
  capabilityResult,
  validCapabilityArgs,
} from "../capabilities/capability-tools";
import { getCapabilityCatalog } from "../capabilities/catalog";
import { getToolsForAgent } from "./tools";
import { validateTeamToolArgs } from "./team-tool-validation";
import {
  BrowserDiagnosticError,
  localizedBrowserDiagnostic,
} from "../vm/browser-diagnostics";
import { isTerminalTool } from "./tool-loop-policy";
import { getToolCopy, toolMessage } from "./tool-localization";
import { createHash, randomUUID } from "node:crypto";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  agentsTable,
  companyChannelMembersTable,
  companyChannelsTable,
  companyMessagesTable,
  tasksTable,
  activityEventsTable,
  approvalRequestsTable,
  operationReceiptsTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  type Agent,
  type ApprovalScope,
  type OperationReceipt,
  type Task,
} from "@workspace/db";
import { specialistPermissionsPreset } from "./permission-presets";
import { logger } from "../logger";
import type { RuntimeOperationsConfig } from "../runtime-operations-config";
import { auditCommandName, redactAuditText } from "../audit-redaction";
import {
  readWorkspaceLocale,
  isWorkspaceLocale,
  type WorkspaceLocale,
} from "../workspace-locale";
import { getTerminalCopy, terminalMessage } from "../vm/terminal-localization";
import type { TerminalMessageKey } from "../vm/terminal-copy";
import { LocalEmergencyStopError } from "./local-emergency-epoch";
import { isCanonicalRootCeo } from "./agent-authority";
import { avatarColorFor } from "./avatar-color";
import { runJudge, type JudgeReviewRecord, type JudgeVerdict } from "./judge";
import {
  VmError,
  localizedVmErrorMessage,
  deleteEntry,
  execAgentSudo,
  execInSandbox,
  execArgvInSandbox,
  getAgentSudoTarget,
  getSandboxWorkingDirectory,
  getVmStatus,
  isAgentSudoEnabled,
  listDirectory,
  readTextFile,
  safeResolve,
  validateAgentSudoCommand,
  writeTextFile,
  type AgentSudoTarget,
} from "../vm/sandbox";
import {
  clickRef,
  extractText,
  fillRef,
  getBrowserActionBinding,
  getExistingBrowserActionBinding,
  inspectBrowserSession,
  isBrowserActionOutcomeUnknownError,
  navigateTo,
  runWithAgentBrowserControl,
  saveScreenshotToSandbox,
  scrollPage,
  snapshotPage,
  waitForPage,
  type BrowserActionBinding,
} from "../vm/browser";
import {
  beginComputerStep,
  computerStepDetail,
  finishComputerStep,
  formatComputerStep,
  getComputerSessionSnapshot,
  type ComputerSurface,
  type ComputerStep,
} from "./computer-session";
import {
  assertExecutionAllowed,
  EmergencyStopError,
  lockAndAssertExecutionAllowed,
  lockRuntimeControlState,
} from "./runtime-emergency-stop";
import {
  assertActiveAgentCapacity,
  assertCompanyMessageCapacity,
  assertOutstandingApprovalCapacity,
  assertOutstandingTaskCapacity,
  RuntimeCapacityError,
} from "./runtime-capacity";
import {
  evaluateExclusiveToolCall,
  exclusiveToolBlockedMessage,
  type ExclusiveTurnPolicy,
} from "./exclusive-turn-policy";
import {
  TaskLeaseOwnershipLostError,
  type AttachedOperationInvocation,
  type TaskLeaseHeartbeatRuntime,
  type TaskLeaseTimer,
} from "./task-lease-heartbeat";
import {
  assertOperationInvocationActive,
  canonicalArgumentHash,
  canonicalizeJson,
  claimOperationInvocation,
  classifyToolSideEffect,
  completeOperation,
  ConfirmedAppliedReplayError,
  heartbeatOperationInvocation,
  invalidateApprovalBinding,
  isConfirmedAppliedReceipt,
  isConfirmedAppliedReplay,
  markOperationRunning,
  markOperationUnknown,
  OperationInvocationOwnershipLostError,
  OperationInvocationStateError,
  releaseOperationForSafeRetry,
  reserveOperation,
  runTransactionalOperation,
  type ApprovedBrowserBindingEvidence,
  type OperationExecutor,
} from "./operation-receipts";
import type { FileEffectHook } from "../vm/file-operation-lock";

export interface ToolRuntimeContext {
  agent: Agent;
  /** Captured once by the outer execution; presentation never enters capability hashes. */
  locale?: WorkspaceLocale;
  taskId: number | null;
  taskLeaseOwner?: string;
  /** Exact durable attempt identity; only Task 3 registry claims can mint it. */
  runtimeAttemptId?: string;
  /**
   * Durable Task 4 ownership assertion supplied by the outer task attempt.
   * Task-backed judge retries fail closed when this seam is unavailable.
   */
  assertTaskLease?: (action?: string) => Promise<void>;
  /** Unique to one outer model loop; prevents stale cross-run verification. */
  computerLoopId?: string;
  /** Effective chat-turn model, used only to preserve an explicit free spend boundary. */
  turnModelId?: string;
  /** Server-derived, per-chat-turn allowlist for explicit only/sadece requests. */
  exclusiveTurnPolicy?: ExclusiveTurnPolicy;
  /** Server-owned logical/physical identity for durable operation receipts. */
  operationIdentity?: {
    executionKind: "task_step" | "approved_action" | "chat_turn";
    logicalExecutionId: string;
    runtimeInstanceId: string | null;
    originAttemptId: string | null;
    sourceMessageId: number | null;
    modelToolCallId: string | null;
    callSlot: string;
    agentLeaseOwner: string;
  };
  attachOperationInvocation?: (input: AttachedOperationInvocation) => void;
  detachOperationInvocation?: (invocationId: string) => void;
  /** Server-owned initial invocation lease; periodic heartbeats renew it. */
  operationInvocationLeaseMs?: number;
  /** Test/coordination seam immediately before the durable effect boundary. */
  beforeOperationEffectBoundary?: () => Promise<void>;
  /** Internal normalized-handler seam used to keep domain writes in the receipt transaction. */
  transactionalExecutor?: ToolTransaction;
  preapprovedAction?: {
    approvalId: number;
    automaticPolicyRevision?: number;
    toolName: string;
    argsHash: string;
    capabilityArgs?: Record<string, unknown>;
    leaseOwner: string;
    category: BusinessApprovalCategory;
    taskDisposition?: "resume" | "complete";
    browserBinding?: ApprovedBrowserBindingEvidence | null;
  };
}

export interface ToolExecutionResult {
  content: string;
  createdTasks: Task[];
  createdAgents: Agent[];
  /** Machine-readable execution truth; never infer success from prose. */
  toolOutcome:
    "succeeded" | "rejected" | "deferred" | "outcome_unknown" | "unknown";
  /** Durable logical receipt that owns an unknown or replayed outcome. */
  receiptId?: string;
  /** Present only after a task lifecycle mutation was durably persisted. */
  taskLifecycleEffect?: "completed" | "suspended";
  /** Prepared lifecycle data; only stepTask may atomically persist it. */
  durableTaskLifecycleIntent?: DurableTaskLifecycleIntent;
  /** Allowlisted receipt evidence; never exposed as raw tool output. */
  operationResultData?: Record<string, unknown> | null;
  sudoOutcome?: {
    ok: boolean;
    exitCode: number | null;
    durationMs: number;
    argsHash: string;
    stdoutPreview: string;
    stderrPreview: string;
    outputTruncated: boolean;
  };
}

export interface DurableLifecycleOperationFinalization {
  receiptId: string;
  invocationId: string;
  leaseOwner: string;
}

export type DurableTaskLifecycleIntent =
  | {
      kind: "complete";
      resultSummary: string;
      continuous: boolean;
      cycleCompletedAt: Date;
      nextRunAt: Date | null;
      judgeVerdict: JudgeVerdict;
      /** Internal endurance-only lifecycle seam; never accepted from model args. */
      allowActiveContinuousChildren?: true;
      operationFinalization?: DurableLifecycleOperationFinalization;
    }
  | {
      kind: "approval";
      category: BusinessApprovalCategory;
      title: string;
      description: string;
      amountUsd: string | null;
      scope: ApprovalScope | null;
      actionPayload: {
        toolName: string;
        args: Record<string, unknown>;
        taskDisposition: "resume";
      } | null;
      browserBinding: ApprovedBrowserBindingEvidence | null;
      expiresAt: Date | null;
      judgeVerdict: JudgeVerdict;
      judgeReasoning: string;
      isSudoApproval: boolean;
      operationFinalization?: DurableLifecycleOperationFinalization;
    }
  | {
      kind: "user_input";
      question: string;
      operationFinalization?: DurableLifecycleOperationFinalization;
    };

type ToolTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function empty(
  content: string,
  toolOutcome: ToolExecutionResult["toolOutcome"] = /^(?:Hata|ENGELLENDI):/iu.test(
    content.trim(),
  ) ||
  /^\[COMPUTER STEP[^\n]*\| (?:FAILED|BLOCKED)(?:\s|\||\])/u.test(
    content.trim(),
  )
    ? "rejected"
    : "succeeded",
): ToolExecutionResult {
  return { content, createdTasks: [], createdAgents: [], toolOutcome };
}

export function resolveJudgeExecutionModelBoundary(input: {
  taskExecutionModelId?: string | null;
  turnModelId?: string | null;
  agentModelMode: Agent["modelMode"];
  agentModelId?: string | null;
}): string | null {
  const taskModelId = input.taskExecutionModelId?.trim();
  if (taskModelId) return taskModelId;

  const turnModelId = input.turnModelId?.trim();
  if (turnModelId && /:free$/iu.test(turnModelId)) return turnModelId;

  const agentModelId = input.agentModelId?.trim();
  if (
    input.agentModelMode === "manual" &&
    agentModelId &&
    /:free$/iu.test(agentModelId)
  ) {
    return agentModelId;
  }

  return null;
}

const APPROVAL_EXECUTABLE_TOOLS = new Set([
  "vm_run_command",
  "vm_run_sudo_command",
  "browser_click",
  "browser_type",
]);
const ACTIVE_TASK_STATUSES = ["pending", "planning", "in_progress"];
// Approved sudo execution may run for 120 seconds. Keep the task, agent, and
// physical invocation authority alive for that whole window plus a bounded
// finalization margin; approved-action workers do not own the task-step
// heartbeat manager.
const DEFAULT_OPERATION_INVOCATION_LEASE_MS = 60_000;
const APPROVED_OUTPUT_MAX_LINES = 12;
const APPROVED_STDOUT_MAX_BYTES = 1_536;
const APPROVED_STDERR_MAX_BYTES = 512;
export async function heartbeatJudgeTaskLease(
  ctx: ToolRuntimeContext,
): Promise<void> {
  if (!ctx.taskId || !ctx.taskLeaseOwner) {
    throw new Error("Judge task lease context is missing");
  }
  if (!ctx.assertTaskLease) {
    throw new Error("Durable task lease heartbeat callback is missing");
  }
  await ctx.assertTaskLease(getToolCopy(ctx.locale ?? "tr").judgeRunning);
}

function isDurableTaskContext(
  ctx: ToolRuntimeContext,
): ctx is ToolRuntimeContext & {
  taskId: number;
  taskLeaseOwner: string;
  runtimeAttemptId: string;
  assertTaskLease: (action?: string) => Promise<void>;
} {
  return Boolean(
    ctx.taskId &&
    ctx.taskLeaseOwner &&
    ctx.runtimeAttemptId &&
    ctx.assertTaskLease,
  );
}

async function assertDurableTaskBoundary(
  ctx: ToolRuntimeContext,
  action?: string,
): Promise<void> {
  if (!ctx.taskId) return;
  if (ctx.preapprovedAction) {
    await withPreapprovedActionFence(
      ctx as ToolRuntimeContext & {
        taskId: number;
        preapprovedAction: NonNullable<ToolRuntimeContext["preapprovedAction"]>;
      },
      async () => undefined,
    );
    return;
  }
  if (!isDurableTaskContext(ctx)) {
    throw new TaskLeaseOwnershipLostError(
      "Task-backed tool execution is missing the exact durable attempt fence",
    );
  }
  await ctx.assertTaskLease(action);
}

async function withPreapprovedActionFence<T>(
  ctx: ToolRuntimeContext & {
    taskId: number;
    preapprovedAction: NonNullable<ToolRuntimeContext["preapprovedAction"]>;
  },
  callback: (tx: ToolTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await lockAndAssertExecutionAllowed(tx);
    await tx.execute(
      sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${ctx.agent.id} FOR UPDATE`,
    );
    await tx.execute(
      sql`SELECT id FROM ${approvalRequestsTable} WHERE ${approvalRequestsTable.id} = ${ctx.preapprovedAction.approvalId} FOR UPDATE`,
    );
    await tx.execute(
      sql`SELECT id FROM ${tasksTable} WHERE ${tasksTable.id} = ${ctx.taskId} FOR UPDATE`,
    );
    const [agent] = await tx
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(
        and(
          eq(agentsTable.id, ctx.agent.id),
          eq(agentsTable.isActive, true),
          eq(agentsTable.runLeaseOwner, ctx.preapprovedAction.leaseOwner),
        ),
      );
    const [approval] = await tx
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, ctx.preapprovedAction.approvalId));
    const [task] = await tx
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.id, ctx.taskId),
          eq(tasksTable.ownerAgentId, ctx.agent.id),
          eq(tasksTable.status, "awaiting_approval"),
          eq(tasksTable.leaseOwner, ctx.preapprovedAction.leaseOwner),
        ),
      );
    const livePayload = approval?.actionPayload;
    const exactUnconsumedCapability = Boolean(
      approval &&
      approval.consumedAt === null &&
      approval.bindingInvalidatedAt === null &&
      approval.expiresAt &&
      approval.expiresAt.getTime() > Date.now() &&
      livePayload?.toolName === ctx.preapprovedAction.toolName &&
      hashToolArgs(livePayload.args) === ctx.preapprovedAction.argsHash,
    );
    const exactConsumedCapability = Boolean(
      approval &&
      approval.consumedAt !== null &&
      approval.bindingInvalidatedAt === null &&
      approval.actionPayload === null,
    );
    const approvalMatches = Boolean(
      approval &&
      approval.taskId === ctx.taskId &&
      approval.agentId === ctx.agent.id &&
      approval.status === "approved" &&
      approval.category === ctx.preapprovedAction.category &&
      approval.scope?.toolName === ctx.preapprovedAction.toolName &&
      approval.scope.argsHash === ctx.preapprovedAction.argsHash &&
      (exactUnconsumedCapability || exactConsumedCapability),
    );
    if (!agent || !approvalMatches || !task) {
      throw new TaskLeaseOwnershipLostError();
    }
    return callback(tx);
  });
}

async function withTaskMutationFence<T>(
  ctx: ToolRuntimeContext,
  callback: (tx: ToolTransaction) => Promise<T>,
  options: { additionalAgentIds?: readonly number[] } = {},
): Promise<T> {
  if (ctx.taskId && ctx.preapprovedAction) {
    return withPreapprovedActionFence(
      ctx as ToolRuntimeContext & {
        taskId: number;
        preapprovedAction: NonNullable<ToolRuntimeContext["preapprovedAction"]>;
      },
      callback,
    );
  }
  if (ctx.taskId && !ctx.preapprovedAction) {
    // The normalized transactional wrapper already holds the canonical
    // runtime/agent/task/attempt/receipt locks. Calling the heartbeat callback
    // here would open a second transaction that waits on those same rows while
    // the outer transaction waits for it (a PostgreSQL self-deadlock). The
    // locked live-row checks below are the authoritative inner fence.
    if (!ctx.transactionalExecutor) await assertDurableTaskBoundary(ctx);
    if (!isDurableTaskContext(ctx)) throw new TaskLeaseOwnershipLostError();
    const mutate = async (tx: ToolTransaction): Promise<T> => {
      await lockAndAssertExecutionAllowed(tx);
      const agentIds = [
        ...new Set([ctx.agent.id, ...(options.additionalAgentIds ?? [])]),
      ].sort((left, right) => left - right);
      for (const agentId of agentIds) {
        await tx.execute(
          sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${agentId} FOR UPDATE`,
        );
      }
      await tx.execute(
        sql`SELECT id FROM ${tasksTable} WHERE ${tasksTable.id} = ${ctx.taskId} FOR UPDATE`,
      );
      await tx.execute(
        sql`SELECT id FROM ${taskAttemptsTable} WHERE ${taskAttemptsTable.id} = ${ctx.runtimeAttemptId} FOR UPDATE`,
      );
      const [agent] = await tx
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(
          and(
            eq(agentsTable.id, ctx.agent.id),
            eq(agentsTable.isActive, true),
            eq(agentsTable.runLeaseOwner, ctx.taskLeaseOwner),
          ),
        );
      const [task] = await tx
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.id, ctx.taskId),
            eq(tasksTable.ownerAgentId, ctx.agent.id),
            eq(tasksTable.leaseOwner, ctx.taskLeaseOwner),
            inArray(tasksTable.status, ACTIVE_TASK_STATUSES),
          ),
        );
      const [attempt] = await tx
        .select({ id: taskAttemptsTable.id })
        .from(taskAttemptsTable)
        .where(
          and(
            eq(taskAttemptsTable.id, ctx.runtimeAttemptId),
            eq(taskAttemptsTable.taskId, ctx.taskId),
            eq(taskAttemptsTable.agentId, ctx.agent.id),
            eq(taskAttemptsTable.leaseOwner, ctx.taskLeaseOwner),
            inArray(taskAttemptsTable.state, ["claimed", "running"]),
          ),
        );
      if (!agent || !task || !attempt) throw new TaskLeaseOwnershipLostError();
      return callback(tx);
    };
    return ctx.transactionalExecutor
      ? mutate(ctx.transactionalExecutor)
      : db.transaction(mutate);
  }
  const mutate = async (tx: ToolTransaction): Promise<T> => {
    await lockAndAssertExecutionAllowed(tx);
    return callback(tx);
  };
  return ctx.transactionalExecutor
    ? mutate(ctx.transactionalExecutor)
    : db.transaction(mutate);
}

function persistJudgeReview(
  ctx: ToolRuntimeContext,
): ((review: JudgeReviewRecord) => Promise<void>) | undefined {
  if (!ctx.taskId || ctx.preapprovedAction) return undefined;
  return async (review) => {
    await withTaskMutationFence(ctx, async (tx) => {
      await tx.insert(activityEventsTable).values(review);
    });
  };
}

interface ApprovedOutputPreview {
  value: string;
  truncated: boolean;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength <= maxBytes) return value;
  return encoded
    .subarray(0, maxBytes)
    .toString("utf8")
    .replace(/\uFFFD$/u, "");
}

function approvedOutputPreview(
  value: string,
  maxBytes: number,
): ApprovedOutputPreview {
  const lines = value.split(/\r?\n/);
  const lineBounded = lines.slice(0, APPROVED_OUTPUT_MAX_LINES).join("\n");
  // execAgentSudo already applies its environment-aware redactor. Apply the
  // shared audit redactor again at the persistence boundary and then enforce
  // a UTF-8 byte cap (not merely a JavaScript character cap).
  const redacted = redactAuditText(lineBounded, maxBytes * 4);
  const bounded = truncateUtf8(redacted, maxBytes);
  return {
    value: bounded,
    truncated: lines.length > APPROVED_OUTPUT_MAX_LINES || bounded !== redacted,
  };
}

function transientApprovedActionOutput(
  toolName: string | undefined,
  result: ToolExecutionResult,
  summary: string,
): string {
  if (toolName !== "vm_run_sudo_command") return result.content;
  const preview =
    result.sudoOutcome?.stdoutPreview ||
    result.sudoOutcome?.stderrPreview ||
    "";
  return preview ? redactAuditText(`${summary}\n${preview}`, 2_000) : summary;
}

class ApprovedActionClaimConflict extends Error {}

type BusinessApprovalCategory =
  "spend" | "delete" | "publish" | "external_contact" | "other";

function agentAllowsApprovalCategory(agent: Agent, category: string): boolean {
  switch (category as BusinessApprovalCategory) {
    case "spend":
      return agent.permissions.canSpend;
    case "delete":
      return agent.permissions.canDelete;
    case "publish":
      return agent.permissions.canPublish;
    case "external_contact":
      return agent.permissions.canContactExternal;
    case "other":
      return true;
    default:
      return false;
  }
}

function requiredApprovalCategoryForAction(
  toolName: string,
  args: Record<string, unknown>,
): BusinessApprovalCategory | null {
  if (toolName === "browser_click" || toolName === "browser_type") {
    return "external_contact";
  }
  if (
    toolName === "vm_run_command" &&
    ["rm", "del"].includes(
      auditCommandName(String(args.command ?? "")).toLowerCase(),
    )
  ) {
    return "delete";
  }
  if (
    toolName === "vm_run_command" &&
    /^extension(?:\s|$)/i.test(String(args.command ?? ""))
  )
    return "other";
  if (toolName === "vm_run_sudo_command") return "other";
  return null;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function hashToolArgs(args: Record<string, unknown>): string {
  return canonicalArgumentHash(args);
}

function approvedBrowserBindingHash(input: {
  runtimeInstanceId: string;
  sessionId: string;
  sessionEpoch: number;
  snapshotMarker: string;
  toolName: "browser_click" | "browser_type";
  argsHash: string;
}): string {
  const digest = createHash("sha256")
    .update(canonicalizeJson(input), "utf8")
    .digest("hex");
  return `sha256:${digest}`;
}

function liveBrowserBindingMatchesApproval(
  ctx: ToolRuntimeContext,
  toolName: "browser_click" | "browser_type",
  liveBinding: BrowserActionBinding,
  scopedArgs: Record<string, unknown>,
): boolean {
  const evidence = ctx.preapprovedAction?.browserBinding;
  const runtimeInstanceId = ctx.operationIdentity?.runtimeInstanceId;
  const argsHash = hashToolArgs(scopedArgs);
  return Boolean(
    evidence &&
    runtimeInstanceId &&
    ctx.preapprovedAction?.argsHash === argsHash &&
    evidence.runtimeInstanceId === runtimeInstanceId &&
    evidence.sessionId === liveBinding.sessionId &&
    evidence.sessionEpoch === liveBinding.sessionEpoch &&
    evidence.snapshotMarker === liveBinding.snapshotMarker &&
    evidence.bindingHash ===
      approvedBrowserBindingHash({
        runtimeInstanceId,
        sessionId: liveBinding.sessionId,
        sessionEpoch: liveBinding.sessionEpoch,
        snapshotMarker: liveBinding.snapshotMarker,
        toolName,
        argsHash,
      }),
  );
}

async function invalidateUnavailableApprovedBrowser(
  ctx: ToolRuntimeContext,
  reason: string,
): Promise<void> {
  const approvalId = ctx.preapprovedAction?.approvalId;
  const evidence = ctx.preapprovedAction?.browserBinding;
  if (!approvalId || !evidence) return;
  await invalidateApprovalBinding({
    locale: ctx.locale,
    approvalId,
    expectedRuntimeInstanceId: evidence.runtimeInstanceId,
    expectedBindingHash: evidence.bindingHash,
    reason,
    now: new Date(),
  });
}

async function resolveApprovedBrowserPreflight(
  ctx: ToolRuntimeContext,
  toolName: "browser_click" | "browser_type",
  ref: number,
  args: Record<string, unknown>,
): Promise<{
  binding: BrowserActionBinding;
  scopedArgs: Record<string, unknown>;
} | null> {
  const binding = await getExistingBrowserActionBinding(ctx.agent.id, ref);
  const scopedArgs = binding
    ? {
        ...args,
        ref,
        ...(toolName === "browser_type"
          ? { text: String(args.text ?? ""), submit: false }
          : {}),
        __browserContext: binding,
      }
    : null;
  if (
    !binding ||
    (toolName === "browser_type" && binding.sensitive) ||
    !scopedArgs ||
    !liveBrowserBindingMatchesApproval(ctx, toolName, binding, scopedArgs)
  ) {
    await invalidateUnavailableApprovedBrowser(
      ctx,
      "binding_unavailable_or_changed/reapproval_required",
    );
    return null;
  }
  return { binding, scopedArgs };
}

export interface DurableExternalEffectResult {
  result: ToolExecutionResult;
  resultData?: Record<string, unknown> | null;
}

export interface DurableExternalEffectInput {
  toolName: string;
  normalizedArgs: Record<string, unknown>;
  browserBinding?: ApprovedBrowserBindingEvidence | null;
  execute: (boundary: {
    startEffect: FileEffectHook;
    executionLocale?: WorkspaceLocale;
  }) => Promise<DurableExternalEffectResult>;
  onError: (error: unknown) => Promise<ToolExecutionResult>;
}

interface DurableExternalEffectDependencies {
  completeOperation?: typeof completeOperation;
  markOperationUnknown?: typeof markOperationUnknown;
  releaseOperationForSafeRetry?: typeof releaseOperationForSafeRetry;
}

function durableEffectExternalKey(
  ctx: ToolRuntimeContext,
  toolName: string,
  normalizedArgs: Record<string, unknown>,
): string | null {
  const classification = classifyToolSideEffect({
    toolName,
    preapprovedAction: Boolean(ctx.preapprovedAction),
    approvalBound: ctx.operationIdentity?.executionKind === "approved_action",
  });
  // Retain the old screenshot deduplication key across its retry-policy
  // correction. A retained identity never grants permission to recapture.
  if (
    classification !== "idempotent" &&
    !(
      toolName === "browser_save_screenshot" &&
      classification === "at_most_once"
    )
  )
    return null;
  const digest = createHash("sha256")
    .update(
      canonicalizeJson({
        logicalExecutionId: ctx.operationIdentity?.logicalExecutionId ?? null,
        toolName,
        args: normalizedArgs,
      }),
      "utf8",
    )
    .digest("hex");
  return `effect:v1:${digest}`;
}

function sharedToolText(
  ctx: ToolRuntimeContext,
  toolName: string,
  key: TerminalMessageKey,
  _legacy: string,
  params: Readonly<Record<string, string | number>> = {},
): string {
  if (key === "emergencyBlocked" && !isTerminalTool(toolName))
    return getToolCopy(ctx.locale ?? "tr").emergencyBlocked;
  return terminalMessage(ctx.locale ?? "tr", key, params);
}

function replayedEffectResult(
  ctx: ToolRuntimeContext,
  toolName: string,
  receiptId: string,
  resultData: Record<string, unknown> | null,
): ToolExecutionResult {
  const rejected = resultData?.ok === false;
  const safeEvidence = resultData
    ? sharedToolText(
        ctx,
        toolName,
        "safeEvidence",
        ` Güvenli kanıt: ${canonicalizeJson(resultData)}.`,
        { data: canonicalizeJson(resultData) },
      )
    : "";
  return {
    ...empty(
      sharedToolText(
        ctx,
        toolName,
        "replayComplete",
        `İşlem daha önce tamamlandı; dış etki yeniden çalıştırılmadı.${safeEvidence}`,
        { evidence: safeEvidence },
      ),
      rejected ? "rejected" : "succeeded",
    ),
    receiptId,
  };
}

async function durableEffectErrorResult(
  ctx: ToolRuntimeContext,
  input: DurableExternalEffectInput,
  error: unknown,
  toolOutcome: ToolExecutionResult["toolOutcome"],
  receiptId: string,
): Promise<ToolExecutionResult> {
  try {
    const result = await input.onError(error);
    return { ...result, toolOutcome, receiptId };
  } catch (loggingError) {
    logger.error(
      { error: loggingError, receiptId, toolName: input.toolName },
      "Durable effect error telemetry could not be persisted",
    );
    return {
      ...empty(
        sharedToolText(
          ctx,
          input.toolName,
          "effectFailure",
          "İşlem güvenli biçimde tamamlanamadı; ham hata veya çıktı kaydedilmedi.",
        ),
        toolOutcome,
      ),
      receiptId,
    };
  }
}

export async function runDurableExternalEffect(
  ctx: ToolRuntimeContext,
  input: DurableExternalEffectInput,
  dependencies: DurableExternalEffectDependencies = {},
): Promise<ToolExecutionResult> {
  const executionLocale = hasLocalizedToolOutput(input.toolName)
    ? (ctx.locale ?? "tr")
    : undefined;
  if (hasLocalizedToolOutput(input.toolName)) {
    getToolCopy(ctx.locale ?? "tr");
    ctx = { ...ctx, locale: ctx.locale ?? "tr" };
  }
  const completeDurableOperation =
    dependencies.completeOperation ?? completeOperation;
  const markDurableOperationUnknown =
    dependencies.markOperationUnknown ?? markOperationUnknown;
  const releaseDurableOperationForSafeRetry =
    dependencies.releaseOperationForSafeRetry ?? releaseOperationForSafeRetry;
  const identity = ctx.operationIdentity;
  // Compatibility path for direct internal/test callers. Production task and
  // chat composition always supplies a server-owned operation identity; the
  // approved-action worker path is migrated to the same contract separately.
  if (!identity) {
    return (
      await input.execute({
        startEffect: async () => undefined,
        executionLocale: ctx.locale,
      })
    ).result;
  }

  const sideEffectClass = classifyToolSideEffect({
    toolName: input.toolName,
    preapprovedAction: Boolean(ctx.preapprovedAction),
    approvalBound: identity.executionKind === "approved_action",
  });
  if (sideEffectClass === "transactional" || sideEffectClass === "read_only") {
    throw new TypeError(
      `runDurableExternalEffect cannot execute ${sideEffectClass} tool ${input.toolName}.`,
    );
  }
  const receiptArgs =
    identity.executionKind === "approved_action"
      ? ctx.preapprovedAction?.capabilityArgs
      : input.normalizedArgs;
  if (!receiptArgs) {
    throw new TypeError(
      "Approved operation execution requires server-held capability arguments.",
    );
  }
  const now = new Date();
  const reservation = await reserveOperation({
    executionLocale,
    canonicalVersion: 1,
    executionKind: identity.executionKind,
    logicalExecutionId: identity.logicalExecutionId,
    toolName: input.toolName,
    args: receiptArgs,
    physical: {
      attemptId:
        identity.executionKind === "task_step"
          ? identity.originAttemptId
          : null,
      workerInstanceId: identity.runtimeInstanceId,
      modelToolCallId: identity.modelToolCallId,
      callSlot: identity.callSlot,
    },
    taskId: ctx.taskId,
    agentId: ctx.agent.id,
    approvalId:
      identity.executionKind === "approved_action"
        ? (ctx.preapprovedAction?.approvalId ?? null)
        : null,
    sourceMessageId:
      identity.executionKind === "chat_turn" ? identity.sourceMessageId : null,
    originAttemptId:
      identity.executionKind === "task_step" ? identity.originAttemptId : null,
    sideEffectClass,
    externalIdempotencyKey: durableEffectExternalKey(
      ctx,
      input.toolName,
      receiptArgs,
    ),
    now,
  });
  if (
    reservation.receipt.state === "succeeded" ||
    isConfirmedAppliedReplay(reservation)
  ) {
    return replayedEffectResult(
      ctx,
      input.toolName,
      reservation.receipt.id,
      reservation.receipt.resultData,
    );
  }
  if (reservation.receipt.state === "unknown") {
    return {
      ...empty(
        sharedToolText(
          ctx,
          input.toolName,
          "receiptUnknown",
          `İşlem sonucu belirsiz; otomatik tekrar engellendi. Receipt: ${reservation.receipt.id}.`,
          { id: reservation.receipt.id },
        ),
        "unknown",
      ),
      receiptId: reservation.receipt.id,
    };
  }
  if (reservation.receipt.state === "failed") {
    return {
      ...empty(
        sharedToolText(
          ctx,
          input.toolName,
          "receiptFailed",
          `İşlem kalıcı olarak başarısız kapatıldı. Receipt: ${reservation.receipt.id}.`,
          { id: reservation.receipt.id },
        ),
        "rejected",
      ),
      receiptId: reservation.receipt.id,
    };
  }

  const savedLocale = toolReceiptLocale(reservation.receipt);
  if (savedLocale) {
    ctx = { ...ctx, locale: savedLocale };
  }
  const invocationLeaseOwner = `operation:${reservation.receipt.id}:${randomUUID()}`;
  const claimed = await claimOperationInvocation({
    receiptId: reservation.receipt.id,
    executionKind: identity.executionKind,
    attemptId:
      identity.executionKind === "task_step" ? identity.originAttemptId : null,
    workerInstanceId: identity.runtimeInstanceId,
    modelToolCallId: identity.modelToolCallId,
    leaseOwner: invocationLeaseOwner,
    leaseExpiresAt: new Date(
      now.getTime() +
        Math.max(
          1,
          Math.floor(
            ctx.operationInvocationLeaseMs ??
              DEFAULT_OPERATION_INVOCATION_LEASE_MS,
          ),
        ),
    ),
    taskLeaseOwner:
      identity.executionKind === "task_step"
        ? (ctx.taskLeaseOwner ?? null)
        : null,
    agentLeaseOwner: identity.agentLeaseOwner,
    browserBinding: input.browserBinding,
    now,
  });
  if (!claimed.claimed || !claimed.invocation) {
    if (
      claimed.receipt.state === "succeeded" ||
      isConfirmedAppliedReceipt(claimed.receipt)
    ) {
      return replayedEffectResult(
        ctx,
        input.toolName,
        claimed.receipt.id,
        claimed.receipt.resultData,
      );
    }
    if (claimed.receipt.state === "unknown") {
      return {
        ...empty(
          sharedToolText(
            ctx,
            input.toolName,
            "receiptUnknown",
            `İşlem sonucu belirsiz; otomatik tekrar engellendi. Receipt: ${claimed.receipt.id}.`,
            { id: claimed.receipt.id },
          ),
          "unknown",
        ),
        receiptId: claimed.receipt.id,
      };
    }
    return {
      ...empty(
        sharedToolText(
          ctx,
          input.toolName,
          "receiptBusy",
          `Aynı mantıksal işlem başka bir worker tarafından yürütülüyor. Receipt: ${claimed.receipt.id}.`,
          { id: claimed.receipt.id },
        ),
        "deferred",
      ),
      receiptId: claimed.receipt.id,
    };
  }
  const invocation = claimed.invocation;

  if (identity.runtimeInstanceId && ctx.attachOperationInvocation) {
    ctx.attachOperationInvocation({
      receiptId: claimed.receipt.id,
      invocationId: invocation.id,
      leaseOwner: invocationLeaseOwner,
      workerInstanceId: identity.runtimeInstanceId,
    });
  }
  let crossedEffectBoundary = false;
  let startRequested = false;
  const startEffect: FileEffectHook = async (): Promise<void> => {
    if (startRequested) {
      throw new Error("Durable effect boundary can only be crossed once.");
    }
    startRequested = true;
    await ctx.beforeOperationEffectBoundary?.();
    await markOperationRunning({
      receiptId: claimed.receipt.id,
      invocationId: invocation.id,
      leaseOwner: invocationLeaseOwner,
      browserBinding: input.browserBinding,
      now: new Date(),
    });
    crossedEffectBoundary = true;
  };
  startEffect.revalidate = async (tx) => {
    await assertOperationInvocationActive(
      {
        receiptId: claimed.receipt.id,
        invocationId: invocation.id,
        leaseOwner: invocationLeaseOwner,
        browserBinding: input.browserBinding,
        now: new Date(),
      },
      tx,
    );
  };
  try {
    const executed = await input.execute({
      startEffect,
      executionLocale: ctx.locale,
    });
    if (!crossedEffectBoundary) {
      const released = await releaseDurableOperationForSafeRetry({
        receiptId: claimed.receipt.id,
        invocationId: invocation.id,
        leaseOwner: invocationLeaseOwner,
        failureKind: "effect_not_started",
        sanitizedError:
          "The normalized handler returned before crossing the external effect boundary.",
        now: new Date(),
      });
      return { ...executed.result, receiptId: released.id };
    }
    if (
      executed.result.toolOutcome === "unknown" ||
      executed.result.toolOutcome === "outcome_unknown"
    ) {
      const unknown = await markDurableOperationUnknown({
        receiptId: claimed.receipt.id,
        invocationId: invocation.id,
        leaseOwner: invocationLeaseOwner,
        browserBinding: input.browserBinding,
        failureKind: "effect_outcome_unknown",
        sanitizedError:
          "The external effect crossed its boundary but its outcome could not be confirmed.",
        now: new Date(),
      });
      return {
        ...executed.result,
        toolOutcome: "unknown",
        receiptId: unknown.id,
      };
    }
    const savedResultData =
      identity.executionKind === "approved_action"
        ? {
            ...(executed.resultData ?? {}),
            taskDisposition:
              ctx.preapprovedAction?.taskDisposition === "complete"
                ? "complete"
                : "resume",
          }
        : (executed.resultData ?? null);
    const receipt = await completeDurableOperation({
      receiptId: claimed.receipt.id,
      invocationId: invocation.id,
      leaseOwner: invocationLeaseOwner,
      browserBinding: input.browserBinding,
      resultData: savedResultData,
      now: new Date(),
    });
    return { ...executed.result, receiptId: receipt.id };
  } catch (error) {
    if (!crossedEffectBoundary) {
      try {
        const released = await releaseDurableOperationForSafeRetry({
          receiptId: claimed.receipt.id,
          invocationId: invocation.id,
          leaseOwner: invocationLeaseOwner,
          failureKind: startRequested
            ? "effect_boundary_commit_unconfirmed"
            : "pre_effect_check_failed",
          sanitizedError: startRequested
            ? "The running transition could not be confirmed before the effect was invoked."
            : "A normalized pre-effect check failed before invocation.",
          now: new Date(),
        });
        if (error instanceof ConfirmedAppliedReplayError) {
          return replayedEffectResult(
            ctx,
            input.toolName,
            error.confirmedReceipt.id,
            error.confirmedReceipt.resultData,
          );
        }
        return durableEffectErrorResult(
          ctx,
          input,
          error,
          "rejected",
          released.id,
        );
      } catch (releaseError) {
        logger.error(
          { error: releaseError, receiptId: claimed.receipt.id },
          "Pre-effect operation claim could not be safely released",
        );
        return durableEffectErrorResult(
          ctx,
          input,
          error,
          "unknown",
          claimed.receipt.id,
        );
      }
    }
    if (sideEffectClass === "idempotent") {
      try {
        const released = await releaseDurableOperationForSafeRetry({
          receiptId: claimed.receipt.id,
          invocationId: invocation.id,
          leaseOwner: invocationLeaseOwner,
          failureKind: "idempotent_effect_failed",
          sanitizedError:
            "The idempotent effect failed and may be retried with the same key.",
          now: new Date(),
        });
        return durableEffectErrorResult(
          ctx,
          input,
          error,
          "rejected",
          released.id,
        );
      } catch (releaseError) {
        logger.error(
          { error: releaseError, receiptId: claimed.receipt.id },
          "Idempotent operation could not be released for safe retry",
        );
      }
    } else {
      try {
        const unknown = await markDurableOperationUnknown({
          receiptId: claimed.receipt.id,
          invocationId: invocation.id,
          leaseOwner: invocationLeaseOwner,
          browserBinding: input.browserBinding,
          failureKind: "effect_outcome_unknown",
          sanitizedError:
            "The external effect crossed its boundary but finalization failed.",
          now: new Date(),
        });
        return durableEffectErrorResult(
          ctx,
          input,
          error,
          "unknown",
          unknown.id,
        );
      } catch (unknownError) {
        logger.error(
          { error: unknownError, receiptId: claimed.receipt.id },
          "At-most-once operation could not persist its unknown outcome",
        );
      }
    }
    return durableEffectErrorResult(
      ctx,
      input,
      error,
      "unknown",
      claimed.receipt.id,
    );
  } finally {
    ctx.detachOperationInvocation?.(invocation.id);
  }
}

function redactedPreviewValue(value: unknown, key = ""): unknown {
  if (/pass(word)?|secret|token|api[-_]?key|authorization|cookie/i.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value))
    return value.slice(0, 20).map((item) => redactedPreviewValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([entryKey]) => entryKey !== "__browserContext")
        .slice(0, 30)
        .map(([entryKey, entryValue]) => [
          entryKey,
          redactedPreviewValue(entryValue, entryKey),
        ]),
    );
  }
  return typeof value === "string" ? value.slice(0, 1_000) : value;
}

// These legacy identity fields are frozen; translated presentation never changes a receipt key.
const LEGACY_SUDO_APPROVAL_TITLE = "KRITIK: CEO Host Shell komutu";
const LEGACY_SUDO_APPROVAL_DESCRIPTION =
  "Bu onay, aşağıdaki tam komutu belirtilen host ve başlangıç dizininde API servis hesabının mevcut işletim sistemi yetkileriyle bir kez çalıştırır; root/Administrator yükseltmesi sağlamaz. Komutun çağırdığı betik/program onaydan sonra değişebilir; başlatılan alt süreçler shell timeout süresini aşabilir.";

function buildApprovalPreview(
  toolName: string,
  toolArgs: Record<string, unknown>,
  sudoTarget?: AgentSudoTarget | null,
  locale: WorkspaceLocale = "tr",
): string {
  const copy = getToolCopy(locale);
  const text = toolMessage.bind(null, locale);
  if (toolName === "vm_run_sudo_command" && sudoTarget) {
    return [
      copy.teamSudoTitle,
      text("previewInstance", { id: sudoTarget.executionInstanceId }),
      text("previewHost", { host: sudoTarget.hostname }),
      text("previewDirectory", { path: sudoTarget.cwd }),
      copy.previewCommand,
      String(toolArgs.command ?? ""),
      copy.previewWarning,
    ].join("\n");
  }
  const rawContext = toolArgs.__browserContext;
  const browserContext =
    rawContext && typeof rawContext === "object" && !Array.isArray(rawContext)
      ? (rawContext as Record<string, unknown>)
      : null;
  if (toolName === "browser_type" && browserContext) {
    return [
      text("previewPage", {
        url: String(browserContext.pageUrl ?? copy.previewUnknown),
      }),
      text("previewField", {
        role: String(browserContext.role ?? copy.previewFieldDefault),
        text: String(browserContext.text ?? copy.previewUnlabeled),
      }),
      browserContext.context
        ? text("previewContext", { text: String(browserContext.context) })
        : null,
      text("previewText", {
        text: JSON.stringify(String(toolArgs.text ?? "").slice(0, 1_000)),
      }),
      text("previewSubmit", {
        value: toolArgs.submit ? copy.previewYes : copy.previewNo,
      }),
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (toolName === "browser_click" && browserContext) {
    return [
      text("previewPage", {
        url: String(browserContext.pageUrl ?? copy.previewUnknown),
      }),
      text("previewElement", {
        role: String(browserContext.role ?? copy.previewElementDefault),
        text: String(browserContext.text ?? copy.previewUnlabeled),
      }),
      browserContext.context
        ? text("previewContext", { text: String(browserContext.context) })
        : null,
      browserContext.href
        ? text("previewLink", { url: String(browserContext.href) })
        : null,
      browserContext.formAction
        ? text("previewForm", { url: String(browserContext.formAction) })
        : null,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return canonicalJson(redactedPreviewValue(toolArgs)).slice(0, 1_500);
}

async function consumeScopedApproval(
  ctx: ToolRuntimeContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  if (!ctx.taskId) return false;
  const argsHash = hashToolArgs(args);
  const requiredCategory = requiredApprovalCategoryForAction(toolName, args);
  if (
    ctx.preapprovedAction?.toolName === toolName &&
    ctx.preapprovedAction.argsHash === argsHash &&
    (!requiredCategory || ctx.preapprovedAction.category === requiredCategory)
  ) {
    const [leasedTask] = await db
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.id, ctx.taskId),
          eq(tasksTable.status, "awaiting_approval"),
          eq(tasksTable.leaseOwner, ctx.preapprovedAction.leaseOwner),
        ),
      );
    return Boolean(leasedTask);
  }
  // Approval rows are server-held capabilities executed only by the approved
  // action worker. Ordinary task/chat tool calls may request approval, but can
  // never scan for and consume a generic approved row themselves.
  return false;
}

function approvalRequiredMessage(
  toolName: string,
  args: Record<string, unknown>,
  category: "delete" | "external_contact" | "publish" | "other",
  locale?: WorkspaceLocale,
): string {
  if (locale)
    return terminalMessage(locale, "approvalRequired", {
      toolName,
      category,
      args: canonicalJson(args),
    });
  return [
    `ENGELLENDI: ${toolName} icin tek kullanimlik, kapsamli kullanici onayi gerekli.`,
    "request_approval aracini su bilgilerle cagir:",
    `category=${category}, toolName=${toolName}, toolArgs=${canonicalJson(args)}.`,
    "Onay gelene kadar bu eylemi veya esdegerini deneme.",
  ].join(" ");
}

const DURABLE_TRANSACTIONAL_DISPATCH_TOOLS = new Set([
  "create_sub_agent",
  "delegate_task",
  "update_task_progress",
  "log_note",
  "post_company_message",
]);

const DURABLE_READ_ONLY_DISPATCH_TOOLS = new Set([
  ...CAPABILITY_TOOL_NAMES,
  "computer_observe",
  "vm_list_files",
  "vm_read_file",
  "browser_snapshot",
  "browser_extract_text",
  "browser_wait",
]);

function invalidFiniteNumberMarker(value: unknown): number | string {
  const number = Number(value);
  return Number.isFinite(number) ? number : "__invalid_number__";
}

function normalizeDurableDispatchArgs(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  switch (toolName) {
    case "create_sub_agent":
      return {
        name: String(args.name ?? "").trim(),
        role: String(args.role ?? "").trim(),
        systemPrompt: String(args.systemPrompt ?? "").trim(),
      };
    case "delegate_task": {
      const priority =
        typeof args.priority === "string" &&
        ["low", "normal", "high", "urgent"].includes(args.priority)
          ? args.priority
          : "normal";
      const autonomyMode =
        args.autonomyMode === undefined
          ? "finite"
          : args.autonomyMode === "finite" || args.autonomyMode === "continuous"
            ? args.autonomyMode
            : "__invalid_autonomy_mode__";
      return {
        agentId: invalidFiniteNumberMarker(args.agentId),
        title: String(args.title ?? "").trim(),
        brief: String(args.brief ?? "").trim(),
        priority,
        autonomyMode,
        cadenceSeconds:
          args.cadenceSeconds === undefined
            ? null
            : invalidFiniteNumberMarker(args.cadenceSeconds),
      };
    }
    case "update_task_progress":
      return {
        progressPercent: Math.max(
          0,
          Math.min(100, Math.round(Number(args.progressPercent) || 0)),
        ),
        note: String(args.note ?? "").trim() || "Ilerleme guncellendi.",
      };
    case "log_note":
      return { summary: String(args.summary ?? "").trim() };
    case "post_company_message": {
      const rawReplyTo = args.replyToMessageId;
      const numericReplyTo =
        rawReplyTo === undefined || rawReplyTo === null
          ? null
          : invalidFiniteNumberMarker(rawReplyTo);
      return {
        content: String(args.content ?? "").trim(),
        replyToMessageId: numericReplyTo,
      };
    }
    case "computer_observe":
    case "browser_snapshot":
    case "browser_extract_text":
      return {};
    case "vm_list_files":
      return {
        path:
          typeof args.path === "string"
            ? args.path.trim().replace(/\\/gu, "/")
            : "",
      };
    case "vm_read_file":
      return {
        path: String(args.path ?? "")
          .trim()
          .replace(/\\/gu, "/"),
      };
    case "browser_wait":
      return {
        milliseconds: Math.min(
          5_000,
          Math.max(250, Math.floor(Number(args.milliseconds) || 1_000)),
        ),
      };
    default:
      return args;
  }
}

function normalizedOperationReservation(
  ctx: ToolRuntimeContext,
  toolName: string,
  args: Record<string, unknown>,
  sideEffectClass: "transactional" | "read_only",
) {
  const identity = ctx.operationIdentity;
  if (!identity) {
    throw new TypeError("Durable normalized operation identity is missing.");
  }
  return {
    canonicalVersion: 1 as const,
    executionKind: identity.executionKind,
    logicalExecutionId: identity.logicalExecutionId,
    toolName,
    executionLocale: hasLocalizedToolOutput(toolName)
      ? (ctx.locale ?? "tr")
      : undefined,
    args,
    physical: {
      attemptId:
        identity.executionKind === "task_step"
          ? identity.originAttemptId
          : null,
      workerInstanceId: identity.runtimeInstanceId,
      modelToolCallId: identity.modelToolCallId,
      callSlot: identity.callSlot,
    },
    taskId: ctx.taskId,
    agentId: ctx.agent.id,
    approvalId: null,
    sourceMessageId:
      identity.executionKind === "chat_turn" ? identity.sourceMessageId : null,
    originAttemptId:
      identity.executionKind === "task_step" ? identity.originAttemptId : null,
    sideEffectClass,
  };
}

function normalizedOperationClaim(
  ctx: ToolRuntimeContext,
  receiptId: string,
  now: Date,
) {
  const identity = ctx.operationIdentity;
  if (!identity) {
    throw new TypeError("Durable normalized operation identity is missing.");
  }
  return {
    executionKind: identity.executionKind,
    attemptId:
      identity.executionKind === "task_step" ? identity.originAttemptId : null,
    workerInstanceId: identity.runtimeInstanceId,
    modelToolCallId: identity.modelToolCallId,
    leaseOwner: `operation:${receiptId}:${randomUUID()}`,
    leaseExpiresAt: new Date(now.getTime() + 120_000),
    taskLeaseOwner:
      identity.executionKind === "task_step"
        ? (ctx.taskLeaseOwner ?? null)
        : null,
    agentLeaseOwner: identity.agentLeaseOwner,
    now,
  };
}

async function replayedTransactionalResult(
  toolName: string,
  receipt: OperationReceipt,
  locale: WorkspaceLocale = "tr",
): Promise<ToolExecutionResult> {
  const text = toolMessage.bind(null, locale);
  const data = receipt.resultData;
  if (toolName === "create_sub_agent" && typeof data?.agentId === "number") {
    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, data.agentId));
    return {
      ...empty(text("teamAgentReplayed", { id: data.agentId }), "succeeded"),
      createdAgents: agent ? [agent] : [],
      receiptId: receipt.id,
      operationResultData: data,
    };
  }
  if (toolName === "delegate_task" && typeof data?.taskId === "number") {
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, data.taskId));
    return {
      ...empty(text("teamTaskReplayed", { id: data.taskId }), "succeeded"),
      createdTasks: task ? [task] : [],
      receiptId: receipt.id,
      operationResultData: data,
    };
  }
  if (toolName === "request_approval" && typeof data?.approvalId === "number") {
    const [approval] = await db
      .select({ taskId: approvalRequestsTable.taskId })
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, data.approvalId));
    const [task] = approval
      ? await db
          .select()
          .from(tasksTable)
          .where(eq(tasksTable.id, approval.taskId))
      : [];
    return {
      ...empty(
        text("teamApprovalReplayed", { id: data.approvalId }),
        "succeeded",
      ),
      createdTasks: task ? [task] : [],
      receiptId: receipt.id,
      taskLifecycleEffect: "suspended",
      operationResultData: data,
    };
  }
  const evidence = data
    ? text("teamEvidence", { data: canonicalizeJson(data) })
    : "";
  return {
    ...empty(text("teamOperationReplayed", { evidence }), "succeeded"),
    receiptId: receipt.id,
    operationResultData: data,
  };
}

function unavailableNormalizedOperationResult(
  disposition: "busy" | "unknown" | "failed",
  receipt: OperationReceipt,
  locale: WorkspaceLocale = "tr",
): ToolExecutionResult {
  if (disposition === "unknown") {
    return {
      ...empty(
        terminalMessage(locale, "receiptUnknown", { id: receipt.id }),
        "unknown",
      ),
      receiptId: receipt.id,
    };
  }
  if (disposition === "failed") {
    return {
      ...empty(
        terminalMessage(locale, "receiptFailed", { id: receipt.id }),
        "rejected",
      ),
      receiptId: receipt.id,
    };
  }
  return {
    ...empty(
      terminalMessage(locale, "receiptBusy", { id: receipt.id }),
      "deferred",
    ),
    receiptId: receipt.id,
  };
}

class NormalizedTransactionalNoMutation extends Error {
  constructor(readonly result: ToolExecutionResult) {
    super(
      "Normalized transactional handler completed without a durable mutation.",
    );
    this.name = "NormalizedTransactionalNoMutation";
  }
}

async function runDurableTransactionalTool(
  ctx: ToolRuntimeContext,
  toolName: string,
  args: Record<string, unknown>,
  execute: (
    transactionalContext: ToolRuntimeContext,
  ) => Promise<ToolExecutionResult>,
): Promise<ToolExecutionResult> {
  if (!ctx.operationIdentity) return execute(ctx);
  const now = new Date();
  const reservation = normalizedOperationReservation(
    ctx,
    toolName,
    args,
    "transactional",
  );
  let operation;
  try {
    operation = await runTransactionalOperation({
      reservation,
      claim: normalizedOperationClaim(ctx, "pending", now),
      mutate: async (tx, receipt) => {
        const result = await execute({
          ...ctx,
          locale: toolReceiptLocale(receipt) ?? ctx.locale,
          transactionalExecutor: tx as ToolTransaction,
        });
        if (result.toolOutcome !== "succeeded") {
          throw new NormalizedTransactionalNoMutation(result);
        }
        return {
          value: result,
          resultData: result.operationResultData ?? null,
        };
      },
    });
  } catch (error) {
    if (!(error instanceof NormalizedTransactionalNoMutation)) throw error;
    const observed = await reserveOperation(reservation);
    return { ...error.result, receiptId: observed.receipt.id };
  }
  if (operation.disposition === "executed") {
    return { ...operation.value, receiptId: operation.receipt.id };
  }
  if (operation.disposition === "replayed") {
    return replayedTransactionalResult(
      toolName,
      operation.receipt,
      ctx.locale ?? "tr",
    );
  }
  return unavailableNormalizedOperationResult(
    operation.disposition,
    operation.receipt,
    ctx.locale,
  );
}

async function runDurableReadOnlyTool(
  ctx: ToolRuntimeContext,
  toolName: string,
  args: Record<string, unknown>,
  execute: (
    executionContext: ToolRuntimeContext,
  ) => Promise<ToolExecutionResult>,
): Promise<ToolExecutionResult> {
  if (!ctx.operationIdentity) return execute(ctx);
  const now = new Date();
  const reservation = await reserveOperation(
    normalizedOperationReservation(ctx, toolName, args, "read_only"),
  );
  if (
    reservation.receipt.state === "succeeded" ||
    isConfirmedAppliedReplay(reservation)
  ) {
    const reconciledApplied = isConfirmedAppliedReplay(reservation);
    return {
      ...empty(
        reconciledApplied
          ? getToolCopy(ctx.locale ?? "tr").readReconciled
          : getToolCopy(ctx.locale ?? "tr").readReplayed,
        "deferred",
      ),
      receiptId: reservation.receipt.id,
    };
  }
  if (reservation.receipt.state === "unknown") {
    return unavailableNormalizedOperationResult(
      "unknown",
      reservation.receipt,
      ctx.locale,
    );
  }
  if (reservation.receipt.state === "failed") {
    return unavailableNormalizedOperationResult(
      "failed",
      reservation.receipt,
      ctx.locale,
    );
  }

  const claimInput = normalizedOperationClaim(ctx, reservation.receipt.id, now);
  const claimed = await claimOperationInvocation({
    ...claimInput,
    receiptId: reservation.receipt.id,
  });
  if (!claimed.claimed || !claimed.invocation) {
    if (isConfirmedAppliedReceipt(claimed.receipt)) {
      return {
        ...empty(getToolCopy(ctx.locale ?? "tr").readReconciled, "deferred"),
        receiptId: claimed.receipt.id,
      };
    }
    if (claimed.receipt.state === "succeeded") {
      return {
        ...empty(getToolCopy(ctx.locale ?? "tr").readReplayed, "deferred"),
        receiptId: claimed.receipt.id,
      };
    }
    return unavailableNormalizedOperationResult(
      claimed.receipt.state === "unknown"
        ? "unknown"
        : claimed.receipt.state === "failed"
          ? "failed"
          : "busy",
      claimed.receipt,
      ctx.locale,
    );
  }

  const owner = {
    receiptId: claimed.receipt.id,
    invocationId: claimed.invocation.id,
    leaseOwner: claimInput.leaseOwner,
  };
  if (
    ctx.operationIdentity.runtimeInstanceId &&
    ctx.attachOperationInvocation
  ) {
    ctx.attachOperationInvocation({
      ...owner,
      workerInstanceId: ctx.operationIdentity.runtimeInstanceId,
    });
  }
  let running = false;
  try {
    await markOperationRunning({ ...owner, now: new Date() });
    running = true;
    const result = await execute({
      ...ctx,
      locale: toolReceiptLocale(claimed.receipt) ?? ctx.locale,
    });
    if (result.toolOutcome !== "succeeded") {
      const released = await releaseOperationForSafeRetry({
        ...owner,
        failureKind: "read_only_execution_failed",
        sanitizedError:
          "The read-only handler did not return a successful observation; no raw output was persisted.",
        now: new Date(),
      });
      return { ...result, receiptId: released.id };
    }
    const receipt = await completeOperation({
      ...owner,
      resultData: null,
      now: new Date(),
    });
    return { ...result, receiptId: receipt.id };
  } catch (error) {
    try {
      const released = await releaseOperationForSafeRetry({
        ...owner,
        failureKind: running
          ? "read_only_observation_interrupted"
          : "read_only_pre_effect_failed",
        sanitizedError:
          "The read-only observation was not durably completed; it may be retried without stored raw output.",
        now: new Date(),
      });
      return {
        ...empty(
          getToolCopy(toolReceiptLocale(claimed.receipt) ?? ctx.locale ?? "tr")
            .readRetry,
          "rejected",
        ),
        receiptId: released.id,
      };
    } catch (releaseError) {
      logger.error(
        { error: releaseError, receiptId: claimed.receipt.id, toolName },
        "Read-only operation could not be released for retry",
      );
      throw error;
    }
  } finally {
    ctx.detachOperationInvocation?.(claimed.invocation.id);
  }
}

type ReservedLifecycleOperation =
  | { disposition: "reserved"; receipt: OperationReceipt }
  | {
      disposition: "replayed" | "busy" | "unknown" | "failed";
      receipt: OperationReceipt;
    };

async function reserveDurableLifecycleOperation(
  ctx: ToolRuntimeContext,
  toolName: "complete_task" | "request_approval" | "request_user_input",
  args: Record<string, unknown>,
): Promise<ReservedLifecycleOperation | null> {
  if (!ctx.operationIdentity) return null;
  const reservation = await reserveOperation(
    normalizedOperationReservation(ctx, toolName, args, "transactional"),
  );
  if (
    reservation.receipt.state === "succeeded" ||
    isConfirmedAppliedReplay(reservation)
  ) {
    return { disposition: "replayed", receipt: reservation.receipt };
  }
  if (reservation.receipt.state === "unknown") {
    return { disposition: "unknown", receipt: reservation.receipt };
  }
  if (reservation.receipt.state === "failed") {
    return { disposition: "failed", receipt: reservation.receipt };
  }
  return { disposition: "reserved", receipt: reservation.receipt };
}

async function claimDurableLifecycleOperation(
  ctx: ToolRuntimeContext,
  reservation: Extract<ReservedLifecycleOperation, { disposition: "reserved" }>,
): Promise<
  | {
      disposition: "prepared";
      finalization: DurableLifecycleOperationFinalization;
    }
  | {
      disposition: "replayed" | "busy" | "unknown" | "failed";
      receipt: OperationReceipt;
    }
> {
  const identity = ctx.operationIdentity;
  if (!identity) {
    throw new TypeError("Durable lifecycle operation identity is missing.");
  }
  const now = new Date();
  const claimInput = normalizedOperationClaim(ctx, reservation.receipt.id, now);
  const claimed = await claimOperationInvocation({
    ...claimInput,
    receiptId: reservation.receipt.id,
  });
  if (!claimed.claimed || !claimed.invocation) {
    return {
      disposition:
        claimed.receipt.state === "succeeded" ||
        isConfirmedAppliedReceipt(claimed.receipt)
          ? "replayed"
          : claimed.receipt.state === "unknown"
            ? "unknown"
            : claimed.receipt.state === "failed"
              ? "failed"
              : "busy",
      receipt: claimed.receipt,
    };
  }
  const finalization = {
    receiptId: claimed.receipt.id,
    invocationId: claimed.invocation.id,
    leaseOwner: claimInput.leaseOwner,
  };
  if (identity.runtimeInstanceId && ctx.attachOperationInvocation) {
    ctx.attachOperationInvocation({
      ...finalization,
      workerInstanceId: identity.runtimeInstanceId,
    });
  }
  return { disposition: "prepared", finalization };
}

async function lifecycleOperationDispositionResult(
  toolName: "complete_task" | "request_approval" | "request_user_input",
  operation: Exclude<ReservedLifecycleOperation, { disposition: "reserved" }>,
  locale: WorkspaceLocale = "tr",
): Promise<ToolExecutionResult> {
  if (operation.disposition === "replayed") {
    const replayed = await replayedTransactionalResult(
      toolName,
      operation.receipt,
      locale,
    );
    return {
      ...replayed,
      taskLifecycleEffect:
        toolName === "complete_task" ? "completed" : "suspended",
    };
  }
  return unavailableNormalizedOperationResult(
    operation.disposition,
    operation.receipt,
    locale,
  );
}

export async function executeTool(
  ctx: ToolRuntimeContext,
  name: string,
  rawArgs: string,
): Promise<ToolExecutionResult> {
  return withToolPolicy(
    name,
    async () => {
      try {
        return await executeToolWithPolicy(ctx, name, rawArgs);
      } catch (error) {
        if (!(error instanceof ExecutionPolicyDenied)) throw error;
        const messages = {
          tr: "Geçerli erişim modu bu işleme izin vermiyor.",
          en: "The current access mode does not allow this action.",
          de: "Der aktuelle Zugriffsmodus erlaubt diese Aktion nicht.",
          ru: "Текущий режим доступа не разрешает это действие.",
          "zh-CN": "当前访问模式不允许此操作。",
          "zh-TW": "目前的存取模式不允許此操作。",
          ar: "وضع الوصول الحالي لا يسمح بهذا الإجراء.",
        };
        return empty(messages[ctx.locale ?? "tr"], "rejected");
      }
    },
    ctx.preapprovedAction?.automaticPolicyRevision,
  );
}

async function executeToolWithPolicy(
  ctx: ToolRuntimeContext,
  name: string,
  rawArgs: string,
): Promise<ToolExecutionResult> {
  // Presentation applies even to malformed or unsupported calls. Receipt
  // metadata still uses the separate, explicit production-tool allowlist.
  getTerminalCopy(ctx.locale ?? "tr");
  ctx = { ...ctx, locale: ctx.locale ?? "tr" };
  const reject = (
    key: TerminalMessageKey,
    legacy: string,
    params: Readonly<Record<string, string | number>> = {},
  ) => empty(sharedToolText(ctx, name, key, legacy, params), "rejected");
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    return reject("invalidToolJson", "Hata: arac argumanlari gecersiz JSON.");
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return reject(
      "invalidToolObject",
      "Hata: arac argumanlari bir JSON nesnesi olmali.",
    );
  }

  // Validate before read-only canonicalization can erase invalid field types.
  if (isCapabilityTool(name) && !validCapabilityArgs(name, args)) {
    return empty(
      getCapabilityCatalog(ctx.locale ?? "tr").copy.invalid,
      "rejected",
    );
  }
  // In particular, an omitted content field is not an instruction to empty a file.
  const fileCopy = getToolCopy(ctx.locale ?? "tr");
  if (name === "vm_list_files") {
    if (args.path !== undefined && typeof args.path !== "string")
      return empty(fileCopy.pathInvalid, "rejected");
  } else if (name === "vm_read_file" || name === "vm_write_file") {
    if (typeof args.path !== "string")
      return empty(fileCopy.pathInvalid, "rejected");
    if (!args.path.trim()) return empty(fileCopy.pathRequired, "rejected");
    if (name === "vm_write_file" && typeof args.content !== "string")
      return empty(fileCopy.contentRequired, "rejected");
  }

  if (
    ["vm_list_files", "vm_read_file", "vm_write_file"].includes(name) &&
    typeof args.path === "string" &&
    args.path !== args.path.trim()
  )
    return empty(fileCopy.pathNoncanonical, "rejected");

  if (
    process.env.RUNTIME_ROLE === "api" &&
    [
      "browser_open",
      "browser_snapshot",
      "browser_click",
      "browser_type",
      "browser_scroll",
      "browser_extract_text",
      "browser_wait",
      "browser_save_screenshot",
    ].includes(name)
  ) {
    return empty(fileCopy.browserWorkerOnly, "rejected");
  }

  // Reject malformed browser fields before canonicalization or session creation.
  if (
    name === "browser_open" &&
    (typeof args.url !== "string" || !args.url.trim())
  )
    return empty(fileCopy.browserUrlRequired, "rejected");
  if (name === "browser_click" || name === "browser_type") {
    if (
      typeof args.ref !== "number" ||
      !Number.isSafeInteger(args.ref) ||
      args.ref <= 0
    )
      return empty(fileCopy.browserRefRequired, "rejected");
    if (name === "browser_type") {
      if (typeof args.text !== "string")
        return empty(fileCopy.browserTextRequired, "rejected");
      if (args.submit !== undefined && typeof args.submit !== "boolean")
        return empty(fileCopy.browserSubmitInvalid, "rejected");
    }
  }
  if (
    name === "browser_scroll" &&
    args.direction !== "up" &&
    args.direction !== "down"
  )
    return empty(fileCopy.browserDirectionRequired, "rejected");
  if (
    name === "browser_wait" &&
    (typeof args.milliseconds !== "number" ||
      !Number.isFinite(args.milliseconds))
  )
    return empty(fileCopy.browserWaitRequired, "rejected");
  if (
    name === "browser_save_screenshot" &&
    args.name !== undefined &&
    typeof args.name !== "string"
  )
    return empty(fileCopy.browserNameInvalid, "rejected");

  const teamValidation = validateTeamToolArgs(name, args, ctx.locale ?? "tr");
  if (teamValidation) return empty(teamValidation, "rejected");

  if (ctx.exclusiveTurnPolicy) {
    const decision = evaluateExclusiveToolCall(
      ctx.exclusiveTurnPolicy,
      name,
      args,
    );
    if (!decision.allowed) {
      return empty(
        exclusiveToolBlockedMessage(
          ctx.exclusiveTurnPolicy,
          name,
          decision.explanation,
          ctx.locale ?? "tr",
          decision.reason,
        ),
        "rejected",
      );
    }
  }

  // Reject unsupported names before any effect or policy admission. Preserve
  // the explicit localized unknown-tool diagnostic for fabricated tool calls.
  if (!hasLocalizedToolOutput(name))
    return empty(
      toolMessage(ctx.locale ?? "tr", "toolUnknown", { tool: name }),
      "rejected",
    );
  try {
    await assertExecutionAllowed();
  } catch (error) {
    if (error instanceof EmergencyStopError) {
      return reject(
        "emergencyBlocked",
        "ENGELLENDI: operator acil durdurmayi etkinlestirdi; arac calistirilmadi.",
      );
    }
    throw error;
  }

  const [currentAgent] = await db
    .select()
    .from(agentsTable)
    .where(
      and(eq(agentsTable.id, ctx.agent.id), eq(agentsTable.isActive, true)),
    );
  if (!currentAgent) {
    return reject(
      "agentInactive",
      "ENGELLENDI: ajan pasiflestirildi; arac calistirilmadi.",
    );
  }
  // Permission changes are a live kill switch, not a turn-start snapshot.
  ctx = { ...ctx, agent: currentAgent };
  if (
    ctx.preapprovedAction?.category &&
    !agentAllowsApprovalCategory(currentAgent, ctx.preapprovedAction.category)
  ) {
    return reject(
      "categoryRevoked",
      "ENGELLENDI: onay kategorisi icin ajan yetkisi geri alindi; eylem calistirilmadi.",
    );
  }

  if (ctx.taskId && !ctx.preapprovedAction) {
    if (!ctx.taskLeaseOwner) {
      return reject(
        "taskLeaseMissing",
        "ENGELLENDI: gorev lease yetkisi eksik; arac calistirilmadi.",
      );
    }
    const [activeTask] = await db
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.id, ctx.taskId),
          eq(tasksTable.leaseOwner, ctx.taskLeaseOwner),
          inArray(tasksTable.status, ACTIVE_TASK_STATUSES),
        ),
      );
    if (!activeTask) {
      return reject(
        "taskLeaseLost",
        "ENGELLENDI: gorev durduruldu veya lease kaybedildi; arac calistirilmadi.",
      );
    }
    try {
      await assertDurableTaskBoundary(
        ctx,
        sharedToolText(ctx, name, "taskBoundary", `Araç sınırı · ${name}`, {
          tool: name,
        }),
      );
    } catch (error) {
      return empty(
        isTerminalTool(name)
          ? terminalErrorMessage(
              error,
              ctx.locale ?? "tr",
              getTerminalCopy(ctx.locale ?? "tr").terminalFailureFallback,
            )
          : localizedToolErrorMessage(
              error,
              ctx.locale ?? "tr",
              fileCopy.operationFailure,
            ),
        "rejected",
      );
    }
  }

  if (DURABLE_TRANSACTIONAL_DISPATCH_TOOLS.has(name)) {
    const normalizedArgs = normalizeDurableDispatchArgs(name, args);
    return runDurableTransactionalTool(
      ctx,
      name,
      normalizedArgs,
      (transactionalContext) =>
        dispatchToolHandler(transactionalContext, name, args),
    );
  }
  if (DURABLE_READ_ONLY_DISPATCH_TOOLS.has(name)) {
    const normalizedArgs = normalizeDurableDispatchArgs(name, args);
    return runDurableReadOnlyTool(
      ctx,
      name,
      normalizedArgs,
      (executionContext) =>
        dispatchToolHandler(executionContext, name, normalizedArgs),
    );
  }
  return dispatchToolHandler(ctx, name, args);
}

async function dispatchToolHandler(
  ctx: ToolRuntimeContext,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  if (isCapabilityTool(name)) {
    const available = await getToolsForAgent(ctx.agent, ctx.taskId !== null);
    try {
      await assertPackEnabled(name);
      if (name === "list_extensions" || name === "run_extension") {
        const data =
          name === "list_extensions"
            ? await discoverExtensions(
                typeof args.offset === "number" ? args.offset : 0,
              )
            : await executeInstalledTool(
                String(args.id),
                args.args as Record<string, unknown>,
                ctx.locale ?? "tr",
              );
        return {
          content: JSON.stringify({
            message: getCapabilityCatalog(ctx.locale ?? "tr").copy.completed,
            data,
          }),
          toolOutcome: "succeeded",
          createdTasks: [],
          createdAgents: [],
        };
      }
    } catch {
      return {
        content: JSON.stringify({
          message: getCapabilityCatalog(ctx.locale ?? "tr").copy.invalid,
          code: "CAPABILITY_UNAVAILABLE",
        }),
        toolOutcome: "rejected",
        createdTasks: [],
        createdAgents: [],
      };
    }
    return capabilityResult(
      name,
      args,
      ctx.locale ?? "tr",
      available.map((tool) => tool.function.name),
      name === "list_skills" || name === "read_skill"
        ? await personalSkillGuides(ctx.locale ?? "tr")
        : [],
      (await readCapabilityPacks()).enabledPacks,
    );
  }
  switch (name) {
    case "create_sub_agent":
      return createSubAgent(ctx, args);
    case "delegate_task":
      return delegateTask(ctx, args);
    case "update_task_progress":
      return updateTaskProgress(ctx, args);
    case "complete_task":
      return completeTask(ctx, args);
    case "request_approval":
      return requestApproval(ctx, args);
    case "request_user_input":
      return requestUserInput(ctx, args);
    case "log_note":
      return logNote(ctx, args);
    case "post_company_message":
      return postCompanyMessage(ctx, args);
    case "computer_observe":
      return computerObserve(ctx);
    case "vm_run_command":
      return vmRunCommand(ctx, args);
    case "vm_run_sudo_command":
      return vmRunSudoCommand(ctx, args);
    case "vm_list_files":
      return vmListFiles(ctx, args);
    case "vm_read_file":
      return vmReadFile(ctx, args);
    case "vm_write_file":
      return vmWriteFile(ctx, args);
    case "browser_open":
      return browserOpen(ctx, args);
    case "browser_snapshot":
      return browserSnapshot(ctx);
    case "browser_click":
      return browserClick(ctx, args);
    case "browser_type":
      return browserType(ctx, args);
    case "browser_scroll":
      return browserScroll(ctx, args);
    case "browser_extract_text":
      return browserExtract(ctx);
    case "browser_wait":
      return browserWait(ctx, args);
    case "browser_save_screenshot":
      return browserSaveScreenshot(ctx, args);
    default:
      return empty(
        toolMessage(ctx.locale ?? "tr", "toolUnknown", { tool: name }),
        "rejected",
      );
  }
}

export interface ApprovedActionExecutionResult {
  status: "queued" | "succeeded" | "failed" | "approval_outcome_unknown";
  claimed: boolean;
  approvalId: number;
  taskId?: number;
  toolName?: string;
  output?: string;
}

export interface ApprovedActionFinalizationResult {
  disposition: "finalized" | "already_finalized" | "not_ready" | "conflict";
  approvalId: number;
  taskId: number;
  toolName: string;
  status: "succeeded" | "failed";
  summary: string;
}

const APPROVAL_OUTCOME_UNKNOWN_MARKER = "[APPROVAL_OUTCOME_UNKNOWN]";

class ApprovedActionReconciliationOwnerChanged extends Error {}

function markApprovalOutcomeUnknown(
  decisionNote: string | null,
  message = "Consumed action outcome requires operator review.",
): string {
  if (decisionNote?.includes(APPROVAL_OUTCOME_UNKNOWN_MARKER)) {
    return decisionNote;
  }
  const existing = decisionNote?.trim() ? decisionNote : null;
  return [existing, `${APPROVAL_OUTCOME_UNKNOWN_MARKER} ${message}`]
    .filter(Boolean)
    .join("\n");
}

export async function persistApprovedActionOutcomeUnknown(input: {
  locale?: WorkspaceLocale;
  approvalId: number;
  taskId: number;
  agentId: number;
  leaseOwner: string | null;
  blockOnlyIfLeaseExpiredBefore?: Date;
  error: unknown;
}): Promise<void> {
  // Recovery safety must not depend on the availability of presentation settings.
  const locale =
    input.locale ??
    (await readWorkspaceLocale().catch((error) => {
      logger.warn(
        { error },
        "Approval recovery could not read the display locale; using Turkish",
      );
      return "tr" as const;
    }));
  for (
    let reconciliationAttempt = 0;
    reconciliationAttempt < 3;
    reconciliationAttempt += 1
  ) {
    const [anticipatedTask] = await db
      .select({ ownerAgentId: tasksTable.ownerAgentId })
      .from(tasksTable)
      .where(eq(tasksTable.id, input.taskId));
    if (!anticipatedTask) {
      throw new Error("Consumed approved action task is missing");
    }
    const lockedAgentIds = [input.agentId, anticipatedTask.ownerAgentId]
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort((left, right) => left - right);
    try {
      await db.transaction(async (tx) => {
        // Unknown-outcome reconciliation is fail-closed bookkeeping, not new
        // autonomous work. It must serialize with the stop row but still
        // persist operator evidence while the stop is enabled.
        await lockRuntimeControlState(tx);
        for (const agentId of lockedAgentIds) {
          await tx.execute(
            sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${agentId} FOR UPDATE`,
          );
        }
        await tx.execute(
          sql`SELECT id FROM ${approvalRequestsTable} WHERE ${approvalRequestsTable.id} = ${input.approvalId} FOR UPDATE`,
        );
        await tx.execute(
          sql`SELECT id FROM ${tasksTable} WHERE ${tasksTable.id} = ${input.taskId} FOR UPDATE`,
        );
        const [approval] = await tx
          .select({
            consumedAt: approvalRequestsTable.consumedAt,
            decisionNote: approvalRequestsTable.decisionNote,
            scope: approvalRequestsTable.scope,
          })
          .from(approvalRequestsTable)
          .where(eq(approvalRequestsTable.id, input.approvalId));
        const [task] = await tx
          .select({
            ownerAgentId: tasksTable.ownerAgentId,
            status: tasksTable.status,
            leaseOwner: tasksTable.leaseOwner,
            leaseExpiresAt: tasksTable.leaseExpiresAt,
            blockedReason: tasksTable.blockedReason,
          })
          .from(tasksTable)
          .where(eq(tasksTable.id, input.taskId));
        if (!approval?.consumedAt || !task) {
          throw new Error("Consumed approved action could not be reconciled");
        }
        const executionLocale = await readApprovedActionLocale(
          {
            id: input.approvalId,
            taskId: input.taskId,
            agentId: input.agentId,
            scope: approval.scope,
          },
          tx,
        );
        const copy = getTerminalCopy(executionLocale ?? locale);
        if (!lockedAgentIds.includes(task.ownerAgentId)) {
          throw new ApprovedActionReconciliationOwnerChanged();
        }
        await tx
          .update(approvalRequestsTable)
          .set({
            decisionNote: markApprovalOutcomeUnknown(
              approval.decisionNote,
              copy.approvedUnknown,
            ),
          })
          .where(
            and(
              eq(approvalRequestsTable.id, input.approvalId),
              isNotNull(approvalRequestsTable.consumedAt),
            ),
          );

        const alreadyUnknown =
          task.leaseOwner === null &&
          task.blockedReason === "approval_outcome_unknown";
        const ownsConsumedLease =
          input.leaseOwner !== null && task.leaseOwner === input.leaseOwner;
        const consumedLeaseCanBeBlocked =
          ownsConsumedLease &&
          (!input.blockOnlyIfLeaseExpiredBefore ||
            !task.leaseExpiresAt ||
            task.leaseExpiresAt.getTime() <
              input.blockOnlyIfLeaseExpiredBefore.getTime());
        const unleasedAwaitingTask =
          task.leaseOwner === null && task.status === "awaiting_approval";
        if (
          !alreadyUnknown &&
          (consumedLeaseCanBeBlocked || unleasedAwaitingTask)
        ) {
          const leaseCondition = consumedLeaseCanBeBlocked
            ? eq(tasksTable.leaseOwner, input.leaseOwner!)
            : isNull(tasksTable.leaseOwner);
          const [blocked] = await tx
            .update(tasksTable)
            .set({
              status: "blocked",
              blockedReason: "approval_outcome_unknown",
              lastError: copy.approvedUnknown,
              leaseOwner: null,
              leaseExpiresAt: null,
              nextAttemptAt: null,
            })
            .where(
              and(
                eq(tasksTable.id, input.taskId),
                eq(tasksTable.ownerAgentId, task.ownerAgentId),
                leaseCondition,
              ),
            )
            .returning({ id: tasksTable.id });
          if (!blocked) {
            throw new Error("Approved action unknown-state CAS failed");
          }
        }
        if (input.leaseOwner !== null) {
          await tx
            .update(agentsTable)
            .set({
              status: "idle",
              currentTaskId: null,
              currentAction: null,
              runLeaseOwner: null,
              runLeaseExpiresAt: null,
              lastActiveAt: new Date(),
            })
            .where(
              and(
                eq(agentsTable.id, input.agentId),
                eq(agentsTable.runLeaseOwner, input.leaseOwner),
              ),
            );
        }
        const existingUnknownEvents = await tx
          .select({ detail: activityEventsTable.detail })
          .from(activityEventsTable)
          .where(
            and(
              eq(activityEventsTable.taskId, input.taskId),
              eq(activityEventsTable.type, "error"),
            ),
          );
        if (
          !existingUnknownEvents.some(
            (event) =>
              event.detail?.approvalId === input.approvalId &&
              (event.detail?.outcome === "unknown" ||
                event.detail?.replayBlocked === true),
          )
        ) {
          await tx.insert(activityEventsTable).values({
            agentId: input.agentId,
            taskId: input.taskId,
            type: "error",
            summary: copy.approvedUnknown,
            detail: {
              approvalId: input.approvalId,
              outcome: "unknown",
              replayBlocked: true,
              error:
                input.error instanceof Error
                  ? redactAuditText(input.error.message, 1_000)
                  : copy.unknownFinalization,
            },
            severity: "critical",
          });
        }
      });
      return;
    } catch (error) {
      if (error instanceof ApprovedActionReconciliationOwnerChanged) continue;
      throw error;
    }
  }
  throw new Error("Approved action owner changed during reconciliation");
}

function approvedReceiptFinalizationEvidence(receipt: OperationReceipt): {
  ok: boolean;
  executionLocale?: WorkspaceLocale;
  taskDisposition: "resume" | "complete";
  exitCode: number | null;
  durationMs: number | null;
} | null {
  if (
    receipt.executionKind !== "approved_action" ||
    receipt.state !== "succeeded" ||
    receipt.approvalId === null ||
    receipt.taskId === null
  ) {
    return null;
  }
  const data = receipt.resultData;
  if (
    !data ||
    (Object.hasOwn(data, "executionLocale") &&
      !isWorkspaceLocale(data.executionLocale)) ||
    typeof data.ok !== "boolean" ||
    (data.taskDisposition !== "resume" && data.taskDisposition !== "complete")
  ) {
    return null;
  }
  const exitCode =
    data.exitCode === null ||
    (typeof data.exitCode === "number" && Number.isInteger(data.exitCode))
      ? data.exitCode
      : null;
  const durationMs =
    typeof data.durationMs === "number" &&
    Number.isInteger(data.durationMs) &&
    data.durationMs >= 0
      ? data.durationMs
      : null;
  return {
    ok: data.ok,
    executionLocale: isWorkspaceLocale(data.executionLocale)
      ? data.executionLocale
      : undefined,
    taskDisposition: data.taskDisposition,
    exitCode,
    durationMs,
  };
}

function approvedReceiptSummary(
  receipt: OperationReceipt,
  evidence: NonNullable<ReturnType<typeof approvedReceiptFinalizationEvidence>>,
): string {
  if (isTerminalTool(receipt.toolName) && evidence.executionLocale) {
    return terminalMessage(
      evidence.executionLocale,
      evidence.ok ? "approvedCompleted" : "approvedFailed",
      { tool: receipt.toolName, exitCode: evidence.exitCode ?? "null" },
    );
  }
  if (evidence.executionLocale) {
    return toolMessage(
      evidence.executionLocale,
      evidence.ok ? "approvedToolCompleted" : "approvedToolFailed",
      { tool: receipt.toolName },
    );
  }
  if (receipt.toolName === "vm_run_sudo_command") {
    return evidence.ok
      ? `Onayli CEO Host Shell eylemi tamamlandi (exitCode=${evidence.exitCode ?? "null"}).`
      : `Onayli CEO Host Shell eylemi basarisiz oldu (exitCode=${evidence.exitCode ?? "null"}).`;
  }
  return evidence.ok
    ? `Onayli eylem tamamlandi: ${receipt.toolName}.`
    : `Onayli eylem basarisiz oldu: ${receipt.toolName}.`;
}

/**
 * Finalizes an approved task solely from a terminal durable receipt. This is
 * intentionally separate from effect dispatch: a worker can safely call it
 * after a crash without retaining or reconstructing the consumed capability.
 */
export async function finalizeSucceededApprovedActionReceipt(input: {
  receiptId: string;
  /** Exact claim owner for the immediate post-effect path. */
  expectedLeaseOwner?: string | null;
  /** Recovery may only take over an unleased or expired task/agent owner. */
  recovery?: boolean;
  now?: Date;
}): Promise<ApprovedActionFinalizationResult> {
  const [snapshot] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.id, input.receiptId));
  const snapshotEvidence = snapshot
    ? approvedReceiptFinalizationEvidence(snapshot)
    : null;
  if (
    !snapshot ||
    !snapshotEvidence ||
    snapshot.approvalId === null ||
    snapshot.taskId === null
  ) {
    throw new Error(
      "Approved-action finalization requires a succeeded receipt with safe result evidence.",
    );
  }

  const now = input.now ?? new Date();
  const recovery = input.recovery === true;
  const expectedLeaseOwner = input.expectedLeaseOwner ?? null;
  if (!recovery && !expectedLeaseOwner) {
    throw new Error(
      "Immediate approved-action finalization requires the exact lease owner.",
    );
  }

  return db.transaction(async (tx) => {
    await lockAndAssertExecutionAllowed(tx);
    // Canonical order: runtime control -> agent -> approval -> task -> receipt.
    await tx.execute(
      sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${snapshot.agentId} FOR UPDATE`,
    );
    await tx.execute(
      sql`SELECT id FROM ${approvalRequestsTable} WHERE ${approvalRequestsTable.id} = ${snapshot.approvalId} FOR UPDATE`,
    );
    await tx.execute(
      sql`SELECT id FROM ${tasksTable} WHERE ${tasksTable.id} = ${snapshot.taskId} FOR UPDATE`,
    );
    await tx.execute(
      sql`SELECT id FROM ${operationReceiptsTable} WHERE ${operationReceiptsTable.id} = ${snapshot.id} FOR UPDATE`,
    );

    const [[receipt], [approval], [task], [agent], priorEvents] =
      await Promise.all([
        tx
          .select()
          .from(operationReceiptsTable)
          .where(eq(operationReceiptsTable.id, snapshot.id)),
        tx
          .select()
          .from(approvalRequestsTable)
          .where(eq(approvalRequestsTable.id, snapshot.approvalId!)),
        tx.select().from(tasksTable).where(eq(tasksTable.id, snapshot.taskId!)),
        tx
          .select()
          .from(agentsTable)
          .where(eq(agentsTable.id, snapshot.agentId)),
        tx
          .select({ detail: activityEventsTable.detail })
          .from(activityEventsTable)
          .where(
            and(
              eq(activityEventsTable.taskId, snapshot.taskId!),
              eq(activityEventsTable.type, "approval_resolved"),
            ),
          ),
      ]);
    const evidence = receipt
      ? approvedReceiptFinalizationEvidence(receipt)
      : null;
    if (
      !receipt ||
      !evidence ||
      receipt.id !== snapshot.id ||
      receipt.approvalId !== approval?.id ||
      receipt.taskId !== task?.id ||
      receipt.agentId !== agent?.id ||
      approval.taskId !== receipt.taskId ||
      approval.agentId !== receipt.agentId ||
      approval.status !== "approved" ||
      approval.resolvedAt === null ||
      approval.consumedAt === null ||
      approval.actionPayload !== null ||
      approval.bindingInvalidatedAt !== null ||
      receipt.sideEffectClass !== "approval_at_most_once" ||
      receipt.logicalExecutionId !== `approval:${approval.id}` ||
      !APPROVAL_EXECUTABLE_TOOLS.has(receipt.toolName) ||
      approval.scope?.toolName !== receipt.toolName ||
      approval.scope.argsHash !== receipt.argumentHash
    ) {
      throw new Error(
        "Succeeded approved-action receipt no longer matches its consumed authority.",
      );
    }

    const summary = approvedReceiptSummary(receipt, evidence);
    const baseResult = {
      approvalId: approval.id,
      taskId: task.id,
      toolName: receipt.toolName,
      status: evidence.ok ? ("succeeded" as const) : ("failed" as const),
      summary,
    };
    if (priorEvents.some((event) => event.detail?.receiptId === receipt.id)) {
      return { disposition: "already_finalized", ...baseResult };
    }
    if (task.ownerAgentId !== receipt.agentId) {
      return { disposition: "conflict", ...baseResult };
    }
    if (task.status !== "awaiting_approval") {
      return { disposition: "conflict", ...baseResult };
    }

    if (recovery) {
      if (
        task.leaseExpiresAt !== null &&
        task.leaseExpiresAt.getTime() >= now.getTime()
      ) {
        return { disposition: "not_ready", ...baseResult };
      }
      if (
        agent.currentTaskId === task.id &&
        agent.runLeaseExpiresAt !== null &&
        agent.runLeaseExpiresAt.getTime() >= now.getTime()
      ) {
        return { disposition: "not_ready", ...baseResult };
      }
    } else if (
      task.leaseOwner !== expectedLeaseOwner ||
      agent.runLeaseOwner !== expectedLeaseOwner
    ) {
      return { disposition: "not_ready", ...baseResult };
    }

    const completeSyntheticTask =
      evidence.ok && evidence.taskDisposition === "complete";
    const completesContinuousCycle =
      completeSyntheticTask && task.autonomyMode === "continuous";
    const continuousNextRunAt = completesContinuousCycle
      ? new Date(now.getTime() + (task.cadenceSeconds ?? 3_600) * 1_000)
      : null;
    const leaseCondition = recovery
      ? or(
          isNull(tasksTable.leaseExpiresAt),
          lt(tasksTable.leaseExpiresAt, now),
        )
      : eq(tasksTable.leaseOwner, expectedLeaseOwner!);
    const [finalizedTask] = await tx
      .update(tasksTable)
      .set({
        status: evidence.ok
          ? completeSyntheticTask
            ? completesContinuousCycle
              ? "in_progress"
              : "completed"
            : "in_progress"
          : "blocked",
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: evidence.ok ? null : summary,
        blockedReason: evidence.ok ? null : "approval_action_failed",
        ...(completesContinuousCycle
          ? {
              progressPercent: 0,
              completedAt: null,
              nextAttemptAt: continuousNextRunAt,
              cycleCount: sql`${tasksTable.cycleCount} + 1`,
              lastCycleCompletedAt: now,
            }
          : {}),
        ...(completeSyntheticTask
          ? completesContinuousCycle
            ? {}
            : {
                progressPercent: 100,
                completedAt: now,
                resultSummary: summary,
              }
          : {}),
      })
      .where(
        and(
          eq(tasksTable.id, task.id),
          eq(tasksTable.ownerAgentId, receipt.agentId),
          eq(tasksTable.status, "awaiting_approval"),
          leaseCondition,
        ),
      )
      .returning({ id: tasksTable.id });
    if (!finalizedTask) {
      return { disposition: "not_ready", ...baseResult };
    }

    if (!recovery) {
      const [releasedAgent] = await tx
        .update(agentsTable)
        .set({
          status: "idle",
          currentTaskId: null,
          currentAction: null,
          lastActiveAt: now,
          runLeaseOwner: null,
          runLeaseExpiresAt: null,
        })
        .where(
          and(
            eq(agentsTable.id, receipt.agentId),
            eq(agentsTable.runLeaseOwner, expectedLeaseOwner!),
          ),
        )
        .returning({ id: agentsTable.id });
      if (!releasedAgent) {
        throw new Error(
          "Approved-action agent lease was lost during immediate finalization.",
        );
      }
    } else if (agent.currentTaskId === task.id) {
      const [releasedAgent] = await tx
        .update(agentsTable)
        .set({
          status: "idle",
          currentTaskId: null,
          currentAction: null,
          lastActiveAt: now,
          runLeaseOwner: null,
          runLeaseExpiresAt: null,
        })
        .where(
          and(
            eq(agentsTable.id, receipt.agentId),
            eq(agentsTable.currentTaskId, task.id),
            or(
              isNull(agentsTable.runLeaseExpiresAt),
              lt(agentsTable.runLeaseExpiresAt, now),
            ),
          ),
        )
        .returning({ id: agentsTable.id });
      if (!releasedAgent) {
        throw new Error(
          "Expired approved-action agent lease could not be released.",
        );
      }
    }

    await tx.insert(activityEventsTable).values({
      agentId: receipt.agentId,
      taskId: task.id,
      type: "approval_resolved",
      summary,
      detail: {
        approvalId: approval.id,
        receiptId: receipt.id,
        actor: "agent",
        owner: "agent",
        tool: receipt.toolName,
        taskDisposition: evidence.taskDisposition,
        autonomyMode: task.autonomyMode,
        nextRunAt: continuousNextRunAt?.toISOString() ?? null,
        sourceTrust: "untrusted_data",
        status: evidence.ok ? "succeeded" : "failed",
        outcome: evidence.ok ? "finished" : "failed",
        exitCode: evidence.exitCode,
        durationMs: evidence.durationMs,
        outputStored: false,
        recoveredFinalization: recovery,
      },
      severity: evidence.ok ? "info" : "warning",
    });
    return { disposition: "finalized", ...baseResult };
  });
}

// Read presentation only from the single receipt for this exact capability.
// This enum grants no authority and never changes the approval/operation hash.
async function readApprovedActionLocale(
  approval: {
    id: number;
    taskId: number;
    agentId: number;
    scope: ApprovalScope | null;
  },
  executor: OperationExecutor = db,
): Promise<WorkspaceLocale | null> {
  if (!approval.scope) return null;
  const receipts = await executor
    .select({
      toolName: operationReceiptsTable.toolName,
      resultData: operationReceiptsTable.resultData,
    })
    .from(operationReceiptsTable)
    .where(
      and(
        eq(operationReceiptsTable.approvalId, approval.id),
        eq(operationReceiptsTable.executionKind, "approved_action"),
        eq(
          operationReceiptsTable.logicalExecutionId,
          `approval:${approval.id}`,
        ),
        eq(operationReceiptsTable.taskId, approval.taskId),
        eq(operationReceiptsTable.agentId, approval.agentId),
        eq(operationReceiptsTable.toolName, approval.scope.toolName),
        eq(operationReceiptsTable.argumentHash, approval.scope.argsHash),
      ),
    )
    .limit(2);
  return receipts.length === 1 ? toolReceiptLocale(receipts[0]) : null;
}

async function findApprovedActionReceipt(
  approvalId: number,
): Promise<OperationReceipt | null> {
  const [receipt] = await db
    .select()
    .from(operationReceiptsTable)
    .where(
      and(
        eq(operationReceiptsTable.approvalId, approvalId),
        eq(operationReceiptsTable.executionKind, "approved_action"),
      ),
    )
    .limit(1);
  return receipt ?? null;
}

interface ApprovedActionLeaseHeartbeat {
  assertOwned(): Promise<void>;
  attachOperationInvocation(input: AttachedOperationInvocation): void;
  detachOperationInvocation(invocationId: string): void;
  stop(): Promise<void>;
}

interface ApprovedActionHeartbeatState {
  currentAction: string;
  approvalId: number;
  taskId: number;
  agentId: number;
  leaseOwner: string;
  runtimeInstanceId: string | null;
  browserBinding: ApprovedBrowserBindingEvidence | null;
  config: RuntimeOperationsConfig;
  runtime: TaskLeaseHeartbeatRuntime;
  operation: AttachedOperationInvocation | null;
  stopped: boolean;
  ownershipLost: boolean;
  timer: TaskLeaseTimer | null;
  tail: Promise<void>;
  inFlight: Set<Promise<void>>;
  stopPromise: Promise<void> | null;
}

class ApprovedActionLeaseOwnershipMismatchError extends Error {
  constructor() {
    super("Approved-action task or agent lease owner no longer matches.");
    this.name = "ApprovedActionLeaseOwnershipMismatchError";
  }
}

const approvedActionHeartbeatRuntime: TaskLeaseHeartbeatRuntime = {
  now: () => new Date(),
  setTimeout(callback, delayMs) {
    return setTimeout(() => void callback(), delayMs);
  },
  clearTimeout(timer) {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
};

function approvedActionHeartbeatTimestamp(
  runtime: TaskLeaseHeartbeatRuntime,
): Date {
  const now = runtime.now();
  if (!Number.isFinite(now.getTime())) {
    throw new Error(
      "Approved-action heartbeat clock returned an invalid time.",
    );
  }
  return now;
}

async function renewApprovedActionOwnership(
  state: ApprovedActionHeartbeatState,
): Promise<void> {
  const now = approvedActionHeartbeatTimestamp(state.runtime);
  const leaseExpiresAt = new Date(now.getTime() + state.config.taskLeaseMs);
  await db.transaction(async (tx) => {
    await lockAndAssertExecutionAllowed(tx);
    if (state.runtimeInstanceId) {
      await tx.execute(
        sql`SELECT id FROM ${runtimeInstancesTable} WHERE ${runtimeInstancesTable.id} = ${state.runtimeInstanceId} FOR UPDATE`,
      );
    }
    const [agent] = await tx
      .update(agentsTable)
      .set({
        status: "working",
        currentTaskId: state.taskId,
        currentAction: state.currentAction,
        lastActiveAt: now,
        runLeaseExpiresAt: leaseExpiresAt,
      })
      .where(
        and(
          eq(agentsTable.id, state.agentId),
          eq(agentsTable.isActive, true),
          eq(agentsTable.runLeaseOwner, state.leaseOwner),
        ),
      )
      .returning({ id: agentsTable.id });
    await tx.execute(
      sql`SELECT id FROM ${approvalRequestsTable} WHERE ${approvalRequestsTable.id} = ${state.approvalId} FOR UPDATE`,
    );
    const [task] = await tx
      .update(tasksTable)
      .set({ leaseExpiresAt, lastHeartbeatAt: now })
      .where(
        and(
          eq(tasksTable.id, state.taskId),
          eq(tasksTable.ownerAgentId, state.agentId),
          eq(tasksTable.status, "awaiting_approval"),
          eq(tasksTable.leaseOwner, state.leaseOwner),
        ),
      )
      .returning({ id: tasksTable.id });
    if (!agent || !task) {
      throw new ApprovedActionLeaseOwnershipMismatchError();
    }
  });

  const operation = state.operation;
  if (operation) {
    const heartbeat = await heartbeatOperationInvocation({
      receiptId: operation.receiptId,
      invocationId: operation.invocationId,
      leaseOwner: operation.leaseOwner,
      browserBinding: state.browserBinding,
      leaseExpiresAt,
      now,
      allowExpiredInvocationLeaseRenewal: true,
    });
    if (!heartbeat.renewed) state.operation = null;
  }
}

function startApprovedActionLeaseHeartbeat(input: {
  currentAction: string;
  approvalId: number;
  taskId: number;
  agentId: number;
  leaseOwner: string;
  runtimeInstanceId: string | null;
  browserBinding: ApprovedBrowserBindingEvidence | null;
  config: RuntimeOperationsConfig;
  runtime?: TaskLeaseHeartbeatRuntime;
}): ApprovedActionLeaseHeartbeat {
  const state: ApprovedActionHeartbeatState = {
    ...input,
    runtime: input.runtime ?? approvedActionHeartbeatRuntime,
    operation: null,
    stopped: false,
    ownershipLost: false,
    timer: null,
    tail: Promise.resolve(),
    inFlight: new Set(),
    stopPromise: null,
  };
  const enqueueRenewal = (): Promise<void> => {
    const renewal = state.tail
      .catch(() => undefined)
      .then(() => renewApprovedActionOwnership(state));
    state.tail = renewal.catch(() => undefined);
    return renewal;
  };
  const permanentlyRevokesOwnership = (error: unknown): boolean =>
    error instanceof ApprovedActionLeaseOwnershipMismatchError ||
    error instanceof OperationInvocationOwnershipLostError ||
    error instanceof EmergencyStopError;
  const revokeOwnership = (): void => {
    state.ownershipLost = true;
    if (state.timer) state.runtime.clearTimeout(state.timer);
    state.timer = null;
  };
  const schedule = (): void => {
    if (state.stopped || state.ownershipLost) return;
    const timer = state.runtime.setTimeout(() => {
      const callback = (async () => {
        if (state.timer === timer) state.timer = null;
        if (state.stopped || state.ownershipLost) return;
        try {
          await enqueueRenewal();
        } catch (error) {
          const ownershipRevoked = permanentlyRevokesOwnership(error);
          if (ownershipRevoked) revokeOwnership();
          logger.warn(
            { error, approvalId: state.approvalId, taskId: state.taskId },
            ownershipRevoked
              ? "Approved-action heartbeat lost durable ownership"
              : "Approved-action heartbeat persistence failed; renewal will retry",
          );
        } finally {
          schedule();
        }
      })();
      state.inFlight.add(callback);
      void callback.finally(() => state.inFlight.delete(callback));
      return callback;
    }, state.config.taskHeartbeatMs);
    state.timer = timer;
    timer.unref?.();
  };
  const heartbeat: ApprovedActionLeaseHeartbeat = {
    async assertOwned() {
      if (state.stopped || state.ownershipLost) {
        throw new TaskLeaseOwnershipLostError();
      }
      try {
        await enqueueRenewal();
      } catch (error) {
        if (permanentlyRevokesOwnership(error)) revokeOwnership();
        if (error instanceof EmergencyStopError) throw error;
        throw new TaskLeaseOwnershipLostError(
          error instanceof Error ? error.message : undefined,
        );
      }
    },
    attachOperationInvocation(operation) {
      if (state.stopped || state.ownershipLost) {
        throw new TaskLeaseOwnershipLostError();
      }
      state.operation = { ...operation };
    },
    detachOperationInvocation(invocationId) {
      if (state.operation?.invocationId === invocationId) {
        state.operation = null;
      }
    },
    stop() {
      if (state.stopPromise) return state.stopPromise;
      state.stopped = true;
      if (state.timer) state.runtime.clearTimeout(state.timer);
      state.timer = null;
      state.stopPromise = (async () => {
        await state.tail.catch(() => undefined);
        while (state.inFlight.size > 0) {
          await Promise.allSettled([...state.inFlight]);
        }
      })();
      return state.stopPromise;
    },
  };
  schedule();
  return Object.freeze(heartbeat);
}

/**
 * Claims and executes the exact server-held action behind an approved request.
 * The approval + task lease claim is transactional and at-most-once: a crash
 * can safely drop an action, but can never replay an external side effect.
 */
export async function executeApprovedAction(
  approvalId: number,
  config: RuntimeOperationsConfig,
  dependencies: {
    executeAction?: typeof executeTool;
    locale?: WorkspaceLocale;
    afterClaimLocksBeforeTimestamp?: () => Promise<void>;
    beforeOperationEffectBoundary?: () => Promise<void>;
    afterEffectBeforeFinalization?: (receiptId: string) => Promise<void>;
    runtimeInstanceId?: string | null;
    leaseHeartbeatRuntime?: TaskLeaseHeartbeatRuntime;
  } = {},
): Promise<ApprovedActionExecutionResult> {
  const [candidate] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, approvalId));
  if (candidate?.consumedAt) {
    const [[consumedTask], durableReceipt] = await Promise.all([
      db
        .select({ blockedReason: tasksTable.blockedReason })
        .from(tasksTable)
        .where(eq(tasksTable.id, candidate.taskId)),
      findApprovedActionReceipt(approvalId),
    ]);
    if (
      candidate.decisionNote?.includes(APPROVAL_OUTCOME_UNKNOWN_MARKER) ||
      consumedTask?.blockedReason === "approval_outcome_unknown" ||
      durableReceipt?.state === "unknown"
    ) {
      return {
        status: "approval_outcome_unknown",
        claimed: false,
        approvalId,
        taskId: candidate.taskId,
        toolName: candidate.actionPayload?.toolName,
      };
    }
    if (durableReceipt?.state === "succeeded") {
      return {
        status: "queued",
        claimed: false,
        approvalId,
        taskId: candidate.taskId,
        toolName: durableReceipt.toolName,
      };
    }
  }
  await assertExecutionAllowed();
  if (
    !candidate?.actionPayload ||
    candidate.status !== "approved" ||
    candidate.consumedAt ||
    !candidate.expiresAt ||
    candidate.expiresAt.getTime() <= Date.now()
  ) {
    return { status: "queued", claimed: false, approvalId };
  }
  const requiredCategory = requiredApprovalCategoryForAction(
    candidate.actionPayload.toolName,
    candidate.actionPayload.args,
  );
  if (requiredCategory && candidate.category !== requiredCategory) {
    return { status: "queued", claimed: false, approvalId };
  }
  const approvedBrowserBinding: ApprovedBrowserBindingEvidence | null =
    candidate.browserRuntimeInstanceId &&
    candidate.browserSessionId &&
    candidate.browserSessionEpoch !== null &&
    candidate.browserSnapshotMarker &&
    candidate.browserBindingHash
      ? {
          runtimeInstanceId: candidate.browserRuntimeInstanceId,
          sessionId: candidate.browserSessionId,
          sessionEpoch: candidate.browserSessionEpoch,
          snapshotMarker: candidate.browserSnapshotMarker,
          bindingHash: candidate.browserBindingHash,
        }
      : null;
  const runtimeInstanceId =
    dependencies.runtimeInstanceId ??
    approvedBrowserBinding?.runtimeInstanceId ??
    null;
  if (
    (candidate.actionPayload.toolName === "browser_click" ||
      candidate.actionPayload.toolName === "browser_type") &&
    (!approvedBrowserBinding ||
      approvedBrowserBinding.runtimeInstanceId !== runtimeInstanceId ||
      candidate.bindingInvalidatedAt !== null)
  ) {
    return { status: "queued", claimed: false, approvalId };
  }

  if (candidate.actionPayload.toolName === "vm_run_sudo_command") {
    const sudoArgs = candidate.actionPayload.args;
    const keys = Object.keys(sudoArgs);
    const validated = validateAgentSudoCommand(sudoArgs.command);
    const [sudoAgent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, candidate.agentId));
    if (
      keys.length !== 1 ||
      keys[0] !== "command" ||
      !validated.ok ||
      candidate.scope?.toolName !== "vm_run_sudo_command" ||
      candidate.scope.argsHash !== hashToolArgs(sudoArgs) ||
      !sudoAgent?.isActive ||
      !sudoAgent.permissions.canUseSudo ||
      !(await isCanonicalRootCeo(sudoAgent)) ||
      !isAgentSudoEnabled()
    ) {
      return { status: "queued", claimed: false, approvalId };
    }
    const currentTarget = await getAgentSudoTarget(candidate.agentId);
    if (candidate.scope.target !== currentTarget.target) {
      // Host/sandbox affinity is checked before the approval or task is
      // consumed so another replica can never execute this capability.
      return { status: "queued", claimed: false, approvalId };
    }
  }

  // Read before acquiring a claim: failed preference reads must not leave a lease.
  const locale =
    (await readApprovedActionLocale(candidate)) ??
    dependencies.locale ??
    (await readWorkspaceLocale());
  getTerminalCopy(locale);
  const candidateIsSudo =
    candidate.actionPayload.toolName === "vm_run_sudo_command";
  const candidateArgsHash = hashToolArgs(candidate.actionPayload.args);
  const leaseOwner = `approval:${approvalId}:${randomUUID()}`;
  let approval = candidate;
  try {
    approval = await db.transaction(async (tx) => {
      await lockAndAssertExecutionAllowed(tx);
      // Serialize capability revocation with approval consumption. A permission
      // that was valid when requested is not authority forever.
      await tx.execute(
        sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${candidate.agentId} FOR UPDATE`,
      );
      await tx.execute(
        sql`SELECT id FROM ${approvalRequestsTable} WHERE ${approvalRequestsTable.id} = ${approvalId} FOR UPDATE`,
      );
      await tx.execute(
        sql`SELECT id FROM ${tasksTable} WHERE ${tasksTable.id} = ${candidate.taskId} FOR UPDATE`,
      );
      const [liveApprovalAgent] = await tx
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, candidate.agentId));
      const [liveApproval] = await tx
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, approvalId));
      const [liveTask] = await tx
        .select({
          ownerAgentId: tasksTable.ownerAgentId,
          status: tasksTable.status,
          leaseExpiresAt: tasksTable.leaseExpiresAt,
        })
        .from(tasksTable)
        .where(eq(tasksTable.id, candidate.taskId));
      await dependencies.afterClaimLocksBeforeTimestamp?.();
      const claimNow = new Date();
      const leaseExpiresAt = new Date(claimNow.getTime() + config.taskLeaseMs);
      if (
        !liveApprovalAgent?.isActive ||
        !liveApproval?.actionPayload ||
        liveApproval.taskId !== candidate.taskId ||
        liveApproval.agentId !== candidate.agentId ||
        liveApproval.status !== "approved" ||
        liveApproval.consumedAt !== null ||
        liveApproval.bindingInvalidatedAt !== null ||
        !liveApproval.expiresAt ||
        liveApproval.expiresAt.getTime() <= claimNow.getTime() ||
        liveApproval.category !== candidate.category ||
        liveApproval.actionPayload.toolName !==
          candidate.actionPayload!.toolName ||
        hashToolArgs(liveApproval.actionPayload.args) !== candidateArgsHash ||
        !agentAllowsApprovalCategory(
          liveApprovalAgent,
          liveApproval.category,
        ) ||
        (candidateIsSudo && !liveApprovalAgent.permissions.canUseSudo) ||
        !liveTask ||
        liveTask.ownerAgentId !== liveApproval.agentId ||
        liveTask.status !== "awaiting_approval" ||
        (liveTask.leaseExpiresAt !== null &&
          liveTask.leaseExpiresAt.getTime() >= claimNow.getTime()) ||
        (liveApprovalAgent.runLeaseExpiresAt !== null &&
          liveApprovalAgent.runLeaseExpiresAt.getTime() >= claimNow.getTime())
      ) {
        throw new ApprovedActionClaimConflict();
      }
      const claimedApproval = liveApproval;

      const [claimedAgent] = await tx
        .update(agentsTable)
        .set({
          runLeaseOwner: leaseOwner,
          runLeaseExpiresAt: leaseExpiresAt,
          status: "working",
          currentTaskId: claimedApproval.taskId,
          currentAction: terminalMessage(locale, "approvedAction", {
            tool: liveApproval.actionPayload.toolName,
          }),
          lastActiveAt: claimNow,
        })
        .where(
          and(
            eq(agentsTable.id, claimedApproval.agentId),
            eq(agentsTable.isActive, true),
            or(
              isNull(agentsTable.runLeaseExpiresAt),
              lt(agentsTable.runLeaseExpiresAt, claimNow),
            ),
          ),
        )
        .returning({ id: agentsTable.id });
      if (!claimedAgent) throw new ApprovedActionClaimConflict();

      const [claimedTask] = await tx
        .update(tasksTable)
        .set({ leaseOwner, leaseExpiresAt })
        .where(
          and(
            eq(tasksTable.id, claimedApproval.taskId),
            eq(tasksTable.ownerAgentId, claimedApproval.agentId),
            eq(tasksTable.status, "awaiting_approval"),
            or(
              isNull(tasksTable.leaseExpiresAt),
              lt(tasksTable.leaseExpiresAt, claimNow),
            ),
          ),
        )
        .returning({ id: tasksTable.id });
      if (!claimedTask) throw new ApprovedActionClaimConflict();
      return claimedApproval;
    });
  } catch (error) {
    if (error instanceof ApprovedActionClaimConflict) {
      return { status: "queued", claimed: false, approvalId };
    }
    throw error;
  }

  const leaseHeartbeat = startApprovedActionLeaseHeartbeat({
    currentAction: terminalMessage(locale, "approvedAction", {
      tool: candidate.actionPayload.toolName,
    }),
    approvalId,
    taskId: approval.taskId,
    agentId: approval.agentId,
    leaseOwner,
    runtimeInstanceId,
    browserBinding: approvedBrowserBinding,
    config,
    runtime: dependencies.leaseHeartbeatRuntime,
  });
  try {
    const payload = approval.actionPayload;
    const argsHash = payload ? hashToolArgs(payload.args) : "";
    // This value is written by requestApproval, never copied from tool args.
    // Missing/unknown values from pre-upgrade rows default to resume so an old
    // approval can never complete a multi-step task by accident.
    const taskDisposition =
      payload?.taskDisposition === "complete" ? "complete" : "resume";
    const scopeValid =
      Boolean(payload) &&
      APPROVAL_EXECUTABLE_TOOLS.has(payload!.toolName) &&
      approval.scope?.toolName === payload!.toolName &&
      approval.scope?.argsHash === argsHash;
    const releasePreEffectClaim = async (): Promise<void> => {
      await db.transaction(async (tx) => {
        await lockRuntimeControlState(tx);
        await tx.execute(
          sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${approval.agentId} FOR UPDATE`,
        );
        await tx.execute(
          sql`SELECT id FROM ${approvalRequestsTable} WHERE ${approvalRequestsTable.id} = ${approvalId} FOR UPDATE`,
        );
        await tx.execute(
          sql`SELECT id FROM ${tasksTable} WHERE ${tasksTable.id} = ${approval.taskId} FOR UPDATE`,
        );
        await tx
          .update(tasksTable)
          .set({ leaseOwner: null, leaseExpiresAt: null })
          .where(
            and(
              eq(tasksTable.id, approval.taskId),
              eq(tasksTable.leaseOwner, leaseOwner),
              eq(tasksTable.status, "awaiting_approval"),
            ),
          );
        await tx
          .update(agentsTable)
          .set({
            status: "idle",
            currentTaskId: null,
            currentAction: null,
            runLeaseOwner: null,
            runLeaseExpiresAt: null,
            lastActiveAt: new Date(),
          })
          .where(
            and(
              eq(agentsTable.id, approval.agentId),
              eq(agentsTable.runLeaseOwner, leaseOwner),
            ),
          );
      });
    };
    const unknownOutcome = async (
      error: unknown,
    ): Promise<ApprovedActionExecutionResult> => {
      const [[liveApproval], durableReceipt] = await Promise.all([
        db
          .select({ consumedAt: approvalRequestsTable.consumedAt })
          .from(approvalRequestsTable)
          .where(eq(approvalRequestsTable.id, approvalId)),
        findApprovedActionReceipt(approvalId),
      ]);
      if (durableReceipt?.state === "succeeded") {
        try {
          const finalization = await finalizeSucceededApprovedActionReceipt({
            receiptId: durableReceipt.id,
            expectedLeaseOwner: leaseOwner,
          });
          if (
            finalization.disposition === "finalized" ||
            finalization.disposition === "already_finalized"
          ) {
            return {
              status: finalization.status,
              claimed: true,
              approvalId,
              taskId: approval.taskId,
              toolName: durableReceipt.toolName,
            };
          }
        } catch (finalizationError) {
          logger.error(
            {
              error: finalizationError,
              approvalId,
              receiptId: durableReceipt.id,
            },
            "Succeeded approved effect remains pending after caller failure",
          );
        }
        return {
          status: "queued",
          claimed: true,
          approvalId,
          taskId: approval.taskId,
          toolName: durableReceipt.toolName,
        };
      }
      if (!liveApproval?.consumedAt) {
        await releasePreEffectClaim();
        return {
          status: "failed",
          claimed: true,
          approvalId,
          taskId: approval.taskId,
          toolName: payload?.toolName,
        };
      }
      await persistApprovedActionOutcomeUnknown({
        locale,
        approvalId,
        taskId: approval.taskId,
        agentId: approval.agentId,
        leaseOwner,
        error,
      });
      return {
        status: "approval_outcome_unknown",
        claimed: true,
        approvalId,
        taskId: approval.taskId,
        toolName: payload?.toolName,
      };
    };
    let agent: Agent | undefined;
    try {
      [agent] = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, approval.agentId));
    } catch (error) {
      return unknownOutcome(error);
    }

    let result: ToolExecutionResult = empty(
      getTerminalCopy(locale).effectFailure,
      "rejected",
    );
    try {
      if (!scopeValid || !payload) {
        result = empty(
          getTerminalCopy(locale).approvedScopeInvalid,
          "rejected",
        );
      } else if (!agent?.isActive) {
        result = empty(
          getTerminalCopy(locale).approvedAgentMissing,
          "rejected",
        );
      } else {
        result = await (dependencies.executeAction ?? executeTool)(
          {
            agent,
            locale,
            taskId: approval.taskId,
            taskLeaseOwner: leaseOwner,
            assertTaskLease: () => leaseHeartbeat.assertOwned(),
            attachOperationInvocation: (operation) =>
              leaseHeartbeat.attachOperationInvocation(operation),
            detachOperationInvocation: (invocationId) =>
              leaseHeartbeat.detachOperationInvocation(invocationId),
            operationInvocationLeaseMs: Math.min(
              config.taskLeaseMs,
              DEFAULT_OPERATION_INVOCATION_LEASE_MS,
            ),
            beforeOperationEffectBoundary: async () => {
              await leaseHeartbeat.assertOwned();
              await dependencies.beforeOperationEffectBoundary?.();
            },
            preapprovedAction: {
              approvalId,
              automaticPolicyRevision:
                approval.automaticPolicyRevision ?? undefined,
              toolName: payload.toolName,
              argsHash,
              capabilityArgs: payload.args,
              leaseOwner,
              category: approval.category as BusinessApprovalCategory,
              taskDisposition,
              browserBinding: approvedBrowserBinding,
            },
            operationIdentity: {
              executionKind: "approved_action",
              logicalExecutionId: `approval:${approvalId}`,
              runtimeInstanceId,
              originAttemptId: null,
              sourceMessageId: null,
              modelToolCallId: null,
              callSlot: "approved-action:0",
              agentLeaseOwner: leaseOwner,
            },
          },
          payload.toolName,
          canonicalJson(payload.args),
        );
        await leaseHeartbeat.assertOwned();
      }
    } catch (error) {
      return unknownOutcome(error);
    }

    if (result.toolOutcome === "outcome_unknown") {
      if (result.receiptId) {
        return {
          status: "approval_outcome_unknown",
          claimed: true,
          approvalId,
          taskId: approval.taskId,
          toolName: payload?.toolName,
        };
      }
      return unknownOutcome(
        new Error("Approved external effect outcome is uncertain"),
      );
    }
    if (result.toolOutcome === "unknown") {
      return {
        status: "approval_outcome_unknown",
        claimed: true,
        approvalId,
        taskId: approval.taskId,
        toolName: payload?.toolName,
      };
    }
    if (result.toolOutcome === "deferred") {
      await releasePreEffectClaim();
      return {
        status: "queued",
        claimed: true,
        approvalId,
        taskId: approval.taskId,
        toolName: payload?.toolName,
      };
    }

    const [[durableReceipt], [consumedApproval]] = await Promise.all([
      result.receiptId
        ? db
            .select({ state: operationReceiptsTable.state })
            .from(operationReceiptsTable)
            .where(eq(operationReceiptsTable.id, result.receiptId))
        : Promise.resolve([]),
      db
        .select({
          consumedAt: approvalRequestsTable.consumedAt,
          actionPayload: approvalRequestsTable.actionPayload,
        })
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, approvalId)),
    ]);
    if (
      !result.receiptId ||
      durableReceipt?.state !== "succeeded" ||
      !consumedApproval?.consumedAt ||
      consumedApproval.actionPayload !== null
    ) {
      if (durableReceipt?.state === "unknown") {
        return {
          status: "approval_outcome_unknown",
          claimed: true,
          approvalId,
          taskId: approval.taskId,
          toolName: payload?.toolName,
        };
      }
      if (!consumedApproval?.consumedAt) await releasePreEffectClaim();
      return {
        status: "failed",
        claimed: true,
        approvalId,
        taskId: approval.taskId,
        toolName: payload?.toolName,
      };
    }

    try {
      await dependencies.afterEffectBeforeFinalization?.(result.receiptId);
      const finalization = await finalizeSucceededApprovedActionReceipt({
        receiptId: result.receiptId,
        expectedLeaseOwner: leaseOwner,
      });
      if (
        finalization.disposition !== "finalized" &&
        finalization.disposition !== "already_finalized"
      ) {
        throw new Error(
          `Approved-action finalization is ${finalization.disposition}.`,
        );
      }
      return {
        status: finalization.status,
        claimed: true,
        approvalId,
        taskId: approval.taskId,
        toolName: payload?.toolName,
        // Output is returned only to this live internal caller. Durable recovery
        // and every persisted record use the receipt's bounded safe envelope.
        output: transientApprovedActionOutput(
          payload?.toolName,
          result,
          finalization.summary,
        ),
      };
    } catch (error) {
      logger.error(
        { error, approvalId, receiptId: result.receiptId },
        "Approved effect succeeded but task finalization remains pending",
      );
      return {
        status: "queued",
        claimed: true,
        approvalId,
        taskId: approval.taskId,
        toolName: payload?.toolName,
      };
    }
  } finally {
    await leaseHeartbeat.stop();
  }
}

const liveComputerActivityEvents = new Map<string, number>();

function computerActivityKey(step: ComputerStep): string {
  return `${step.sessionId}:${step.sequence}`;
}

async function beginLoggedComputerStep(
  ctx: ToolRuntimeContext,
  surface: ComputerSurface,
  tool: string,
): Promise<ComputerStep> {
  await assertDurableTaskBoundary(
    ctx,
    sharedToolText(
      ctx,
      tool,
      "computerBoundary",
      `Bilgisayar adimi · ${tool}`,
      { tool },
    ),
  );
  const step = beginComputerStep(
    ctx.agent.id,
    surface,
    tool,
    undefined,
    true,
    ctx.computerLoopId,
  );
  const type =
    surface === "terminal"
      ? "vm_command"
      : surface === "files"
        ? "vm_file"
        : "note";
  try {
    const event = await withTaskMutationFence(ctx, async (tx) => {
      const [persisted] = await tx
        .insert(activityEventsTable)
        .values({
          agentId: ctx.agent.id,
          taskId: ctx.taskId,
          type,
          summary: sharedToolText(
            ctx,
            tool,
            "computerStarted",
            `${ctx.agent.name} bilgisayar adımına başladı: ${tool.replaceAll("_", " ")}.`,
            { name: ctx.agent.name, tool },
          ),
          detail: computerStepDetail(step),
          severity: "info",
        })
        .returning({ id: activityEventsTable.id });
      return persisted;
    });
    if (event) {
      liveComputerActivityEvents.set(computerActivityKey(step), event.id);
    }
  } catch (error) {
    if (
      error instanceof TaskLeaseOwnershipLostError ||
      error instanceof EmergencyStopError
    ) {
      throw error;
    }
    logger.error(
      { error, agentId: ctx.agent.id, tool },
      "computer activity start persistence failed",
    );
  }
  return step;
}

async function logVmEvent(
  ctx: ToolRuntimeContext,
  type: "vm_command" | "vm_file" | "note",
  summary: string,
  detail?: Record<string, unknown>,
  severity: "info" | "warning" | "critical" = "info",
  computerStep?: ComputerStep,
): Promise<void> {
  try {
    const values = {
      agentId: ctx.agent.id,
      taskId: ctx.taskId,
      type,
      summary: summary.slice(0, 2000),
      detail: computerStep
        ? computerStepDetail(computerStep, detail)
        : (detail ?? null),
      severity,
    };
    const activityKey = computerStep ? computerActivityKey(computerStep) : null;
    const liveEventId = activityKey
      ? liveComputerActivityEvents.get(activityKey)
      : undefined;
    await withTaskMutationFence(ctx, async (tx) => {
      if (liveEventId !== undefined) {
        const updated = await tx
          .update(activityEventsTable)
          .set(values)
          .where(eq(activityEventsTable.id, liveEventId))
          .returning({ id: activityEventsTable.id });
        if (updated.length > 0) {
          liveComputerActivityEvents.delete(activityKey!);
          return;
        }
        // Retention/manual cleanup may have removed the running row. Fall through
        // to a completed insert so the durable ledger never loses the outcome.
        liveComputerActivityEvents.delete(activityKey!);
      }
      await tx.insert(activityEventsTable).values(values);
    });
  } catch (error) {
    if (
      error instanceof TaskLeaseOwnershipLostError ||
      error instanceof EmergencyStopError
    ) {
      throw error;
    }
    // Observability failure must never rewrite a completed browser/terminal
    // side effect as an execution failure. Keep the live map for recovery.
    logger.error(
      { error, agentId: ctx.agent.id, type },
      "computer activity completion persistence failed",
    );
  }
}

export async function reconcileInterruptedComputerActivities(): Promise<void> {
  const interruptionPatch = JSON.stringify({
    status: "failed",
    lifecyclePhase: "completed",
    interrupted: true,
    interruptedAt: new Date().toISOString(),
  });
  await db.update(activityEventsTable).set({
    // Cast the bound JSON explicitly. PostgreSQL/PGlite cannot infer a text
    // parameter's type when it appears as a variadic jsonb_build_object
    // value during process startup.
    detail: sql`${activityEventsTable.detail} || ${interruptionPatch}::jsonb`,
    severity: "warning",
  }).where(sql`${activityEventsTable.detail} ->> 'lifecyclePhase' = 'running'
      AND ${activityEventsTable.detail} ->> 'status' = 'running'
      AND (
        ${activityEventsTable.detail} ->> 'sessionId' LIKE 'computer:%'
        OR ${activityEventsTable.detail} ->> 'sessionId' LIKE 'operator:%'
      )`);
}

function computerErrorMessage(error: unknown, fallback: string): string {
  return redactAuditText(error instanceof Error ? error.message : fallback);
}

function terminalErrorMessage(
  error: unknown,
  locale: WorkspaceLocale,
  fallback: string,
): string {
  const copy = getTerminalCopy(locale);
  if (
    error instanceof EmergencyStopError ||
    error instanceof LocalEmergencyStopError
  )
    return copy.emergencyBlocked;
  if (error instanceof TaskLeaseOwnershipLostError) return copy.taskLeaseLost;
  if (error instanceof OperationInvocationOwnershipLostError)
    return copy.operationLeaseLost;
  if (error instanceof OperationInvocationStateError)
    return error.presentationReason
      ? copy[error.presentationReason]
      : copy.operationStateInvalid;
  return redactAuditText(localizedVmErrorMessage(error, locale, fallback));
}

function localizedToolErrorMessage(
  error: unknown,
  locale: WorkspaceLocale,
  fallback: string,
): string {
  if (
    error instanceof EmergencyStopError ||
    error instanceof LocalEmergencyStopError
  )
    return getToolCopy(locale).emergencyBlocked;
  if (error instanceof BrowserDiagnosticError)
    return redactAuditText(localizedBrowserDiagnostic(error, locale));
  return terminalErrorMessage(error, locale, fallback);
}

function formatLocalizedComputerStep(
  locale: WorkspaceLocale,
  step: ComputerStep,
  body: string,
): string {
  return formatComputerStep(step, body, getTerminalCopy(locale).stepStart);
}

function auditUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(
      /^https?:\/\//i.test(value) ? value : `https://${value}`,
    );
    return `${parsed.origin}${parsed.pathname}`.slice(0, 1_000);
  } catch {
    return "invalid-url";
  }
}

function fmtOutput(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  locale: WorkspaceLocale,
  started = true,
): string {
  const copy = getTerminalCopy(locale);
  const parts: string[] = [];
  if (stdout) parts.push(`STDOUT:\n${stdout.slice(0, 4000)}`);
  if (stderr) parts.push(`STDERR:\n${stderr.slice(0, 2000)}`);
  if (parts.length === 0) parts.push(copy.noOutput);
  parts.push(
    exitCode === null
      ? started
        ? copy.interrupted
        : copy.commandNotStarted
      : terminalMessage(locale, "exitCode", { code: exitCode }),
  );
  return parts.join("\n");
}

async function computerObserve(
  ctx: ToolRuntimeContext,
): Promise<ToolExecutionResult> {
  const locale = ctx.locale ?? "tr";
  const copy = getToolCopy(locale);
  const startLabel = getTerminalCopy(locale).stepStart;
  if (
    !ctx.agent.permissions.canUseTerminal &&
    !ctx.agent.permissions.canBrowse
  ) {
    return empty(copy.computerPermissionDenied, "rejected");
  }

  let started: ComputerStep | null = null;
  try {
    started = await beginLoggedComputerStep(
      ctx,
      "computer",
      "computer_observe",
    );
    await assertExecutionAllowed();
    await assertDurableTaskBoundary(ctx, copy.computerDispatch);
    const [vm, cwd, browser] = await Promise.all([
      getVmStatus(ctx.agent.id),
      ctx.agent.permissions.canUseTerminal
        ? getSandboxWorkingDirectory(ctx.agent.id)
        : Promise.resolve<string | null>(null),
      ctx.agent.permissions.canBrowse
        ? inspectBrowserSession(ctx.agent.id)
        : Promise.resolve(null),
    ]);
    const rootListing =
      ctx.agent.permissions.canUseTerminal && vm.exists
        ? await listDirectory(ctx.agent.id, "")
        : null;
    const browserSnapshot =
      ctx.agent.permissions.canBrowse &&
      browser?.active &&
      browser.control.owner === "agent"
        ? await runWithAgentBrowserControl(ctx.agent.id, () =>
            assertExecutionAllowed().then(() =>
              snapshotPage(ctx.agent.id, locale),
            ),
          )
        : null;
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "succeeded",
      auditUrl(browserSnapshot?.url ?? browser?.url) ?? cwd ?? "computer ready",
    );
    const trace = getComputerSessionSnapshot(ctx.agent.id);
    const lines = [
      copy.computerTitle,
      `session: ${trace.sessionId}`,
      `sequence: ${trace.sequence}`,
      `activeSurface: ${trace.activeSurface ?? "none"}`,
    ];

    if (ctx.agent.permissions.canUseTerminal) {
      lines.push(
        "",
        copy.workspaceTitle,
        `cwd: ${cwd ?? "/"}`,
        `workspace: ${vm.exists ? "ready" : "not-created"}`,
        `files: ${vm.fileCount} · directories: ${vm.dirCount} · bytes: ${vm.totalBytes}`,
      );
      if (rootListing?.entries.length) {
        lines.push(
          `rootEntries: ${rootListing.entries
            .slice(0, 20)
            .map((entry) =>
              entry.type === "directory" ? `${entry.name}/` : entry.name,
            )
            .join(", ")}`,
        );
      }
    }

    if (ctx.agent.permissions.canBrowse) {
      lines.push(
        "",
        copy.browserTitle,
        `session: ${browser?.active ? "active" : "idle"}`,
        `controlOwner: ${browser?.control.owner ?? "agent"}`,
        `controlLeaseExpiresAt: ${browser?.control.leaseExpiresAt ?? "none"}`,
        `channel: ${browser?.channel ?? "none"} · visibleWindow: ${browser?.visible ? "yes" : "no"}`,
        `page: ${browserSnapshot?.title || browser?.title || "(none)"} · ${browserSnapshot?.url || browser?.url || "about:blank"}`,
      );
      if (browserSnapshot) {
        lines.push("", ...browserSnapshot.lines.slice(0, 120));
      }
    }

    lines.push("", copy.computerRecent);
    for (const item of trace.recentSteps.slice(-8)) {
      lines.push(
        `#${item.sequence} ${item.surface} ${item.status} ${item.tool}` +
          (item.transition
            ? ` (${item.previousSurface ?? "none"} → ${item.surface})`
            : "") +
          (item.evidence ? ` · ${item.evidence}` : ""),
      );
    }
    lines.push("", copy.computerNext);

    await logVmEvent(
      ctx,
      "note",
      toolMessage(locale, "computerObserved", { name: ctx.agent.name }),
      {
        cwd,
        url: auditUrl(browserSnapshot?.url ?? browser?.url),
        title: browserSnapshot?.title ?? browser?.title ?? null,
        controlOwner: browser?.control.owner ?? null,
        fileCount: vm.fileCount,
      },
      "info",
      finished,
    );
    return empty(
      formatComputerStep(
        finished,
        lines.join("\n").slice(0, 12_000),
        startLabel,
      ),
      "succeeded",
    );
  } catch (error) {
    const message = localizedToolErrorMessage(
      error,
      locale,
      copy.computerFailure,
    );
    if (!started)
      return empty(
        toolMessage(locale, "computerError", { message }),
        "rejected",
      );
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "failed",
      message,
    );
    await logVmEvent(
      ctx,
      "note",
      toolMessage(locale, "computerObservationFailed", {
        name: ctx.agent.name,
      }),
      { error: message },
      "warning",
      finished,
    );
    return empty(
      formatComputerStep(
        finished,
        toolMessage(locale, "computerError", { message }),
        startLabel,
      ),
      "rejected",
    );
  }
}

async function vmRunCommand(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  let locale = ctx.locale ?? "tr";
  let copy = getTerminalCopy(locale);
  if (!ctx.agent.permissions.canUseTerminal) {
    return empty(copy.terminalPermissionDenied, "rejected");
  }
  const command = typeof args.command === "string" ? args.command.trim() : "";
  if (!command)
    return empty(
      terminalMessage(locale, "errorPrefix", { message: copy.commandRequired }),
      "rejected",
    );

  const commandName = auditCommandName(command).toLowerCase();
  let program: Awaited<ReturnType<typeof resolveLocalProgram>>;
  try {
    program = await resolveLocalProgram(command);
  } catch {
    return empty(copy.terminalFailureFallback, "rejected");
  }
  if (["rm", "del"].includes(commandName) || program) {
    const approved = await consumeScopedApproval(ctx, "vm_run_command", args);
    if (!approved) {
      return empty(
        terminalMessage(locale, "approvalRequired", {
          toolName: "vm_run_command",
          args: canonicalJson(args),
          category: program ? "other" : "delete",
        }),
        "rejected",
      );
    }
  }
  const commandHash = createHash("sha256").update(command).digest("hex");
  let started: ComputerStep | null = null;
  try {
    return await runDurableExternalEffect(ctx, {
      toolName: "vm_run_command",
      normalizedArgs: {
        commandHash: `sha256:${commandHash}`,
        commandName: commandName.slice(0, 80),
        commandChars: command.length,
      },
      execute: async ({ startEffect, executionLocale }) => {
        locale = executionLocale ?? locale;
        copy = getTerminalCopy(locale);
        ctx = { ...ctx, locale };
        started = await beginLoggedComputerStep(
          ctx,
          "terminal",
          "vm_run_command",
        );
        await assertExecutionAllowed();
        await assertDurableTaskBoundary(ctx, copy.terminalDispatch);
        let effectBoundaryCrossed = false;
        const crossEffectBoundary: FileEffectHook = async (): Promise<void> => {
          await program?.revalidate();
          await startEffect();
          effectBoundaryCrossed = true;
        };
        crossEffectBoundary.revalidate = async () => {
          await startEffect.revalidate?.();
          await program?.revalidate();
        };
        const result = program
          ? await execArgvInSandbox(
              ctx.agent.id,
              program.argv,
              30000,
              crossEffectBoundary,
              locale,
            )
          : await execInSandbox(
              ctx.agent.id,
              command,
              undefined,
              crossEffectBoundary,
              locale,
            );
        // Sandbox mutators and spawned processes cross the boundary immediately
        // before their effect. Successful read-only builtins intentionally do
        // not call that hook; complete their approval-bound observation only
        // after the read has succeeded. Retrying remains safe if this commit
        // fails because those builtins cannot mutate external state.
        if (!effectBoundaryCrossed && result.ok) {
          await crossEffectBoundary();
        }
        const cwd = result.cwd ?? "/";
        const finished = finishComputerStep(
          ctx.agent.id,
          started,
          result.ok ? "succeeded" : "failed",
          `cwd=${cwd}; exitCode=${result.exitCode ?? "null"}`,
        );
        try {
          await logVmEvent(
            ctx,
            "vm_command",
            result.ok
              ? terminalMessage(locale, "terminalExecuted", {
                  name: ctx.agent.name,
                  command: commandName,
                })
              : terminalMessage(locale, "terminalFailed", {
                  name: ctx.agent.name,
                }),
            {
              commandName: commandName.slice(0, 80),
              commandChars: command.length,
              commandHash,
              cwd,
              exitCode: result.exitCode,
              outputStored: false,
            },
            result.ok ? "info" : "warning",
            finished,
          );
        } catch (telemetryError) {
          logger.error(
            { error: telemetryError, commandHash },
            "VM command completed but telemetry persistence failed",
          );
        }

        const note = result.note
          ? terminalMessage(locale, "note", { note: result.note })
          : "";
        return {
          result: empty(
            formatComputerStep(
              finished,
              `${fmtOutput(result.stdout, result.stderr, result.exitCode, locale, effectBoundaryCrossed && !result.note?.startsWith("spawn-error:"))}${note}`,
              copy.stepStart,
            ),
            result.ok ? "succeeded" : "rejected",
          ),
          resultData: {
            executionLocale: locale,
            ok: result.ok,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
          },
        };
      },
      onError: async (error) => {
        const message = terminalErrorMessage(
          error,
          locale,
          copy.terminalFailureFallback,
        );
        if (!started)
          return empty(
            terminalMessage(locale, "terminalError", { message }),
            "rejected",
          );
        const finished = finishComputerStep(
          ctx.agent.id,
          started,
          "failed",
          message,
        );
        await logVmEvent(
          ctx,
          "vm_command",
          terminalMessage(locale, "terminalFailed", { name: ctx.agent.name }),
          { error: message, commandHash },
          "warning",
          finished,
        );
        return empty(
          formatComputerStep(
            finished,
            terminalMessage(locale, "terminalError", { message }),
            copy.stepStart,
          ),
          "rejected",
        );
      },
    });
  } catch (error) {
    const message = terminalErrorMessage(
      error,
      locale,
      copy.terminalFailureFallback,
    );
    if (!started)
      return empty(
        terminalMessage(locale, "terminalError", { message }),
        "rejected",
      );
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "failed",
      message,
    );
    await logVmEvent(
      ctx,
      "vm_command",
      terminalMessage(locale, "terminalFailed", { name: ctx.agent.name }),
      { error: message },
      "warning",
      finished,
    );
    return empty(
      formatComputerStep(
        finished,
        terminalMessage(locale, "terminalError", { message }),
        copy.stepStart,
      ),
      "rejected",
    );
  }
}

async function vmRunSudoCommand(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  let locale = ctx.locale ?? "tr";
  let copy = getTerminalCopy(locale);
  if (!(await isCanonicalRootCeo(ctx.agent))) {
    return empty(copy.sudoRootOnly, "rejected");
  }
  if (!ctx.agent.permissions.canUseSudo) {
    return empty(copy.sudoPermissionDenied, "rejected");
  }

  const validated = validateAgentSudoCommand(args.command, locale);
  if (!validated.ok)
    return empty(
      terminalMessage(locale, "errorPrefix", { message: validated.error }),
      "rejected",
    );
  const command = validated.command;
  if (!isAgentSudoEnabled()) {
    return empty(copy.sudoDisabled, "rejected");
  }

  // Normalize the capability payload so the approval hash binds precisely to
  // the command that will be passed to the platform shell.
  const scopedArgs = { command };
  if (
    !ctx.preapprovedAction ||
    ctx.preapprovedAction.toolName !== "vm_run_sudo_command" ||
    ctx.preapprovedAction.argsHash !== hashToolArgs(scopedArgs)
  ) {
    return empty(copy.sudoApprovalRequired, "rejected");
  }
  const approved = await consumeScopedApproval(
    ctx,
    "vm_run_sudo_command",
    scopedArgs,
  );
  if (!approved) {
    return empty(copy.sudoApprovalRequired, "rejected");
  }
  const argsHash = hashToolArgs(scopedArgs);
  let started: ComputerStep | null = null;
  let completedTelemetry:
    | { finished: ComputerStep; exitCode: number | null; ok: boolean }
    | undefined;
  try {
    const durableResult = await runDurableExternalEffect(ctx, {
      toolName: "vm_run_sudo_command",
      normalizedArgs: scopedArgs,
      execute: async ({ startEffect, executionLocale }) => {
        locale = executionLocale ?? locale;
        copy = getTerminalCopy(locale);
        ctx = { ...ctx, locale };
        started = await beginLoggedComputerStep(
          ctx,
          "terminal",
          "vm_run_sudo_command",
        );
        await assertExecutionAllowed();
        await assertDurableTaskBoundary(ctx, copy.sudoDispatch);
        const result = await execAgentSudo({
          agentId: ctx.agent.id,
          command,
          approvalId: ctx.preapprovedAction!.approvalId,
          leaseOwner: ctx.preapprovedAction!.leaseOwner,
          argsHash: ctx.preapprovedAction!.argsHash,
          beforeEffect: startEffect,
          locale,
        });
        const finished = finishComputerStep(
          ctx.agent.id,
          started,
          result.ok ? "succeeded" : "failed",
          `argsHash=${argsHash.slice(0, 12)}; exitCode=${result.exitCode ?? "null"}`,
        );
        completedTelemetry = {
          finished,
          exitCode: result.exitCode,
          ok: result.ok,
        };
        const note = result.note
          ? terminalMessage(locale, "note", { note: result.note })
          : "";
        const stdoutPreview = approvedOutputPreview(
          result.stdout,
          APPROVED_STDOUT_MAX_BYTES,
        );
        const stderrPreview = approvedOutputPreview(
          result.stderr,
          APPROVED_STDERR_MAX_BYTES,
        );
        return {
          result: {
            content: formatComputerStep(
              finished,
              `${fmtOutput(result.stdout, result.stderr, result.exitCode, locale, result.exitCode !== null || result.note === "agent-sudo" || Boolean(result.note?.startsWith("signal:")))}${note}`,
              copy.stepStart,
            ),
            createdTasks: [],
            createdAgents: [],
            toolOutcome: result.ok ? "succeeded" : "rejected",
            sudoOutcome: {
              ok: result.ok,
              exitCode: result.exitCode,
              durationMs: result.durationMs,
              argsHash,
              stdoutPreview: stdoutPreview.value,
              stderrPreview: stderrPreview.value,
              outputTruncated:
                stdoutPreview.truncated || stderrPreview.truncated,
            },
          },
          resultData: {
            executionLocale: locale,
            ok: result.ok,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
          },
        };
      },
      onError: async (error) => {
        const message = terminalErrorMessage(
          error,
          locale,
          copy.sudoFailureFallback,
        );
        if (!started)
          return empty(
            terminalMessage(locale, "terminalError", { message }),
            "rejected",
          );
        const finished = finishComputerStep(
          ctx.agent.id,
          started,
          "failed",
          message,
        );
        try {
          await logVmEvent(
            ctx,
            "vm_command",
            terminalMessage(locale, "sudoFailed", { name: ctx.agent.name }),
            { error: message, argsHash },
            "warning",
            finished,
          );
        } catch (telemetryError) {
          logger.error(
            {
              error: telemetryError,
              approvalId: ctx.preapprovedAction?.approvalId,
            },
            "Approved sudo failure telemetry could not be persisted",
          );
        }
        return empty(
          formatComputerStep(
            finished,
            terminalMessage(locale, "terminalError", { message }),
            copy.stepStart,
          ),
          "rejected",
        );
      },
    });
    if (completedTelemetry) {
      try {
        await logVmEvent(
          ctx,
          "vm_command",
          completedTelemetry.ok
            ? terminalMessage(locale, "sudoExecuted", {
                name: ctx.agent.name,
                exitCode: completedTelemetry.exitCode ?? "null",
              })
            : terminalMessage(locale, "sudoFailed", { name: ctx.agent.name }),
          {
            authority: "agent_sudo",
            source: "autonomous_tool",
            argsHash,
            approvalId: ctx.preapprovedAction?.approvalId ?? null,
            exitCode: completedTelemetry.exitCode,
          },
          "warning",
          completedTelemetry.finished,
        );
      } catch (telemetryError) {
        logger.error(
          {
            error: telemetryError,
            approvalId: ctx.preapprovedAction?.approvalId,
          },
          "Approved sudo command telemetry could not be persisted",
        );
      }
    }
    return durableResult;
  } catch (error) {
    const message = terminalErrorMessage(
      error,
      locale,
      copy.sudoFailureFallback,
    );
    return empty(
      terminalMessage(locale, "terminalError", { message }),
      "rejected",
    );
  }
}

async function vmListFiles(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const locale = ctx.locale ?? "tr";
  const copy = getToolCopy(locale);
  const common = getTerminalCopy(locale);
  if (!ctx.agent.permissions.canUseTerminal)
    return empty(common.terminalPermissionDenied, "rejected");
  const relPath = typeof args.path === "string" ? args.path : "";
  let started: ComputerStep | null = null;
  try {
    started = await beginLoggedComputerStep(ctx, "files", "vm_list_files");
    await assertExecutionAllowed();
    await assertDurableTaskBoundary(ctx, copy.listDispatch);
    const listing = await listDirectory(ctx.agent.id, relPath);
    const canClaimEmpty =
      listing.entries.length === 0 &&
      !listing.truncated &&
      listing.skipped === 0;
    const shown = Math.min(listing.entries.length, 100);
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "succeeded",
      `/${listing.path}; entries=${listing.total}`,
    );
    await logVmEvent(
      ctx,
      "vm_file",
      toolMessage(
        locale,
        canClaimEmpty ? "directoryEmptyListed" : "directoryListed",
        { name: ctx.agent.name, path: listing.path },
      ),
      {
        path: `/${listing.path}`,
        count: listing.total,
        shown,
        truncated: listing.truncated,
        skipped: listing.skipped,
      },
      "info",
      finished,
    );
    if (canClaimEmpty)
      return empty(
        formatComputerStep(
          finished,
          toolMessage(locale, "directoryEmpty", { path: listing.path }),
          common.stepStart,
        ),
        "succeeded",
      );
    const lines = listing.entries.slice(0, 100).map((entry) =>
      entry.type === "directory"
        ? `[DIR]  ${entry.path}`
        : toolMessage(locale, "directoryFile", {
            path: entry.path,
            bytes: entry.sizeBytes,
          }),
    );
    return empty(
      formatComputerStep(
        finished,
        [
          ...lines,
          toolMessage(locale, "directoryObserved", {
            shown,
            count: listing.total,
          }),
          ...(listing.truncated ? [copy.directoryScanLimited] : []),
          ...(listing.skipped
            ? [
                toolMessage(locale, "directoryEntriesSkipped", {
                  count: listing.skipped,
                }),
              ]
            : []),
        ].join("\n"),
        common.stepStart,
      ),
      "succeeded",
    );
  } catch (error) {
    const message = localizedToolErrorMessage(error, locale, copy.listFailure);
    if (!started) return empty(message, "rejected");
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "failed",
      message,
    );
    await logVmEvent(
      ctx,
      "vm_file",
      toolMessage(locale, "directoryListFailed", { name: ctx.agent.name }),
      { path: relPath, error: message },
      "warning",
      finished,
    );
    return empty(
      formatComputerStep(finished, message, common.stepStart),
      "rejected",
    );
  }
}

async function vmReadFile(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const locale = ctx.locale ?? "tr";
  const copy = getToolCopy(locale);
  const common = getTerminalCopy(locale);
  if (!ctx.agent.permissions.canUseTerminal)
    return empty(common.terminalPermissionDenied, "rejected");
  const relPath = typeof args.path === "string" ? args.path.trim() : "";
  let started: ComputerStep | null = null;
  try {
    started = await beginLoggedComputerStep(ctx, "files", "vm_read_file");
    await assertExecutionAllowed();
    await assertDurableTaskBoundary(ctx, copy.readDispatch);
    const file = await readTextFile(ctx.agent.id, relPath);
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "succeeded",
      `${file.path}; bytes=${file.sizeBytes}`,
    );
    await logVmEvent(
      ctx,
      "vm_file",
      toolMessage(locale, "fileRead", {
        name: ctx.agent.name,
        path: file.path,
      }),
      { path: file.path, sizeBytes: file.sizeBytes, truncated: file.truncated },
      "info",
      finished,
    );
    return empty(
      formatComputerStep(
        finished,
        file.content + (file.truncated ? "\n" + copy.fileTruncated : ""),
        common.stepStart,
      ),
      "succeeded",
    );
  } catch (error) {
    const message = localizedToolErrorMessage(error, locale, copy.readFailure);
    if (!started) return empty(message, "rejected");
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "failed",
      message,
    );
    await logVmEvent(
      ctx,
      "vm_file",
      toolMessage(locale, "fileReadFailed", { name: ctx.agent.name }),
      { path: relPath, error: message },
      "warning",
      finished,
    );
    return empty(
      formatComputerStep(finished, message, common.stepStart),
      "rejected",
    );
  }
}

async function vmWriteFile(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  let locale = ctx.locale ?? "tr";
  let copy = getToolCopy(locale);
  let common = getTerminalCopy(locale);
  if (!ctx.agent.permissions.canUseTerminal)
    return empty(common.terminalPermissionDenied, "rejected");
  if (typeof args.path !== "string") return empty(copy.pathInvalid, "rejected");
  if (typeof args.content !== "string")
    return empty(copy.contentRequired, "rejected");
  const relPath = args.path.trim();
  const content = args.content;
  if (!relPath) return empty(copy.pathRequired, "rejected");
  let started: ComputerStep | null = null;
  const failure = async (error: unknown, eventPath: string) => {
    const message = localizedToolErrorMessage(error, locale, copy.writeFailure);
    if (!started) return empty(message, "rejected");
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "failed",
      message,
    );
    await logVmEvent(
      ctx,
      "vm_file",
      toolMessage(locale, "fileWriteFailed", { name: ctx.agent.name }),
      { path: eventPath, error: message },
      "warning",
      finished,
    );
    return empty(
      formatComputerStep(finished, message, common.stepStart),
      "rejected",
    );
  };
  try {
    const normalizedPath = safeResolve(ctx.agent.id, relPath).rel;
    const contentBytes = Buffer.byteLength(content, "utf8");
    const contentHash = createHash("sha256").update(content).digest("hex");
    return await runDurableExternalEffect(ctx, {
      toolName: "vm_write_file",
      normalizedArgs: {
        path: normalizedPath,
        contentHash: `sha256:${contentHash}`,
        byteCount: contentBytes,
      },
      execute: async ({ startEffect, executionLocale }) => {
        locale = executionLocale ?? locale;
        copy = getToolCopy(locale);
        ctx = { ...ctx, locale };
        common = getTerminalCopy(locale);
        started = await beginLoggedComputerStep(ctx, "files", "vm_write_file");
        await assertExecutionAllowed();
        await assertDurableTaskBoundary(ctx, copy.writeDispatch);
        const res = await writeTextFile(
          ctx.agent.id,
          normalizedPath,
          content,
          undefined,
          startEffect,
        );
        const finished = finishComputerStep(
          ctx.agent.id,
          started,
          "succeeded",
          `${res.path}; bytes=${res.sizeBytes}`,
        );
        await logVmEvent(
          ctx,
          "vm_file",
          toolMessage(locale, "fileWritten", {
            name: ctx.agent.name,
            path: res.path,
            bytes: res.sizeBytes,
          }),
          { path: res.path, sizeBytes: res.sizeBytes },
          "info",
          finished,
        );
        return {
          result: empty(
            formatComputerStep(
              finished,
              toolMessage(locale, "fileWriteComplete", {
                path: res.path,
                bytes: res.sizeBytes,
              }),
              common.stepStart,
            ),
            "succeeded",
          ),
          resultData: {
            pathHash: `sha256:${createHash("sha256").update(res.path).digest("hex")}`,
            byteCount: res.sizeBytes,
          },
        };
      },
      onError: (error) => failure(error, normalizedPath),
    });
  } catch (error) {
    return failure(error, relPath);
  }
}

// --- tarayici araclari -----------------------------------------------------

async function browserOpen(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  let locale = ctx.locale ?? "tr";
  let copy = getToolCopy(locale);
  if (!ctx.agent.permissions.canBrowse) {
    return empty(copy.browserPermissionDenied, "rejected");
  }
  const url = (args.url as string).trim();
  if (!url) return empty(copy.browserUrlRequired, "rejected");
  let normalizedUrl: string;
  try {
    normalizedUrl = new URL(url).toString();
  } catch {
    return empty(copy.browserUrlInvalid, "rejected");
  }
  let started: ComputerStep | null = null;
  try {
    return await runDurableExternalEffect(ctx, {
      toolName: "browser_open",
      normalizedArgs: { url: normalizedUrl },
      execute: async ({ startEffect, executionLocale }) => {
        locale = executionLocale ?? locale;
        copy = getToolCopy(locale);
        ctx = { ...ctx, locale };
        started = await beginLoggedComputerStep(ctx, "browser", "browser_open");
        const { finalUrl, snap } = await runWithAgentBrowserControl(
          ctx.agent.id,
          async () => {
            await assertExecutionAllowed();
            await assertDurableTaskBoundary(ctx, copy.browserOpenDispatch);
            const finalUrl = await navigateTo(
              ctx.agent.id,
              normalizedUrl,
              undefined,
              undefined,
              startEffect,
            );
            const snap = await snapshotPage(ctx.agent.id, locale);
            return { finalUrl, snap };
          },
        );
        const finished = finishComputerStep(
          ctx.agent.id,
          started,
          "succeeded",
          auditUrl(finalUrl),
        );
        try {
          await logVmEvent(
            ctx,
            "vm_command",
            toolMessage(locale, "browserOpened", { name: ctx.agent.name }),
            { url: auditUrl(finalUrl), title: snap.title },
            "info",
            finished,
          );
        } catch (telemetryError) {
          logger.error(
            { error: telemetryError },
            "Browser navigation completed but telemetry persistence failed",
          );
        }
        return {
          result: empty(
            formatLocalizedComputerStep(
              locale,
              finished,
              snap.lines.join("\n").slice(0, 6000),
            ),
            "succeeded",
          ),
          resultData: {
            originHash: `sha256:${createHash("sha256").update(new URL(finalUrl).origin).digest("hex")}`,
            snapshotHash: `sha256:${createHash("sha256").update(snap.lines.join("\n")).digest("hex")}`,
          },
        };
      },
      onError: async (error) => {
        const message = localizedToolErrorMessage(
          error,
          locale,
          copy.browserUnknown,
        );
        if (!started)
          return empty(
            toolMessage(locale, "browserError", { message }),
            "rejected",
          );
        const finished = finishComputerStep(
          ctx.agent.id,
          started,
          "failed",
          message,
        );
        await logVmEvent(
          ctx,
          "vm_command",
          toolMessage(locale, "browserOpenFailed", { name: ctx.agent.name }),
          { requestedUrl: auditUrl(normalizedUrl), error: message },
          "warning",
          finished,
        );
        return empty(
          formatLocalizedComputerStep(
            locale,
            finished,
            toolMessage(locale, "browserError", { message }),
          ),
          "rejected",
        );
      },
    });
  } catch (error) {
    const message = localizedToolErrorMessage(
      error,
      locale,
      copy.browserUnknown,
    );
    if (!started)
      return empty(
        toolMessage(locale, "browserError", { message }),
        "rejected",
      );
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "failed",
      message,
    );
    await logVmEvent(
      ctx,
      "vm_command",
      toolMessage(locale, "browserOpenFailed", { name: ctx.agent.name }),
      { requestedUrl: auditUrl(normalizedUrl), error: message },
      "warning",
      finished,
    );
    return empty(
      formatLocalizedComputerStep(
        locale,
        finished,
        toolMessage(locale, "browserError", { message }),
      ),
      "rejected",
    );
  }
}

async function browserSnapshot(
  ctx: ToolRuntimeContext,
): Promise<ToolExecutionResult> {
  const locale = ctx.locale ?? "tr";
  const copy = getToolCopy(locale);
  if (!ctx.agent.permissions.canBrowse) {
    return empty(copy.browserPermissionDenied, "rejected");
  }
  const started = await beginLoggedComputerStep(
    ctx,
    "browser",
    "browser_snapshot",
  );
  try {
    const snap = await runWithAgentBrowserControl(ctx.agent.id, async () => {
      await assertExecutionAllowed();
      await assertDurableTaskBoundary(ctx, copy.browserSnapshotDispatch);
      return snapshotPage(ctx.agent.id, locale);
    });
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "succeeded",
      auditUrl(snap.url),
    );
    await logVmEvent(
      ctx,
      "note",
      toolMessage(locale, "browserObserved", { name: ctx.agent.name }),
      { url: auditUrl(snap.url), title: snap.title, charCount: snap.charCount },
      "info",
      finished,
    );
    return empty(
      formatLocalizedComputerStep(
        locale,
        finished,
        snap.lines.join("\n").slice(0, 8000),
      ),
      "succeeded",
    );
  } catch (error) {
    const message = localizedToolErrorMessage(
      error,
      locale,
      copy.browserUnknown,
    );
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "failed",
      message,
    );
    await logVmEvent(
      ctx,
      "note",
      toolMessage(locale, "browserObserveFailed", { name: ctx.agent.name }),
      { error: message },
      "warning",
      finished,
    );
    return empty(
      formatLocalizedComputerStep(
        locale,
        finished,
        toolMessage(locale, "browserSnapshotError", { message }),
      ),
      "rejected",
    );
  }
}

async function browserClick(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  let locale = ctx.locale ?? "tr";
  let copy = getToolCopy(locale);
  if (!ctx.agent.permissions.canBrowse)
    return empty(copy.browserPermissionDenied, "rejected");
  const ref = args.ref as number;
  if (!Number.isFinite(ref)) return empty(copy.browserRefRequired, "rejected");
  if (ctx.preapprovedAction) {
    const preflight = await resolveApprovedBrowserPreflight(
      ctx,
      "browser_click",
      ref,
      args,
    );
    if (!preflight) {
      return empty(copy.browserTargetChanged, "rejected");
    }
    let approvedStarted: ComputerStep | null = null;
    return runDurableExternalEffect(ctx, {
      toolName: "browser_click",
      normalizedArgs: preflight.scopedArgs,
      browserBinding: ctx.preapprovedAction.browserBinding,
      execute: async ({ startEffect, executionLocale }) => {
        locale = executionLocale ?? locale;
        copy = getToolCopy(locale);
        ctx = { ...ctx, locale };
        approvedStarted = await beginLoggedComputerStep(
          ctx,
          "browser",
          "browser_click",
        );
        await assertExecutionAllowed();
        await assertDurableTaskBoundary(ctx, copy.browserApprovedClickDispatch);
        await clickRef(ctx.agent.id, ref, preflight.binding, startEffect);
        const snap = await snapshotPage(ctx.agent.id, locale);
        const finished = finishComputerStep(
          ctx.agent.id,
          approvedStarted,
          "succeeded",
          `${auditUrl(snap.url)}; ref=${ref}`,
        );
        try {
          await logVmEvent(
            ctx,
            "vm_command",
            toolMessage(locale, "browserApprovedClicked", {
              name: ctx.agent.name,
            }),
            {
              ref,
              url: auditUrl(snap.url),
              targetRole: preflight.binding.role,
              contentStored: false,
            },
            "info",
            finished,
          );
        } catch (telemetryError) {
          logger.error(
            {
              error: telemetryError,
              approvalId: ctx.preapprovedAction?.approvalId,
            },
            "Approved browser click telemetry could not be persisted",
          );
        }
        return {
          result: empty(
            formatLocalizedComputerStep(
              locale,
              finished,
              `${copy.browserClicked}\n\n${snap.lines.join("\n").slice(0, 5000)}`,
            ),
            "succeeded",
          ),
          resultData: {
            ok: true,
            snapshotHash: `sha256:${createHash("sha256").update(snap.lines.join("\n")).digest("hex")}`,
          },
        };
      },
      onError: async (error) => {
        const message = localizedToolErrorMessage(
          error,
          locale,
          copy.browserUnknown,
        );
        if (!approvedStarted)
          return empty(
            toolMessage(locale, "browserClickError", { message }),
            "rejected",
          );
        const finished = finishComputerStep(
          ctx.agent.id,
          approvedStarted,
          "failed",
          message,
        );
        return empty(
          formatLocalizedComputerStep(
            locale,
            finished,
            toolMessage(locale, "browserClickError", { message }),
          ),
          "rejected",
        );
      },
    });
  }
  let binding: BrowserActionBinding;
  try {
    binding = await runWithAgentBrowserControl(ctx.agent.id, () =>
      getBrowserActionBinding(ctx.agent.id, ref),
    );
  } catch (error) {
    const started = await beginLoggedComputerStep(
      ctx,
      "browser",
      "browser_click",
    );
    const message = localizedToolErrorMessage(
      error,
      locale,
      copy.browserUnknown,
    );
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "failed",
      message,
    );
    await logVmEvent(
      ctx,
      "vm_command",
      toolMessage(locale, "browserClickFailed", { name: ctx.agent.name }),
      { ref, error: message },
      "warning",
      finished,
    );
    return empty(
      formatLocalizedComputerStep(
        locale,
        finished,
        toolMessage(locale, "browserClickError", { message }),
      ),
      "rejected",
    );
  }

  const safeNavigationLink =
    binding.tag === "a" &&
    Boolean(binding.href) &&
    !binding.hasOnClick &&
    /^https?:\/\//i.test(binding.href ?? "");
  if (!safeNavigationLink) {
    const started = await beginLoggedComputerStep(
      ctx,
      "browser",
      "browser_click",
    );
    try {
      await assertExecutionAllowed();
      await assertDurableTaskBoundary(ctx, copy.browserClickDispatch);
      const scopedArgs = { ...args, __browserContext: binding };
      const approved = await consumeScopedApproval(
        ctx,
        "browser_click",
        scopedArgs,
      );
      if (!approved) {
        const finished = finishComputerStep(
          ctx.agent.id,
          started,
          "blocked",
          `ref=${ref}; approval required`,
        );
        await logVmEvent(
          ctx,
          "vm_command",
          toolMessage(locale, "browserClickApproval", { name: ctx.agent.name }),
          {
            ref,
            url: auditUrl(binding.pageUrl),
            targetRole: binding.role,
            targetText: binding.text,
          },
          "warning",
          finished,
        );
        return empty(
          formatLocalizedComputerStep(
            locale,
            finished,
            approvalRequiredMessage(
              "browser_click",
              scopedArgs,
              "external_contact",
              locale,
            ),
          ),
          "rejected",
        );
      }
      throw new Error(copy.browserTargetChanged);
    } catch (error) {
      const message = localizedToolErrorMessage(
        error,
        locale,
        copy.browserUnknown,
      );
      const finished = finishComputerStep(
        ctx.agent.id,
        started,
        "failed",
        message,
      );
      await logVmEvent(
        ctx,
        "vm_command",
        toolMessage(locale, "browserClickFailed", { name: ctx.agent.name }),
        { ref, error: message },
        "warning",
        finished,
      );
      return empty(
        formatLocalizedComputerStep(
          locale,
          finished,
          toolMessage(locale, "browserClickError", { message }),
        ),
        "rejected",
      );
    }
  }

  const destinationHash = `sha256:${createHash("sha256")
    .update(binding.href!)
    .digest("hex")}`;
  const runtimeInstanceId = ctx.operationIdentity?.runtimeInstanceId ?? null;
  const ordinaryBrowserBinding: ApprovedBrowserBindingEvidence | null =
    runtimeInstanceId === null
      ? null
      : {
          runtimeInstanceId,
          sessionId: binding.sessionId,
          sessionEpoch: binding.sessionEpoch,
          snapshotMarker: binding.snapshotMarker,
          bindingHash: `sha256:${createHash("sha256")
            .update(
              canonicalizeJson({
                runtimeInstanceId,
                sessionId: binding.sessionId,
                sessionEpoch: binding.sessionEpoch,
                snapshotMarker: binding.snapshotMarker,
                toolName: "browser_click",
                bindingRef: ref,
                destinationHash,
              }),
              "utf8",
            )
            .digest("hex")}`,
        };
  let started: ComputerStep | null = null;
  return runDurableExternalEffect(ctx, {
    toolName: "browser_click",
    normalizedArgs: { bindingRef: ref, destinationHash },
    browserBinding: ordinaryBrowserBinding,
    execute: async ({ startEffect, executionLocale }) => {
      locale = executionLocale ?? locale;
      copy = getToolCopy(locale);
      ctx = { ...ctx, locale };
      started = await beginLoggedComputerStep(ctx, "browser", "browser_click");
      const snap = await runWithAgentBrowserControl(ctx.agent.id, async () => {
        await assertExecutionAllowed();
        await assertDurableTaskBoundary(ctx, copy.browserLinkDispatch);
        await navigateTo(
          ctx.agent.id,
          binding.href!,
          "agent",
          undefined,
          startEffect,
          {
            sessionId: binding.sessionId,
            sessionEpoch: binding.sessionEpoch,
          },
        );
        return snapshotPage(ctx.agent.id, locale);
      });
      const snapshotHash = `sha256:${createHash("sha256")
        .update(snap.lines.join("\n"))
        .digest("hex")}`;
      const finished = finishComputerStep(
        ctx.agent.id,
        started,
        "succeeded",
        `ref=${ref}; destinationHash=${destinationHash}`,
      );
      try {
        await logVmEvent(
          ctx,
          "vm_command",
          toolMessage(locale, "browserLinkOpened", { name: ctx.agent.name }),
          { bindingRef: ref, destinationHash, snapshotHash },
          "info",
          finished,
        );
      } catch (telemetryError) {
        logger.error(
          { error: telemetryError, destinationHash },
          "Safe browser navigation completed but telemetry persistence failed",
        );
      }
      return {
        result: empty(
          formatLocalizedComputerStep(
            locale,
            finished,
            `${copy.browserClicked}\n\n${snap.lines.join("\n").slice(0, 5000)}`,
          ),
          "succeeded",
        ),
        resultData: { ok: true, snapshotHash },
      };
    },
    onError: async (_error) => {
      const message = copy.browserLinkFailure;
      if (!started)
        return empty(
          toolMessage(locale, "browserClickError", { message }),
          "rejected",
        );
      const finished = finishComputerStep(
        ctx.agent.id,
        started,
        "failed",
        `${message} destinationHash=${destinationHash}`,
      );
      await logVmEvent(
        ctx,
        "vm_command",
        toolMessage(locale, "browserLinkFailed", { name: ctx.agent.name }),
        { bindingRef: ref, destinationHash, error: message },
        "warning",
        finished,
      );
      return empty(
        formatLocalizedComputerStep(
          locale,
          finished,
          toolMessage(locale, "browserClickError", { message }),
        ),
        "rejected",
      );
    },
  });
}

async function browserType(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  let locale = ctx.locale ?? "tr";
  let copy = getToolCopy(locale);
  if (!ctx.agent.permissions.canBrowse)
    return empty(copy.browserPermissionDenied, "rejected");
  const ref = args.ref as number;
  const text = args.text as string;
  const submit = args.submit === true;
  if (!Number.isFinite(ref)) return empty(copy.browserRefRequired, "rejected");
  if (submit) {
    return empty(copy.browserSeparateSubmit, "rejected");
  }
  if (ctx.preapprovedAction) {
    const preflight = await resolveApprovedBrowserPreflight(
      ctx,
      "browser_type",
      ref,
      args,
    );
    if (!preflight) {
      return empty(copy.browserFieldChanged, "rejected");
    }
    let approvedStarted: ComputerStep | null = null;
    return runDurableExternalEffect(ctx, {
      toolName: "browser_type",
      normalizedArgs: preflight.scopedArgs,
      browserBinding: ctx.preapprovedAction.browserBinding,
      execute: async ({ startEffect, executionLocale }) => {
        locale = executionLocale ?? locale;
        copy = getToolCopy(locale);
        ctx = { ...ctx, locale };
        approvedStarted = await beginLoggedComputerStep(
          ctx,
          "browser",
          "browser_type",
        );
        await assertExecutionAllowed();
        await assertDurableTaskBoundary(ctx, copy.browserApprovedTypeDispatch);
        await fillRef(ctx.agent.id, ref, text, preflight.binding, startEffect);
        const snap = await snapshotPage(ctx.agent.id, locale);
        const finished = finishComputerStep(
          ctx.agent.id,
          approvedStarted,
          "succeeded",
          `${auditUrl(snap.url)}; ref=${ref}; chars=${text.length}`,
        );
        try {
          await logVmEvent(
            ctx,
            "vm_command",
            toolMessage(locale, "browserApprovedTyped", {
              name: ctx.agent.name,
            }),
            {
              ref,
              url: auditUrl(snap.url),
              characterCount: text.length,
              contentStored: false,
            },
            "info",
            finished,
          );
        } catch (telemetryError) {
          logger.error(
            {
              error: telemetryError,
              approvalId: ctx.preapprovedAction?.approvalId,
            },
            "Approved browser type telemetry could not be persisted",
          );
        }
        return {
          result: empty(
            formatLocalizedComputerStep(
              locale,
              finished,
              `${copy.browserTyped}\n\n${snap.lines.join("\n").slice(0, 5000)}`,
            ),
            "succeeded",
          ),
          resultData: {
            ok: true,
            snapshotHash: `sha256:${createHash("sha256").update(snap.lines.join("\n")).digest("hex")}`,
          },
        };
      },
      onError: async (error) => {
        const message = localizedToolErrorMessage(
          error,
          locale,
          copy.browserUnknown,
        );
        if (!approvedStarted)
          return empty(
            toolMessage(locale, "browserTypeError", { message }),
            "rejected",
          );
        const finished = finishComputerStep(
          ctx.agent.id,
          approvedStarted,
          "failed",
          message,
        );
        return empty(
          formatLocalizedComputerStep(
            locale,
            finished,
            toolMessage(locale, "browserTypeError", { message }),
          ),
          "rejected",
        );
      },
    });
  }
  const started = await beginLoggedComputerStep(ctx, "browser", "browser_type");
  let approvedEffectCompleted = false;
  try {
    return await runWithAgentBrowserControl(ctx.agent.id, async () => {
      await assertExecutionAllowed();
      await assertDurableTaskBoundary(ctx, copy.browserTypeDispatch);
      const binding = await getBrowserActionBinding(ctx.agent.id, ref);
      if (binding.sensitive) {
        const finished = finishComputerStep(
          ctx.agent.id,
          started,
          "blocked",
          `ref=${ref}; sensitive field`,
        );
        await logVmEvent(
          ctx,
          "vm_command",
          toolMessage(locale, "browserSensitiveAvoided", {
            name: ctx.agent.name,
          }),
          { ref, url: auditUrl(binding.pageUrl), targetRole: binding.role },
          "warning",
          finished,
        );
        return empty(
          formatLocalizedComputerStep(
            locale,
            finished,
            copy.browserSensitiveBlocked,
          ),
          "rejected",
        );
      }
      const scopedArgs = { ...args, __browserContext: binding };
      const approved = await consumeScopedApproval(
        ctx,
        "browser_type",
        scopedArgs,
      );
      if (!approved) {
        const finished = finishComputerStep(
          ctx.agent.id,
          started,
          "blocked",
          `ref=${ref}; approval required`,
        );
        await logVmEvent(
          ctx,
          "vm_command",
          toolMessage(locale, "browserTypeApproval", { name: ctx.agent.name }),
          {
            ref,
            url: auditUrl(binding.pageUrl),
            targetRole: binding.role,
            targetText: binding.text,
          },
          "warning",
          finished,
        );
        return empty(
          formatLocalizedComputerStep(
            locale,
            finished,
            approvalRequiredMessage(
              "browser_type",
              scopedArgs,
              "external_contact",
              locale,
            ),
          ),
          "rejected",
        );
      }
      await assertDurableTaskBoundary(ctx, copy.browserApprovedTypeDispatch);
      await fillRef(ctx.agent.id, ref, text, binding);
      approvedEffectCompleted = true;
      const snap = await snapshotPage(ctx.agent.id, locale);
      const finished = finishComputerStep(
        ctx.agent.id,
        started,
        "succeeded",
        `${auditUrl(snap.url)}; ref=${ref}; chars=${text.length}`,
      );
      await logVmEvent(
        ctx,
        "vm_command",
        toolMessage(locale, "browserApprovedTyped", { name: ctx.agent.name }),
        {
          ref,
          url: auditUrl(snap.url),
          title: snap.title,
          characterCount: text.length,
          contentStored: false,
        },
        "info",
        finished,
      );
      return empty(
        formatLocalizedComputerStep(
          locale,
          finished,
          `${copy.browserTyped}\n\n${snap.lines.join("\n").slice(0, 5000)}`,
        ),
        "succeeded",
      );
    });
  } catch (error) {
    const effectOutcomeUncertain =
      approvedEffectCompleted || isBrowserActionOutcomeUnknownError(error);
    const message = localizedToolErrorMessage(
      error,
      locale,
      copy.browserUnknown,
    );
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "failed",
      message,
    );
    await logVmEvent(
      ctx,
      "vm_command",
      toolMessage(locale, "browserTypeFailed", { name: ctx.agent.name }),
      { ref, error: message, contentStored: false },
      "warning",
      finished,
    );
    return empty(
      formatLocalizedComputerStep(
        locale,
        finished,
        toolMessage(locale, "browserTypeError", { message }),
      ),
      effectOutcomeUncertain ? "outcome_unknown" : "rejected",
    );
  }
}

async function browserScroll(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  let locale = ctx.locale ?? "tr";
  let copy = getToolCopy(locale);
  if (!ctx.agent.permissions.canBrowse)
    return empty(copy.browserPermissionDenied, "rejected");
  const direction = args.direction === "up" ? "up" : "down";
  let started: ComputerStep | null = null;
  try {
    return await runDurableExternalEffect(ctx, {
      toolName: "browser_scroll",
      normalizedArgs: { direction },
      execute: async ({ startEffect, executionLocale }) => {
        locale = executionLocale ?? locale;
        copy = getToolCopy(locale);
        ctx = { ...ctx, locale };
        started = await beginLoggedComputerStep(
          ctx,
          "browser",
          "browser_scroll",
        );
        const snap = await runWithAgentBrowserControl(
          ctx.agent.id,
          async () => {
            await assertExecutionAllowed();
            await assertDurableTaskBoundary(ctx, copy.browserScrollDispatch);
            await scrollPage(ctx.agent.id, direction, startEffect);
            return snapshotPage(ctx.agent.id, locale);
          },
        );
        const finished = finishComputerStep(
          ctx.agent.id,
          started,
          "succeeded",
          `${auditUrl(snap.url)}; direction=${direction}`,
        );
        try {
          await logVmEvent(
            ctx,
            "vm_command",
            toolMessage(
              locale,
              direction === "down"
                ? "browserScrolledDown"
                : "browserScrolledUp",
              { name: ctx.agent.name },
            ),
            { direction, url: auditUrl(snap.url), title: snap.title },
            "info",
            finished,
          );
        } catch (telemetryError) {
          logger.error(
            { error: telemetryError },
            "Browser scroll completed but telemetry persistence failed",
          );
        }
        return {
          result: empty(
            formatLocalizedComputerStep(
              locale,
              finished,
              `${direction === "down" ? copy.browserDown : copy.browserUp}\n\n${snap.lines.join("\n").slice(0, 5000)}`,
            ),
            "succeeded",
          ),
          resultData: {
            snapshotHash: `sha256:${createHash("sha256").update(snap.lines.join("\n")).digest("hex")}`,
          },
        };
      },
      onError: async (error) => {
        const message = localizedToolErrorMessage(
          error,
          locale,
          copy.browserUnknown,
        );
        if (!started)
          return empty(
            toolMessage(locale, "browserScrollError", { message }),
            "rejected",
          );
        const finished = finishComputerStep(
          ctx.agent.id,
          started,
          "failed",
          message,
        );
        await logVmEvent(
          ctx,
          "vm_command",
          toolMessage(locale, "browserScrollFailed", { name: ctx.agent.name }),
          { direction, error: message },
          "warning",
          finished,
        );
        return empty(
          formatLocalizedComputerStep(
            locale,
            finished,
            toolMessage(locale, "browserScrollError", { message }),
          ),
          "rejected",
        );
      },
    });
  } catch (error) {
    const message = localizedToolErrorMessage(
      error,
      locale,
      copy.browserUnknown,
    );
    if (!started)
      return empty(
        toolMessage(locale, "browserScrollError", { message }),
        "rejected",
      );
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "failed",
      message,
    );
    await logVmEvent(
      ctx,
      "vm_command",
      toolMessage(locale, "browserScrollFailed", { name: ctx.agent.name }),
      { direction, error: message },
      "warning",
      finished,
    );
    return empty(
      formatLocalizedComputerStep(
        locale,
        finished,
        toolMessage(locale, "browserScrollError", { message }),
      ),
      "rejected",
    );
  }
}

async function browserExtract(
  ctx: ToolRuntimeContext,
): Promise<ToolExecutionResult> {
  const locale = ctx.locale ?? "tr";
  const copy = getToolCopy(locale);
  if (!ctx.agent.permissions.canBrowse)
    return empty(copy.browserPermissionDenied, "rejected");
  const started = await beginLoggedComputerStep(
    ctx,
    "browser",
    "browser_extract_text",
  );
  try {
    const text = await runWithAgentBrowserControl(ctx.agent.id, async () => {
      await assertExecutionAllowed();
      await assertDurableTaskBoundary(ctx, copy.browserExtractDispatch);
      return extractText(ctx.agent.id);
    });
    const browser = await inspectBrowserSession(ctx.agent.id);
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "succeeded",
      `${auditUrl(browser.url) ?? "about:blank"}; chars=${text.length}`,
    );
    await logVmEvent(
      ctx,
      "note",
      toolMessage(locale, "browserExtracted", { name: ctx.agent.name }),
      {
        url: auditUrl(browser.url),
        title: browser.title,
        characterCount: text.length,
      },
      "info",
      finished,
    );
    return empty(
      formatLocalizedComputerStep(
        locale,
        finished,
        text || copy.browserEmptyText,
      ),
      "succeeded",
    );
  } catch (error) {
    const message = localizedToolErrorMessage(
      error,
      locale,
      copy.browserUnknown,
    );
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "failed",
      message,
    );
    await logVmEvent(
      ctx,
      "note",
      toolMessage(locale, "browserExtractFailed", { name: ctx.agent.name }),
      { error: message },
      "warning",
      finished,
    );
    return empty(
      formatLocalizedComputerStep(
        locale,
        finished,
        toolMessage(locale, "browserExtractError", { message }),
      ),
      "rejected",
    );
  }
}

async function browserWait(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const locale = ctx.locale ?? "tr";
  const copy = getToolCopy(locale);
  if (!ctx.agent.permissions.canBrowse)
    return empty(copy.browserPermissionDenied, "rejected");
  const milliseconds = Math.min(
    5_000,
    Math.max(250, Math.floor(Number(args.milliseconds) || 1_000)),
  );
  const started = await beginLoggedComputerStep(ctx, "browser", "browser_wait");
  try {
    const snap = await runWithAgentBrowserControl(ctx.agent.id, async () => {
      await assertExecutionAllowed();
      await assertDurableTaskBoundary(ctx, copy.browserWaitDispatch);
      await waitForPage(ctx.agent.id, milliseconds);
      return snapshotPage(ctx.agent.id, locale);
    });
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "succeeded",
      `${auditUrl(snap.url)}; waitedMs=${milliseconds}`,
    );
    await logVmEvent(
      ctx,
      "note",
      toolMessage(locale, "browserWaited", { name: ctx.agent.name }),
      { url: auditUrl(snap.url), title: snap.title, waitedMs: milliseconds },
      "info",
      finished,
    );
    return empty(
      formatLocalizedComputerStep(
        locale,
        finished,
        `${toolMessage(locale, "browserWaitComplete", { milliseconds })}\n\n${snap.lines.join("\n").slice(0, 6000)}`,
      ),
      "succeeded",
    );
  } catch (error) {
    const message = localizedToolErrorMessage(
      error,
      locale,
      copy.browserUnknown,
    );
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "failed",
      message,
    );
    await logVmEvent(
      ctx,
      "note",
      toolMessage(locale, "browserWaitFailed", { name: ctx.agent.name }),
      { waitedMs: milliseconds, error: message },
      "warning",
      finished,
    );
    return empty(
      formatLocalizedComputerStep(
        locale,
        finished,
        toolMessage(locale, "browserWaitError", { message }),
      ),
      "rejected",
    );
  }
}

async function browserSaveScreenshot(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  let locale = ctx.locale ?? "tr";
  let copy = getToolCopy(locale);
  if (!ctx.agent.permissions.canBrowse)
    return empty(copy.browserPermissionDenied, "rejected");
  const requestedName =
    typeof args.name === "string" ? args.name.trim().slice(0, 120) : "";
  const deterministicSuffix = createHash("sha256")
    .update(
      `${ctx.operationIdentity?.logicalExecutionId ?? `agent:${ctx.agent.id}`}:${ctx.operationIdentity?.callSlot ?? "direct"}`,
    )
    .digest("hex")
    .slice(0, 20);
  const name = requestedName || `kanit-${deterministicSuffix}.png`;
  let started: ComputerStep | null = null;
  try {
    return await runDurableExternalEffect(ctx, {
      toolName: "browser_save_screenshot",
      normalizedArgs: { name },
      execute: async ({ startEffect, executionLocale }) => {
        locale = executionLocale ?? locale;
        copy = getToolCopy(locale);
        ctx = { ...ctx, locale };
        started = await beginLoggedComputerStep(
          ctx,
          "browser",
          "browser_save_screenshot",
        );
        const { saved, browser } = await runWithAgentBrowserControl(
          ctx.agent.id,
          async () => {
            await assertExecutionAllowed();
            await assertDurableTaskBoundary(
              ctx,
              copy.browserScreenshotDispatch,
            );
            const saved = await saveScreenshotToSandbox(
              ctx.agent.id,
              name,
              startEffect,
            );
            const browser = await inspectBrowserSession(ctx.agent.id);
            return { saved, browser };
          },
        );
        const finished = finishComputerStep(
          ctx.agent.id,
          started,
          "succeeded",
          `${saved.path}; bytes=${saved.sizeBytes}`,
        );
        try {
          await logVmEvent(
            ctx,
            "vm_file",
            toolMessage(locale, "browserScreenshotSaved", {
              name: ctx.agent.name,
            }),
            {
              path: saved.path,
              sizeBytes: saved.sizeBytes,
              url: auditUrl(browser.url),
              title: browser.title,
            },
            "info",
            finished,
          );
        } catch (telemetryError) {
          logger.error(
            { error: telemetryError },
            "Browser screenshot completed but telemetry persistence failed",
          );
        }
        return {
          result: empty(
            formatLocalizedComputerStep(
              locale,
              finished,
              [
                toolMessage(locale, "browserPngSaved", { path: saved.path }),
                toolMessage(locale, "browserSize", { bytes: saved.sizeBytes }),
                toolMessage(locale, "browserPage", {
                  title: browser.title || copy.browserUntitled,
                  url: browser.url ?? "about:blank",
                }),
              ].join("\n"),
            ),
            "succeeded",
          ),
          resultData: {
            pathHash: `sha256:${createHash("sha256").update(saved.path).digest("hex")}`,
            byteCount: saved.sizeBytes,
          },
        };
      },
      onError: async (error) => {
        const message = localizedToolErrorMessage(
          error,
          locale,
          copy.browserUnknown,
        );
        if (!started)
          return empty(
            toolMessage(locale, "browserScreenshotError", { message }),
            "rejected",
          );
        const finished = finishComputerStep(
          ctx.agent.id,
          started,
          "failed",
          message,
        );
        await logVmEvent(
          ctx,
          "vm_file",
          toolMessage(locale, "browserScreenshotFailed", {
            name: ctx.agent.name,
          }),
          { error: message },
          "warning",
          finished,
        );
        return empty(
          formatLocalizedComputerStep(
            locale,
            finished,
            toolMessage(locale, "browserScreenshotError", { message }),
          ),
          "rejected",
        );
      },
    });
  } catch (error) {
    const message = localizedToolErrorMessage(
      error,
      locale,
      copy.browserUnknown,
    );
    if (!started)
      return empty(
        toolMessage(locale, "browserScreenshotError", { message }),
        "rejected",
      );
    const finished = finishComputerStep(
      ctx.agent.id,
      started,
      "failed",
      message,
    );
    await logVmEvent(
      ctx,
      "vm_file",
      toolMessage(locale, "browserScreenshotFailed", { name: ctx.agent.name }),
      { error: message },
      "warning",
      finished,
    );
    return empty(
      formatLocalizedComputerStep(
        locale,
        finished,
        toolMessage(locale, "browserScreenshotError", { message }),
      ),
      "rejected",
    );
  }
}

async function createSubAgent(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const locale = ctx.locale ?? "tr";
  const copy = getToolCopy(locale);
  const text = toolMessage.bind(null, locale);
  if (!ctx.agent.permissions.canCreateSubAgents) {
    return empty(copy.teamCreateDenied, "rejected");
  }
  const name = args.name as string;
  const role = args.role as string;
  const systemPrompt = args.systemPrompt as string;
  if (!name || !role || !systemPrompt) {
    return empty(
      text("teamStringRequired", { field: "name/role/systemPrompt" }),
      "rejected",
    );
  }

  let created;
  try {
    created = await withTaskMutationFence(ctx, async (tx) => {
      await assertActiveAgentCapacity(tx);
      if (ctx.taskId) {
        const [lockedTask] = await tx
          .update(tasksTable)
          .set({ leaseExpiresAt: sql`${tasksTable.leaseExpiresAt}` })
          .where(
            and(
              eq(tasksTable.id, ctx.taskId),
              eq(tasksTable.leaseOwner, ctx.taskLeaseOwner!),
              inArray(tasksTable.status, ACTIVE_TASK_STATUSES),
            ),
          )
          .returning({ id: tasksTable.id });
        if (!lockedTask) throw new TaskLeaseOwnershipLostError();
      }

      const [child] = await tx
        .insert(agentsTable)
        .values({
          name,
          role,
          department: ctx.agent.department,
          parentAgentId: ctx.agent.id,
          depth: ctx.agent.depth + 1,
          status: "idle",
          systemPrompt,
          isCustomPrompt: true,
          templateKey: null,
          modelMode: "auto",
          modelId: null,
          avatarColor: avatarColorFor(`${ctx.agent.id}-${name}`),
          permissions: {
            canCreateSubAgents:
              specialistPermissionsPreset.canCreateSubAgents &&
              ctx.agent.permissions.canCreateSubAgents,
            canDelegate:
              specialistPermissionsPreset.canDelegate &&
              ctx.agent.permissions.canDelegate,
            canSpend:
              specialistPermissionsPreset.canSpend &&
              ctx.agent.permissions.canSpend,
            canDelete:
              specialistPermissionsPreset.canDelete &&
              ctx.agent.permissions.canDelete,
            canPublish:
              specialistPermissionsPreset.canPublish &&
              ctx.agent.permissions.canPublish,
            canContactExternal:
              specialistPermissionsPreset.canContactExternal &&
              ctx.agent.permissions.canContactExternal,
            canBrowse:
              specialistPermissionsPreset.canBrowse &&
              ctx.agent.permissions.canBrowse,
            canUseTerminal:
              specialistPermissionsPreset.canUseTerminal &&
              ctx.agent.permissions.canUseTerminal,
            canUseSudo:
              specialistPermissionsPreset.canUseSudo &&
              ctx.agent.permissions.canUseSudo,
          },
          createdByAgentId: ctx.agent.id,
          createdByUser: false,
          isActive: true,
        })
        .returning();
      await tx.insert(activityEventsTable).values({
        agentId: ctx.agent.id,
        taskId: ctx.taskId,
        type: "subagent_created",
        summary: text("teamAgentActivity", {
          name: ctx.agent.name,
          child: name,
          role,
        }),
        detail: { newAgentId: child.id },
        severity: "info",
      });
      return child;
    });
  } catch (error) {
    if (error instanceof RuntimeCapacityError) {
      return empty(
        text("teamAgentCapacity", { limit: error.limit }),
        "rejected",
      );
    }
    throw error;
  }
  if (!created) {
    return empty(copy.teamCreateStopped, "rejected");
  }

  return {
    content: text("teamAgentCreated", { id: created.id }),
    createdTasks: [],
    createdAgents: [created],
    toolOutcome: "succeeded",
    operationResultData: { agentId: created.id },
  };
}

async function delegateTask(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const locale = ctx.locale ?? "tr";
  const copy = getToolCopy(locale);
  const text = toolMessage.bind(null, locale);
  if (!ctx.agent.permissions.canDelegate) {
    return empty(copy.teamDelegateDenied, "rejected");
  }
  const agentId = Number(args.agentId);
  const title = args.title as string;
  const brief = args.brief as string;
  const priority =
    typeof args.priority === "string" &&
    ["low", "normal", "high", "urgent"].includes(args.priority)
      ? (args.priority as "low" | "normal" | "high" | "urgent")
      : "normal";
  const autonomyMode =
    args.autonomyMode === undefined
      ? "finite"
      : args.autonomyMode === "finite" || args.autonomyMode === "continuous"
        ? args.autonomyMode
        : null;
  const cadenceValue =
    args.cadenceSeconds === undefined || args.cadenceSeconds === null
      ? null
      : Number(args.cadenceSeconds);

  if (!agentId || !title || !brief) {
    return empty(
      text("teamStringRequired", { field: "agentId/title/brief" }),
      "rejected",
    );
  }
  if (brief.length > 8_000) {
    return empty(copy.teamBriefTooLong, "rejected");
  }
  if (
    !autonomyMode ||
    (cadenceValue !== null &&
      (!Number.isSafeInteger(cadenceValue) ||
        cadenceValue < 60 ||
        cadenceValue > 604_800)) ||
    (autonomyMode === "finite" && cadenceValue !== null)
  ) {
    return empty(copy.teamCadenceInvalid, "rejected");
  }
  const cadenceSeconds =
    autonomyMode === "continuous" ? (cadenceValue ?? 60) : null;

  let task;
  try {
    task = await withTaskMutationFence(
      ctx,
      async (tx) => {
        // Serialize the authoritative target snapshot with deactivation and
        // task cancellation before the parent task row is touched.
        const [target] = await tx
          .select()
          .from(agentsTable)
          .where(eq(agentsTable.id, agentId));
        if (!target || !target.isActive) return null;
        if (target.parentAgentId !== ctx.agent.id) return null;
        await assertOutstandingTaskCapacity(tx);
        if (ctx.taskId) {
          const [lockedTask] = await tx
            .update(tasksTable)
            .set({ leaseExpiresAt: sql`${tasksTable.leaseExpiresAt}` })
            .where(
              and(
                eq(tasksTable.id, ctx.taskId),
                eq(tasksTable.leaseOwner, ctx.taskLeaseOwner!),
                inArray(tasksTable.status, ACTIVE_TASK_STATUSES),
              ),
            )
            .returning({ id: tasksTable.id });
          if (!lockedTask) throw new TaskLeaseOwnershipLostError();
        }

        const [delegated] = await tx
          .insert(tasksTable)
          .values({
            title,
            brief,
            status: "pending",
            priority,
            autonomyMode,
            cadenceSeconds,
            ownerAgentId: target.id,
            assignedByAgentId: ctx.agent.id,
            createdByUser: false,
            parentTaskId: ctx.taskId,
            progressPercent: 0,
            executionModelId:
              target.modelMode === "manual" ? target.modelId : null,
          })
          .returning();
        await tx.insert(activityEventsTable).values([
          {
            agentId: target.id,
            taskId: delegated.id,
            type: "task_created",
            summary: text("teamTaskCreatedActivity", { title }),
            detail: {
              delegationLifecycle: "created",
              fromAgentId: ctx.agent.id,
              toAgentId: target.id,
              parentTaskId: ctx.taskId,
            },
            severity: "info" as const,
          },
          {
            agentId: ctx.agent.id,
            taskId: delegated.id,
            type: "task_delegated",
            summary: text("teamDelegatedActivity", {
              name: ctx.agent.name,
              title,
              target: target.name,
              role: target.role,
            }),
            detail: {
              delegationLifecycle: "assigned",
              fromAgentId: ctx.agent.id,
              toAgentId: target.id,
              parentTaskId: ctx.taskId,
            },
            severity: "info" as const,
          },
        ]);
        return delegated;
      },
      { additionalAgentIds: [agentId] },
    );
  } catch (error) {
    if (error instanceof RuntimeCapacityError) {
      return empty(
        text("teamTaskCapacity", { limit: error.limit }),
        "rejected",
      );
    }
    throw error;
  }
  if (!task) {
    return empty(copy.teamDelegateStopped, "rejected");
  }

  return {
    content: text("teamDelegated", { id: task.id }),
    createdTasks: [task],
    createdAgents: [],
    toolOutcome: "succeeded",
    operationResultData: { taskId: task.id },
  };
}

async function updateTaskProgress(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const locale = ctx.locale ?? "tr";
  const copy = getToolCopy(locale);
  const text = toolMessage.bind(null, locale);
  if (!ctx.taskId) {
    return empty(copy.teamTaskContext, "rejected");
  }
  const progressPercent = Math.max(
    0,
    Math.min(100, Math.round(Number(args.progressPercent) || 0)),
  );
  const note =
    typeof args.note === "string" && args.note.trim()
      ? args.note
      : copy.teamProgressDefault;

  const updated = await withTaskMutationFence(ctx, async (tx) => {
    const [task] = await tx
      .update(tasksTable)
      .set({ progressPercent, status: "in_progress" })
      .where(
        and(
          eq(tasksTable.id, ctx.taskId!),
          eq(tasksTable.leaseOwner, ctx.taskLeaseOwner!),
          inArray(tasksTable.status, ACTIVE_TASK_STATUSES),
        ),
      )
      .returning({
        id: tasksTable.id,
        assignedByAgentId: tasksTable.assignedByAgentId,
      });
    if (!task) throw new TaskLeaseOwnershipLostError();
    await tx.insert(activityEventsTable).values({
      agentId: ctx.agent.id,
      taskId: ctx.taskId,
      type: "progress_update",
      summary: redactAuditText(note, 2_000, true),
      detail: {
        progressPercent,
        ...(task.assignedByAgentId !== null
          ? {
              delegationLifecycle: "progress",
              fromAgentId: ctx.agent.id,
              toAgentId: task.assignedByAgentId,
            }
          : {}),
      },
      severity: "info",
    });
    return task;
  });
  if (!updated) {
    return empty(copy.teamProgressStopped, "rejected");
  }

  return {
    ...empty(
      text("teamProgressSaved", { progress: progressPercent }),
      "succeeded",
    ),
    operationResultData: { progress: progressPercent },
  };
}

async function completeTask(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  let locale = ctx.locale ?? "tr";
  let copy = getToolCopy(locale);
  let text = toolMessage.bind(null, locale);
  if (!ctx.taskId) {
    return empty(copy.teamTaskContext, "rejected");
  }
  const resultSummary = args.resultSummary as string;
  if (!resultSummary)
    return empty(
      text("teamStringRequired", { field: "resultSummary" }),
      "rejected",
    );

  const [task] = await db
    .select()
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.id, ctx.taskId),
        eq(tasksTable.leaseOwner, ctx.taskLeaseOwner!),
        inArray(tasksTable.status, ACTIVE_TASK_STATUSES),
      ),
    );
  if (!task) {
    return empty(copy.teamTaskLost, "rejected");
  }
  const [unresolvedSubtask] = await db
    .select({ id: tasksTable.id, status: tasksTable.status })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.parentTaskId, ctx.taskId),
        inArray(tasksTable.status, [
          "pending",
          "planning",
          "in_progress",
          "awaiting_approval",
          "blocked",
        ]),
      ),
    )
    .limit(1);
  if (unresolvedSubtask) {
    return empty(
      text("teamChildUnresolved", {
        id: unresolvedSubtask.id,
        status: unresolvedSubtask.status,
      }),
      "rejected",
    );
  }

  const lifecycleReservation = isDurableTaskContext(ctx)
    ? await reserveDurableLifecycleOperation(ctx, "complete_task", {
        resultSummary: resultSummary.trim(),
      })
    : null;
  if (lifecycleReservation && lifecycleReservation.disposition !== "reserved") {
    return lifecycleOperationDispositionResult(
      "complete_task",
      lifecycleReservation,
      locale,
    );
  }

  if (lifecycleReservation) {
    locale = toolReceiptLocale(lifecycleReservation.receipt) ?? locale;
    copy = getToolCopy(locale);
    text = toolMessage.bind(null, locale);
    ctx = { ...ctx, locale };
  }

  const judgeResult = await runJudge({
    locale,
    agent: ctx.agent,
    taskId: ctx.taskId,
    purpose: "completion",
    originalBrief: task.brief,
    actionSummary: resultSummary,
    taskExecutionModelId: resolveJudgeExecutionModelBoundary({
      taskExecutionModelId: task.executionModelId,
      turnModelId: ctx.turnModelId,
      agentModelMode: ctx.agent.modelMode,
      agentModelId: ctx.agent.modelId,
    }),
    beforeAttempt: () => heartbeatJudgeTaskLease(ctx),
    persistReview: persistJudgeReview(ctx),
  });
  await heartbeatJudgeTaskLease(ctx);

  if (judgeResult.verdict === "block") {
    return empty(
      text("teamCompletionRejected", { reason: judgeResult.reasoning }),
      "rejected",
    );
  }

  const cycleCompletedAt = new Date();
  const continuous = task.autonomyMode === "continuous";
  const cadenceSeconds = task.cadenceSeconds ?? 3_600;
  const nextRunAt = continuous
    ? new Date(cycleCompletedAt.getTime() + cadenceSeconds * 1_000)
    : null;
  if (isDurableTaskContext(ctx)) {
    if (
      !lifecycleReservation ||
      lifecycleReservation.disposition !== "reserved"
    ) {
      throw new Error("Durable completion receipt reservation is missing.");
    }
    const claimedLifecycle = await claimDurableLifecycleOperation(
      ctx,
      lifecycleReservation,
    );
    if (claimedLifecycle.disposition !== "prepared") {
      return lifecycleOperationDispositionResult(
        "complete_task",
        claimedLifecycle,
        locale,
      );
    }
    return {
      content: continuous
        ? text("teamCyclePrepared", { at: nextRunAt!.toISOString() })
        : copy.teamCompletionPrepared,
      createdTasks: [],
      createdAgents: [],
      toolOutcome: "succeeded",
      durableTaskLifecycleIntent: {
        kind: "complete",
        resultSummary,
        continuous,
        cycleCompletedAt,
        nextRunAt,
        judgeVerdict: judgeResult.verdict,
        operationFinalization: claimedLifecycle.finalization,
      },
    };
  }
  const completed = await db.transaction(async (tx) => {
    await lockAndAssertExecutionAllowed(tx);
    const [liveUnresolvedSubtask] = await tx
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.parentTaskId, ctx.taskId!),
          inArray(tasksTable.status, [
            "pending",
            "planning",
            "in_progress",
            "awaiting_approval",
            "blocked",
          ]),
        ),
      )
      .limit(1);
    if (liveUnresolvedSubtask) return null;
    const [updated] = await tx
      .update(tasksTable)
      .set({
        status: continuous ? "in_progress" : "completed",
        progressPercent: continuous ? 0 : 100,
        resultSummary,
        completedAt: continuous ? null : cycleCompletedAt,
        nextAttemptAt: nextRunAt,
        consecutiveFailures: 0,
        lastError: null,
        blockedReason: null,
        ...(continuous
          ? {
              cycleCount: sql`${tasksTable.cycleCount} + 1`,
              lastCycleCompletedAt: cycleCompletedAt,
            }
          : {}),
      })
      .where(
        and(
          eq(tasksTable.id, ctx.taskId!),
          eq(tasksTable.leaseOwner, ctx.taskLeaseOwner!),
          inArray(tasksTable.status, ACTIVE_TASK_STATUSES),
        ),
      )
      .returning();
    if (!updated) return null;

    await tx.insert(activityEventsTable).values({
      agentId: ctx.agent.id,
      taskId: ctx.taskId,
      type: "task_status_changed",
      summary: continuous
        ? text("teamCycleActivity", {
            summary: redactAuditText(resultSummary, 1_500, true),
          })
        : judgeResult.verdict === "warn"
          ? text("teamCompletionWarnActivity", {
              summary: redactAuditText(resultSummary, 1_500, true),
            })
          : text("teamCompletionActivity", {
              summary: redactAuditText(resultSummary, 1_500, true),
            }),
      detail: continuous
        ? {
            status: "in_progress",
            autonomyMode: "continuous",
            cycleCount: updated.cycleCount,
            cycleCompletedAt: cycleCompletedAt.toISOString(),
            nextRunAt: nextRunAt!.toISOString(),
            judgeVerdict: judgeResult.verdict,
            ...(updated.assignedByAgentId !== null
              ? {
                  delegationLifecycle: "cycle_completed",
                  fromAgentId: ctx.agent.id,
                  toAgentId: updated.assignedByAgentId,
                }
              : {}),
          }
        : {
            status: "completed",
            judgeVerdict: judgeResult.verdict,
            ...(updated.assignedByAgentId !== null
              ? {
                  delegationLifecycle: "completed",
                  fromAgentId: ctx.agent.id,
                  toAgentId: updated.assignedByAgentId,
                }
              : {}),
          },
      severity: judgeResult.verdict === "warn" ? "warning" : "info",
    });

    if (updated.parentTaskId && !continuous) {
      await tx.insert(activityEventsTable).values({
        taskId: updated.parentTaskId,
        agentId: updated.assignedByAgentId,
        type: "progress_update",
        summary: redactAuditText(
          text("teamChildCompletedActivity", {
            name: ctx.agent.name,
            title: updated.title,
            summary: resultSummary,
          }),
          2_000,
          true,
        ),
        detail: { completedSubtaskId: updated.id },
        severity: "info",
      });
    }
    return updated;
  });
  if (!completed) {
    return empty(copy.teamCompletionStopped, "rejected");
  }

  return {
    content: continuous
      ? text("teamCycleComplete", { at: nextRunAt!.toISOString() })
      : copy.teamComplete,
    createdTasks: [],
    createdAgents: [],
    toolOutcome: "succeeded",
    taskLifecycleEffect: "completed",
  };
}

async function requestApproval(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  let locale = ctx.locale ?? "tr";
  let copy = getToolCopy(locale);
  let text = toolMessage.bind(null, locale);
  let category =
    typeof args.category === "string" &&
    ["spend", "delete", "publish", "external_contact", "other"].includes(
      args.category,
    )
      ? (args.category as
          "spend" | "delete" | "publish" | "external_contact" | "other")
      : "other";
  let title = args.title as string;
  let description = args.description as string;
  let amountUsd =
    typeof args.amountUsd === "number" ? String(args.amountUsd) : null;
  const toolName =
    typeof args.toolName === "string" ? args.toolName.trim() : "";
  const explicitTarget =
    typeof args.target === "string" ? args.target.trim().slice(0, 500) : null;
  let toolArgs =
    args.toolArgs &&
    typeof args.toolArgs === "object" &&
    !Array.isArray(args.toolArgs)
      ? (args.toolArgs as Record<string, unknown>)
      : null;
  let sudoTarget: AgentSudoTarget | null = null;
  let browserBinding: ApprovedBrowserBindingEvidence | null = null;
  const isSudoApproval = toolName === "vm_run_sudo_command";

  if (toolName && !APPROVAL_EXECUTABLE_TOOLS.has(toolName)) {
    return empty(
      text("teamApprovalUnsupported", { tool: toolName }),
      "rejected",
    );
  }
  if ((toolName && !toolArgs) || (!toolName && toolArgs)) {
    return empty(copy.teamApprovalScopeRequired, "rejected");
  }

  if (isSudoApproval) {
    if (
      !(await isCanonicalRootCeo(ctx.agent)) ||
      !ctx.agent.permissions.canUseSudo ||
      !isAgentSudoEnabled()
    ) {
      return empty(copy.teamSudoDenied, "rejected");
    }
    const validated = validateAgentSudoCommand(toolArgs?.command, locale);
    if (!validated.ok) {
      return empty(
        text("teamSudoInvalid", { reason: validated.error }),
        "rejected",
      );
    }
    toolArgs = { command: validated.command };
    sudoTarget = await getAgentSudoTarget(ctx.agent.id);
    category = "other";
    title = copy.teamSudoTitle;
    description = copy.teamSudoDescription;
    amountUsd = null;
  }

  // Authorization/category validation must precede browser-state lookup. A
  // malformed or deliberately downgraded proposal is rejected for its actual
  // authority violation without touching process-local browser state.
  const requiredCategory = toolArgs
    ? requiredApprovalCategoryForAction(toolName, toolArgs)
    : null;
  if (requiredCategory && category !== requiredCategory) {
    return empty(
      text("teamCategoryRequired", {
        tool: toolName,
        category: requiredCategory,
      }),
      "rejected",
    );
  }

  if (!agentAllowsApprovalCategory(ctx.agent, category)) {
    return empty(text("teamCategoryDenied", { category }), "rejected");
  }

  if (toolName === "browser_click" || toolName === "browser_type") {
    const ref = Number(toolArgs?.ref);
    const runtimeInstanceId = ctx.operationIdentity?.runtimeInstanceId ?? null;
    if (!Number.isFinite(ref) || !runtimeInstanceId) {
      return empty(copy.teamBrowserApprovalContext, "rejected");
    }
    const liveBinding = await getExistingBrowserActionBinding(
      ctx.agent.id,
      ref,
    );
    if (!liveBinding) {
      return empty(copy.teamBrowserApprovalMissing, "rejected");
    }
    if (toolName === "browser_type" && liveBinding.sensitive) {
      return empty(copy.teamBrowserApprovalSensitive, "rejected");
    }
    toolArgs = {
      ...toolArgs,
      ref,
      ...(toolName === "browser_type"
        ? { text: String(toolArgs?.text ?? ""), submit: false }
        : {}),
      __browserContext: liveBinding,
    };
    const argsHash = hashToolArgs(toolArgs);
    browserBinding = {
      runtimeInstanceId,
      sessionId: liveBinding.sessionId,
      sessionEpoch: liveBinding.sessionEpoch,
      snapshotMarker: liveBinding.snapshotMarker,
      bindingHash: approvedBrowserBindingHash({
        runtimeInstanceId,
        sessionId: liveBinding.sessionId,
        sessionEpoch: liveBinding.sessionEpoch,
        snapshotMarker: liveBinding.snapshotMarker,
        toolName,
        argsHash,
      }),
    };
  }

  if (
    category === "spend" &&
    (typeof args.amountUsd !== "number" ||
      !Number.isFinite(args.amountUsd) ||
      args.amountUsd <= 0)
  ) {
    return empty(copy.teamSpendAmount, "rejected");
  }

  const browserContext = toolArgs?.__browserContext;
  const derivedBrowserTarget =
    browserContext &&
    typeof browserContext === "object" &&
    !Array.isArray(browserContext)
      ? [
          String((browserContext as Record<string, unknown>).pageUrl ?? ""),
          String(
            (browserContext as Record<string, unknown>).context ??
              (browserContext as Record<string, unknown>).text ??
              "",
          ),
        ]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 500)
      : null;
  const target =
    sudoTarget?.target || derivedBrowserTarget || explicitTarget || null;

  if (!title || !description) {
    return empty(
      text("teamStringRequired", { field: "title/description" }),
      "rejected",
    );
  }

  let task: Task | undefined;
  if (ctx.taskId) {
    [task] = await db
      .select()
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.id, ctx.taskId),
          eq(tasksTable.leaseOwner, ctx.taskLeaseOwner!),
          inArray(tasksTable.status, ACTIVE_TASK_STATUSES),
        ),
      );
    if (!task) {
      return empty(copy.teamApprovalStopped, "rejected");
    }
  }

  const scope: ApprovalScope | null =
    toolName && toolArgs
      ? {
          toolName,
          argsHash: hashToolArgs(toolArgs),
          target,
          preview: buildApprovalPreview(toolName, toolArgs, sudoTarget, locale),
        }
      : null;
  const judgeSafeSudoCommand = JSON.stringify(String(toolArgs?.command ?? ""))
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
  const approvalOperationArgs: Record<string, unknown> = {
    category,
    title: isSudoApproval ? LEGACY_SUDO_APPROVAL_TITLE : title.trim(),
    description: isSudoApproval
      ? LEGACY_SUDO_APPROVAL_DESCRIPTION
      : description.trim(),
    amountUsd,
    toolName: scope?.toolName ?? null,
    actionArgsHash: scope?.argsHash ?? null,
    target: scope?.target ?? null,
  };

  const lifecycleReservation = ctx.operationIdentity
    ? await reserveDurableLifecycleOperation(
        ctx,
        "request_approval",
        approvalOperationArgs,
      )
    : null;
  if (lifecycleReservation && lifecycleReservation.disposition !== "reserved") {
    return lifecycleOperationDispositionResult(
      "request_approval",
      lifecycleReservation,
      locale,
    );
  }

  if (lifecycleReservation) {
    locale = toolReceiptLocale(lifecycleReservation.receipt) ?? locale;
    copy = getToolCopy(locale);
    text = toolMessage.bind(null, locale);
    ctx = { ...ctx, locale };
  }
  if (isSudoApproval) {
    title = copy.teamSudoTitle;
    description = copy.teamSudoDescription;
  }
  if (scope && toolArgs) {
    scope.preview = buildApprovalPreview(
      toolName,
      toolArgs,
      sudoTarget,
      locale,
    );
  }
  const judgeActionSummary = isSudoApproval
    ? [
        `${title}: ${description}`,
        '<untrusted_sudo_proposal target="approval-bound local CEO workspace">',
        judgeSafeSudoCommand,
        "</untrusted_sudo_proposal>",
      ].join("\n")
    : `${title}: ${description}${amountUsd ? ` (${text("teamAmount", { amount: amountUsd })})` : ""}`;

  const judgeResult = await runJudge({
    locale,
    agent: ctx.agent,
    taskId: task?.id ?? null,
    purpose: "approval",
    originalBrief: task?.brief ?? description,
    actionSummary: judgeActionSummary,
    taskExecutionModelId: resolveJudgeExecutionModelBoundary({
      taskExecutionModelId: task?.executionModelId,
      turnModelId: ctx.turnModelId,
      agentModelMode: ctx.agent.modelMode,
      agentModelId: ctx.agent.modelId,
    }),
    redactActionSummaryInActivity: isSudoApproval,
    beforeAttempt: task ? () => heartbeatJudgeTaskLease(ctx) : undefined,
    persistReview: task ? persistJudgeReview(ctx) : undefined,
  });
  if (task) await heartbeatJudgeTaskLease(ctx);

  if (judgeResult.verdict === "block") {
    return empty(
      text("teamApprovalRejected", { reason: judgeResult.reasoning }),
      "rejected",
    );
  }

  if (isSudoApproval) {
    const [liveAgent] = await db
      .select()
      .from(agentsTable)
      .where(
        and(eq(agentsTable.id, ctx.agent.id), eq(agentsTable.isActive, true)),
      );
    if (
      !liveAgent ||
      !liveAgent.permissions.canUseSudo ||
      !(await isCanonicalRootCeo(liveAgent)) ||
      !isAgentSudoEnabled()
    ) {
      return empty(copy.teamSudoRevoked, "rejected");
    }
    const liveTarget = await getAgentSudoTarget(liveAgent.id);
    if (liveTarget.target !== scope?.target) {
      return empty(copy.teamSudoTargetChanged, "rejected");
    }
  }
  const actionPayload =
    scope && toolArgs && APPROVAL_EXECUTABLE_TOOLS.has(toolName)
      ? {
          toolName,
          args: toolArgs,
          // Server-derived only: agent-supplied toolArgs cannot influence the
          // lifecycle of the task that owns this capability.
          taskDisposition: ctx.taskId
            ? ("resume" as const)
            : ("complete" as const),
        }
      : null;
  const approvalTtlMs = isSudoApproval ? 5 * 60_000 : 30 * 60_000;
  const expiresAt = scope ? new Date(Date.now() + approvalTtlMs) : null;

  if (task) await heartbeatJudgeTaskLease(ctx);
  if (task && isDurableTaskContext(ctx)) {
    if (
      !lifecycleReservation ||
      lifecycleReservation.disposition !== "reserved"
    ) {
      throw new Error("Durable approval receipt reservation is missing.");
    }
    const claimedLifecycle = await claimDurableLifecycleOperation(
      ctx,
      lifecycleReservation,
    );
    if (claimedLifecycle.disposition !== "prepared") {
      return lifecycleOperationDispositionResult(
        "request_approval",
        claimedLifecycle,
        locale,
      );
    }
    return {
      content: copy.teamApprovalPrepared,
      createdTasks: [],
      createdAgents: [],
      toolOutcome: "succeeded",
      durableTaskLifecycleIntent: {
        kind: "approval",
        category,
        title,
        description,
        amountUsd,
        scope,
        actionPayload:
          scope && toolArgs && APPROVAL_EXECUTABLE_TOOLS.has(toolName)
            ? { toolName, args: toolArgs, taskDisposition: "resume" }
            : null,
        browserBinding,
        expiresAt,
        judgeVerdict: judgeResult.verdict,
        judgeReasoning: judgeResult.reasoning,
        isSudoApproval,
        operationFinalization: claimedLifecycle.finalization,
      },
    };
  }
  const persistApprovalMutation = async (tx: ToolTransaction) => {
    await lockAndAssertExecutionAllowed(tx);
    await tx.execute(
      sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${ctx.agent.id} FOR UPDATE`,
    );
    const [liveApprovalAgent] = await tx
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, ctx.agent.id));
    if (
      !liveApprovalAgent?.isActive ||
      !agentAllowsApprovalCategory(liveApprovalAgent, category) ||
      (isSudoApproval && !liveApprovalAgent.permissions.canUseSudo)
    ) {
      throw new ApprovedActionClaimConflict();
    }
    await assertOutstandingApprovalCapacity(tx);
    if (!ctx.taskId) await assertOutstandingTaskCapacity(tx);
    let effectiveTask: Task;
    let createdTask: Task | null = null;
    if (ctx.taskId) {
      const [suspended] = await tx
        .update(tasksTable)
        .set({ status: "awaiting_approval", blockedReason: null })
        .where(
          and(
            eq(tasksTable.id, ctx.taskId),
            eq(tasksTable.leaseOwner, ctx.taskLeaseOwner!),
            inArray(tasksTable.status, ACTIVE_TASK_STATUSES),
          ),
        )
        .returning();
      if (!suspended) throw new ApprovedActionClaimConflict();
      effectiveTask = suspended;
    } else {
      [createdTask] = await tx
        .insert(tasksTable)
        .values({
          title,
          brief: description,
          status: "awaiting_approval",
          priority:
            category === "spend" || category === "publish" ? "high" : "normal",
          ownerAgentId: ctx.agent.id,
          assignedByAgentId: null,
          createdByUser: true,
          progressPercent: 0,
          executionModelId:
            ctx.agent.modelMode === "manual" ? ctx.agent.modelId : null,
        })
        .returning();
      effectiveTask = createdTask;
    }

    const [approval] = await tx
      .insert(approvalRequestsTable)
      .values({
        taskId: effectiveTask.id,
        agentId: ctx.agent.id,
        category,
        title,
        description,
        amountUsd,
        scope,
        actionPayload,
        browserRuntimeInstanceId: browserBinding?.runtimeInstanceId ?? null,
        browserSessionId: browserBinding?.sessionId ?? null,
        browserSessionEpoch: browserBinding?.sessionEpoch ?? null,
        browserSnapshotMarker: browserBinding?.snapshotMarker ?? null,
        browserBindingHash: browserBinding?.bindingHash ?? null,
        expiresAt,
      })
      .returning();
    await tx.insert(activityEventsTable).values({
      agentId: ctx.agent.id,
      taskId: effectiveTask.id,
      type: "approval_requested",
      summary: text("teamApprovalActivity", {
        title: redactAuditText(title, 500, true),
      }),
      detail: {
        approvalId: approval.id,
        category,
        amountUsd,
        toolName: scope?.toolName ?? null,
        target:
          scope?.toolName === "browser_click" ||
          scope?.toolName === "browser_type"
            ? null
            : scope?.target
              ? redactAuditText(scope.target, 500)
              : null,
        expiresAt: approval.expiresAt?.toISOString() ?? null,
      },
      severity: "warning",
    });
    return { approval, effectiveTask, createdTask };
  };
  let approvalReceiptId: string | undefined;
  let persisted:
    | Awaited<ReturnType<typeof persistApprovalMutation>>
    | { capacityError: RuntimeCapacityError }
    | null;
  try {
    if (ctx.operationIdentity) {
      const now = new Date();
      const operation = await runTransactionalOperation({
        reservation: normalizedOperationReservation(
          ctx,
          "request_approval",
          approvalOperationArgs,
          "transactional",
        ),
        claim: normalizedOperationClaim(ctx, "pending", now),
        mutate: async (tx) => {
          const value = await persistApprovalMutation(tx as ToolTransaction);
          return {
            value,
            resultData: { approvalId: value.approval.id },
          };
        },
      });
      if (operation.disposition === "replayed") {
        return replayedTransactionalResult(
          "request_approval",
          operation.receipt,
          locale,
        );
      }
      if (operation.disposition !== "executed") {
        return unavailableNormalizedOperationResult(
          operation.disposition,
          operation.receipt,
          locale,
        );
      }
      persisted = operation.value;
      approvalReceiptId = operation.receipt.id;
    } else {
      persisted = await db.transaction(persistApprovalMutation);
    }
  } catch (error) {
    if (error instanceof ApprovedActionClaimConflict) persisted = null;
    else if (error instanceof RuntimeCapacityError) {
      persisted = { capacityError: error };
    } else throw error;
  }
  if (persisted && "capacityError" in persisted) {
    return empty(
      text("teamApprovalCapacity", { limit: persisted.capacityError.limit }),
      "rejected",
    );
  }
  if (!persisted) {
    return empty(copy.teamApprovalStopped, "rejected");
  }

  const { approval, effectiveTask, createdTask } = persisted;

  return {
    content:
      text("teamApprovalCreated", {
        id: approval.id,
        taskId: effectiveTask.id,
      }) +
      (scope
        ? text("teamApprovalExpiry", { minutes: isSudoApproval ? 5 : 30 })
        : "") +
      (judgeResult.verdict === "warn"
        ? text("teamReviewNote", { reason: judgeResult.reasoning })
        : ""),
    createdTasks: createdTask ? [createdTask] : [],
    createdAgents: [],
    toolOutcome: "succeeded",
    taskLifecycleEffect: "suspended",
    receiptId: approvalReceiptId,
    operationResultData: { approvalId: approval.id },
  };
}

async function requestUserInput(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  let locale = ctx.locale ?? "tr";
  let copy = getToolCopy(locale);
  let text = toolMessage.bind(null, locale);
  if (!ctx.taskId) {
    return empty(copy.teamTaskContext, "rejected");
  }
  const question = typeof args.question === "string" ? args.question : "";
  if (!question)
    return empty(text("teamStringRequired", { field: "question" }), "rejected");
  const recordedQuestion = redactAuditText(question, 1_001, true);
  if (
    !recordedQuestion.trim() ||
    question.length > 1_000 ||
    recordedQuestion.length > 1_000
  ) {
    return empty(copy.teamQuestionBound, "rejected");
  }

  if (isDurableTaskContext(ctx)) {
    const lifecycleReservation = await reserveDurableLifecycleOperation(
      ctx,
      "request_user_input",
      { question: question.trim() },
    );
    if (!lifecycleReservation) {
      throw new Error("Durable user-input receipt reservation is missing.");
    }
    if (lifecycleReservation.disposition !== "reserved") {
      return lifecycleOperationDispositionResult(
        "request_user_input",
        lifecycleReservation,
        locale,
      );
    }
    if (lifecycleReservation) {
      locale = toolReceiptLocale(lifecycleReservation.receipt) ?? locale;
      copy = getToolCopy(locale);
      text = toolMessage.bind(null, locale);
      ctx = { ...ctx, locale };
    }

    const claimedLifecycle = await claimDurableLifecycleOperation(
      ctx,
      lifecycleReservation,
    );
    if (claimedLifecycle.disposition !== "prepared") {
      return lifecycleOperationDispositionResult(
        "request_user_input",
        claimedLifecycle,
        locale,
      );
    }
    return {
      content: copy.teamQuestionPrepared,
      createdTasks: [],
      createdAgents: [],
      toolOutcome: "succeeded",
      durableTaskLifecycleIntent: {
        kind: "user_input",
        question,
        operationFinalization: claimedLifecycle.finalization,
      },
    };
  }

  const questionId = randomUUID();
  const safeQuestion = redactAuditText(question, 1_000, true);
  const blocked = await db.transaction(async (tx) => {
    await lockAndAssertExecutionAllowed(tx);
    const [task] = await tx
      .update(tasksTable)
      .set({
        status: "blocked",
        blockedReason: "user_input",
        userInputQuestionId: questionId,
        userInputQuestion: safeQuestion,
        userInputOwnerAgentId: ctx.agent.id,
        lastError: copy.teamInputWaiting,
        nextAttemptAt: null,
      })
      .where(
        and(
          eq(tasksTable.id, ctx.taskId!),
          eq(tasksTable.leaseOwner, ctx.taskLeaseOwner!),
          inArray(tasksTable.status, ACTIVE_TASK_STATUSES),
        ),
      )
      .returning({ id: tasksTable.id });
    if (!task) return null;
    await tx.insert(activityEventsTable).values({
      agentId: ctx.agent.id,
      taskId: ctx.taskId,
      type: "note",
      summary: text("teamQuestionActivity", {
        question: redactAuditText(question, 1_000, true),
      }),
      detail: { question: safeQuestion, questionId },
      severity: "warning",
    });
    return task;
  });
  if (!blocked) {
    return empty(copy.teamQuestionStopped, "rejected");
  }

  return {
    content: copy.teamQuestionSaved,
    createdTasks: [],
    createdAgents: [],
    toolOutcome: "succeeded",
    taskLifecycleEffect: "suspended",
  };
}

async function logNote(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const locale = ctx.locale ?? "tr";
  const copy = getToolCopy(locale);
  const text = toolMessage.bind(null, locale);
  const summary = args.summary as string;
  if (!summary)
    return empty(text("teamStringRequired", { field: "summary" }), "rejected");

  const eventId = await withTaskMutationFence(ctx, async (tx) => {
    const [event] = await tx
      .insert(activityEventsTable)
      .values({
        agentId: ctx.agent.id,
        taskId: ctx.taskId,
        type: "note",
        summary: redactAuditText(summary, 2_000, true),
        severity: "info",
      })
      .returning({ id: activityEventsTable.id });
    return event.id;
  });

  return {
    ...empty(copy.teamNoteSaved, "succeeded"),
    operationResultData: { eventId },
  };
}

async function postCompanyMessage(
  ctx: ToolRuntimeContext,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const locale = ctx.locale ?? "tr";
  const copy = getToolCopy(locale);
  const text = toolMessage.bind(null, locale);
  const content = args.content as string;
  if (!content)
    return empty(text("teamStringRequired", { field: "content" }), "rejected");
  if (content.length > 4_000) {
    return empty(copy.teamMessageBound, "rejected");
  }

  const rawReplyTo = args.replyToMessageId;
  const replyToMessageId =
    rawReplyTo === undefined || rawReplyTo === null ? null : Number(rawReplyTo);
  if (
    replyToMessageId !== null &&
    (!Number.isSafeInteger(replyToMessageId) || replyToMessageId <= 0)
  ) {
    return empty(
      text("teamNumberInvalid", { field: "replyToMessageId" }),
      "rejected",
    );
  }

  const persisted = await withTaskMutationFence(ctx, async (tx) => {
    await assertCompanyMessageCapacity(tx);

    await tx
      .insert(companyChannelsTable)
      .values({ key: "company", name: copy.teamChannelName })
      .onConflictDoNothing({ target: companyChannelsTable.key });
    const [channel] = await tx
      .select({ id: companyChannelsTable.id })
      .from(companyChannelsTable)
      .where(eq(companyChannelsTable.key, "company"));
    if (!channel) return { error: copy.teamChannelMissing } as const;

    const [membership] = await tx
      .select({ agentId: companyChannelMembersTable.agentId })
      .from(companyChannelMembersTable)
      .innerJoin(
        agentsTable,
        and(
          eq(companyChannelMembersTable.agentId, agentsTable.id),
          eq(agentsTable.isActive, true),
        ),
      )
      .where(
        and(
          eq(companyChannelMembersTable.channelId, channel.id),
          eq(companyChannelMembersTable.agentId, ctx.agent.id),
        ),
      );
    if (!membership) {
      return {
        error: copy.teamMembershipMissing,
      } as const;
    }

    if (replyToMessageId !== null) {
      const [replyTarget] = await tx
        .select({ id: companyMessagesTable.id })
        .from(companyMessagesTable)
        .where(
          and(
            eq(companyMessagesTable.id, replyToMessageId),
            eq(companyMessagesTable.channelId, channel.id),
          ),
        );
      if (!replyTarget) {
        return {
          error: copy.teamReplyMissing,
        } as const;
      }
    }

    // A model may emit the same communication tool repeatedly in one tool
    // batch. A short persisted cooldown prevents duplicate channel noise
    // without coupling separate agents or later autonomous task steps.
    const [latestPost] = await tx
      .select({ createdAt: companyMessagesTable.createdAt })
      .from(companyMessagesTable)
      .where(
        and(
          eq(companyMessagesTable.senderAgentId, ctx.agent.id),
          eq(companyMessagesTable.source, "agent_tool"),
        ),
      )
      .orderBy(
        desc(companyMessagesTable.createdAt),
        desc(companyMessagesTable.id),
      )
      .limit(1);
    if (latestPost && Date.now() - latestPost.createdAt.getTime() < 5_000) {
      return {
        error: copy.teamMessageCooldown,
      } as const;
    }

    const [message] = await tx
      .insert(companyMessagesTable)
      .values({
        channelId: channel.id,
        senderType: "agent",
        senderAgentId: ctx.agent.id,
        content,
        source: "agent_tool",
        taskId: ctx.taskId,
        replyToMessageId,
      })
      .returning({ id: companyMessagesTable.id });
    return { message } as const;
  }).catch((error) => {
    if (error instanceof RuntimeCapacityError) {
      return { capacityError: error } as const;
    }
    throw error;
  });

  if ("capacityError" in persisted) {
    return empty(
      text("teamMessageCapacity", { limit: persisted.capacityError.limit }),
      "rejected",
    );
  }
  if ("error" in persisted && typeof persisted.error === "string")
    return empty(text("teamBlocked", { reason: persisted.error }), "rejected");
  if (!persisted.message) {
    return empty(copy.teamMessageFailed, "rejected");
  }
  return {
    ...empty(
      text("teamMessageSaved", { id: persisted.message.id }),
      "succeeded",
    ),
    operationResultData: { messageId: persisted.message.id },
  };
}
