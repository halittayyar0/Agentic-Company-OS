import { hasLocalizedToolOutput, toolReceiptLocale } from "./tool-presentation";
import { CAPABILITY_TOOL_NAMES } from "../capabilities/names";
import { toolMessage } from "./tool-localization";
import {
  isWorkspaceLocale,
  readWorkspaceLocale,
  type WorkspaceLocale,
} from "../workspace-locale";
import { terminalMessage } from "../vm/terminal-localization";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  activityEventsTable,
  agentsTable,
  approvalRequestsTable,
  db,
  operationInvocationsTable,
  operationReceiptsTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  tasksTable,
  type ApprovalRequest,
  type OperationInvocation,
  type OperationReceipt,
  type OperationReconciliationDecision,
  type OperationSideEffectClass,
} from "@workspace/db";
import {
  lockAndAssertExecutionAllowed,
  lockRuntimeControlState,
} from "./runtime-emergency-stop";
import { appendOperationsChanged } from "../operations/operations-events";

const CANONICAL_VERSION = 1 as const;

export type OperationExecutionKind =
  "task_step" | "approved_action" | "chat_turn";

export interface OperationPhysicalIdentity {
  attemptId?: string | null;
  workerInstanceId?: string | null;
  modelToolCallId?: string | null;
  callSlot: string;
}

export interface CanonicalOperationIdentity {
  canonicalVersion: typeof CANONICAL_VERSION;
  executionKind: OperationExecutionKind;
  logicalExecutionId: string;
  toolName: string;
  args: unknown;
  physical: OperationPhysicalIdentity;
}

export interface CanonicalReplayIdentity extends CanonicalOperationIdentity {
  sideEffectClass: OperationSideEffectClass;
}

type OperationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type OperationExecutor = typeof db | OperationTransaction;

export interface ReserveOperationInput extends CanonicalReplayIdentity {
  /** Bounded presentation metadata; excluded from operation/capability identity. */
  executionLocale?: WorkspaceLocale;
  taskId: number | null;
  agentId: number;
  approvalId: number | null;
  sourceMessageId: number | null;
  originAttemptId: string | null;
  externalIdempotencyKey?: string | null;
  now?: Date;
}

export interface ReserveOperationResult {
  receipt: OperationReceipt;
  execute: boolean;
  disposition: "execute" | "existing" | "reconciled_applied";
}

export function isConfirmedAppliedReceipt(receipt: OperationReceipt): boolean {
  return (
    receipt.state === "unknown" &&
    receipt.reconciliationDecision === "confirmed_applied"
  );
}

export function isConfirmedAppliedReplay(
  reservation: ReserveOperationResult,
): boolean {
  return (
    reservation.disposition === "reconciled_applied" ||
    isConfirmedAppliedReceipt(reservation.receipt)
  );
}

function existingReservationDisposition(
  receipt: OperationReceipt,
): ReserveOperationResult["disposition"] {
  return receipt.state === "unknown" &&
    receipt.reconciliationDecision === "confirmed_applied"
    ? "reconciled_applied"
    : "existing";
}

export class OperationReceiptIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationReceiptIntegrityError";
  }
}

export type OperationStatePresentationReason =
  | "invocationExpired"
  | "runtimeUnavailable"
  | "agentAuthorityLost"
  | "taskAuthorityLost";

export class OperationInvocationStateError extends Error {
  constructor(
    message: string,
    readonly presentationReason?: OperationStatePresentationReason,
  ) {
    super(message);
    this.name = "OperationInvocationStateError";
  }
}

export class OperationInvocationOwnershipLostError extends OperationInvocationStateError {
  constructor(message = "Operation invocation ownership was lost.") {
    super(message);
    this.name = "OperationInvocationOwnershipLostError";
  }
}

export class OperationReconciliationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationReconciliationConflictError";
  }
}

export class ConfirmedAppliedReplayError extends OperationInvocationStateError {
  constructor(readonly confirmedReceipt: OperationReceipt) {
    super(
      "A confirmed-applied task-cycle receipt superseded this invocation before its effect boundary.",
    );
    this.name = "ConfirmedAppliedReplayError";
  }
}

export interface ReconcileOperationInput {
  receiptId: string;
  decision: OperationReconciliationDecision;
  note: string;
  actorId: string;
  now?: Date;
}

export interface InvalidateApprovalBindingInput {
  /** Presentation only; never part of binding identity. */
  locale?: WorkspaceLocale;
  approvalId: number;
  expectedRuntimeInstanceId: string;
  expectedBindingHash: string;
  reason: string;
  now?: Date;
}

export interface ClaimOperationInvocationInput {
  receiptId: string;
  executionKind: OperationExecutionKind;
  attemptId: string | null;
  workerInstanceId: string | null;
  modelToolCallId?: string | null;
  leaseOwner: string;
  leaseExpiresAt: Date;
  taskLeaseOwner: string | null;
  agentLeaseOwner: string;
  browserBinding?: ApprovedBrowserBindingEvidence | null;
  now?: Date;
}

export interface ApprovedBrowserBindingEvidence {
  runtimeInstanceId: string;
  sessionId: string;
  sessionEpoch: number;
  snapshotMarker: string;
  bindingHash: string;
}

export interface ClaimOperationInvocationResult {
  claimed: boolean;
  receipt: OperationReceipt;
  invocation: OperationInvocation | null;
}

export interface OperationInvocationOwnerInput {
  receiptId: string;
  invocationId: string;
  leaseOwner: string;
  browserBinding?: ApprovedBrowserBindingEvidence | null;
  now?: Date;
}

export interface CompleteOperationInput extends OperationInvocationOwnerInput {
  resultData?: Record<string, unknown> | null;
}

export interface HeartbeatOperationInvocationInput extends OperationInvocationOwnerInput {
  leaseExpiresAt: Date;
  allowExpiredInvocationLeaseRenewal?: boolean;
}

export interface HeartbeatOperationInvocationResult {
  renewed: boolean;
  receipt: OperationReceipt;
  invocation: OperationInvocation;
}

export interface RunTransactionalOperationInput<T> {
  reservation: ReserveOperationInput;
  claim: Omit<ClaimOperationInvocationInput, "receiptId">;
  mutate: (
    tx: OperationExecutor,
    receipt: OperationReceipt,
  ) => Promise<{ value: T; resultData?: Record<string, unknown> | null }>;
}

export type RunTransactionalOperationResult<T> =
  | {
      disposition: "executed";
      receipt: OperationReceipt;
      value: T;
    }
  | {
      disposition: "replayed" | "busy" | "unknown" | "failed";
      receipt: OperationReceipt;
      value: null;
    };

export interface RecoverInterruptedOperationInput {
  receiptId: string;
  now?: Date;
  runtimeStaleBefore: Date;
}

export type RecoverInterruptedOperationDisposition =
  | "not_found"
  | "not_stale"
  | "terminal"
  | "reclaimable"
  | "reclaimable_same_key"
  | "unknown";

export interface RecoverInterruptedOperationResult {
  disposition: RecoverInterruptedOperationDisposition;
  receipt: OperationReceipt;
  invocation: OperationInvocation | null;
}

function normalizedString(value: string): string {
  return value.normalize("NFC");
}

function normalizeJsonValue(
  value: unknown,
  ancestors: Set<object>,
  path: string,
): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
      return normalizedString(value);
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(
          `Canonical JSON requires finite numbers at ${path}.`,
        );
      }
      return Object.is(value, -0) ? 0 : value;
    case "undefined":
      throw new TypeError(`Canonical JSON cannot encode undefined at ${path}.`);
    case "bigint":
    case "function":
    case "symbol":
      throw new TypeError(
        `Canonical JSON cannot encode ${typeof value} at ${path}.`,
      );
    case "object":
      break;
    default:
      throw new TypeError("Unsupported canonical JSON value.");
  }

  if (ancestors.has(value)) {
    throw new TypeError(
      `Canonical JSON cannot encode a circular value at ${path}.`,
    );
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) => {
        if (entry === undefined) {
          throw new TypeError(
            `Canonical JSON cannot encode undefined array entries at ${path}[${index}].`,
          );
        }
        return normalizeJsonValue(entry, ancestors, `${path}[${index}]`);
      });
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Canonical JSON requires a plain object at ${path}.`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(
        `Canonical JSON cannot encode symbol keys at ${path}.`,
      );
    }

    const normalizedEntries = new Map<string, unknown>();
    for (const originalKey of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, originalKey);
      if (!descriptor || descriptor.get || descriptor.set) {
        throw new TypeError(
          `Canonical JSON cannot encode accessors at ${path}.${originalKey}.`,
        );
      }
      if (descriptor.value === undefined) continue;
      const key = normalizedString(originalKey);
      if (normalizedEntries.has(key)) {
        throw new TypeError(
          `Canonical JSON key collision after Unicode normalization at ${path}.${key}.`,
        );
      }
      normalizedEntries.set(
        key,
        normalizeJsonValue(descriptor.value, ancestors, `${path}.${key}`),
      );
    }

    const normalized: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of [...normalizedEntries.keys()].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    )) {
      normalized[key] = normalizedEntries.get(key);
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value, new Set(), "$"));
}

function assertCanonicalIdentity(
  input: CanonicalOperationIdentity,
): CanonicalOperationIdentity {
  if (input.canonicalVersion !== CANONICAL_VERSION) {
    throw new TypeError(
      `Unsupported operation canonical version: ${input.canonicalVersion}.`,
    );
  }
  if (!input.logicalExecutionId.trim()) {
    throw new TypeError("logicalExecutionId is required.");
  }
  if (!input.toolName.trim()) throw new TypeError("toolName is required.");
  if (!input.physical.callSlot.trim()) {
    throw new TypeError("A server-owned callSlot is required.");
  }
  return input;
}

function hashEnvelope(prefix: "op" | "replay", envelope: unknown): string {
  const digest = createHash("sha256")
    .update(canonicalizeJson(envelope), "utf8")
    .digest("hex");
  return `${prefix}:v${CANONICAL_VERSION}:${digest}`;
}

export function canonicalOperationKey(
  rawInput: CanonicalOperationIdentity,
): string {
  const input = assertCanonicalIdentity(rawInput);
  return hashEnvelope("op", {
    version: input.canonicalVersion,
    executionKind: input.executionKind,
    logicalExecutionId: normalizedString(input.logicalExecutionId),
    toolName: normalizedString(input.toolName),
    args: normalizeJsonValue(input.args, new Set(), "$.args"),
    physical: {
      attemptId: input.physical.attemptId ?? null,
      workerInstanceId: input.physical.workerInstanceId ?? null,
      modelToolCallId: input.physical.modelToolCallId ?? null,
      callSlot: normalizedString(input.physical.callSlot),
    },
  });
}

export function canonicalReplayKey(
  rawInput: CanonicalReplayIdentity,
): string | null {
  const input = assertCanonicalIdentity(rawInput);
  if (rawInput.sideEffectClass === "read_only") return null;
  return hashEnvelope("replay", {
    version: input.canonicalVersion,
    executionKind: input.executionKind,
    logicalExecutionId: normalizedString(input.logicalExecutionId),
    toolName: normalizedString(input.toolName),
    // This field was part of screenshot identities before their unsafe retry
    // policy was corrected. Keep its hash token, not its execution permission.
    sideEffectClass:
      input.toolName === "browser_save_screenshot" &&
      rawInput.sideEffectClass === "at_most_once"
        ? "idempotent"
        : rawInput.sideEffectClass,
    args: normalizeJsonValue(input.args, new Set(), "$.args"),
  });
}

export function canonicalArgumentHash(args: unknown): string {
  return createHash("sha256")
    .update(canonicalizeJson(args), "utf8")
    .digest("hex");
}

function legacyCanonicalArgumentHash(args: unknown): string {
  const legacyCanonicalJson = (value: unknown): string => {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value) ?? "null";
    }
    if (Array.isArray(value)) {
      return `[${value.map(legacyCanonicalJson).join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${legacyCanonicalJson(record[key])}`,
      )
      .join(",")}}`;
  };
  return createHash("sha256").update(legacyCanonicalJson(args)).digest("hex");
}

const APPROVED_BROWSER_TOOLS = new Set(["browser_click", "browser_type"]);

function approvedBrowserBindingMatches(
  approval: ApprovalRequest,
  workerInstanceId: string | null,
  evidence: ApprovedBrowserBindingEvidence | null | undefined,
): boolean {
  if (!APPROVED_BROWSER_TOOLS.has(approval.scope?.toolName ?? "")) return true;
  return Boolean(
    workerInstanceId &&
    evidence &&
    evidence.runtimeInstanceId === workerInstanceId &&
    approval.browserRuntimeInstanceId === workerInstanceId &&
    approval.browserSessionId === evidence.sessionId &&
    approval.browserSessionEpoch === evidence.sessionEpoch &&
    approval.browserSnapshotMarker === evidence.snapshotMarker &&
    approval.browserBindingHash === evidence.bindingHash,
  );
}

function consumedApprovalScope(
  scope: ApprovalRequest["scope"],
  disposition: "consumed" | "invalidated",
): ApprovalRequest["scope"] {
  if (!scope) return null;
  const browserScoped = APPROVED_BROWSER_TOOLS.has(scope.toolName);
  return {
    toolName: scope.toolName,
    argsHash: scope.argsHash,
    target: browserScoped ? null : (scope.target ?? null),
    preview: `${disposition.toUpperCase()}: capability sha256:${scope.argsHash}`,
  };
}

