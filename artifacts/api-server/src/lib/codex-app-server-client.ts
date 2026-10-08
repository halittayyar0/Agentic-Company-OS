import type { ChildProcessWithoutNullStreams } from "node:child_process";

export type CodexClientFailureKind =
  | "protocol"
  | "unsupported_request"
  | "request_rejected"
  | "ownership_lost"
  | "interrupted"
  | "timeout"
  | "cancelled"
  | "process_failed";
export class CodexClientError extends Error {
  constructor(
    readonly kind: CodexClientFailureKind,
    readonly method?: string,
  ) {
    super(`codex_client_${kind}`);
    this.name = "CodexClientError";
  }
}
export interface CodexServerEvent {
  method: string;
  params: Record<string, unknown>;
}
export interface CodexServerApproval extends CodexServerEvent {
  id: string | number;
}
interface Options {
  /** Caller checks current task lease, execution policy and registration revision. */
  assertOwned(): Promise<void>;
  /** Caller governs the exact effect. No session-wide approval is accepted. */
  approve?(
    request: CodexServerApproval,
    /** Aborted when native clears the request, ends its item/turn, or the
     * owner closes/times out. A late decision is never sent to the server. */
    signal: AbortSignal,
  ): Promise<"accept" | "decline" | "cancel">;
  onNotification?(event: CodexServerEvent): void | Promise<void>;
  /** Synchronous exact-action fence after all received events and the final
   * ownership check, immediately before writing a one-time native decision. */
  validateApprovalReply?(
    request: CodexServerApproval,
    decision: "accept" | "decline" | "cancel",
  ): void;
  /** The owner must stop its child/process tree here; this client never kills unrelated processes. */
  onFailure?(error: CodexClientError): void;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
  approvalTimeoutMs?: number;
}
const methods = new Set([
  "initialize",
  "config/read",
  "permissionProfile/list",
  "thread/start",
  "thread/resume",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
]);
const approvals = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
]);
const LINE_LIMIT = 1024 * 1024,
  STREAM_LIMIT = 32 * 1024 * 1024,
  STDERR_LIMIT = 128 * 1024;
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_:-]{1,160}$/u.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const rpcId = (value: unknown): value is string | number =>
  identifier(value) ||
  (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);

/** Bounded Codex stdio transport only. The task adapter owns child startup,
 * sandbox/approval mapping and terminal proof. A JSON-RPC response, delta or
 * process exit does not complete a task. No raw stderr/error body is retained. */
