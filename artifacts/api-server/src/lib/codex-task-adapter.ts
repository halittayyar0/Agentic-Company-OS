import type { ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import {
  codexTaskConfigurationMatches,
  type CodexOwnedConfiguration,
} from "./codex-task-configuration";
import {
  createCodexAppServerClient,
  CodexClientError,
  type CodexServerApproval,
} from "./codex-app-server-client";
import { redactAuditText } from "./audit-redaction";
import {
  createCodexActionTracker,
  CodexActionScopeError,
  type CodexExactAction,
  type CodexExactApprovalRequest,
  type CodexActionReceipt,
} from "./codex-action-scope";

/** The orchestrator supplies this binding from its current durable claim,
 * policy and selected registration. None of these values is model controlled. */
export interface CodexTaskBinding {
  taskId: number;
  attemptId: string;
  leaseOwner: string;
  policyRevision: number;
  registrationId: string;
  registrationRevision: number;
  accountId: string;
  admissionVersion: number;
}
export interface CodexReportedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
export interface CodexTaskSession {
  threadId: string;
  binding: CodexTaskBinding;
  cwd: string;
  /** Cumulative thread counters at the last accepted terminal turn. */
  usage?: CodexReportedUsage | null;
}
export interface PreparedCodexTask {
  cwd: string;
  model: string;
  approvalPolicy: "never" | "on-request";
  /** Legacy fixtures/capabilities. Never combine with a named profile. */
  sandboxPolicy?: Record<string, unknown>;
  /** The backend writes this exact profile to its isolated owned config.
   * Project read/write scope is one canonical workspace; command network is
   * disabled. Platform containment still has to accept thread/start. */
  permissions?: {
    id: string;
    runtimeWorkspaceRoots: string[];
    /** Backend-verified CLI file needed by the native permission helper. */
    runtimeExecutable: string;
    definition: Record<string, unknown>;
    configuration: CodexOwnedConfiguration;
  };
  config: Record<string, unknown>;
  /** Backend-only current/refresh secrets for exact redaction, never output. */
  secrets: readonly string[];
}
export interface CodexTaskPorts {
  /** Throws or returns null when the lease expired, emergency stop is active,
   * permissions changed, or the selected account is no longer admissible. */
  readBinding(): Promise<CodexTaskBinding | null>;
  /** Must verify actual executable capability and map current permissions
   * before launching. Unsupported containment/permissions must throw here. */
  prepare(binding: CodexTaskBinding): Promise<PreparedCodexTask>;
  /** Only an owned isolated home/config/env and process may be returned.
   * stop resolves only after its process tree is stopped and unregistered. */
  launch(
    prepared: PreparedCodexTask,
    binding: CodexTaskBinding,
  ): Promise<{
    child: ChildProcessWithoutNullStreams;
    stop(): Promise<void>;
  }>;
  /** Bridge to the durable exact-action approval. Must not accept a session
   * amendment or inferred commandActions as an authorization boundary. */
  approve?(
    request: CodexExactApprovalRequest,
    binding: CodexTaskBinding,
    signal?: AbortSignal,
  ): Promise<"accept" | "decline" | "cancel">;
  /** A terminal item is observed before this acknowledgement. Failure to
   * persist prevents a completed checkpoint but retains the actual receipt. */
  onActionReceipt?(
    receipt: CodexActionReceipt,
    binding: CodexTaskBinding,
  ): Promise<void>;
  /** Final backend budget/effect admission after native profile inspection,
   * before sending turn/start. It receives no prompt or credential. */
  beforeTurnStart?(binding: CodexTaskBinding): Promise<void>;
  readSession?(binding: CodexTaskBinding): Promise<CodexTaskSession | null>;
}
export type CodexTaskFailureKind =
  | "protocol"
  | "unsupported_capability"
  | "ownership_lost"
  | "interrupted"
  | "timeout"
  | "cancelled"
  | "process_failed"
  | "turn_failed"
  | "cleanup_failed"
  | "accounting_failed";
/** Backend-owned shutdown acknowledgement; neither token usage nor native
 * item/turn completion proves that an owned runtime has stopped. */
export type CodexCleanupState = "unknown" | "not_launched" | "verified";
export class CodexTaskError extends Error {
  constructor(
    readonly kind: CodexTaskFailureKind,
    readonly usage: CodexReportedUsage | null = null,
    readonly actionReceipts: readonly CodexActionReceipt[] = [],
    readonly requestStarted: boolean = false,
    readonly cleanupState: CodexCleanupState = "unknown",
  ) {
    super(`codex_task_${kind}`);
    this.name = "CodexTaskError";
  }
}
export interface CodexTurnControl {
  steer(text: string): Promise<void>;
  interrupt(): Promise<void>;
}
interface Input {
  binding: CodexTaskBinding;
  prompt: string;
  resume?: boolean;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
  turnTimeoutMs?: number;
  fenceIntervalMs?: number;
  onControl?(control: CodexTurnControl): void;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_:-]{1,160}$/u.test(value);
const counter = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const boundedText = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  Buffer.byteLength(value) <= 128 * 1024 &&
  !value.includes("\0");
const bindingKeys = [
  "taskId",
  "attemptId",
  "leaseOwner",
  "policyRevision",
  "registrationId",
  "registrationRevision",
  "accountId",
  "admissionVersion",
] as const;
function sameBinding(left: CodexTaskBinding, right: CodexTaskBinding) {
  return bindingKeys.every((key) => left[key] === right[key]);
}
function validBinding(value: CodexTaskBinding) {
  return (
    [value.taskId, value.policyRevision, value.registrationRevision].every(
      (n) => counter(n) && n > 0,
    ) &&
    counter(value.admissionVersion) &&
    [
      value.attemptId,
      value.leaseOwner,
      value.registrationId,
      value.accountId,
    ].every(identifier)
  );
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (record(value))
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item != null)
        .map(([key, item]) => [key, withoutNulls(item)]),
    );
  return value;
}
function validNamedPermissions(prepared: PreparedCodexTask): boolean {
  const profile = prepared.permissions;
  if (
    !profile ||
    !identifier(profile.id) ||
    profile.id.startsWith(":") ||
    prepared.sandboxPolicy != null ||
    Object.keys(prepared.config).length !== 0 ||
    !Array.isArray(profile.runtimeWorkspaceRoots) ||
    profile.runtimeWorkspaceRoots.length !== 1 ||
    profile.runtimeWorkspaceRoots[0] !== prepared.cwd ||
    !path.isAbsolute(prepared.cwd) ||
    !record(profile.configuration) ||
    !boundedText(profile.configuration.file) ||
    !record(profile.configuration.values) ||
    !record(profile.definition) ||
    Object.keys(profile.definition).some(
      (key) => !["filesystem", "network"].includes(key),
    ) ||
    !record(profile.definition.network) ||
    canonical(profile.definition.network) !== canonical({ enabled: false }) ||
    !record(profile.definition.filesystem)
  )
    return false;
  const filesystem = profile.definition.filesystem;
  const executable = profile.runtimeExecutable;
  const home = path.dirname(profile.configuration.file);
  if (
    !boundedText(executable) ||
    !path.isAbsolute(executable) ||
    path.normalize(executable) !== executable ||
    /[*?\[\]\u0000-\u001f\u007f]/u.test(executable) ||
    ![home, prepared.cwd].every((root) => {
      const relative = path.relative(root, executable);
      return relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    })
  )
    return false;
  return (
    path.isAbsolute(profile.configuration.file) &&
    path.basename(profile.configuration.file) === "config.toml" &&
    filesystem[path.dirname(profile.configuration.file)] === "deny" &&
    filesystem[executable] === "read" &&
    filesystem[":minimal"] === "read" &&
    ["read", "write"].includes(String(filesystem[":workspace_roots"])) &&
    Object.keys(filesystem).length >= 4 &&
    Object.entries(filesystem).every(
      ([key, access]) =>
        key === ":minimal" ||
        key === ":workspace_roots" ||
        (key === executable && access === "read") ||
        (path.isAbsolute(key) &&
          !key.includes("\0") &&
          !key.includes("*") &&
          access === "deny"),
    )
  );
}
function parsedUsage(value: unknown): CodexReportedUsage {
  if (
    !record(value) ||
    !counter(value.inputTokens) ||
    !counter(value.outputTokens) ||
    !counter(value.totalTokens) ||
    value.totalTokens < value.inputTokens ||
    value.totalTokens < value.outputTokens ||
    value.inputTokens + value.outputTokens !== value.totalTokens
  )
    throw new CodexTaskError("protocol");
  return {
    promptTokens: value.inputTokens,
    completionTokens: value.outputTokens,
    totalTokens: value.totalTokens,
  };
}
function safeError(
  error: unknown,
  usage: CodexReportedUsage | null,
): CodexTaskError {
  if (error instanceof CodexTaskError)
    return new CodexTaskError(
      error.kind,
      usage ?? error.usage,
      error.actionReceipts,
    );
  if (error instanceof CodexActionScopeError)
    return new CodexTaskError(error.kind, usage);
  if (error instanceof CodexClientError)
    return new CodexTaskError(
      error.kind === "request_rejected"
        ? [
            "initialize",
            "config/read",
            "permissionProfile/list",
            "thread/start",
            "thread/resume",
          ].includes(error.method ?? "")
          ? "unsupported_capability"
          : "turn_failed"
        : error.kind === "unsupported_request"
          ? "unsupported_capability"
          : error.kind,
      usage,
    );
  return new CodexTaskError("protocol", usage);
}