function assertApprovedActionAuthority(input: {
  receipt: OperationReceipt;
  approval: ApprovalRequest | null | undefined;
  workerInstanceId: string | null;
  browserBinding?: ApprovedBrowserBindingEvidence | null;
  now: Date;
}): asserts input is typeof input & { approval: ApprovalRequest } {
  const { receipt, approval, workerInstanceId, browserBinding, now } = input;
  const actionPayload = approval?.actionPayload;
  if (
    !approval ||
    receipt.approvalId === null ||
    approval.id !== receipt.approvalId ||
    approval.taskId !== receipt.taskId ||
    approval.agentId !== receipt.agentId ||
    approval.status !== "approved" ||
    approval.resolvedAt === null ||
    approval.consumedAt !== null ||
    approval.bindingInvalidatedAt !== null ||
    !approval.expiresAt ||
    approval.expiresAt.getTime() <= now.getTime() ||
    receipt.logicalExecutionId !== `approval:${approval.id}` ||
    approval.scope?.toolName !== receipt.toolName ||
    approval.scope.argsHash !== receipt.argumentHash ||
    actionPayload?.toolName !== receipt.toolName ||
    canonicalArgumentHash(actionPayload.args) !== receipt.argumentHash ||
    !approvedBrowserBindingMatches(approval, workerInstanceId, browserBinding)
  ) {
    throw new OperationInvocationStateError(
      "Approved-action authority or immutable browser binding is unavailable.",
    );
  }
}

function assertConsumedApprovedActionAuthority(input: {
  receipt: OperationReceipt;
  approval: ApprovalRequest | null | undefined;
  workerInstanceId: string | null;
  browserBinding?: ApprovedBrowserBindingEvidence | null;
}): asserts input is typeof input & { approval: ApprovalRequest } {
  const { receipt, approval, workerInstanceId, browserBinding } = input;
  if (
    !approval ||
    receipt.approvalId === null ||
    approval.id !== receipt.approvalId ||
    approval.taskId !== receipt.taskId ||
    approval.agentId !== receipt.agentId ||
    approval.status !== "approved" ||
    approval.consumedAt === null ||
    approval.actionPayload !== null ||
    approval.bindingInvalidatedAt !== null ||
    receipt.logicalExecutionId !== `approval:${approval.id}` ||
    approval.scope?.toolName !== receipt.toolName ||
    approval.scope.argsHash !== receipt.argumentHash ||
    !approvedBrowserBindingMatches(approval, workerInstanceId, browserBinding)
  ) {
    throw new OperationInvocationStateError(
      "Consumed approved-action authority or immutable browser binding is unavailable.",
    );
  }
}

function nullableEqual<T>(left: T | null, right: T | null): boolean {
  return left === right;
}

function assertReceiptIdentity(
  receipt: OperationReceipt,
  input: ReserveOperationInput,
  expected: {
    operationKey: string;
    replayKey: string | null;
    argumentHash: string;
  },
): void {
  const sameOperation = receipt.operationKey === expected.operationKey;
  const sameReplay =
    expected.replayKey !== null && receipt.replayKey === expected.replayKey;
  const sameExternal =
    input.externalIdempotencyKey !== null &&
    input.externalIdempotencyKey !== undefined &&
    receipt.externalIdempotencyKey === input.externalIdempotencyKey;
  if (!sameOperation && !sameReplay && !sameExternal) {
    throw new OperationReceiptIntegrityError(
      "Operation reservation conflict did not resolve to the requested identity.",
    );
  }
  if (
    (sameOperation && receipt.replayKey !== expected.replayKey) ||
    receipt.canonicalVersion !== input.canonicalVersion ||
    receipt.executionKind !== input.executionKind ||
    receipt.logicalExecutionId !== input.logicalExecutionId.normalize("NFC") ||
    !nullableEqual(receipt.taskId, input.taskId) ||
    receipt.agentId !== input.agentId ||
    !nullableEqual(receipt.approvalId, input.approvalId) ||
    !nullableEqual(receipt.sourceMessageId, input.sourceMessageId) ||
    (sameOperation &&
      !nullableEqual(receipt.originAttemptId, input.originAttemptId)) ||
    (receipt.sideEffectClass !== input.sideEffectClass &&
      !(
        receipt.toolName === "browser_save_screenshot" &&
        receipt.sideEffectClass === "idempotent" &&
        input.sideEffectClass === "at_most_once"
      )) ||
    receipt.toolName !== input.toolName.normalize("NFC") ||
    receipt.argumentHash !== expected.argumentHash ||
    !nullableEqual(
      receipt.externalIdempotencyKey,
      input.externalIdempotencyKey ?? null,
    )
  ) {
    throw new OperationReceiptIntegrityError(
      "Operation key collision has different immutable receipt fields.",
    );
  }
}

async function findLegacyCompatibilityReceipt(
  input: ReserveOperationInput,
  argsHash: string,
  executor: OperationExecutor,
): Promise<OperationReceipt | null> {
  if (input.sideEffectClass === "read_only") return null;

  const logicalExecutionId = input.logicalExecutionId.normalize("NFC");
  const toolName = input.toolName.normalize("NFC");
  const legacyArgsHash = legacyCanonicalArgumentHash(input.args);
  const corePredicate = and(
    eq(operationReceiptsTable.canonicalVersion, input.canonicalVersion),
    eq(operationReceiptsTable.executionKind, input.executionKind),
    eq(operationReceiptsTable.logicalExecutionId, logicalExecutionId),
    input.toolName === "browser_save_screenshot" &&
      input.sideEffectClass === "at_most_once"
      ? inArray(operationReceiptsTable.sideEffectClass, [
          "idempotent",
          "at_most_once",
        ])
      : eq(operationReceiptsTable.sideEffectClass, input.sideEffectClass),
    eq(operationReceiptsTable.toolName, toolName),
    sql`${operationReceiptsTable.externalIdempotencyKey} is not null`,
    sql`${operationReceiptsTable.replayKey} = ${operationReceiptsTable.externalIdempotencyKey}`,
  );
  const compatibleHashPredicate =
    legacyArgsHash === argsHash
      ? eq(operationReceiptsTable.argumentHash, argsHash)
      : or(
          eq(operationReceiptsTable.argumentHash, argsHash),
          eq(operationReceiptsTable.argumentHash, legacyArgsHash),
        );
  const exactMatches = await executor
    .select()
    .from(operationReceiptsTable)
    .where(and(corePredicate, compatibleHashPredicate))
    .limit(2);
  if (exactMatches.length > 1) {
    throw new OperationReceiptIntegrityError(
      "Legacy operation identity resolves to multiple hash-compatible receipts.",
    );
  }
  let receipt = exactMatches[0];
  if (!receipt) {
    const broadMatches = await executor
      .select()
      .from(operationReceiptsTable)
      .where(corePredicate)
      .limit(2);
    if (broadMatches.length > 1) {
      throw new OperationReceiptIntegrityError(
        "Legacy operation identity is ambiguous after canonical hash drift.",
      );
    }
    receipt = broadMatches[0];
  }
  if (!receipt) return null;

  const suppliedExternalKey = input.externalIdempotencyKey ?? null;
  if (
    !nullableEqual(receipt.taskId, input.taskId) ||
    receipt.agentId !== input.agentId ||
    !nullableEqual(receipt.approvalId, input.approvalId) ||
    !nullableEqual(receipt.sourceMessageId, input.sourceMessageId) ||
    (suppliedExternalKey !== null &&
      receipt.externalIdempotencyKey !== suppliedExternalKey)
  ) {
    throw new OperationReceiptIntegrityError(
      "Legacy replay identity has different immutable receipt fields.",
    );
  }
  return receipt;
}

interface ConfirmedAppliedTaskCycleIdentity {
  canonicalVersion: number;
  taskId: number;
  agentId: number;
  originAttemptId: string;
  logicalExecutionId: string;
  toolName: string;
  argumentHash: string;
}

async function findConfirmedAppliedTaskCycleReceipt(
  identity: ConfirmedAppliedTaskCycleIdentity,
  executor: OperationExecutor,
  excludeReceiptId?: string,
): Promise<OperationReceipt | null> {
  const attempts = await executor
    .select({
      id: taskAttemptsTable.id,
      cycleNumber: taskAttemptsTable.cycleNumber,
    })
    .from(taskAttemptsTable)
    .where(
      and(
        eq(taskAttemptsTable.id, identity.originAttemptId),
        eq(taskAttemptsTable.taskId, identity.taskId),
        eq(taskAttemptsTable.agentId, identity.agentId),
        eq(
          taskAttemptsTable.logicalExecutionId,
          identity.logicalExecutionId.normalize("NFC"),
        ),
      ),
    )
    .limit(2);
  if (attempts.length !== 1) {
    throw new OperationReceiptIntegrityError(
      "Task-step reservation does not resolve to one exact durable attempt.",
    );
  }

  const predicates = [
    eq(operationReceiptsTable.canonicalVersion, identity.canonicalVersion),
    eq(operationReceiptsTable.executionKind, "task_step"),
    eq(operationReceiptsTable.taskId, identity.taskId),
    eq(operationReceiptsTable.agentId, identity.agentId),
    eq(operationReceiptsTable.toolName, identity.toolName.normalize("NFC")),
    eq(operationReceiptsTable.argumentHash, identity.argumentHash),
    eq(operationReceiptsTable.state, "unknown"),
    eq(operationReceiptsTable.reconciliationDecision, "confirmed_applied"),
    eq(taskAttemptsTable.cycleNumber, attempts[0]!.cycleNumber),
  ];
  if (excludeReceiptId) {
    predicates.push(sql`${operationReceiptsTable.id} <> ${excludeReceiptId}`);
  }
  const matches = await executor
    .select({ id: operationReceiptsTable.id })
    .from(operationReceiptsTable)
    .innerJoin(
      taskAttemptsTable,
      eq(operationReceiptsTable.originAttemptId, taskAttemptsTable.id),
    )
    .where(and(...predicates))
    .limit(2);
  if (matches.length > 1) {
    throw new OperationReceiptIntegrityError(
      "Multiple confirmed-applied receipts match one task-cycle effect.",
    );
  }
  if (matches.length === 0) return null;
  const receipt = await selectReceipt(executor, matches[0]!.id);
  if (!receipt) {
    throw new OperationReceiptIntegrityError(
      "Confirmed-applied continuation evidence disappeared.",
    );
  }
  return receipt;
}

async function findActiveTaskCycleReceipts(
  identity: ConfirmedAppliedTaskCycleIdentity,
  executor: OperationExecutor,
  excludeReceiptId?: string,
): Promise<OperationReceipt[]> {
  const attempts = await executor
    .select({ cycleNumber: taskAttemptsTable.cycleNumber })
    .from(taskAttemptsTable)
    .where(
      and(
        eq(taskAttemptsTable.id, identity.originAttemptId),
        eq(taskAttemptsTable.taskId, identity.taskId),
        eq(taskAttemptsTable.agentId, identity.agentId),
      ),
    )
    .limit(2);
  if (attempts.length !== 1) {
    throw new OperationReceiptIntegrityError(
      "Task-cycle reconciliation does not resolve to one durable attempt.",
    );
  }
  const predicates = [
    eq(operationReceiptsTable.canonicalVersion, identity.canonicalVersion),
    eq(operationReceiptsTable.executionKind, "task_step"),
    eq(operationReceiptsTable.taskId, identity.taskId),
    eq(operationReceiptsTable.agentId, identity.agentId),
    eq(operationReceiptsTable.toolName, identity.toolName.normalize("NFC")),
    eq(operationReceiptsTable.argumentHash, identity.argumentHash),
    inArray(operationReceiptsTable.state, ["reserved", "running"]),
    eq(taskAttemptsTable.cycleNumber, attempts[0]!.cycleNumber),
  ];
  if (excludeReceiptId) {
    predicates.push(sql`${operationReceiptsTable.id} <> ${excludeReceiptId}`);
  }
  return executor
    .select({ receipt: operationReceiptsTable })
    .from(operationReceiptsTable)
    .innerJoin(
      taskAttemptsTable,
      eq(operationReceiptsTable.originAttemptId, taskAttemptsTable.id),
    )
    .where(and(...predicates))
    .then((rows) => rows.map((row) => row.receipt));
}

function toolPresentationData(
  receipt: Pick<OperationReceipt, "toolName" | "resultData">,
): Record<string, unknown> | null {
  const executionLocale = toolReceiptLocale(receipt);
  return executionLocale ? { executionLocale } : null;
}

