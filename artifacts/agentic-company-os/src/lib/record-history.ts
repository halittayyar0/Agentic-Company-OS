import type { ActivityEvent, Task } from "@workspace/api-client-react";

export type HistorySource =
  | { kind: "activity"; agentId: number; taskId?: number }
  | { kind: "task-activity"; taskId: number }
  | { kind: "subtasks"; taskId: number }
  | { kind: "projects" };
export type HistoryRecord = ActivityEvent | Task;
export type RecordPage<T> = {
  records: T[];
  beforeId: number | null;
  nextBeforeId: number | null;
  capturedAt: number;
};
const positiveId = (value: unknown): value is number =>
  Number.isInteger(value) &&
  Number(value) > 0 &&
  Number(value) <= 2_147_483_647;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function validRow(value: unknown, source: HistorySource): boolean {
  if (!object(value) || !positiveId(value.id)) return false;
  if (source.kind === "projects" || source.kind === "subtasks") {
    return (
      value.parentTaskId ===
        (source.kind === "projects" ? null : source.taskId) &&
      typeof value.title === "string" &&
      typeof value.brief === "string" &&
      typeof value.status === "string" &&
      positiveId(value.ownerAgentId) &&
      typeof value.updatedAt === "string" &&
      Number.isFinite(Date.parse(value.updatedAt))
    );
  }
  return (
    (source.kind !== "activity" || value.agentId === source.agentId) &&
    (source.taskId === undefined || value.taskId === source.taskId) &&
    (value.taskId === null || positiveId(value.taskId)) &&
    (value.agentId === null || positiveId(value.agentId)) &&
    typeof value.summary === "string" &&
    typeof value.type === "string" &&
    ["info", "warning", "critical"].includes(String(value.severity)) &&
    (value.detail === null || object(value.detail)) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt))
  );
}

/** Read-only, scoped pages. Never infer a continuation from a full-looking array. */
export async function fetchRecordPage<T extends HistoryRecord>(
  source: HistorySource,
  limit: number,
  beforeId: number | null,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<RecordPage<T>> {
  if (
    !positiveId(limit) ||
    limit > 200 ||
    (beforeId !== null && !positiveId(beforeId)) ||
    ("taskId" in source &&
      source.taskId !== undefined &&
      !positiveId(source.taskId)) ||
    (source.kind === "activity" && !positiveId(source.agentId))
  ) {
    throw new Error("Invalid history scope");
  }
  const query = new URLSearchParams({ limit: String(limit) });
  let path: string;
  if (source.kind === "activity") {
    path = "/api/activity";
    query.set("agentId", String(source.agentId));
    if (source.taskId !== undefined) query.set("taskId", String(source.taskId));
  } else if (source.kind === "projects") {
    path = "/api/tasks";
    query.set("rootOnly", "true");
  } else {
    path = `/api/tasks/${source.taskId}/${source.kind === "subtasks" ? "subtasks" : "activity"}`;
  }
  if (beforeId !== null) query.set("beforeId", String(beforeId));
  const response = await request(`${path}?${query}`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (response.status === 401 && typeof window !== "undefined")
    window.dispatchEvent(new Event("agenticos:unauthorized"));
  if (!response.ok) throw new Error("History unavailable");
  const records: unknown = await response.json();
  if (
    !Array.isArray(records) ||
    records.length > limit ||
    records.some(
      (row) =>
        !validRow(row, source) || (beforeId !== null && row.id >= beforeId),
    ) ||
    new Set(records.map((row) => row.id)).size !== records.length
  ) {
    throw new Error("Invalid history page");
  }
  const rawCursor = response.headers.get("X-Next-Before-Id");
  const nextBeforeId = rawCursor === null ? null : Number(rawCursor);
  if (
    nextBeforeId !== null &&
    (!/^[1-9]\d*$/.test(rawCursor!) ||
      !positiveId(nextBeforeId) ||
      records.length === 0 ||
      nextBeforeId !== Math.min(...records.map((row) => row.id)))
  ) {
    throw new Error("Invalid history cursor");
  }
  return {
    records: records as T[],
    beforeId,
    nextBeforeId,
    capturedAt: Date.now(),
  };
}

export type PagerSnapshot<T> = {
  page: RecordPage<T> | null;
  trail: Array<number | null>;
  pending: boolean;
  error: boolean;
};
type Target = { beforeId: number | null; trail: Array<number | null> };

/** Holds one visible page and cursor IDs only; navigation commits after a valid read. */
export class RecordPager<T> {
  private snapshot: PagerSnapshot<T> = {
    page: null,
    trail: [],
    pending: false,
    error: false,
  };
  private listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private failed: Target | null = null;
  private active = false;

  constructor(
    private load: (
      beforeId: number | null,
      signal: AbortSignal,
    ) => Promise<RecordPage<T>>,
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(snapshot: PagerSnapshot<T>) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
  start = () => {
    this.active = true;
    return this.snapshot.page?.beforeId || this.snapshot.error
      ? Promise.resolve()
      : this.refresh();
  };
  stop = () => {
    this.active = false;
    this.controller?.abort();
    this.controller = null;
    if (this.snapshot.pending)
      this.publish({ ...this.snapshot, pending: false });
  };
  private async visit(target: Target): Promise<void> {
    if (!this.active || this.controller) return;
    const controller = new AbortController();
    this.controller = controller;
    this.failed = null;
    this.publish({ ...this.snapshot, pending: true, error: false });
    try {
      const page = await this.load(target.beforeId, controller.signal);
      if (
        !this.active ||
        this.controller !== controller ||
        controller.signal.aborted
      )
        return;
      this.publish({ page, trail: target.trail, pending: false, error: false });
    } catch {
      if (
        !this.active ||
        this.controller !== controller ||
        controller.signal.aborted
      )
        return;
      this.failed = target;
      this.publish({ ...this.snapshot, pending: false, error: true });
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }
  refresh = () =>
    this.visit({
      beforeId: this.snapshot.page?.beforeId ?? null,
      trail: this.snapshot.trail,
    });
  retry = () => (this.failed ? this.visit(this.failed) : this.refresh());
  latest = () => this.visit({ beforeId: null, trail: [] });
  older = () => {
    const { page, trail } = this.snapshot;
    return page?.nextBeforeId
      ? this.visit({
          beforeId: page.nextBeforeId,
          trail: [...trail, page.beforeId],
        })
      : Promise.resolve();
  };
  newer = () => {
    const trail = this.snapshot.trail;
    return trail.length
      ? this.visit({ beforeId: trail.at(-1)!, trail: trail.slice(0, -1) })
      : Promise.resolve();
  };
  poll = () => {
    if (!this.snapshot.page?.beforeId && !this.snapshot.error)
      void this.refresh();
  };
}
