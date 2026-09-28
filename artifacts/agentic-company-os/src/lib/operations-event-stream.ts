export type OperationsStreamScope =
  { scope: "global" } | { scope: "project"; taskId: number };

export type OperationsTransportState =
  "disabled" | "connecting" | "live" | "stale" | "disconnected";

export interface OperationsStreamSnapshot {
  state: OperationsTransportState;
  lastEventId: string | null;
  lastEventAt: string | null;
  transportLastFrameAt: string | null;
  reconnectCount: number;
}

export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  removeEventListener(
    type: string,
    listener: (event: MessageEvent) => void,
  ): void;
  close(): void;
}

interface OperationsStreamRuntime {
  now(): Date;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

interface CreateOperationsStreamClientOptions {
  scope: OperationsStreamScope;
  enabled?: boolean;
  eventSourceFactory?: (url: string) => EventSourceLike;
  onSnapshot(snapshot: unknown, cursor: string): void;
  runtime?: OperationsStreamRuntime;
  staleAfterMs?: number;
  disconnectedAfterMs?: number;
}

export interface OperationsStreamClient {
  readonly scopeKey: string;
  getSnapshot(): OperationsStreamSnapshot;
  subscribe(listener: () => void): () => void;
  destroy(): void;
}

const DURABLE_EVENT_TYPES = [
  "snapshot",
  "activity",
  "attempt",
  "receipt",
  "incident",
  "milestone",
  "operations_changed",
] as const;

const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const DEFAULT_STALE_AFTER_MS = 15_000;
const DEFAULT_DISCONNECTED_AFTER_MS = 45_000;
const DURABLE_CURSOR_PATTERN = /^(0|[1-9]\d*)$/;

const browserRuntime: OperationsStreamRuntime = {
  now: () => new Date(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as number),
};

export function operationsStreamUrl(scope: OperationsStreamScope): string {
  if (scope.scope === "global") return "/api/ops/stream";
  operationsStreamScopeKey(scope);
  return `/api/ops/stream?taskId=${encodeURIComponent(String(scope.taskId))}`;
}

export function operationsStreamScopeKey(scope: OperationsStreamScope): string {
  if (scope.scope === "global") return "global";
  if (!Number.isSafeInteger(scope.taskId) || scope.taskId <= 0) {
    throw new Error("Project taskId must be a positive integer");
  }
  return `project:${scope.taskId}`;
}

function isValidDuration(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function eventTime(snapshot: unknown, fallback: Date): string {
  if (
    snapshot &&
    typeof snapshot === "object" &&
    "generatedAt" in snapshot &&
    typeof snapshot.generatedAt === "string"
  ) {
    const parsed = new Date(snapshot.generatedAt);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback.toISOString();
}

function parseDurableFrame(event: MessageEvent): {
  cursor: string;
  value: unknown;
} | null {
  const cursor = event.lastEventId;
  if (!DURABLE_CURSOR_PATTERN.test(cursor)) return null;
  if (typeof event.data !== "string" || event.data.length > MAX_FRAME_BYTES) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(event.data);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    if ("snapshot" in parsed) {
      const nested = parsed.snapshot;
      return nested && typeof nested === "object" && !Array.isArray(nested)
        ? { cursor, value: nested }
        : null;
    }
    return { cursor, value: parsed };
  } catch {
    return null;
  }
}

export function createOperationsStreamClient(
  options: CreateOperationsStreamClientOptions,
): OperationsStreamClient {
  const enabled = options.enabled ?? true;
  const runtime = options.runtime ?? browserRuntime;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const disconnectedAfterMs =
    options.disconnectedAfterMs ?? DEFAULT_DISCONNECTED_AFTER_MS;

  if (!isValidDuration(staleAfterMs)) {
    throw new Error("staleAfterMs must be greater than zero");
  }
  if (
    !isValidDuration(disconnectedAfterMs) ||
    disconnectedAfterMs <= staleAfterMs
  ) {
    throw new Error("disconnectedAfterMs must be greater than staleAfterMs");
  }

  let snapshot: OperationsStreamSnapshot = {
    state: enabled ? "connecting" : "disabled",
    lastEventId: null,
    lastEventAt: null,
    transportLastFrameAt: null,
    reconnectCount: 0,
  };
  let source: EventSourceLike | null = null;
  let staleTimer: unknown;
  let disconnectedTimer: unknown;
  let destroyed = false;
  const subscribers = new Set<() => void>();
  const listeners = new Map<string, (event: MessageEvent) => void>();

  const publish = (next: OperationsStreamSnapshot) => {
    if (destroyed) return;
    snapshot = next;
    for (const subscriber of subscribers) subscriber();
  };

  const clearFreshnessTimers = () => {
    if (staleTimer !== undefined) runtime.clearTimeout(staleTimer);
    if (disconnectedTimer !== undefined) {
      runtime.clearTimeout(disconnectedTimer);
    }
    staleTimer = undefined;
    disconnectedTimer = undefined;
  };

  const scheduleFreshnessTimers = () => {
    clearFreshnessTimers();
    staleTimer = runtime.setTimeout(() => {
      publish({ ...snapshot, state: "stale" });
    }, staleAfterMs);
    disconnectedTimer = runtime.setTimeout(() => {
      publish({ ...snapshot, state: "disconnected" });
    }, disconnectedAfterMs);
  };

  const scheduleConnectionDeadline = () => {
    clearFreshnessTimers();
    disconnectedTimer = runtime.setTimeout(() => {
      publish({ ...snapshot, state: "disconnected" });
    }, disconnectedAfterMs);
  };

  const markTransportFrame = () => {
    publish({
      ...snapshot,
      state: "live",
      transportLastFrameAt: runtime.now().toISOString(),
    });
    scheduleFreshnessTimers();
  };

  const handleHeartbeat = () => {
    markTransportFrame();
  };

  const handleDurableFrame = (event: MessageEvent) => {
    const frame = parseDurableFrame(event);
    if (!frame) return;
    if (
      snapshot.lastEventId !== null &&
      BigInt(frame.cursor) <= BigInt(snapshot.lastEventId)
    ) {
      markTransportFrame();
      return;
    }

    const receivedAt = runtime.now();
    options.onSnapshot(frame.value, frame.cursor);
    publish({
      ...snapshot,
      state: "live",
      lastEventId: frame.cursor,
      lastEventAt: eventTime(frame.value, receivedAt),
      transportLastFrameAt: receivedAt.toISOString(),
    });
    scheduleFreshnessTimers();
  };

  const handleError = () => {
    publish({
      ...snapshot,
      state: snapshot.transportLastFrameAt ? "stale" : "connecting",
      reconnectCount: snapshot.reconnectCount + 1,
    });
  };

  const handleOpen = () => {
    if (snapshot.transportLastFrameAt === null) {
      publish({ ...snapshot, state: "connecting" });
      scheduleConnectionDeadline();
    }
  };

  const addListener = (
    type: string,
    listener: (event: MessageEvent) => void,
  ) => {
    listeners.set(type, listener);
    source?.addEventListener(type, listener);
  };

  if (enabled) {
    const factory =
      options.eventSourceFactory ??
      ((url: string) => new EventSource(url) as unknown as EventSourceLike);
    try {
      source = factory(operationsStreamUrl(options.scope));
      addListener("open", handleOpen);
      addListener("error", handleError);
      addListener("heartbeat", handleHeartbeat);
      for (const type of DURABLE_EVENT_TYPES) {
        addListener(type, handleDurableFrame);
      }
      scheduleConnectionDeadline();
    } catch {
      source = null;
      snapshot = {
        ...snapshot,
        state: "disconnected",
        reconnectCount: snapshot.reconnectCount + 1,
      };
    }
  }

  return {
    scopeKey: operationsStreamScopeKey(options.scope),
    getSnapshot: () => snapshot,
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      clearFreshnessTimers();
      for (const [type, listener] of listeners) {
        source?.removeEventListener(type, listener);
      }
      listeners.clear();
      source?.close();
      source = null;
      subscribers.clear();
      destroyed = true;
    },
  };
}