export function createCodexAppServerClient(
  child: ChildProcessWithoutNullStreams,
  options: Options,
) {
  const timeoutMs = options.requestTimeoutMs ?? 15_000;
  const approvalTimeoutMs = options.approvalTimeoutMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30_000)
    throw new CodexClientError("protocol");
  if (
    !Number.isSafeInteger(approvalTimeoutMs) ||
    approvalTimeoutMs < 10 ||
    approvalTimeoutMs > 60 * 60_000
  )
    throw new CodexClientError("protocol");
  let closed: CodexClientError | null = null,
    nextId = 0,
    bytes = 0,
    stderrBytes = 0;
  let threadId: string | null = null,
    turnId: string | null = null;
  let buffered = "",
    chain = Promise.resolve();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: CodexClientError): void;
      timer: ReturnType<typeof setTimeout>;
      method: string;
    }
  >();
  const serverRequests = new Set<string>();
  const cancelledApproval = Symbol("cancelled_approval");
  interface PendingApproval {
    key: string;
    id: string | number;
    thread: string;
    turn: string;
    item: string;
    active: boolean;
    controller: AbortController;
    cancellation: Promise<typeof cancelledApproval>;
    cancel(): void;
    timer: ReturnType<typeof setTimeout>;
  }
  const activeApprovals = new Map<string, PendingApproval>();
  function settleApproval(pending: PendingApproval, cancelled = true) {
    if (!pending.active) return;
    pending.active = false;
    clearTimeout(pending.timer);
    activeApprovals.delete(pending.key);
    if (cancelled) {
      pending.controller.abort(new CodexClientError("cancelled"));
      pending.cancel();
    }
  }
  function cancelApprovals() {
    for (const pending of activeApprovals.values()) settleApproval(pending);
  }
  let rejectFailure!: (error: CodexClientError) => void;
  const failure = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });
  // Callers may attach an observer after startup; never raise an unhandled raw error.
  void failure.catch(() => {});

  function fail(error: CodexClientError, notify = true) {
    if (closed) return;
    closed = error;
    cancelApprovals();
    options.signal?.removeEventListener("abort", abort);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    rejectFailure(error);
    if (notify) {
      try {
        options.onFailure?.(error);
      } catch {
        /* owner cleanup cannot expose a raw error */
      }
    }
  }
  function assertOpen() {
    if (closed) throw closed;
  }
  async function owned() {
    assertOpen();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        options.assertOwned().catch(() => {
          throw new CodexClientError("ownership_lost");
        }),
        failure,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new CodexClientError("timeout")),
            timeoutMs,
          );
        }),
      ]);
      assertOpen();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  function write(value: unknown) {
    assertOpen();
    const line = JSON.stringify(value) + "\n";
    if (Buffer.byteLength(line) > LINE_LIMIT)
      throw new CodexClientError("protocol");
    child.stdin.write(line, (error) => {
      if (error) fail(new CodexClientError("process_failed"));
    });
  }
  async function handle(raw: unknown) {
    assertOpen();
    if (!record(raw) || (raw.jsonrpc !== undefined && raw.jsonrpc !== "2.0"))
      throw new CodexClientError("protocol");
    if (!Object.hasOwn(raw, "method")) {
      if (
        typeof raw.id !== "number" ||
        !pending.has(raw.id) ||
        Object.hasOwn(raw, "result") === Object.hasOwn(raw, "error")
      )
        throw new CodexClientError("protocol");
      const request = pending.get(raw.id)!;
      clearTimeout(request.timer);
      pending.delete(raw.id);
      if (Object.hasOwn(raw, "error")) {
        const error = new CodexClientError(
          record(raw.error) &&
            Number.isSafeInteger(raw.error.code) &&
            typeof raw.error.message === "string"
            ? "request_rejected"
            : "protocol",
          request.method,
        );
        request.reject(error);
        throw error;
      }
      // Bind the server-issued identity before the next queued notification.
      // Waiting for the caller's await continuation creates a race when a
      // reply and the first approval/notification share one stdout chunk.
      if (
        request.method === "thread/start" ||
        request.method === "thread/resume"
      ) {
        if (
          !record(raw.result) ||
          !record(raw.result.thread) ||
          !identifier(raw.result.thread.id)
        ) {
          const error = new CodexClientError("protocol");
          request.reject(error);
          throw error;
        }
        threadId = raw.result.thread.id;
        cancelApprovals();
        turnId = null;
      } else if (request.method === "turn/start") {
        if (
          !threadId ||
          !record(raw.result) ||
          !record(raw.result.turn) ||
          !identifier(raw.result.turn.id)
        ) {
          const error = new CodexClientError("protocol");
          request.reject(error);
          throw error;
        }
        turnId = raw.result.turn.id;
        cancelApprovals();
      }
      request.resolve(raw.result);
      return;
    }
    if (
      typeof raw.method !== "string" ||
      raw.method.length > 160 ||
      !record(raw.params)
    )
      throw new CodexClientError("protocol");
    const event = { method: raw.method, params: raw.params };
    if (
      event.params.threadId !== undefined &&
      event.params.threadId !== threadId
    )
      throw new CodexClientError("protocol");
    if (event.params.turnId !== undefined && event.params.turnId !== turnId)
      throw new CodexClientError("protocol");
    if (Object.hasOwn(raw, "id")) {
      if (!rpcId(raw.id) || !approvals.has(event.method))
        throw new CodexClientError("unsupported_request");
      const key = `${typeof raw.id}:${raw.id}`;
      if (
        serverRequests.has(key) ||
        serverRequests.size >= 1024 ||
        !threadId ||
        !turnId ||
        event.params.threadId !== threadId ||
        event.params.turnId !== turnId ||
        !identifier(event.params.itemId)
      )
        throw new CodexClientError("protocol");
      serverRequests.add(key);
      if (activeApprovals.size >= 64) throw new CodexClientError("protocol");
      let cancel!: () => void;
      const cancellation = new Promise<typeof cancelledApproval>((resolve) => {
        cancel = () => resolve(cancelledApproval);
      });
      const pending: PendingApproval = {
        key,
        id: raw.id,
        thread: threadId,
        turn: turnId,
        item: event.params.itemId,
        active: true,
        controller: new AbortController(),
        cancellation,
        cancel,
        timer: setTimeout(
          () => { console.error("ACOS_FIXED_RPC_TIMEOUT_DIAGNOSTIC:" + JSON.stringify({ method })); fail(new CodexClientError("timeout")); },
          approvalTimeoutMs,
        ),
      };
      activeApprovals.set(key, pending);
      // Never hold the JSONL delivery chain while waiting for a human. Usage,
      // patch updates, cancellation and steering replies must still be read.
      void (async () => {
        await owned();
        if (!pending.active) return;
        const decision = options.approve
          ? await Promise.race([
              options.approve(
                { ...event, id: pending.id },
                pending.controller.signal,
              ),
              failure,
              pending.cancellation,
            ])
          : "decline";
        if (decision === cancelledApproval || !pending.active) return;
        if (!["accept", "decline", "cancel"].includes(decision))
          throw new CodexClientError("protocol");
        // Drain already received updates before sending a decision. A slow
        // notification observer must not hide an earlier withdrawal/terminal
        // event and permit an accept against an already ended item or turn.
        await Promise.race([chain, failure, pending.cancellation]);
        if (!pending.active) return;
        await owned();
        await Promise.race([chain, failure, pending.cancellation]);
        if (
          !pending.active ||
          pending.thread !== threadId ||
          pending.turn !== turnId
        )
          return;
        options.validateApprovalReply?.({ ...event, id: pending.id }, decision);
        write({ id: pending.id, result: { decision } });
        settleApproval(pending, false);
      })()
        .catch((error) => {
          if (pending.active && !closed)
            fail(
              error instanceof CodexClientError
                ? error
                : new CodexClientError("protocol"),
            );
        })
        .finally(() => settleApproval(pending));
      return;
    }
    if (event.method === "serverRequest/resolved") {
      if (!rpcId(event.params.requestId))
        throw new CodexClientError("protocol");
      const pending = activeApprovals.get(
        `${typeof event.params.requestId}:${event.params.requestId}`,
      );
      if (pending) settleApproval(pending);
    } else if (
      event.method === "turn/completed" &&
      event.params.threadId === threadId &&
      record(event.params.turn) &&
      event.params.turn.id === turnId
    ) {
      cancelApprovals();
    } else if (
      event.method === "item/completed" &&
      event.params.threadId === threadId &&
      event.params.turnId === turnId &&
      record(event.params.item)
    ) {
      for (const pending of activeApprovals.values())
        if (pending.item === event.params.item.id) settleApproval(pending);
    }
    await owned();
    await options.onNotification?.(event);
  }
  function receive(chunk: Buffer) {
    if (closed) return;
    try {
      bytes += chunk.byteLength;
      if (bytes > STREAM_LIMIT) throw new CodexClientError("protocol");
      buffered += decoder.decode(chunk, { stream: true });
      // Bound the unfinished line as well as completed lines.
      let at: number;
      while ((at = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, at).replace(/\r$/u, "");
        buffered = buffered.slice(at + 1);
        if (!line || Buffer.byteLength(line) > LINE_LIMIT)
          throw new CodexClientError("protocol");
        const value: unknown = JSON.parse(line);
        chain = chain
          .then(() => handle(value))
          .catch((error) =>
            fail(
              error instanceof CodexClientError
                ? error
                : new CodexClientError("protocol"),
            ),
          );
      }
      if (Buffer.byteLength(buffered) > LINE_LIMIT)
        throw new CodexClientError("protocol");
    } catch (error) {
      fail(
        error instanceof CodexClientError
          ? error
          : new CodexClientError("protocol"),
      );
    }
  }
  function abort() {
    fail(new CodexClientError("cancelled"));
  }
  child.stdout.on("data", receive);
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.byteLength;
    if (stderrBytes > STDERR_LIMIT) fail(new CodexClientError("protocol"));
  });
  for (const stream of [child.stdin, child.stdout, child.stderr])
    stream.on("error", () => fail(new CodexClientError("process_failed")));
  child.once("error", () => fail(new CodexClientError("process_failed")));
  child.stdout.once("end", () => {
    try {
      decoder.decode();
    } catch {
      fail(new CodexClientError("protocol"));
      return;
    }
    // Drain already received notifications before declaring EOF. Their owner
    // can commit a validated terminal event and explicitly close the client.
    void chain.then(() => {
      if (!closed) fail(new CodexClientError("interrupted"));
    });
  });
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();

  return {
    failure,
    setScope(thread: string, turn: string | null) {
      assertOpen();
      if (!identifier(thread) || (turn !== null && !identifier(turn)))
        throw new CodexClientError("protocol");
      if (thread !== threadId || turn !== turnId) cancelApprovals();
      threadId = thread;
      turnId = turn;
    },
    request(method: string, params: Record<string, unknown>): Promise<unknown> {
      if (closed) return Promise.reject(closed);
      if (
        !methods.has(method) ||
        !record(params) ||
        nextId >= Number.MAX_SAFE_INTEGER
      )
        return Promise.reject(new CodexClientError("protocol"));
      const id = ++nextId;
      const promise = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(
          () => fail(new CodexClientError("timeout")),
          timeoutMs,
        );
        pending.set(id, { resolve, reject, timer, method });
      });
      void (async () => {
        await owned();
        write({ method, id, params });
      })().catch((error) =>
        fail(
          error instanceof CodexClientError
            ? error
            : new CodexClientError("protocol"),
        ),
      );
      return promise;
    },
    async notify(method: "initialized", params: Record<string, unknown>) {
      if (method !== "initialized" || !record(params))
        throw new CodexClientError("protocol");
      try {
        await owned();
        write({ method, params });
      } catch (error) {
        const safe =
          error instanceof CodexClientError
            ? error
            : new CodexClientError("protocol");
        fail(safe);
        throw safe;
      }
    },
    close() {
      fail(new CodexClientError("cancelled"), false);
    },
  };
}