/** Executes one owned coding turn. Completion proves the harness turn ended;
 * patch/build/test/delivery verification still belongs to the delivery ledger.
 * No inference replay, provider fallback, raw transcript or personal auth import. */
export async function runCodexTask(input: Input, ports: CodexTaskPorts) {
  // Own the submitted expectation. Caller mutation must never turn a stale
  // durable claim/account into an authorized replacement mid-turn.
  input = { ...input, binding: Object.freeze({ ...input.binding }) };
  if (!validBinding(input.binding) || !boundedText(input.prompt))
    throw new CodexTaskError("protocol");
  const requestTimeout = input.requestTimeoutMs ?? 15_000;
  const timeout = input.turnTimeoutMs ?? 15 * 60_000;
  const interval = input.fenceIntervalMs ?? 1_000;
  if (
    !counter(timeout) ||
    timeout < 100 ||
    timeout > 60 * 60_000 ||
    !counter(interval) ||
    interval < 20 ||
    interval > 5_000 ||
    !counter(requestTimeout) ||
    requestTimeout < 10 ||
    requestTimeout > 30_000
  )
    throw new CodexTaskError("protocol");
  let usage: CodexReportedUsage | null = null;
  let cumulative: CodexReportedUsage | null = null;
  let baseline: CodexReportedUsage | null = null;
  let child: Awaited<ReturnType<CodexTaskPorts["launch"]>> | undefined;
  let launchInvoked = false;
  let cleanupState: CodexCleanupState = "unknown";
  let client: ReturnType<typeof createCodexAppServerClient> | undefined;
  let actions: ReturnType<typeof createCodexActionTracker> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let finished = false,
    started = false;
  let rejectFailure!: (error: CodexTaskError) => void;
  const failure = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });
  void failure.catch(() => {});
  const fail = (error: CodexTaskError) => {
    if (!finished) rejectFailure(error);
  };
  const abort = () => fail(new CodexTaskError("cancelled", usage));
  async function bounded<T>(action: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        action,
        failure,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new CodexTaskError("timeout", usage)),
            ms,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async function assertOwned() {
    if (input.signal?.aborted) throw new CodexTaskError("cancelled", usage);
    let current: CodexTaskBinding | null;
    try {
      current = await bounded(ports.readBinding(), requestTimeout);
    } catch (error) {
      if (error instanceof CodexTaskError) throw error;
      throw new CodexTaskError("ownership_lost", usage);
    }
    if (!current || !sameBinding(input.binding, current))
      throw new CodexTaskError("ownership_lost", usage);
  }
  async function watch() {
    if (finished) return;
    try {
      await assertOwned();
    } catch (error) {
      fail(safeError(error, usage));
      return;
    }
    if (!finished)
      watchdog = setTimeout(() => {
        void watch();
      }, interval);
  }
  input.signal?.addEventListener("abort", abort, { once: true });
  let result:
    | {
        status: "completed";
        threadId: string;
        turnId: string;
        text: string;
        usage: CodexReportedUsage | null;
        proofScope: "codex_turn";
        deliverableVerified: false;
        actionReceipts: readonly CodexActionReceipt[];
        session: CodexTaskSession;
      }
    | undefined;
  let error: CodexTaskError | undefined;
  try {
    await assertOwned();
    let prepared: PreparedCodexTask;
    try {
      prepared = await bounded(ports.prepare(input.binding), requestTimeout);
    } catch (cause) {
      if (cause instanceof CodexTaskError) throw cause;
      throw new CodexTaskError("unsupported_capability");
    }
    const sandboxModes: Record<string, string> = {
      readOnly: "read-only",
      workspaceWrite: "workspace-write",
      dangerFullAccess: "danger-full-access",
    };
    if (
      !boundedText(prepared.cwd) ||
      !boundedText(prepared.model) ||
      !record(prepared.config) ||
      !["never", "on-request"].includes(prepared.approvalPolicy) ||
      (prepared.permissions != null
        ? !validNamedPermissions(prepared)
        : !record(prepared.sandboxPolicy) ||
          typeof prepared.sandboxPolicy.type !== "string" ||
          !Object.hasOwn(sandboxModes, prepared.sandboxPolicy.type))
    )
      throw new CodexTaskError("unsupported_capability");
    let session: CodexTaskSession | null = null;
    if (input.resume) {
      session = ports.readSession
        ? await bounded(ports.readSession(input.binding), requestTimeout)
        : null;
      if (
        !session ||
        !sameBinding(session.binding, input.binding) ||
        session.cwd !== prepared.cwd ||
        !identifier(session.threadId)
      )
        throw new CodexTaskError("ownership_lost");
      // A resumed thread's lifetime total is not this new turn's usage.
      baseline = session.usage ?? null;
    }
    await assertOwned();
    // launch owns the complete start/registration boundary. A slow launch is
    // awaited so its eventual handle is always available for owned cleanup.
    // Invoking launch can create a process even when it rejects before
    // returning its handle. A missing handle must never imply no launch.
    launchInvoked = true;
    child = await ports.launch(prepared, input.binding);
    await assertOwned();
    deadline = setTimeout(
      () => fail(new CodexTaskError("timeout", usage)),
      timeout,
    );
    void watch();
    let threadId: string | null = null,
      turnId: string | null = null;
    let text = "",
      terminal = false;
    const acceptedItems = new Set<string>();
    let complete!: (status: string) => void;
    const completion = new Promise<string>((resolve) => {
      complete = resolve;
    });
    const redact = (value: string) => {
      for (const secret of prepared.secrets)
        if (secret.length) value = value.split(secret).join("[REDACTED]");
      return redactAuditText(value, 48 * 1024, true);
    };
    actions = createCodexActionTracker({
      workspace: prepared.cwd,
      deniedPaths: prepared.permissions
        ? Object.entries(
            prepared.permissions.definition.filesystem as Record<
              string,
              unknown
            >,
          )
            .filter(([, access]) => access === "deny")
            .map(([target]) => target)
        : [],
      secrets: prepared.secrets,
    });
    const activeActions = actions;
    const reviews = new Map<string, CodexExactAction>();
    const requestKey = (request: CodexServerApproval) =>
      `${typeof request.id}:${request.id}`;
    client = createCodexAppServerClient(child.child, {
      assertOwned,
      signal: input.signal,
      requestTimeoutMs: requestTimeout,
      approvalTimeoutMs: timeout,
      approve: async (request, approvalSignal) => {
        try {
          if (approvalSignal.aborted) return "cancel";
          if (terminal) throw new CodexTaskError("protocol", usage);
          // File grantRoot expands session permissions; command/network policy
          // amendments are likewise never converted into a one-action approval.
          if (
            request.params.grantRoot != null ||
            request.params.proposedExecpolicyAmendment != null ||
            request.params.proposedNetworkPolicyAmendments != null ||
            request.params.additionalPermissions != null ||
            request.params.networkApprovalContext != null
          )
            throw new CodexTaskError("unsupported_capability", usage);
          // Capture the exact item before any asynchronous owner/database
          // check. Native summaries are not executable authorization scopes.
          const review = activeActions.review(request);
          reviews.set(requestKey(request), review.action);
          await assertOwned();
          activeActions.assertReview(review.action);
          const combined = AbortSignal.any([approvalSignal, review.signal]);
          let rejectChanged!: () => void;
          const changed = new Promise<never>((_resolve, reject) => {
            rejectChanged = () => reject(new CodexActionScopeError("protocol"));
            if (combined.aborted) rejectChanged();
            else
              combined.addEventListener("abort", rejectChanged, { once: true });
          });
          let decision: "accept" | "decline" | "cancel";
          try {
            decision = ports.approve
              ? await Promise.race([
                  ports.approve(review.request, input.binding, combined),
                  changed,
                ])
              : "decline";
          } finally {
            combined.removeEventListener("abort", rejectChanged);
          }
          if (approvalSignal.aborted) return "cancel";
          await assertOwned();
          activeActions.assertReview(review.action);
          return decision;
        } catch (cause) {
          // Native can withdraw a pending prompt independently of the turn.
          // Its cancelled callback cannot invalidate a valid terminal event.
          if (approvalSignal.aborted) return "cancel";
          const classified = safeError(cause, usage);
          fail(classified);
          throw new CodexClientError(
            classified.kind === "ownership_lost"
              ? "ownership_lost"
              : "unsupported_request",
          );
        }
      },
      validateApprovalReply: (request, decision) => {
        const action = reviews.get(requestKey(request));
        if (!action) throw new CodexTaskError("protocol", usage);
        try {
          // The client drained queued patch/terminal notifications. This
          // synchronous check/record cannot be overtaken by a received event.
          activeActions.recordDecision(action, decision);
        } catch (cause) {
          const classified = safeError(cause, usage);
          fail(classified);
          throw new CodexClientError("unsupported_request");
        }
      },
      onNotification: async (event) => {
        const p = event.params;
        if (
          terminal &&
          [
            "item/started",
            "item/completed",
            "item/fileChange/patchUpdated",
          ].includes(event.method)
        )
          throw new CodexTaskError("protocol", usage);
        const receipt = activeActions.observe(event);
        if (receipt && ports.onActionReceipt) {
          try {
            await bounded(
              ports.onActionReceipt(receipt, input.binding),
              requestTimeout,
            );
          } catch (cause) {
            const error = safeError(cause, usage);
            fail(error);
            throw error;
          }
        }
        if (event.method === "thread/tokenUsage/updated") {
          if (terminal || !record(p.tokenUsage))
            throw new CodexTaskError("protocol", usage);
          const next = parsedUsage(p.tokenUsage.total);
          if (
            cumulative &&
            (next.promptTokens < cumulative.promptTokens ||
              next.completionTokens < cumulative.completionTokens ||
              next.totalTokens < cumulative.totalTokens)
          )
            throw new CodexTaskError("protocol", usage);
          cumulative = next;
          if (!input.resume || baseline) {
            const base = baseline ?? {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
            };
            if (
              next.promptTokens < base.promptTokens ||
              next.completionTokens < base.completionTokens ||
              next.totalTokens < base.totalTokens
            )
              throw new CodexTaskError("protocol", usage);
            usage = {
              promptTokens: next.promptTokens - base.promptTokens,
              completionTokens: next.completionTokens - base.completionTokens,
              totalTokens: next.totalTokens - base.totalTokens,
            };
          }
        } else if (
          event.method === "item/completed" &&
          record(p.item) &&
          p.item.type === "agentMessage"
        ) {
          if (
            terminal ||
            !identifier(p.item.id) ||
            acceptedItems.has(p.item.id) ||
            typeof p.item.text !== "string"
          )
            throw new CodexTaskError("protocol", usage);
          acceptedItems.add(p.item.id);
          // Deltas can contain a secret split across chunks. Only bounded,
          // complete messages are redacted then retained; no delta logging.
          if (
            Buffer.byteLength(p.item.text) > 128 * 1024 ||
            acceptedItems.size > 128
          )
            throw new CodexTaskError("protocol", usage);
          text = redact(`${text}${text ? "\n" : ""}${p.item.text}`);
        } else if (event.method === "turn/completed") {
          if (
            terminal ||
            !record(p.turn) ||
            !identifier(p.turn.id) ||
            !["completed", "failed", "interrupted"].includes(
              String(p.turn.status),
            )
          )
            throw new CodexTaskError("protocol", usage);
          // Callback can run immediately after turn/start reply. The client
          // already bound the scope, while this runner's await may still wake.
          await Promise.resolve();
          if (p.turn.id !== turnId || p.threadId !== threadId)
            throw new CodexTaskError("protocol", usage);
          await assertOwned();
          if (p.turn.status === "completed") activeActions.assertTerminal();
          terminal = true;
          complete(String(p.turn.status));
        }
      },
      onFailure: (cause) => fail(safeError(cause, usage)),
    });
    const initialized = await bounded(
      client.request("initialize", {
        clientInfo: {
          name: "agentic_company_os",
          title: "Agentic Company OS",
          version: "0.3.13",
        },
        capabilities: { experimentalApi: prepared.permissions != null },
      }),
      requestTimeout,
    );
    if (!record(initialized)) throw new CodexTaskError("protocol");
    await client.notify("initialized", {});
    if (prepared.permissions) {
      const effective = await bounded(
        client.request("config/read", {
          includeLayers: true,
          cwd: prepared.cwd,
        }),
        requestTimeout,
      );
      const profiles = await bounded(
        client.request("permissionProfile/list", { cwd: prepared.cwd }),
        requestTimeout,
      );
      if (
        !codexTaskConfigurationMatches(
          effective,
          prepared.permissions.configuration,
        ) ||
        !record(effective) ||
        !record(effective.config) ||
        effective.config.default_permissions !== prepared.permissions.id ||
        !record(effective.config.permissions) ||
        canonical(
          withoutNulls(effective.config.permissions[prepared.permissions.id]),
        ) !== canonical(prepared.permissions.definition) ||
        !record(profiles) ||
        !Array.isArray(profiles.data) ||
        profiles.data.length > 128 ||
        profiles.nextCursor != null ||
        !profiles.data.some(
          (item) =>
            record(item) &&
            item.id === prepared.permissions!.id &&
            item.allowed === true,
        )
      )
        throw new CodexTaskError("unsupported_capability", usage);
      await assertOwned();
    }
    const params = {
      model: prepared.model,
      modelProvider: "openai_chatgpt_plan",
      cwd: prepared.cwd,
      approvalPolicy: prepared.approvalPolicy,
      approvalsReviewer: "user",
      ...(prepared.permissions
        ? {
            permissions: prepared.permissions.id,
            runtimeWorkspaceRoots: prepared.permissions.runtimeWorkspaceRoots,
          }
        : { sandbox: sandboxModes[prepared.sandboxPolicy!.type as string] }),
      config: prepared.config,
      ephemeral: false,
    };
    const thread = await bounded(
      client.request(
        session ? "thread/resume" : "thread/start",
        session
          ? { ...params, threadId: session.threadId, excludeTurns: true }
          : { ...params, allowProviderModelFallback: false },
      ),
      requestTimeout,
    );
    if (
      !record(thread) ||
      !record(thread.thread) ||
      !identifier(thread.thread.id) ||
      thread.model !== prepared.model ||
      thread.modelProvider !== "openai_chatgpt_plan" ||
      thread.cwd !== prepared.cwd ||
      thread.approvalPolicy !== prepared.approvalPolicy ||
      (prepared.permissions
        ? !record(thread.activePermissionProfile) ||
          thread.activePermissionProfile.id !== prepared.permissions.id ||
          thread.activePermissionProfile.extends !== null ||
          thread.approvalsReviewer !== "user" ||
          canonical(thread.runtimeWorkspaceRoots) !==
            canonical(prepared.permissions.runtimeWorkspaceRoots)
        : canonical(thread.sandbox) !== canonical(prepared.sandboxPolicy)) ||
      (session && thread.thread.id !== session.threadId)
    )
      throw new CodexTaskError("unsupported_capability", usage);
    threadId = thread.thread.id;
    await assertOwned();
    if (ports.beforeTurnStart)
      await bounded(ports.beforeTurnStart(input.binding), requestTimeout);
    await assertOwned();
    started = true;
    const turn = await bounded(
      client.request("turn/start", {
        threadId,
        input: [{ type: "text", text: input.prompt }],
        cwd: prepared.cwd,
        model: prepared.model,
        approvalPolicy: prepared.approvalPolicy,
        approvalsReviewer: "user",
        ...(prepared.permissions
          ? {
              permissions: prepared.permissions.id,
              runtimeWorkspaceRoots: prepared.permissions.runtimeWorkspaceRoots,
            }
          : { sandboxPolicy: prepared.sandboxPolicy }),
      }),
      requestTimeout,
    );
    if (
      !record(turn) ||
      !record(turn.turn) ||
      !identifier(turn.turn.id) ||
      turn.turn.status !== "inProgress"
    )
      throw new CodexTaskError("protocol", usage);
    turnId = turn.turn.id;
    const activeClient = client,
      activeThread = threadId,
      activeTurn = turnId;
    const control: CodexTurnControl = {
      steer: async (text) => {
        if (terminal || !boundedText(text))
          throw new CodexTaskError("protocol", usage);
        await assertOwned();
        await bounded(
          activeClient.request("turn/steer", {
            threadId: activeThread,
            expectedTurnId: activeTurn,
            input: [{ type: "text", text }],
          }),
          requestTimeout,
        );
      },
      interrupt: async () => {
        if (terminal) throw new CodexTaskError("protocol", usage);
        await assertOwned();
        await bounded(
          activeClient.request("turn/interrupt", {
            threadId: activeThread,
            turnId: activeTurn,
          }),
          requestTimeout,
        );
      },
    };
    input.onControl?.(control);
    const status = await bounded(
      Promise.race([completion, client.failure]),
      timeout,
    );
    if (status !== "completed")
      throw new CodexTaskError(
        status === "failed" ? "turn_failed" : "interrupted",
        usage,
      );
    await assertOwned();
    result = {
      status: "completed",
      threadId,
      turnId,
      text,
      usage,
      proofScope: "codex_turn",
      deliverableVerified: false,
      actionReceipts: activeActions.receipts(),
      session: {
        threadId,
        binding: { ...input.binding },
        cwd: prepared.cwd,
        usage: cumulative,
      },
    };
  } catch (cause) {
    error = safeError(cause, usage);
  } finally {
    finished = true;
    if (deadline) clearTimeout(deadline);
    if (watchdog) clearTimeout(watchdog);
    input.signal?.removeEventListener("abort", abort);
    client?.close();
    actions?.close();
    if (child) {
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          child.stop(),
          new Promise<never>((_resolve, reject) => {
            cleanupTimer = setTimeout(
              () => reject(new CodexTaskError("cleanup_failed", usage)),
              10_000,
            );
          }),
        ]);
        cleanupState = "verified";
      } catch {
        error = new CodexTaskError("cleanup_failed", usage);
      } finally {
        if (cleanupTimer) clearTimeout(cleanupTimer);
      }
    }
    if (!launchInvoked) cleanupState = "not_launched";
  }
  if (error)
    throw new CodexTaskError(
      error.kind,
      error.usage,
      actions?.receipts() ?? error.actionReceipts,
      started,
      cleanupState,
    );
  if (!started || !result)
    throw new CodexTaskError("protocol", usage, [], started, cleanupState);
  return result;
}
