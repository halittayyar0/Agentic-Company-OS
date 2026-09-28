import { activityEventsTable, db } from "@workspace/db";
import { and, asc, eq, gt } from "drizzle-orm";
import { logger, safeErrorForLog } from "../logger";

const MAX_ACTIVITY_CURSOR = 2_147_483_647n;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const CHANGE_BATCH_LIMIT = 500;

export type OperationsSseEvent =
  "snapshot" | "operations_changed" | "heartbeat";

export function parseOperationsCursor(value: unknown): string {
  if (value === undefined) return "0";
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError("Operations cursor must be a canonical decimal string");
  }
  const cursor = BigInt(value);
  if (cursor > MAX_ACTIVITY_CURSOR) {
    throw new TypeError("Operations cursor exceeds the durable event range");
  }
  return cursor.toString();
}

export function formatOperationsSseFrame(input: {
  event: OperationsSseEvent;
  id?: string;
  data: unknown;
}): string {
  const id =
    input.id === undefined ? "" : `id: ${parseOperationsCursor(input.id)}\n`;
  return `${id}event: ${input.event}\ndata: ${JSON.stringify(input.data)}\n\n`;
}

export interface OperationsChangeCursor {
  id: string;
}

export async function loadDurableOperationsChanges(
  afterCursor: string,
): Promise<OperationsChangeCursor[]> {
  const cursor = Number(parseOperationsCursor(afterCursor));
  const rows = await db
    .select({ id: activityEventsTable.id })
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.type, "operations_changed"),
        gt(activityEventsTable.id, cursor),
      ),
    )
    .orderBy(asc(activityEventsTable.id))
    .limit(CHANGE_BATCH_LIMIT);
  return rows.map((row) => ({ id: String(row.id) }));
}

type ChangeLoader = (
  afterCursor: string,
) => Promise<ReadonlyArray<OperationsChangeCursor>>;
type ChangeSubscriber = (cursor: string) => void;

interface SubscriberRecord {
  cursor: bigint;
  notify: ChangeSubscriber;
}

export class OperationsStreamHub {
  private readonly subscribers = new Map<symbol, SubscriberRecord>();
  private readonly loadChanges: ChangeLoader;
  private readonly pollIntervalMs: number;
  private readonly autoStart: boolean;
  private timer: NodeJS.Timeout | null = null;
  private polling: Promise<void> | null = null;

  constructor(
    input: {
      loadChanges?: ChangeLoader;
      pollIntervalMs?: number;
      autoStart?: boolean;
    } = {},
  ) {
    this.loadChanges = input.loadChanges ?? loadDurableOperationsChanges;
    this.pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.autoStart = input.autoStart ?? true;
    if (!Number.isInteger(this.pollIntervalMs) || this.pollIntervalMs < 100) {
      throw new TypeError(
        "Operations stream poll interval must be at least 100ms",
      );
    }
  }

  subscribe(afterCursor: string, notify: ChangeSubscriber): () => void {
    const key = Symbol("operations-stream-subscriber");
    this.subscribers.set(key, {
      cursor: BigInt(parseOperationsCursor(afterCursor)),
      notify,
    });
    if (this.autoStart) this.start();
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.subscribers.delete(key);
      if (this.subscribers.size === 0) this.stop();
    };
  }

  start(): void {
    if (this.timer || this.subscribers.size === 0) return;
    this.timer = setInterval(() => void this.pollNow(), this.pollIntervalMs);
    this.timer.unref?.();
    void this.pollNow();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async pollNow(): Promise<void> {
    if (this.subscribers.size === 0) return;
    if (this.polling) return this.polling;
    this.polling = this.pollOnce().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  private async pollOnce(): Promise<void> {
    const oldest = [...this.subscribers.values()].reduce<bigint | null>(
      (minimum, subscriber) =>
        minimum === null || subscriber.cursor < minimum
          ? subscriber.cursor
          : minimum,
      null,
    );
    if (oldest === null) return;
    try {
      const changes = [...(await this.loadChanges(oldest.toString()))]
        .map((change) => BigInt(parseOperationsCursor(change.id)))
        .filter((cursor) => cursor > oldest)
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
      for (const cursor of changes) {
        for (const subscriber of this.subscribers.values()) {
          if (cursor <= subscriber.cursor) continue;
          subscriber.cursor = cursor;
          try {
            subscriber.notify(cursor.toString());
          } catch (error) {
            logger.warn(
              { error: safeErrorForLog(error) },
              "Operations stream subscriber rejected a durable change",
            );
          }
        }
      }
    } catch (error) {
      logger.warn(
        { error: safeErrorForLog(error) },
        "Operations stream durable change poll failed",
      );
    }
  }
}

export class OperationsStreamConnectionLimiter {
  private activeConnections = 0;

  constructor(private readonly maximum: number) {
    if (!Number.isInteger(maximum) || maximum < 1) {
      throw new TypeError(
        "Operations stream maximum must be a positive integer",
      );
    }
  }

  get active(): number {
    return this.activeConnections;
  }

  tryAcquire(): (() => void) | null {
    if (this.activeConnections >= this.maximum) return null;
    this.activeConnections += 1;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.activeConnections -= 1;
    };
  }
}

export const operationsStreamHub = new OperationsStreamHub();