async function reserveOperationLocked(
  input: ReserveOperationInput,
  executor: OperationExecutor,
): Promise<ReserveOperationResult> {
  if (
    input.executionLocale !== undefined &&
    (!isWorkspaceLocale(input.executionLocale) ||
      !hasLocalizedToolOutput(input.toolName))
  ) {
    throw new TypeError("Invalid tool execution locale metadata.");
  }
  const operationKey = canonicalOperationKey(input);
  const replayKey = canonicalReplayKey(input);
  const argsHash = canonicalArgumentHash(input.args);
  const legacyReceipt = await findLegacyCompatibilityReceipt(
    input,
    argsHash,
    executor,
  );
  if (legacyReceipt) {
    return {
      receipt: legacyReceipt,
      execute: false,
      disposition: existingReservationDisposition(legacyReceipt),
    };
  }

  const externalIdempotencyKey = input.externalIdempotencyKey ?? null;
  const conflictPredicate = externalIdempotencyKey
    ? replayKey
      ? or(
          eq(operationReceiptsTable.operationKey, operationKey),
          eq(operationReceiptsTable.replayKey, replayKey),
          eq(
            operationReceiptsTable.externalIdempotencyKey,
            externalIdempotencyKey,
          ),
        )
      : or(
          eq(operationReceiptsTable.operationKey, operationKey),
          eq(
            operationReceiptsTable.externalIdempotencyKey,
            externalIdempotencyKey,
          ),
        )
    : replayKey
      ? or(
          eq(operationReceiptsTable.operationKey, operationKey),
          eq(operationReceiptsTable.replayKey, replayKey),
        )
      : eq(operationReceiptsTable.operationKey, operationKey);
  const observeExisting = async (): Promise<OperationReceipt | null> => {
    const observed = await executor
      .select()
      .from(operationReceiptsTable)
      .where(conflictPredicate)
      .limit(2);
    if (observed.length > 1) {
      throw new OperationReceiptIntegrityError(
        "Operation and replay keys resolve to different receipts.",
      );
    }
    const receipt = observed[0] ?? null;
    if (!receipt) return null;
    assertReceiptIdentity(receipt, input, {
      operationKey,
      replayKey,
      argumentHash: argsHash,
    });
    return receipt;
  };
  const existingReceipt = await observeExisting();
  if (
    input.executionKind === "task_step" &&
    input.sideEffectClass !== "read_only"
  ) {
    if (input.taskId === null || input.originAttemptId === null) {
      throw new OperationReceiptIntegrityError(
        "Task-step continuation identity is incomplete.",
      );
    }
    const confirmedApplied = await findConfirmedAppliedTaskCycleReceipt(
      {
        canonicalVersion: input.canonicalVersion,
        taskId: input.taskId,
        agentId: input.agentId,
        originAttemptId: input.originAttemptId,
        logicalExecutionId: input.logicalExecutionId,
        toolName: input.toolName,
        argumentHash: argsHash,
      },
      executor,
    );
    if (confirmedApplied) {
      return {
        receipt: confirmedApplied,
        execute: false,
        disposition: "reconciled_applied",
      };
    }
  }
  if (existingReceipt) {
    return {
      receipt: existingReceipt,
      execute: false,
      disposition: existingReservationDisposition(existingReceipt),
    };
  }

  const [inserted] = await executor
    .insert(operationReceiptsTable)
    .values({
      id: randomUUID(),
      canonicalVersion: input.canonicalVersion,
      operationKey,
      replayKey,
      executionKind: input.executionKind,
      logicalExecutionId: input.logicalExecutionId.normalize("NFC"),
      taskId: input.taskId,
      agentId: input.agentId,
      approvalId: input.approvalId,
      sourceMessageId: input.sourceMessageId,
      originAttemptId: input.originAttemptId,
      sideEffectClass: input.sideEffectClass,
      state: "reserved",
      toolName: input.toolName.normalize("NFC"),
      argumentHash: argsHash,
      resultData: input.executionLocale
        ? { executionLocale: input.executionLocale }
        : null,
      externalIdempotencyKey: input.externalIdempotencyKey ?? null,
      reservedAt: input.now ?? new Date(),
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) {
    await appendOperationsChanged(executor, {
      kind: "receipt_reserved",
      taskId: inserted.taskId,
      agentId: inserted.agentId,
      attemptId: inserted.originAttemptId,
      receiptId: inserted.id,
      state: inserted.state,
      createdAt: inserted.reservedAt,
    });
    return { receipt: inserted, execute: true, disposition: "execute" };
  }

  const observedReceipt = await observeExisting();
  if (!observedReceipt) {
    throw new OperationReceiptIntegrityError(
      "Operation reservation conflict was not observable.",
    );
  }
  return {
    receipt: observedReceipt,
    execute: false,
    disposition: existingReservationDisposition(observedReceipt),
  };
}

export async function reserveOperation(
  input: ReserveOperationInput,
  executor: OperationExecutor = db,
): Promise<ReserveOperationResult> {
  if (input.executionKind !== "task_step") {
    return withOperationTransaction(executor, (tx) =>
      reserveOperationLocked(input, tx),
    );
  }
  if (input.taskId === null) {
    throw new OperationReceiptIntegrityError(
      "Task-step reservation requires an owning task.",
    );
  }
  if (
    input.originAttemptId === null ||
    input.physical.attemptId !== input.originAttemptId ||
    !input.physical.workerInstanceId
  ) {
    throw new OperationReceiptIntegrityError(
      "Task-step reservation requires one exact origin attempt and worker.",
    );
  }
  return withOperationTransaction(executor, async (tx) => {
    // Match claim/recovery/reconciliation's canonical lock order. In
    // particular, never take task/attempt locks before runtime/agent locks:
    // PostgreSQL foreign-key checks and a concurrent claim would otherwise
    // form an agent -> task / task -> agent cycle.
    await lockRuntimeControlState(tx);
    await lockRuntimeInstance(tx, input.physical.workerInstanceId ?? null);
    await lockAgent(tx, input.agentId);
    await lockTask(tx, input.taskId);
    await lockAndAssertOriginAttempt(tx, input);
    return reserveOperationLocked(input, tx);
  });
}

async function withOperationTransaction<T>(
  executor: OperationExecutor,
  callback: (tx: OperationTransaction) => Promise<T>,
): Promise<T> {
  if (executor === db) return db.transaction(callback);
  return callback(executor as OperationTransaction);
}

async function lockRuntimeInstance(
  tx: OperationTransaction,
  runtimeInstanceId: string | null,
): Promise<void> {
  if (!runtimeInstanceId) return;
  await tx.execute(
    sql`SELECT id FROM ${runtimeInstancesTable} WHERE ${runtimeInstancesTable.id} = ${runtimeInstanceId} FOR UPDATE`,
  );
}

async function lockAgent(
  tx: OperationTransaction,
  agentId: number,
): Promise<void> {
  await tx.execute(
    sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${agentId} FOR UPDATE`,
  );
}

async function lockApproval(
  tx: OperationTransaction,
  approvalId: number | null,
): Promise<void> {
  if (approvalId === null) return;
  await tx.execute(
    sql`SELECT id FROM ${approvalRequestsTable} WHERE ${approvalRequestsTable.id} = ${approvalId} FOR UPDATE`,
  );
}

async function lockTask(
  tx: OperationTransaction,
  taskId: number | null,
): Promise<void> {
  if (taskId === null) return;
  await tx.execute(
    sql`SELECT id FROM ${tasksTable} WHERE ${tasksTable.id} = ${taskId} FOR UPDATE`,
  );
}

async function lockLogicalExecutionAttempts(
  tx: OperationTransaction,
  receipt: Pick<
    OperationReceipt,
    "executionKind" | "taskId" | "logicalExecutionId"
  >,
): Promise<void> {
  if (receipt.executionKind !== "task_step" || receipt.taskId === null) return;
  await tx.execute(
    sql`SELECT id FROM ${taskAttemptsTable}
        WHERE ${taskAttemptsTable.taskId} = ${receipt.taskId}
          AND ${taskAttemptsTable.logicalExecutionId} = ${receipt.logicalExecutionId}
        ORDER BY id
        FOR UPDATE`,
  );
}

async function lockAndAssertOriginAttempt(
  tx: OperationTransaction,
  input: ReserveOperationInput,
): Promise<void> {
  if (input.taskId === null || input.originAttemptId === null) {
    throw new OperationReceiptIntegrityError(
      "Task-step reservation origin attempt is incomplete.",
    );
  }
  await tx.execute(
    sql`SELECT id FROM ${taskAttemptsTable}
        WHERE ${taskAttemptsTable.id} = ${input.originAttemptId}
        FOR UPDATE`,
  );
  const [attempt] = await tx
    .select()
    .from(taskAttemptsTable)
    .where(eq(taskAttemptsTable.id, input.originAttemptId));
  if (
    !attempt ||
    attempt.taskId !== input.taskId ||
    attempt.agentId !== input.agentId ||
    attempt.logicalExecutionId !== input.logicalExecutionId.normalize("NFC") ||
    attempt.workerInstanceId !== input.physical.workerInstanceId
  ) {
    throw new OperationReceiptIntegrityError(
      "Task-step reservation origin attempt does not match its durable identity.",
    );
  }
}

async function lockReceipt(
  tx: OperationTransaction,
  receiptId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT id FROM ${operationReceiptsTable} WHERE ${operationReceiptsTable.id} = ${receiptId} FOR UPDATE`,
  );
}

async function lockInvocation(
  tx: OperationTransaction,
  invocationId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT id FROM ${operationInvocationsTable} WHERE ${operationInvocationsTable.id} = ${invocationId} FOR UPDATE`,
  );
}

async function selectReceipt(
  executor: OperationExecutor,
  receiptId: string,
): Promise<OperationReceipt | null> {
  const [receipt] = await executor
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.id, receiptId));
  return receipt ?? null;
}

async function selectInvocation(
  executor: OperationExecutor,
  invocationId: string,
): Promise<OperationInvocation | null> {
  const [invocation] = await executor
    .select()
    .from(operationInvocationsTable)
    .where(eq(operationInvocationsTable.id, invocationId));
  return invocation ?? null;
}

export async function claimOperationInvocation(
  input: ClaimOperationInvocationInput,
  executor: OperationExecutor = db,
): Promise<ClaimOperationInvocationResult> {
  const snapshot = await selectReceipt(executor, input.receiptId);
  if (!snapshot) {
    throw new OperationInvocationStateError("Operation receipt is missing.");
  }
  return withOperationTransaction(executor, async (tx) => {
    const now = input.now ?? new Date();
    await lockAndAssertExecutionAllowed(tx);
    await lockRuntimeInstance(tx, input.workerInstanceId);
    await lockAgent(tx, snapshot.agentId);
    await lockApproval(tx, snapshot.approvalId);
    await lockTask(tx, snapshot.taskId);
    await lockLogicalExecutionAttempts(tx, snapshot);
    await lockReceipt(tx, input.receiptId);
    await tx.execute(
      sql`SELECT id FROM ${operationInvocationsTable}
          WHERE ${operationInvocationsTable.receiptId} = ${input.receiptId}
            AND ${operationInvocationsTable.state} IN ('claimed', 'running')
          FOR UPDATE`,
    );

    const receipt = await selectReceipt(tx, input.receiptId);
    if (!receipt) {
      throw new OperationInvocationStateError("Operation receipt disappeared.");
    }
    if (receipt.executionKind !== input.executionKind) {
      throw new OperationReceiptIntegrityError(
        "Invocation kind does not match its logical receipt.",
      );
    }
    if (
      receipt.executionKind === "task_step" &&
      receipt.sideEffectClass !== "read_only"
    ) {
      if (receipt.taskId === null || receipt.originAttemptId === null) {
        throw new OperationReceiptIntegrityError(
          "Task-step continuation identity is incomplete at claim.",
        );
      }
      const confirmedApplied = await findConfirmedAppliedTaskCycleReceipt(
        {
          canonicalVersion: receipt.canonicalVersion,
          taskId: receipt.taskId,
          agentId: receipt.agentId,
          originAttemptId: receipt.originAttemptId,
          logicalExecutionId: receipt.logicalExecutionId,
          toolName: receipt.toolName,
          argumentHash: receipt.argumentHash,
        },
        tx,
        receipt.id,
      );
      if (confirmedApplied) {
        return {
          claimed: false,
          receipt: confirmedApplied,
          invocation: null,
        };
      }
    }
    const [activeInvocation] = await tx
      .select()
      .from(operationInvocationsTable)
      .where(
        and(
          eq(operationInvocationsTable.receiptId, input.receiptId),
          inArray(operationInvocationsTable.state, ["claimed", "running"]),
        ),
      );
    if (activeInvocation || receipt.state !== "reserved") {
      return {
        claimed: false,
        receipt,
        invocation: activeInvocation ?? null,
      };
    }

    const releasedScreenshot = await findReleasedScreenshotInvocation(
      tx,
      receipt,
    );
    if (releasedScreenshot) {
      const recovered = await quarantineReleasedScreenshot(
        tx,
        receipt,
        releasedScreenshot,
        now,
      );
      return {
        claimed: false,
        receipt: recovered.receipt,
        invocation: recovered.invocation,
      };
    }

    if (input.workerInstanceId) {
      const [runtime] = await tx
        .select()
        .from(runtimeInstancesTable)
        .where(eq(runtimeInstancesTable.id, input.workerInstanceId));
      if (!runtime || !["starting", "healthy"].includes(runtime.state)) {
        throw new OperationInvocationStateError(
          "The invocation runtime is not healthy.",
        );
      }
    }
    const [agent] = await tx
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, receipt.agentId));
    if (
      !agent?.isActive ||
      agent.runLeaseOwner !== input.agentLeaseOwner ||
      !agent.runLeaseExpiresAt ||
      agent.runLeaseExpiresAt.getTime() <= now.getTime()
    ) {
      throw new OperationInvocationStateError(
        "The invocation agent lease is not current.",
      );
    }

    if (receipt.executionKind === "task_step") {
      if (
        receipt.taskId === null ||
        !input.attemptId ||
        !input.taskLeaseOwner ||
        !input.workerInstanceId
      ) {
        throw new OperationReceiptIntegrityError(
          "Task-step invocation evidence is incomplete.",
        );
      }
      const [task] = await tx
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, receipt.taskId));
      const [attempt] = await tx
        .select()
        .from(taskAttemptsTable)
        .where(eq(taskAttemptsTable.id, input.attemptId));
      if (
        !task ||
        task.ownerAgentId !== receipt.agentId ||
        task.leaseOwner !== input.taskLeaseOwner ||
        !task.leaseExpiresAt ||
        task.leaseExpiresAt.getTime() <= now.getTime() ||
        !attempt ||
        attempt.taskId !== receipt.taskId ||
        attempt.agentId !== receipt.agentId ||
        attempt.workerInstanceId !== input.workerInstanceId ||
        attempt.leaseOwner !== input.taskLeaseOwner ||
        attempt.logicalExecutionId !== receipt.logicalExecutionId ||
        !["claimed", "running"].includes(attempt.state)
      ) {
        throw new OperationInvocationStateError(
          "Task-step invocation authority is stale or mismatched.",
        );
      }
    } else if (receipt.executionKind === "approved_action") {
      if (receipt.approvalId === null || !input.workerInstanceId) {
        throw new OperationReceiptIntegrityError(
          "Approved-action invocation evidence is incomplete.",
        );
      }
      const [approval] = await tx
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, receipt.approvalId));
      assertApprovedActionAuthority({
        receipt,
        approval,
        workerInstanceId: input.workerInstanceId,
        browserBinding: input.browserBinding,
        now,
      });
      const [task] = await tx
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, receipt.taskId!));
      if (
        !task ||
        task.ownerAgentId !== receipt.agentId ||
        task.status !== "awaiting_approval" ||
        task.leaseOwner !== input.agentLeaseOwner ||
        !task.leaseExpiresAt ||
        task.leaseExpiresAt.getTime() <= now.getTime()
      ) {
        throw new OperationInvocationStateError(
          "Approved-action task is no longer awaiting this effect.",
        );
      }
    }

    const [invocation] = await tx
      .insert(operationInvocationsTable)
      .values({
        id: randomUUID(),
        receiptId: input.receiptId,
        executionKind: input.executionKind,
        state: "claimed",
        attemptId: input.attemptId,
        workerInstanceId: input.workerInstanceId,
        modelToolCallId: input.modelToolCallId ?? null,
        leaseOwner: input.leaseOwner,
        leaseExpiresAt: input.leaseExpiresAt,
        taskLeaseOwner: input.taskLeaseOwner,
        agentLeaseOwner: input.agentLeaseOwner,
        claimedAt: now,
        lastHeartbeatAt: now,
      })
      .returning();
    if (!invocation) {
      throw new OperationInvocationStateError(
        "Operation invocation insert returned no row.",
      );
    }
    await appendOperationsChanged(tx, {
      kind: "invocation_created",
      taskId: receipt.taskId,
      agentId: receipt.agentId,
      attemptId: invocation.attemptId,
      receiptId: receipt.id,
      invocationId: invocation.id,
      state: invocation.state,
      createdAt: now,
    });
    return { claimed: true, receipt, invocation };
  });
}

async function lockCanonicalInvocationRows(
  tx: OperationTransaction,
  receipt: OperationReceipt,
  invocation: OperationInvocation,
  options: { assertExecutionAllowed: boolean },
): Promise<void> {
  if (options.assertExecutionAllowed) await lockAndAssertExecutionAllowed(tx);
  else await lockRuntimeControlState(tx);
  await lockRuntimeInstance(tx, invocation.workerInstanceId);
  await lockAgent(tx, receipt.agentId);
  await lockApproval(tx, receipt.approvalId);
  await lockTask(tx, receipt.taskId);
  await lockLogicalExecutionAttempts(tx, receipt);
  await lockReceipt(tx, receipt.id);
  await lockInvocation(tx, invocation.id);
}

async function ownedInvocationRows(
  executor: OperationExecutor,
  input: OperationInvocationOwnerInput,
): Promise<{ receipt: OperationReceipt; invocation: OperationInvocation }> {
  const [receipt, invocation] = await Promise.all([
    selectReceipt(executor, input.receiptId),
    selectInvocation(executor, input.invocationId),
  ]);
  if (!receipt || !invocation || invocation.receiptId !== receipt.id) {
    throw new OperationInvocationStateError(
      "Operation receipt or invocation is missing.",
    );
  }
  if (invocation.leaseOwner !== input.leaseOwner) {
    throw new OperationInvocationOwnershipLostError();
  }
  return { receipt, invocation };
}

async function assertLiveInvocationAuthority(
  tx: OperationTransaction,
  receipt: OperationReceipt,
  invocation: OperationInvocation,
  browserBinding: ApprovedBrowserBindingEvidence | null | undefined,
  now: Date,
  purpose: "start" | "heartbeat" | "finalize",
  allowExpiredInvocationLeaseRenewal = false,
): Promise<void> {
  if (
    receipt.executionKind === "task_step" &&
    receipt.sideEffectClass !== "read_only"
  ) {
    if (receipt.taskId === null || receipt.originAttemptId === null) {
      throw new OperationReceiptIntegrityError(
        "Task-step continuation identity is incomplete at the effect boundary.",
      );
    }
    const confirmedApplied = await findConfirmedAppliedTaskCycleReceipt(
      {
        canonicalVersion: receipt.canonicalVersion,
        taskId: receipt.taskId,
        agentId: receipt.agentId,
        originAttemptId: receipt.originAttemptId,
        logicalExecutionId: receipt.logicalExecutionId,
        toolName: receipt.toolName,
        argumentHash: receipt.argumentHash,
      },
      tx,
      receipt.id,
    );
    if (confirmedApplied) {
      throw new ConfirmedAppliedReplayError(confirmedApplied);
    }
  }
  if (
    !allowExpiredInvocationLeaseRenewal &&
    invocation.leaseExpiresAt.getTime() <= now.getTime()
  ) {
    throw new OperationInvocationStateError(
      "Operation invocation lease expired before the effect boundary.",
      "invocationExpired",
    );
  }
  if (invocation.workerInstanceId) {
    const [runtime] = await tx
      .select()
      .from(runtimeInstancesTable)
      .where(eq(runtimeInstancesTable.id, invocation.workerInstanceId));
    const drainingFinalization =
      runtime?.state === "draining" &&
      purpose !== "start" &&
      receipt.state === "running" &&
      invocation.state === "running";
    if (
      !runtime ||
      (!drainingFinalization &&
        !["starting", "healthy"].includes(runtime.state))
    ) {
      throw new OperationInvocationStateError(
        purpose === "start"
          ? "Operation runtime is not healthy at the effect boundary."
          : "Operation runtime no longer owns this active finalization.",
        "runtimeUnavailable",
      );
    }
  }
  const [agent] = await tx
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, receipt.agentId));
  if (
    !agent?.isActive ||
    agent.runLeaseOwner !== invocation.agentLeaseOwner ||
    !agent.runLeaseExpiresAt ||
    agent.runLeaseExpiresAt.getTime() <= now.getTime()
  ) {
    throw new OperationInvocationStateError(
      "Operation agent lease is stale at the effect boundary.",
      "agentAuthorityLost",
    );
  }
  if (receipt.executionKind === "task_step") {
    if (
      receipt.taskId === null ||
      !invocation.attemptId ||
      !invocation.taskLeaseOwner
    ) {
      throw new OperationReceiptIntegrityError(
        "Task-step invocation authority is incomplete.",
      );
    }
    const [task] = await tx
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, receipt.taskId));
    const [attempt] = await tx
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, invocation.attemptId));
    if (
      !task ||
      task.ownerAgentId !== receipt.agentId ||
      task.leaseOwner !== invocation.taskLeaseOwner ||
      !task.leaseExpiresAt ||
      task.leaseExpiresAt.getTime() <= now.getTime() ||
      !attempt ||
      attempt.logicalExecutionId !== receipt.logicalExecutionId ||
      attempt.leaseOwner !== invocation.taskLeaseOwner ||
      !["claimed", "running"].includes(attempt.state)
    ) {
      throw new OperationInvocationStateError(
        "Task-step authority is stale at the effect boundary.",
        "taskAuthorityLost",
      );
    }
  } else if (receipt.executionKind === "approved_action") {
    if (receipt.approvalId === null || !invocation.workerInstanceId) {
      throw new OperationReceiptIntegrityError(
        "Approved-action invocation authority is incomplete.",
      );
    }
    const [[approval], [task]] = await Promise.all([
      tx
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, receipt.approvalId)),
      tx.select().from(tasksTable).where(eq(tasksTable.id, receipt.taskId!)),
    ]);
    if (receipt.state === "running" && invocation.state === "running") {
      assertConsumedApprovedActionAuthority({
        receipt,
        approval,
        workerInstanceId: invocation.workerInstanceId,
        browserBinding,
      });
    } else {
      assertApprovedActionAuthority({
        receipt,
        approval,
        workerInstanceId: invocation.workerInstanceId,
        browserBinding,
        now,
      });
    }
    if (
      !task ||
      task.ownerAgentId !== receipt.agentId ||
      task.status !== "awaiting_approval" ||
      task.leaseOwner !== invocation.agentLeaseOwner ||
      !task.leaseExpiresAt ||
      task.leaseExpiresAt.getTime() <= now.getTime()
    ) {
      throw new OperationInvocationStateError(
        "Approved-action task is no longer awaiting this effect.",
      );
    }
  }
}

export async function markOperationRunning(
  input: OperationInvocationOwnerInput,
  executor: OperationExecutor = db,
): Promise<{ receipt: OperationReceipt; invocation: OperationInvocation }> {
  const snapshot = await ownedInvocationRows(executor, input);
  return withOperationTransaction(executor, async (tx) => {
    const now = input.now ?? new Date();
    await lockCanonicalInvocationRows(
      tx,
      snapshot.receipt,
      snapshot.invocation,
      {
        assertExecutionAllowed: true,
      },
    );
    const live = await ownedInvocationRows(tx, input);
    if (
      live.receipt.state !== "reserved" ||
      live.invocation.state !== "claimed"
    ) {
      throw new OperationInvocationStateError(
        "Only a claimed invocation on a reserved receipt can start an effect.",
      );
    }
    await assertLiveInvocationAuthority(
      tx,
      live.receipt,
      live.invocation,
      input.browserBinding,
      now,
      "start",
    );
    if (live.receipt.executionKind === "approved_action") {
      const [approvalForScrub] = await tx
        .select({ scope: approvalRequestsTable.scope })
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, live.receipt.approvalId!));
      const [consumedApproval] = await tx
        .update(approvalRequestsTable)
        .set({
          consumedAt: now,
          actionPayload: null,
          scope: consumedApprovalScope(
            approvalForScrub?.scope ?? null,
            "consumed",
          ),
        })
        .where(
          and(
            eq(approvalRequestsTable.id, live.receipt.approvalId!),
            eq(approvalRequestsTable.status, "approved"),
            sql`${approvalRequestsTable.consumedAt} is null`,
            sql`${approvalRequestsTable.bindingInvalidatedAt} is null`,
            sql`${approvalRequestsTable.expiresAt} > ${now}`,
          ),
        )
        .returning({ id: approvalRequestsTable.id });
      if (!consumedApproval) {
        throw new OperationInvocationStateError(
          "Approved-action capability was consumed by another owner.",
        );
      }
    }
    const [runningInvocation] = await tx
      .update(operationInvocationsTable)
      .set({
        state: "running",
        effectStartedAt: now,
        lastHeartbeatAt: now,
      })
      .where(
        and(
          eq(operationInvocationsTable.id, input.invocationId),
          eq(operationInvocationsTable.receiptId, input.receiptId),
          eq(operationInvocationsTable.leaseOwner, input.leaseOwner),
          eq(operationInvocationsTable.state, "claimed"),
        ),
      )
      .returning();
    const [runningReceipt] = await tx
      .update(operationReceiptsTable)
      .set({ state: "running", startedAt: now, finishedAt: null })
      .where(
        and(
          eq(operationReceiptsTable.id, input.receiptId),
          eq(operationReceiptsTable.state, "reserved"),
        ),
      )
      .returning();
    if (!runningInvocation || !runningReceipt) {
      throw new OperationInvocationStateError(
        "Operation running transition lost its compare-and-set race.",
      );
    }
    await appendOperationsChanged(tx, {
      kind: "invocation_state_changed",
      taskId: runningReceipt.taskId,
      agentId: runningReceipt.agentId,
      attemptId: runningInvocation.attemptId,
      receiptId: runningReceipt.id,
      invocationId: runningInvocation.id,
      state: runningInvocation.state,
      createdAt: now,
    });
    await appendOperationsChanged(tx, {
      kind: "receipt_state_changed",
      taskId: runningReceipt.taskId,
      agentId: runningReceipt.agentId,
      attemptId: runningReceipt.originAttemptId,
      receiptId: runningReceipt.id,
      state: runningReceipt.state,
      createdAt: now,
    });
    return { receipt: runningReceipt, invocation: runningInvocation };
  });
}

/** Recheck live authority inside a filesystem lock using its transaction.
 * This neither starts a second effect nor renews an expired lease. */
export async function assertOperationInvocationActive(
  input: OperationInvocationOwnerInput,
  executor: OperationExecutor = db,
): Promise<void> {
  const snapshot = await ownedInvocationRows(executor, input);
  await withOperationTransaction(executor, async (tx) => {
    await lockCanonicalInvocationRows(
      tx,
      snapshot.receipt,
      snapshot.invocation,
      {
        assertExecutionAllowed: true,
      },
    );
    const live = await ownedInvocationRows(tx, input);
    const activePair =
      (live.receipt.state === "reserved" &&
        live.invocation.state === "claimed") ||
      (live.receipt.state === "running" && live.invocation.state === "running");
    if (!activePair) {
      throw new OperationInvocationStateError(
        "Operation is no longer active at the file effect boundary.",
      );
    }
    await assertLiveInvocationAuthority(
      tx,
      live.receipt,
      live.invocation,
      input.browserBinding,
      input.now ?? new Date(),
      "start",
    );
  });
}

export async function heartbeatOperationInvocation(
  input: HeartbeatOperationInvocationInput,
  executor: OperationExecutor = db,
): Promise<HeartbeatOperationInvocationResult> {
  const snapshot = await ownedInvocationRows(executor, input);
  return withOperationTransaction(executor, async (tx) => {
    const now = input.now ?? new Date();
    if (
      !Number.isFinite(input.leaseExpiresAt.getTime()) ||
      input.leaseExpiresAt.getTime() <= now.getTime()
    ) {
      throw new TypeError(
        "Operation heartbeat requires a future lease expiry.",
      );
    }
    await lockCanonicalInvocationRows(
      tx,
      snapshot.receipt,
      snapshot.invocation,
      {
        assertExecutionAllowed: true,
      },
    );
    const live = await ownedInvocationRows(tx, input);
    if (
      ["succeeded", "failed", "unknown"].includes(live.invocation.state) &&
      ["succeeded", "failed", "unknown"].includes(live.receipt.state)
    ) {
      return { renewed: false, ...live };
    }
    const validActivePair =
      (live.receipt.state === "reserved" &&
        live.invocation.state === "claimed") ||
      (live.receipt.state === "running" && live.invocation.state === "running");
    if (!validActivePair) {
      throw new OperationInvocationStateError(
        "Operation heartbeat observed an inconsistent receipt/invocation pair.",
      );
    }
    await assertLiveInvocationAuthority(
      tx,
      live.receipt,
      live.invocation,
      input.browserBinding,
      now,
      "heartbeat",
      input.allowExpiredInvocationLeaseRenewal,
    );
    const [invocation] = await tx
      .update(operationInvocationsTable)
      .set({
        leaseExpiresAt: input.leaseExpiresAt,
        lastHeartbeatAt: now,
      })
      .where(
        and(
          eq(operationInvocationsTable.id, input.invocationId),
          eq(operationInvocationsTable.receiptId, input.receiptId),
          eq(operationInvocationsTable.leaseOwner, input.leaseOwner),
          inArray(operationInvocationsTable.state, ["claimed", "running"]),
        ),
      )
      .returning();
    if (!invocation) {
      throw new OperationInvocationStateError(
        "Operation heartbeat lost its compare-and-set race.",
      );
    }
    return { renewed: true, receipt: live.receipt, invocation };
  });
}

export async function releaseOperationForSafeRetry(
  input: OperationInvocationOwnerInput & {
    failureKind: string;
    sanitizedError: string;
  },
  executor: OperationExecutor = db,
): Promise<OperationReceipt> {
  const snapshot = await ownedInvocationRows(executor, input);
  return withOperationTransaction(executor, async (tx) => {
    const now = input.now ?? new Date();
    await lockCanonicalInvocationRows(
      tx,
      snapshot.receipt,
      snapshot.invocation,
      {
        assertExecutionAllowed: false,
      },
    );
    const live = await ownedInvocationRows(tx, input);
    const beforeEffect =
      live.receipt.state === "reserved" &&
      live.invocation.state === "claimed" &&
      live.invocation.effectStartedAt === null;
    const safelyReplayableAfterEffect =
      live.receipt.state === "running" &&
      live.invocation.state === "running" &&
      live.invocation.effectStartedAt !== null &&
      allowsPostEffectRetry(live.receipt);
    if (!beforeEffect && !safelyReplayableAfterEffect) {
      throw new OperationInvocationStateError(
        "The operation cannot be released for safe retry from its current effect state.",
      );
    }
    const failureKind = truncateUtf8Bytes(input.failureKind, 256);
    const sanitizedError = truncateUtf8Bytes(input.sanitizedError, 4_096);
    const [failedInvocation] = await tx
      .update(operationInvocationsTable)
      .set({
        state: "failed",
        finishedAt: now,
        lastHeartbeatAt: now,
        failureKind,
        sanitizedError,
      })
      .where(
        and(
          eq(operationInvocationsTable.id, input.invocationId),
          eq(operationInvocationsTable.receiptId, input.receiptId),
          eq(operationInvocationsTable.leaseOwner, input.leaseOwner),
          inArray(operationInvocationsTable.state, ["claimed", "running"]),
        ),
      )
      .returning();
    const [reservedReceipt] = await tx
      .update(operationReceiptsTable)
      .set({
        state: "reserved",
        startedAt: null,
        finishedAt: null,
        resultSummary: null,
        resultData: toolPresentationData(live.receipt),
        failureKind: null,
        sanitizedError: null,
      })
      .where(
        and(
          eq(operationReceiptsTable.id, input.receiptId),
          inArray(operationReceiptsTable.state, ["reserved", "running"]),
        ),
      )
      .returning();
    if (!failedInvocation || !reservedReceipt) {
      throw new OperationInvocationStateError(
        "Safe retry release lost its compare-and-set race.",
      );
    }
    await appendOperationsChanged(tx, {
      kind: "invocation_state_changed",
      taskId: reservedReceipt.taskId,
      agentId: reservedReceipt.agentId,
      attemptId: failedInvocation.attemptId,
      receiptId: reservedReceipt.id,
      invocationId: failedInvocation.id,
      state: failedInvocation.state,
      createdAt: now,
    });
    await appendOperationsChanged(tx, {
      kind: "receipt_state_changed",
      taskId: reservedReceipt.taskId,
      agentId: reservedReceipt.agentId,
      attemptId: reservedReceipt.originAttemptId,
      receiptId: reservedReceipt.id,
      state: reservedReceipt.state,
      createdAt: now,
    });
    return reservedReceipt;
  });
}

const SAFE_RESULT_FIELDS_BY_TOOL: Readonly<
  Record<string, ReadonlySet<string>>
> = Object.freeze({
  create_sub_agent: new Set(["executionLocale", "agentId"]),
  delegate_task: new Set(["executionLocale", "taskId"]),
  update_task_progress: new Set(["executionLocale", "progress"]),
  complete_task: new Set(["executionLocale", "taskId", "status"]),
  request_approval: new Set(["executionLocale", "approvalId"]),
  request_user_input: new Set(["executionLocale", "taskId", "status"]),
  log_note: new Set(["executionLocale", "eventId"]),
  post_company_message: new Set(["executionLocale", "messageId"]),
  vm_run_command: new Set([
    "ok",
    "exitCode",
    "durationMs",
    "taskDisposition",
    "executionLocale",
  ]),
  vm_run_sudo_command: new Set([
    "executionLocale",
    "ok",
    "exitCode",
    "durationMs",
    "taskDisposition",
  ]),
  vm_write_file: new Set(["executionLocale", "pathHash", "byteCount"]),
  browser_open: new Set(["executionLocale", "originHash", "snapshotHash"]),
  browser_click: new Set([
    "executionLocale",
    "ok",
    "snapshotHash",
    "taskDisposition",
  ]),
  browser_type: new Set([
    "executionLocale",
    "ok",
    "snapshotHash",
    "taskDisposition",
  ]),
  browser_scroll: new Set(["executionLocale", "snapshotHash"]),
  browser_save_screenshot: new Set([
    "executionLocale",
    "artifactId",
    "pathHash",
    "byteCount",
  ]),
  computer_observe: new Set(["executionLocale"]),
  vm_list_files: new Set(["executionLocale"]),
  vm_read_file: new Set(["executionLocale"]),
  browser_snapshot: new Set(["executionLocale"]),
  browser_extract_text: new Set(["executionLocale"]),
  browser_wait: new Set(["executionLocale"]),
  synthetic_fixture_write: new Set([
    "schemaVersion",
    "runId",
    "operationKey",
    "valueHash",
    "ok",
  ]),
});

function isSafeResultPrimitive(key: string, value: unknown): boolean {
  if (key === "executionLocale") return isWorkspaceLocale(value);
  if (["ok"].includes(key)) return typeof value === "boolean";
  if (["exitCode"].includes(key)) {
    return (
      value === null || (typeof value === "number" && Number.isInteger(value))
    );
  }
  if (
    [
      "schemaVersion",
      "agentId",
      "taskId",
      "approvalId",
      "eventId",
      "messageId",
      "progress",
      "durationMs",
      "byteCount",
    ].includes(key)
  ) {
    if (key === "schemaVersion") return value === 1;
    return (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      Number.isSafeInteger(value)
    );
  }
  if (["pathHash", "originHash", "snapshotHash"].includes(key)) {
    return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
  }
  if (key === "valueHash") {
    return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
  }
  if (key === "runId") {
    return (
      typeof value === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
    );
  }
  if (key === "operationKey") {
    return (
      typeof value === "string" && /^synthetic:v1:[0-9a-f]{64}$/u.test(value)
    );
  }
  if (key === "artifactId") {
    return (
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        value,
      )
    );
  }
  if (key === "status") {
    return (
      typeof value === "string" &&
      [
        "completed",
        "in_progress",
        "blocked",
        "awaiting_approval",
        "awaiting_user",
      ].includes(value)
    );
  }
  if (key === "taskDisposition") {
    return value === "resume" || value === "complete";
  }
  return false;
}

function assertSafeResultEnvelope(
  toolName: string,
  data: Record<string, unknown> | null,
): void {
  if (data === null) return;
  const allowedFields = SAFE_RESULT_FIELDS_BY_TOOL[toolName];
  if (!allowedFields) {
    throw new TypeError(
      `Operation tool ${toolName} has no allowlisted saved-result envelope.`,
    );
  }
  for (const [key, value] of Object.entries(data)) {
    if (!allowedFields.has(key) || !isSafeResultPrimitive(key, value)) {
      throw new TypeError(
        `Unsafe or non-allowlisted operation result field: ${key}.`,
      );
    }
  }
  if (Buffer.byteLength(canonicalizeJson(data), "utf8") > 16_384) {
    throw new TypeError("Operation result data exceeds 16384 bytes.");
  }
}

export async function completeOperation(
  input: CompleteOperationInput,
  executor: OperationExecutor = db,
): Promise<OperationReceipt> {
  const suppliedResultData = input.resultData ?? null;
  const snapshot = await ownedInvocationRows(executor, input);
  assertSafeResultEnvelope(snapshot.receipt.toolName, suppliedResultData);
  const originalPresentation = toolPresentationData(snapshot.receipt);
  const resultData = originalPresentation
    ? { ...suppliedResultData, ...originalPresentation }
    : suppliedResultData;
  const executionLocale = toolReceiptLocale(snapshot.receipt);
  const resultSummary = executionLocale
    ? toolMessage(executionLocale, "operationCompleted", {
        tool: snapshot.receipt.toolName,
      })
    : `Operation completed: ${snapshot.receipt.toolName}.`;
  return withOperationTransaction(executor, async (tx) => {
    const now = input.now ?? new Date();
    await lockCanonicalInvocationRows(
      tx,
      snapshot.receipt,
      snapshot.invocation,
      {
        assertExecutionAllowed: false,
      },
    );
    const live = await ownedInvocationRows(tx, input);
    if (
      live.receipt.state === "succeeded" &&
      live.invocation.state === "succeeded"
    ) {
      return live.receipt;
    }
    if (
      live.receipt.state !== "running" ||
      live.invocation.state !== "running"
    ) {
      throw new OperationInvocationStateError(
        "Only a running operation can complete successfully.",
      );
    }
    await assertLiveInvocationAuthority(
      tx,
      live.receipt,
      live.invocation,
      input.browserBinding,
      now,
      "finalize",
    );
    const [finishedInvocation] = await tx
      .update(operationInvocationsTable)
      .set({ state: "succeeded", finishedAt: now, lastHeartbeatAt: now })
      .where(
        and(
          eq(operationInvocationsTable.id, input.invocationId),
          eq(operationInvocationsTable.leaseOwner, input.leaseOwner),
          eq(operationInvocationsTable.state, "running"),
        ),
      )
      .returning();
    const [finishedReceipt] = await tx
      .update(operationReceiptsTable)
      .set({
        state: "succeeded",
        finishedAt: now,
        resultSummary,
        resultData,
        failureKind: null,
        sanitizedError: null,
      })
      .where(
        and(
          eq(operationReceiptsTable.id, input.receiptId),
          eq(operationReceiptsTable.state, "running"),
        ),
      )
      .returning();
    if (!finishedInvocation || !finishedReceipt) {
      throw new OperationInvocationStateError(
        "Operation completion lost its compare-and-set race.",
      );
    }
    await appendOperationsChanged(tx, {
      kind: "invocation_state_changed",
      taskId: finishedReceipt.taskId,
      agentId: finishedReceipt.agentId,
      attemptId: finishedInvocation.attemptId,
      receiptId: finishedReceipt.id,
      invocationId: finishedInvocation.id,
      state: finishedInvocation.state,
      createdAt: now,
    });
    await appendOperationsChanged(tx, {
      kind: "receipt_state_changed",
      taskId: finishedReceipt.taskId,
      agentId: finishedReceipt.agentId,
      attemptId: finishedReceipt.originAttemptId,
      receiptId: finishedReceipt.id,
      state: finishedReceipt.state,
      createdAt: now,
    });
    return finishedReceipt;
  });
}

async function retireClaimedTransactionalInvocation(
  input: OperationInvocationOwnerInput,
): Promise<void> {
  const snapshot = await ownedInvocationRows(db, input);
  await db.transaction(async (tx) => {
    const now = new Date();
    await lockCanonicalInvocationRows(
      tx,
      snapshot.receipt,
      snapshot.invocation,
      {
        assertExecutionAllowed: false,
      },
    );
    const live = await ownedInvocationRows(tx, input);
    if (
      live.invocation.state === "failed" &&
      live.receipt.state === "reserved"
    ) {
      return;
    }
    if (
      live.receipt.state !== "reserved" ||
      live.invocation.state !== "claimed"
    ) {
      throw new OperationInvocationStateError(
        "Known transactional rollback no longer owns a reclaimable claim.",
      );
    }
    const [failedInvocation] = await tx
      .update(operationInvocationsTable)
      .set({
        state: "failed",
        finishedAt: now,
        lastHeartbeatAt: now,
        failureKind: "transactional_mutation_failed",
        sanitizedError:
          "Transactional domain mutation rolled back before commit.",
      })
      .where(
        and(
          eq(operationInvocationsTable.id, input.invocationId),
          eq(operationInvocationsTable.receiptId, input.receiptId),
          eq(operationInvocationsTable.leaseOwner, input.leaseOwner),
          eq(operationInvocationsTable.state, "claimed"),
        ),
      )
      .returning({ id: operationInvocationsTable.id });
    if (!failedInvocation) {
      throw new OperationInvocationStateError(
        "Transactional rollback cleanup lost its compare-and-set race.",
      );
    }
  });
}

export async function runTransactionalOperation<T>(
  input: RunTransactionalOperationInput<T>,
): Promise<RunTransactionalOperationResult<T>> {
  if (
    input.reservation.sideEffectClass !== "transactional" ||
    classifyToolSideEffect({ toolName: input.reservation.toolName }) !==
      "transactional"
  ) {
    throw new TypeError(
      "runTransactionalOperation accepts only normalized transactional tools.",
    );
  }
  const reservation = await reserveOperation(input.reservation);
  if (
    reservation.receipt.state === "succeeded" ||
    isConfirmedAppliedReplay(reservation)
  ) {
    return {
      disposition: "replayed",
      receipt: reservation.receipt,
      value: null,
    };
  }
  if (reservation.receipt.state === "unknown") {
    return {
      disposition: "unknown",
      receipt: reservation.receipt,
      value: null,
    };
  }
  if (reservation.receipt.state === "failed") {
    return {
      disposition: "failed",
      receipt: reservation.receipt,
      value: null,
    };
  }

  const claimed = await claimOperationInvocation({
    ...input.claim,
    receiptId: reservation.receipt.id,
  });
  if (!claimed.claimed || !claimed.invocation) {
    const disposition =
      claimed.receipt.state === "succeeded" ||
      isConfirmedAppliedReceipt(claimed.receipt)
        ? "replayed"
        : claimed.receipt.state === "unknown"
          ? "unknown"
          : claimed.receipt.state === "failed"
            ? "failed"
            : "busy";
    return { disposition, receipt: claimed.receipt, value: null };
  }

  const noCallbackFailure = Symbol("no-transaction-callback-failure");
  let callbackFailure: unknown = noCallbackFailure;
  try {
    return await db.transaction(async (tx) => {
      try {
        await markOperationRunning(
          {
            receiptId: claimed.receipt.id,
            invocationId: claimed.invocation!.id,
            leaseOwner: input.claim.leaseOwner,
            browserBinding: input.claim.browserBinding,
            now: new Date(),
          },
          tx,
        );
        const mutation = await input.mutate(tx, claimed.receipt);
        assertSafeResultEnvelope(
          claimed.receipt.toolName,
          mutation.resultData ?? null,
        );
        const receipt = await completeOperation(
          {
            receiptId: claimed.receipt.id,
            invocationId: claimed.invocation!.id,
            leaseOwner: input.claim.leaseOwner,
            browserBinding: input.claim.browserBinding,
            resultData: mutation.resultData ?? null,
            now: new Date(),
          },
          tx,
        );
        return { disposition: "executed", receipt, value: mutation.value };
      } catch (error) {
        callbackFailure = error;
        throw error;
      }
    });
  } catch (error) {
    // A callback failure occurs before COMMIT and therefore rolls back the
    // domain mutation plus running transition. A failure after the callback
    // returns may be an ambiguous COMMIT outcome and must remain claimed for
    // conservative recovery instead of being declared safely replayable.
    if (callbackFailure === noCallbackFailure) throw error;
    await retireClaimedTransactionalInvocation({
      receiptId: claimed.receipt.id,
      invocationId: claimed.invocation.id,
      leaseOwner: input.claim.leaseOwner,
    });
    if (callbackFailure instanceof ConfirmedAppliedReplayError) {
      return {
        disposition: "replayed",
        receipt: callbackFailure.confirmedReceipt,
        value: null,
      };
    }
    throw callbackFailure;
  }
}

function truncateUtf8Bytes(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength <= maxBytes) return value;
  return encoded
    .subarray(0, maxBytes)
    .toString("utf8")
    .replace(/\uFFFD+$/u, "");
}

function normalizedBoundedText(
  value: string,
  field: string,
  maxBytes: number,
): string {
  const normalized = value.normalize("NFC").trim();
  const byteLength = Buffer.byteLength(normalized, "utf8");
  if (byteLength < 1 || byteLength > maxBytes) {
    throw new TypeError(`${field} must contain 1-${maxBytes} UTF-8 bytes.`);
  }
  return normalized;
}

async function blockUnknownOperationOwnership(
  tx: OperationTransaction,
  receipt: OperationReceipt,
  invocation: OperationInvocation,
  now: Date,
  safeError: string,
): Promise<void> {
  const locale = toolReceiptLocale(receipt);
  const localizedUnknown = locale
    ? terminalMessage(locale, "receiptUnknown", { id: receipt.id })
    : null;
  const blockedReason =
    receipt.executionKind === "approved_action"
      ? "approval_outcome_unknown"
      : "operation_outcome_unknown";
  const invocationAgentFence = invocation.agentLeaseOwner
    ? eq(agentsTable.runLeaseOwner, invocation.agentLeaseOwner)
    : sql`false`;
  if (receipt.taskId !== null) {
    const [blockedTask] = await tx
      .update(tasksTable)
      .set({
        status: "blocked",
        blockedReason,
        lastError:
          localizedUnknown ??
          `İşlem sonucu belirsiz; otomatik tekrar engellendi. Receipt: ${receipt.id}`,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
      })
      .where(
        and(
          eq(tasksTable.id, receipt.taskId),
          eq(tasksTable.ownerAgentId, receipt.agentId),
          inArray(tasksTable.status, [
            "pending",
            "planning",
            "in_progress",
            "awaiting_approval",
            "blocked",
          ]),
        ),
      )
      .returning({ id: tasksTable.id });
    if (!blockedTask) {
      throw new OperationInvocationStateError(
        "Unknown operation could not fence its owning task.",
      );
    }

    if (receipt.executionKind === "task_step") {
      await tx
        .update(taskAttemptsTable)
        .set({
          state: "blocked",
          finishedAt: now,
          lastHeartbeatAt: now,
          failureKind: "operation_outcome_unknown",
          sanitizedError: safeError,
        })
        .where(
          and(
            eq(taskAttemptsTable.taskId, receipt.taskId),
            eq(taskAttemptsTable.agentId, receipt.agentId),
            eq(
              taskAttemptsTable.logicalExecutionId,
              receipt.logicalExecutionId,
            ),
            inArray(taskAttemptsTable.state, [
              "claimed",
              "running",
              "retrying",
            ]),
          ),
        );
    }
  }

  await tx
    .update(agentsTable)
    .set({
      status: "idle",
      currentTaskId: null,
      currentAction: null,
      runLeaseOwner: null,
      runLeaseExpiresAt: null,
      lastActiveAt: now,
    })
    .where(
      and(
        eq(agentsTable.id, receipt.agentId),
        receipt.taskId === null
          ? invocationAgentFence
          : or(
              eq(agentsTable.currentTaskId, receipt.taskId),
              invocationAgentFence,
            ),
      ),
    );

  await tx.insert(activityEventsTable).values({
    agentId: receipt.agentId,
    taskId: receipt.taskId,
    type: "error",
    summary:
      localizedUnknown ?? "İşlem sonucu belirsiz; otomatik tekrar engellendi.",
    detail: {
      runtimeEvent: "operation_outcome_unknown",
      receiptId: receipt.id,
      invocationId: invocation.id,
      blockedReason,
      replayBlocked: true,
    },
    severity: "critical",
  });
}

export async function markOperationUnknown(
  input: OperationInvocationOwnerInput & {
    failureKind: string;
    sanitizedError: string;
  },
  executor: OperationExecutor = db,
): Promise<OperationReceipt> {
  const snapshot = await ownedInvocationRows(executor, input);
  return withOperationTransaction(executor, async (tx) => {
    const now = input.now ?? new Date();
    await lockCanonicalInvocationRows(
      tx,
      snapshot.receipt,
      snapshot.invocation,
      {
        assertExecutionAllowed: false,
      },
    );
    const live = await ownedInvocationRows(tx, input);
    if (live.receipt.state === "unknown") return live.receipt;
    if (
      live.receipt.state !== "running" ||
      live.invocation.state !== "running"
    ) {
      throw new OperationInvocationStateError(
        "Only a running operation can become unknown.",
      );
    }
    const safeFailureKind = truncateUtf8Bytes(input.failureKind, 256);
    const safeError = truncateUtf8Bytes(input.sanitizedError, 4_096);
    const [unknownInvocation] = await tx
      .update(operationInvocationsTable)
      .set({
        state: "unknown",
        finishedAt: now,
        lastHeartbeatAt: now,
        failureKind: safeFailureKind,
        sanitizedError: safeError,
      })
      .where(
        and(
          eq(operationInvocationsTable.id, input.invocationId),
          eq(operationInvocationsTable.leaseOwner, input.leaseOwner),
          eq(operationInvocationsTable.state, "running"),
        ),
      )
      .returning();
    const [unknownReceipt] = await tx
      .update(operationReceiptsTable)
      .set({
        state: "unknown",
        finishedAt: now,
        failureKind: safeFailureKind,
        sanitizedError: safeError,
      })
      .where(
        and(
          eq(operationReceiptsTable.id, input.receiptId),
          eq(operationReceiptsTable.state, "running"),
        ),
      )
      .returning();
    if (!unknownInvocation || !unknownReceipt) {
      throw new OperationInvocationStateError(
        "Unknown transition lost its compare-and-set race.",
      );
    }
    await blockUnknownOperationOwnership(
      tx,
      unknownReceipt,
      unknownInvocation,
      now,
      safeError,
    );
    await appendOperationsChanged(tx, {
      kind: "invocation_state_changed",
      taskId: unknownReceipt.taskId,
      agentId: unknownReceipt.agentId,
      attemptId: unknownInvocation.attemptId,
      receiptId: unknownReceipt.id,
      invocationId: unknownInvocation.id,
      state: unknownInvocation.state,
      createdAt: now,
    });
    await appendOperationsChanged(tx, {
      kind: "receipt_state_changed",
      taskId: unknownReceipt.taskId,
      agentId: unknownReceipt.agentId,
      attemptId: unknownReceipt.originAttemptId,
      receiptId: unknownReceipt.id,
      state: unknownReceipt.state,
      createdAt: now,
    });
    return unknownReceipt;
  });
}

/**
 * Fences effects still running when this exact runtime incarnation exhausts
 * its graceful-drain budget. The external outcome is unknowable once process
 * teardown begins, so these invocations are never replayed automatically.
 */
export async function markRuntimeOperationsUnknownAfterDrainTimeout(
  runtime: { id: string; startedAt: Date },
  executor: OperationExecutor = db,
): Promise<number> {
  const [ownedRuntime] = await executor
    .select({
      id: runtimeInstancesTable.id,
      startedAt: runtimeInstancesTable.startedAt,
      state: runtimeInstancesTable.state,
    })
    .from(runtimeInstancesTable)
    .where(
      and(
        eq(runtimeInstancesTable.id, runtime.id),
        eq(runtimeInstancesTable.startedAt, runtime.startedAt),
        inArray(runtimeInstancesTable.state, [
          "starting",
          "healthy",
          "draining",
        ]),
      ),
    )
    .limit(1);
  if (!ownedRuntime) return 0;

  const candidates = await executor
    .select({
      receiptId: operationInvocationsTable.receiptId,
      invocationId: operationInvocationsTable.id,
      leaseOwner: operationInvocationsTable.leaseOwner,
    })
    .from(operationInvocationsTable)
    .where(
      and(
        eq(operationInvocationsTable.workerInstanceId, runtime.id),
        eq(operationInvocationsTable.state, "running"),
      ),
    );
  let marked = 0;
  const failures: unknown[] = [];
  for (const candidate of candidates) {
    try {
      const receipt = await markOperationUnknown(
        {
          ...candidate,
          failureKind: "shutdown_drain_timeout",
          sanitizedError:
            "Runtime shutdown deadline expired after the external effect boundary; outcome requires reconciliation.",
          now: new Date(),
        },
        executor,
      );
      if (receipt.state === "unknown") marked += 1;
    } catch (error) {
      const [invocation] = await executor
        .select({ state: operationInvocationsTable.state })
        .from(operationInvocationsTable)
        .where(eq(operationInvocationsTable.id, candidate.invocationId));
      if (
        !invocation ||
        ["succeeded", "failed", "unknown"].includes(invocation.state)
      ) {
        continue;
      }
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "One or more timed-out runtime effects could not be fenced as unknown",
    );
  }
  return marked;
}

export async function reconcileOperation(
  input: ReconcileOperationInput,
  executor: OperationExecutor = db,
): Promise<OperationReceipt> {
  if (
    input.decision !== "confirmed_applied" &&
    input.decision !== "confirmed_not_applied"
  ) {
    throw new TypeError("Unsupported operation reconciliation decision.");
  }
  const note = normalizedBoundedText(input.note, "Reconciliation note", 2_000);
  const actorId = normalizedBoundedText(
    input.actorId,
    "Reconciliation actor ID",
    256,
  );
  const receiptSnapshot = await selectReceipt(executor, input.receiptId);
  if (!receiptSnapshot) {
    throw new OperationInvocationStateError("Operation receipt is missing.");
  }
  const invocationSnapshots = await executor
    .select()
    .from(operationInvocationsTable)
    .where(
      and(
        eq(operationInvocationsTable.receiptId, input.receiptId),
        eq(operationInvocationsTable.state, "unknown"),
      ),
    )
    .limit(2);
  if (invocationSnapshots.length !== 1) {
    throw new OperationReceiptIntegrityError(
      "An unknown receipt must resolve to exactly one unknown invocation.",
    );
  }
  const invocationSnapshot = invocationSnapshots[0]!;

  return withOperationTransaction(executor, async (tx) => {
    const now = input.now ?? new Date();
    await lockCanonicalInvocationRows(tx, receiptSnapshot, invocationSnapshot, {
      assertExecutionAllowed: false,
    });
    const receipt = await selectReceipt(tx, input.receiptId);
    const invocation = await selectInvocation(tx, invocationSnapshot.id);
    if (!receipt || !invocation || invocation.receiptId !== receipt.id) {
      throw new OperationInvocationStateError(
        "Operation reconciliation evidence disappeared.",
      );
    }
    if (receipt.state !== "unknown" || invocation.state !== "unknown") {
      throw new OperationInvocationStateError(
        "Only an unknown operation can be reconciled.",
      );
    }
    if (receipt.reconciliationDecision !== null) {
      if (receipt.reconciliationDecision === input.decision) return receipt;
      throw new OperationReconciliationConflictError(
        "The operation already has a different immutable reconciliation decision.",
      );
    }
    if (
      input.decision === "confirmed_applied" &&
      receipt.executionKind === "task_step"
    ) {
      if (receipt.taskId === null || receipt.originAttemptId === null) {
        throw new OperationReceiptIntegrityError(
          "Task-step reconciliation identity is incomplete.",
        );
      }
      const conflictingEvidence = await findConfirmedAppliedTaskCycleReceipt(
        {
          canonicalVersion: receipt.canonicalVersion,
          taskId: receipt.taskId,
          agentId: receipt.agentId,
          originAttemptId: receipt.originAttemptId,
          logicalExecutionId: receipt.logicalExecutionId,
          toolName: receipt.toolName,
          argumentHash: receipt.argumentHash,
        },
        tx,
        receipt.id,
      );
      if (conflictingEvidence) {
        throw new OperationReceiptIntegrityError(
          "This task-cycle effect already has confirmed-applied evidence.",
        );
      }
      if (receipt.sideEffectClass !== "read_only") {
        const activeSameCycle = await findActiveTaskCycleReceipts(
          {
            canonicalVersion: receipt.canonicalVersion,
            taskId: receipt.taskId,
            agentId: receipt.agentId,
            originAttemptId: receipt.originAttemptId,
            logicalExecutionId: receipt.logicalExecutionId,
            toolName: receipt.toolName,
            argumentHash: receipt.argumentHash,
          },
          tx,
          receipt.id,
        );
        if (activeSameCycle.some((active) => active.state === "running")) {
          throw new OperationReconciliationConflictError(
            "A same-cycle effect already crossed its boundary; reconciliation cannot supersede it.",
          );
        }
      }
    }

    const [reconciled] = await tx
      .update(operationReceiptsTable)
      .set({
        reconciliationDecision: input.decision,
        reconciliationNote: note,
        reconciliationActorId: actorId,
        reconciledAt: now,
      })
      .where(
        and(
          eq(operationReceiptsTable.id, receipt.id),
          eq(operationReceiptsTable.state, "unknown"),
          sql`${operationReceiptsTable.reconciliationDecision} is null`,
        ),
      )
      .returning();
    if (!reconciled) {
      throw new OperationReconciliationConflictError(
        "Operation reconciliation lost its compare-and-set race.",
      );
    }

    let taskResumed = false;
    if (receipt.taskId !== null) {
      const [otherUnresolvedUnknown] = await tx
        .select({ id: operationReceiptsTable.id })
        .from(operationReceiptsTable)
        .where(
          and(
            eq(operationReceiptsTable.taskId, receipt.taskId),
            eq(operationReceiptsTable.state, "unknown"),
            sql`${operationReceiptsTable.reconciliationDecision} is null`,
            sql`${operationReceiptsTable.id} <> ${receipt.id}`,
          ),
        )
        .limit(1);

      if (otherUnresolvedUnknown) {
        const [blockedTask] = await tx
          .select({ id: tasksTable.id })
          .from(tasksTable)
          .where(
            and(
              eq(tasksTable.id, receipt.taskId),
              eq(tasksTable.ownerAgentId, receipt.agentId),
              eq(tasksTable.status, "blocked"),
              or(
                eq(tasksTable.blockedReason, "operation_outcome_unknown"),
                eq(tasksTable.blockedReason, "approval_outcome_unknown"),
              ),
            ),
          );
        if (!blockedTask) {
          throw new OperationInvocationStateError(
            "A task with unresolved operations is not durably blocked.",
          );
        }
      } else {
        const [resumedTask] = await tx
          .update(tasksTable)
          .set({
            status: "in_progress",
            blockedReason: null,
            lastError: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(tasksTable.id, receipt.taskId),
              eq(tasksTable.ownerAgentId, receipt.agentId),
              eq(tasksTable.status, "blocked"),
              or(
                eq(tasksTable.blockedReason, "operation_outcome_unknown"),
                eq(tasksTable.blockedReason, "approval_outcome_unknown"),
              ),
            ),
          )
          .returning({ id: tasksTable.id });
        if (!resumedTask) {
          throw new OperationInvocationStateError(
            "Reconciled operation could not resume its exact blocked task.",
          );
        }
        taskResumed = true;
      }
    }

    await tx.insert(activityEventsTable).values({
      agentId: receipt.agentId,
      taskId: receipt.taskId,
      type: "task_status_changed",
      summary: toolMessage(
        toolReceiptLocale(receipt) ?? "tr",
        "operationReconciled",
      ),
      detail: {
        runtimeEvent: "operation_reconciled",
        receiptId: receipt.id,
        decision: input.decision,
        actorId,
        taskResumed,
      },
      severity: "warning",
    });
    await appendOperationsChanged(tx, {
      kind: "reconciliation_recorded",
      taskId: receipt.taskId,
      agentId: receipt.agentId,
      attemptId: receipt.originAttemptId,
      receiptId: receipt.id,
      invocationId: invocation.id,
      state: receipt.state,
      createdAt: now,
    });
    return reconciled;
  });
}

export async function invalidateApprovalBinding(
  input: InvalidateApprovalBindingInput,
  executor: OperationExecutor = db,
): Promise<ApprovalRequest> {
  // Revocation must remain available if presentation settings cannot be read.
  const locale =
    input.locale ?? (await readWorkspaceLocale().catch(() => "tr" as const));
  if (!isWorkspaceLocale(locale)) throw new TypeError("Invalid display locale");
  const expectedRuntimeInstanceId = normalizedBoundedText(
    input.expectedRuntimeInstanceId,
    "Expected runtime instance ID",
    256,
  );
  const expectedBindingHash = normalizedBoundedText(
    input.expectedBindingHash,
    "Expected browser binding hash",
    256,
  );
  const reason = normalizedBoundedText(
    input.reason,
    "Binding invalidation reason",
    512,
  );
  const [approvalSnapshot] = await executor
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, input.approvalId));
  if (!approvalSnapshot) {
    throw new OperationInvocationStateError("Approval request is missing.");
  }

  return withOperationTransaction(executor, async (tx) => {
    const now = input.now ?? new Date();
    await lockRuntimeControlState(tx);
    await lockRuntimeInstance(tx, expectedRuntimeInstanceId);
    await lockAgent(tx, approvalSnapshot.agentId);
    await lockApproval(tx, input.approvalId);
    await lockTask(tx, approvalSnapshot.taskId);
    await tx.execute(
      sql`SELECT id FROM ${operationReceiptsTable}
          WHERE ${operationReceiptsTable.approvalId} = ${input.approvalId}
          ORDER BY id
          FOR UPDATE`,
    );
    const receipts = await tx
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.approvalId, input.approvalId))
      .limit(2);
    if (receipts.length > 1) {
      throw new OperationReceiptIntegrityError(
        "An approval resolved to multiple logical operation receipts.",
      );
    }
    const receipt = receipts[0] ?? null;
    if (receipt) {
      await tx.execute(
        sql`SELECT id FROM ${operationInvocationsTable}
            WHERE ${operationInvocationsTable.receiptId} = ${receipt.id}
              AND ${operationInvocationsTable.state} IN ('claimed', 'running')
            ORDER BY id
            FOR UPDATE`,
      );
    }

    const [approval] = await tx
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, input.approvalId));
    if (!approval) {
      throw new OperationInvocationStateError("Approval request disappeared.");
    }
    const exactBinding =
      approval.browserRuntimeInstanceId === expectedRuntimeInstanceId &&
      approval.browserBindingHash === expectedBindingHash;
    if (!exactBinding) {
      throw new OperationInvocationStateError(
        "Approval binding changed before invalidation.",
      );
    }
    if (approval.bindingInvalidatedAt !== null) {
      if (
        approval.bindingInvalidationReason === reason &&
        approval.actionPayload === null
      ) {
        return approval;
      }
      throw new OperationInvocationStateError(
        "Approval binding already has different invalidation evidence.",
      );
    }
    if (
      approval.status !== "approved" ||
      approval.resolvedAt === null ||
      approval.consumedAt !== null ||
      approval.actionPayload === null
    ) {
      throw new OperationInvocationStateError(
        "Only an approved, unconsumed browser capability can be invalidated.",
      );
    }

    if (receipt) {
      const activeInvocations = await tx
        .select()
        .from(operationInvocationsTable)
        .where(
          and(
            eq(operationInvocationsTable.receiptId, receipt.id),
            inArray(operationInvocationsTable.state, ["claimed", "running"]),
          ),
        )
        .limit(2);
      if (activeInvocations.length > 1) {
        throw new OperationReceiptIntegrityError(
          "Approval receipt has multiple active operation invocations.",
        );
      }
      const activeInvocation = activeInvocations[0] ?? null;
      if (
        receipt.state === "running" ||
        activeInvocation?.state === "running" ||
        ["succeeded", "unknown"].includes(receipt.state)
      ) {
        throw new OperationInvocationStateError(
          "A browser binding cannot be invalidated after the effect boundary.",
        );
      }
      if (activeInvocation) {
        const [failedInvocation] = await tx
          .update(operationInvocationsTable)
          .set({
            state: "failed",
            finishedAt: now,
            lastHeartbeatAt: now,
            failureKind: "binding_unavailable",
            sanitizedError:
              "Approved browser binding became unavailable before the effect boundary.",
          })
          .where(
            and(
              eq(operationInvocationsTable.id, activeInvocation.id),
              eq(operationInvocationsTable.state, "claimed"),
            ),
          )
          .returning({ id: operationInvocationsTable.id });
        if (!failedInvocation) {
          throw new OperationInvocationStateError(
            "Approval invocation invalidation lost its compare-and-set race.",
          );
        }
      }
      if (receipt.state === "reserved") {
        const [failedReceipt] = await tx
          .update(operationReceiptsTable)
          .set({
            state: "failed",
            finishedAt: now,
            failureKind: "binding_unavailable",
            sanitizedError:
              "Approved browser binding became unavailable before the effect boundary.",
          })
          .where(
            and(
              eq(operationReceiptsTable.id, receipt.id),
              eq(operationReceiptsTable.state, "reserved"),
            ),
          )
          .returning({ id: operationReceiptsTable.id });
        if (!failedReceipt) {
          throw new OperationInvocationStateError(
            "Approval receipt invalidation lost its compare-and-set race.",
          );
        }
      }
    }

    const [invalidated] = await tx
      .update(approvalRequestsTable)
      .set({
        bindingInvalidatedAt: now,
        bindingInvalidationReason: reason,
        actionPayload: null,
        scope: consumedApprovalScope(approval.scope, "invalidated"),
      })
      .where(
        and(
          eq(approvalRequestsTable.id, input.approvalId),
          eq(approvalRequestsTable.status, "approved"),
          sql`${approvalRequestsTable.consumedAt} is null`,
          sql`${approvalRequestsTable.bindingInvalidatedAt} is null`,
          eq(
            approvalRequestsTable.browserRuntimeInstanceId,
            expectedRuntimeInstanceId,
          ),
          eq(approvalRequestsTable.browserBindingHash, expectedBindingHash),
        ),
      )
      .returning();
    if (!invalidated) {
      throw new OperationInvocationStateError(
        "Approval binding invalidation lost its compare-and-set race.",
      );
    }

    const [resumedTask] = await tx
      .update(tasksTable)
      .set({
        status: "in_progress",
        blockedReason: null,
        lastError: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(tasksTable.id, approval.taskId),
          eq(tasksTable.ownerAgentId, approval.agentId),
          eq(tasksTable.status, "awaiting_approval"),
        ),
      )
      .returning({ id: tasksTable.id });
    if (!resumedTask) {
      throw new OperationInvocationStateError(
        "Invalidated approval could not resume its exact awaiting task.",
      );
    }
    await tx
      .update(agentsTable)
      .set({
        status: "idle",
        currentTaskId: null,
        currentAction: null,
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
        lastActiveAt: now,
      })
      .where(
        and(
          eq(agentsTable.id, approval.agentId),
          eq(agentsTable.currentTaskId, approval.taskId),
        ),
      );
    await tx.insert(activityEventsTable).values({
      agentId: approval.agentId,
      taskId: approval.taskId,
      type: "approval_resolved",
      summary: toolMessage(
        (receipt && toolReceiptLocale(receipt)) || locale,
        "approvalBindingInvalidated",
      ),
      detail: {
        runtimeEvent: "approval_binding_invalidated",
        approvalId: approval.id,
        receiptId: receipt?.id ?? null,
        reason,
        reapprovalRequired: true,
      },
      severity: "warning",
    });
    return invalidated;
  });
}

function allowsPostEffectRetry(receipt: OperationReceipt): boolean {
  // Old records retain their immutable classification, but a mutable page
  // capture must never be repeated after its publication boundary.
  return (
    receipt.toolName !== "browser_save_screenshot" &&
    ["read_only", "idempotent"].includes(receipt.sideEffectClass)
  );
}

async function findReleasedScreenshotInvocation(
  executor: OperationExecutor,
  receipt: OperationReceipt,
): Promise<OperationInvocation | null> {
  if (
    receipt.toolName !== "browser_save_screenshot" ||
    receipt.state !== "reserved"
  )
    return null;
  const [invocation] = await executor
    .select()
    .from(operationInvocationsTable)
    .where(
      and(
        eq(operationInvocationsTable.receiptId, receipt.id),
        eq(operationInvocationsTable.state, "failed"),
        sql`${operationInvocationsTable.effectStartedAt} IS NOT NULL`,
      ),
    )
    .orderBy(
      sql`${operationInvocationsTable.claimedAt} DESC`,
      sql`${operationInvocationsTable.id} DESC`,
    )
    .limit(1);
  return invocation ?? null;
}

/** Caller holds the canonical agent/task/receipt locks. Repair an old unsafe
 * release without recapturing the page or changing any identity/source data. */
async function quarantineReleasedScreenshot(
  tx: OperationTransaction,
  receipt: OperationReceipt,
  invocation: OperationInvocation,
  now: Date,
): Promise<RecoverInterruptedOperationResult> {
  const safeError =
    "A legacy screenshot was released after publication; recapture is blocked to preserve existing evidence.";
  const [unknownInvocation] = await tx
    .update(operationInvocationsTable)
    .set({
      state: "unknown",
      failureKind: "screenshot_recovery_required",
      sanitizedError: safeError,
    })
    .where(
      and(
        eq(operationInvocationsTable.id, invocation.id),
        eq(operationInvocationsTable.receiptId, receipt.id),
        eq(operationInvocationsTable.state, "failed"),
        sql`${operationInvocationsTable.effectStartedAt} IS NOT NULL`,
      ),
    )
    .returning();
  const [unknownReceipt] = await tx
    .update(operationReceiptsTable)
    .set({
      state: "unknown",
      startedAt: receipt.startedAt ?? invocation.effectStartedAt,
      finishedAt: now,
      failureKind: "screenshot_recovery_required",
      sanitizedError: safeError,
    })
    .where(
      and(
        eq(operationReceiptsTable.id, receipt.id),
        eq(operationReceiptsTable.state, "reserved"),
      ),
    )
    .returning();
  if (!unknownInvocation || !unknownReceipt)
    throw new OperationInvocationStateError(
      "Legacy screenshot recovery lost its compare-and-set race.",
    );
  await blockUnknownOperationOwnership(
    tx,
    unknownReceipt,
    unknownInvocation,
    now,
    safeError,
  );
  for (const kind of [
    "invocation_state_changed",
    "receipt_state_changed",
    "recovery_recorded",
  ] as const) {
    await appendOperationsChanged(tx, {
      kind,
      taskId: receipt.taskId,
      agentId: receipt.agentId,
      attemptId: invocation.attemptId,
      receiptId: receipt.id,
      invocationId: invocation.id,
      state: "unknown",
      createdAt: now,
    });
  }
  return {
    disposition: "unknown",
    receipt: unknownReceipt,
    invocation: unknownInvocation,
  };
}

export async function recoverInterruptedOperation(
  input: RecoverInterruptedOperationInput,
  executor: OperationExecutor = db,
): Promise<RecoverInterruptedOperationResult> {
  const receiptSnapshot = await selectReceipt(executor, input.receiptId);
  if (!receiptSnapshot) {
    throw new OperationInvocationStateError("Operation receipt is missing.");
  }
  const [activeSnapshot] = await executor
    .select()
    .from(operationInvocationsTable)
    .where(
      and(
        eq(operationInvocationsTable.receiptId, input.receiptId),
        inArray(operationInvocationsTable.state, ["claimed", "running"]),
      ),
    );
  const invocationSnapshot =
    activeSnapshot ??
    (await findReleasedScreenshotInvocation(executor, receiptSnapshot));
  if (!invocationSnapshot) {
    return {
      disposition:
        receiptSnapshot.state === "reserved" ? "reclaimable" : "terminal",
      receipt: receiptSnapshot,
      invocation: null,
    };
  }

  return withOperationTransaction(executor, async (tx) => {
    const now = input.now ?? new Date();
    await lockCanonicalInvocationRows(tx, receiptSnapshot, invocationSnapshot, {
      assertExecutionAllowed: false,
    });
    const receipt = await selectReceipt(tx, input.receiptId);
    const invocation = await selectInvocation(tx, invocationSnapshot.id);
    if (!receipt || !invocation) {
      throw new OperationInvocationStateError(
        "Interrupted operation disappeared during recovery.",
      );
    }
    if (receipt.state !== "reserved" && receipt.state !== "running") {
      return { disposition: "terminal", receipt, invocation };
    }
    if (
      receipt.toolName === "browser_save_screenshot" &&
      receipt.state === "reserved" &&
      invocation.state === "failed" &&
      invocation.effectStartedAt !== null
    ) {
      // A new live claim may have appeared since the snapshot. It owns the
      // receipt until normal recovery fences it; never rewrite underneath it.
      const [active] = await tx
        .select({ id: operationInvocationsTable.id })
        .from(operationInvocationsTable)
        .where(
          and(
            eq(operationInvocationsTable.receiptId, receipt.id),
            inArray(operationInvocationsTable.state, ["claimed", "running"]),
          ),
        )
        .limit(1);
      if (active) return { disposition: "not_stale", receipt, invocation };
      return quarantineReleasedScreenshot(tx, receipt, invocation, now);
    }
    if (invocation.state !== "claimed" && invocation.state !== "running") {
      return { disposition: "terminal", receipt, invocation };
    }
    if (invocation.leaseExpiresAt.getTime() > now.getTime()) {
      return { disposition: "not_stale", receipt, invocation };
    }

    let runtimeStale = invocation.workerInstanceId === null;
    if (invocation.workerInstanceId) {
      const [runtime] = await tx
        .select()
        .from(runtimeInstancesTable)
        .where(eq(runtimeInstancesTable.id, invocation.workerInstanceId));
      runtimeStale =
        !runtime ||
        ["stale", "stopped"].includes(runtime.state) ||
        runtime.lastHeartbeatAt.getTime() < input.runtimeStaleBefore.getTime();
    }
    const [agent] = await tx
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, receipt.agentId));
    const agentOwnerStale =
      !agent ||
      agent.runLeaseOwner !== invocation.agentLeaseOwner ||
      !agent.runLeaseExpiresAt ||
      agent.runLeaseExpiresAt.getTime() <= now.getTime();
    let taskOwnerStale = true;
    if (receipt.executionKind === "task_step" && receipt.taskId !== null) {
      const [task] = await tx
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, receipt.taskId));
      taskOwnerStale =
        !task ||
        task.leaseOwner !== invocation.taskLeaseOwner ||
        !task.leaseExpiresAt ||
        task.leaseExpiresAt.getTime() <= now.getTime();
    }
    // A runtime heartbeat proves only that the worker process is alive; it does
    // not retain authority for every invocation that process once owned. The
    // invocation lease above is the effect-specific liveness proof, while the
    // task and agent leases prevent recovery during an active owning attempt.
    // This distinction lets a finalization write that was lost during a
    // database outage converge after the worker itself has recovered.
    if (!agentOwnerStale || !taskOwnerStale) {
      return { disposition: "not_stale", receipt, invocation };
    }

    const crossedEffectBoundary = invocation.effectStartedAt !== null;
    const replayableAfterEffect = allowsPostEffectRetry(receipt);
    if (!crossedEffectBoundary || replayableAfterEffect) {
      const failureKind = crossedEffectBoundary
        ? "idempotent_owner_lost"
        : "pre_effect_owner_lost";
      const [failedInvocation] = await tx
        .update(operationInvocationsTable)
        .set({
          state: "failed",
          finishedAt: now,
          lastHeartbeatAt: now,
          failureKind,
          sanitizedError: runtimeStale
            ? "Invocation owner and runtime became stale; safe reclaim permitted."
            : "Invocation and direct ownership leases expired; process liveness alone does not retain effect authority.",
        })
        .where(
          and(
            eq(operationInvocationsTable.id, invocation.id),
            inArray(operationInvocationsTable.state, ["claimed", "running"]),
          ),
        )
        .returning();
      const [reservedReceipt] = await tx
        .update(operationReceiptsTable)
        .set({
          state: "reserved",
          startedAt: null,
          finishedAt: null,
          failureKind: null,
          sanitizedError: null,
          resultSummary: null,
          resultData: toolPresentationData(receipt),
        })
        .where(
          and(
            eq(operationReceiptsTable.id, receipt.id),
            inArray(operationReceiptsTable.state, ["reserved", "running"]),
          ),
        )
        .returning();
      if (!failedInvocation || !reservedReceipt) {
        throw new OperationInvocationStateError(
          "Interrupted operation reclaim lost its compare-and-set race.",
        );
      }
      await appendOperationsChanged(tx, {
        kind: "invocation_state_changed",
        taskId: reservedReceipt.taskId,
        agentId: reservedReceipt.agentId,
        attemptId: failedInvocation.attemptId,
        receiptId: reservedReceipt.id,
        invocationId: failedInvocation.id,
        state: failedInvocation.state,
        createdAt: now,
      });
      await appendOperationsChanged(tx, {
        kind: "receipt_state_changed",
        taskId: reservedReceipt.taskId,
        agentId: reservedReceipt.agentId,
        attemptId: reservedReceipt.originAttemptId,
        receiptId: reservedReceipt.id,
        state: reservedReceipt.state,
        createdAt: now,
      });
      await appendOperationsChanged(tx, {
        kind: "recovery_recorded",
        taskId: reservedReceipt.taskId,
        agentId: reservedReceipt.agentId,
        attemptId: reservedReceipt.originAttemptId,
        receiptId: reservedReceipt.id,
        invocationId: failedInvocation.id,
        state: reservedReceipt.state,
        createdAt: now,
      });
      return {
        disposition:
          crossedEffectBoundary && receipt.sideEffectClass === "idempotent"
            ? "reclaimable_same_key"
            : "reclaimable",
        receipt: reservedReceipt,
        invocation: failedInvocation,
      };
    }

    const safeError = runtimeStale
      ? "At-most-once invocation crossed the effect boundary before its owner became stale."
      : "At-most-once invocation crossed the effect boundary before its invocation and direct ownership leases expired.";
    const [unknownInvocation] = await tx
      .update(operationInvocationsTable)
      .set({
        state: "unknown",
        finishedAt: now,
        lastHeartbeatAt: now,
        failureKind: "effect_outcome_unknown",
        sanitizedError: safeError,
      })
      .where(
        and(
          eq(operationInvocationsTable.id, invocation.id),
          eq(operationInvocationsTable.state, "running"),
        ),
      )
      .returning();
    const [unknownReceipt] = await tx
      .update(operationReceiptsTable)
      .set({
        state: "unknown",
        finishedAt: now,
        failureKind: "effect_outcome_unknown",
        sanitizedError: safeError,
      })
      .where(
        and(
          eq(operationReceiptsTable.id, receipt.id),
          eq(operationReceiptsTable.state, "running"),
        ),
      )
      .returning();
    if (!unknownInvocation || !unknownReceipt) {
      throw new OperationInvocationStateError(
        "Interrupted operation unknown transition lost its compare-and-set race.",
      );
    }

    await blockUnknownOperationOwnership(
      tx,
      unknownReceipt,
      unknownInvocation,
      now,
      safeError,
    );
    await appendOperationsChanged(tx, {
      kind: "invocation_state_changed",
      taskId: unknownReceipt.taskId,
      agentId: unknownReceipt.agentId,
      attemptId: unknownInvocation.attemptId,
      receiptId: unknownReceipt.id,
      invocationId: unknownInvocation.id,
      state: unknownInvocation.state,
      createdAt: now,
    });
    await appendOperationsChanged(tx, {
      kind: "receipt_state_changed",
      taskId: unknownReceipt.taskId,
      agentId: unknownReceipt.agentId,
      attemptId: unknownReceipt.originAttemptId,
      receiptId: unknownReceipt.id,
      state: unknownReceipt.state,
      createdAt: now,
    });
    await appendOperationsChanged(tx, {
      kind: "recovery_recorded",
      taskId: unknownReceipt.taskId,
      agentId: unknownReceipt.agentId,
      attemptId: unknownReceipt.originAttemptId,
      receiptId: unknownReceipt.id,
      invocationId: unknownInvocation.id,
      state: unknownReceipt.state,
      createdAt: now,
    });
    return {
      disposition: "unknown",
      receipt: unknownReceipt,
      invocation: unknownInvocation,
    };
  });
}

const READ_ONLY_TOOLS = new Set([
  ...CAPABILITY_TOOL_NAMES,
  "computer_observe",
  "vm_list_files",
  "vm_read_file",
  "browser_snapshot",
  "browser_extract_text",
  "browser_wait",
]);
const TRANSACTIONAL_TOOLS = new Set([
  "create_sub_agent",
  "delegate_task",
  "update_task_progress",
  "complete_task",
  "request_approval",
  "request_user_input",
  "log_note",
  "post_company_message",
]);
const IDEMPOTENT_TOOLS = new Set(["vm_write_file"]);
const AT_MOST_ONCE_TOOLS = new Set([
  "browser_save_screenshot",
  "vm_run_command",
  "browser_open",
  "browser_scroll",
  "browser_click",
  // This name is never exposed by the production tool catalog. A validated,
  // injected endurance adapter is its only caller. It deliberately exercises
  // the no-replay path using a run-scoped PostgreSQL fixture; no
  // VM/browser/network handler exists.
  "synthetic_fixture_write",
]);
const APPROVAL_AT_MOST_ONCE_TOOLS = new Set([
  "vm_run_sudo_command",
  "browser_type",
]);

export function classifyToolSideEffect(input: {
  toolName: string;
  args?: Record<string, unknown>;
  preapprovedAction?: boolean;
  approvalBound?: boolean;
}): OperationSideEffectClass {
  const toolName = input.toolName;
  let classification: OperationSideEffectClass | null = null;
  if (READ_ONLY_TOOLS.has(toolName)) classification = "read_only";
  else if (TRANSACTIONAL_TOOLS.has(toolName)) classification = "transactional";
  else if (IDEMPOTENT_TOOLS.has(toolName)) classification = "idempotent";
  else if (AT_MOST_ONCE_TOOLS.has(toolName)) classification = "at_most_once";
  else if (APPROVAL_AT_MOST_ONCE_TOOLS.has(toolName)) {
    classification = "approval_at_most_once";
  }
  if (!classification) {
    throw new TypeError(
      `Unknown tool side-effect classification for ${toolName || "(empty)"}.`,
    );
  }
  if (input.preapprovedAction || input.approvalBound) {
    return "approval_at_most_once";
  }
  return classification;
}
