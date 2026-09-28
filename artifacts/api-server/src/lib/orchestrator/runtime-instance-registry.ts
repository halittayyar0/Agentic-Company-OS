import { randomUUID } from "node:crypto";
import { hostname as readHostname } from "node:os";
import {
  db,
  dbReady,
  runtimeInstancesTable,
  type RuntimeInstanceRole,
} from "@workspace/db";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { logger } from "../logger";
import type { RuntimeOperationsConfig } from "../runtime-operations-config";
import { appendOperationsChanged } from "../operations/operations-events";

const CLAIMABLE_STATES = ["starting", "healthy"] as const;
const STOPPABLE_STATES = ["starting", "healthy", "draining", "stale"] as const;

const runtimeInstanceHandleBrand = Symbol("RuntimeInstanceHandle");

export interface RuntimeInstanceHandle {
  id: string;
  startedAt: Date;
  stopHeartbeat(): Promise<void>;
}

export interface RuntimeInstanceTimer {
  unref?(): unknown;
}

export interface RuntimeInstanceRegistryRuntime {
  now(): Date;
  setTimeout(
    callback: () => void | Promise<void>,
    delayMs: number,
  ): RuntimeInstanceTimer;
  clearTimeout(timer: RuntimeInstanceTimer): void;
}

export interface RuntimeInstanceStaleMarkRuntime {
  now(): Date;
  afterStaleCandidatesSelected?(
    candidates: ReadonlyArray<Readonly<RuntimeInstanceOwnership>>,
  ): void | Promise<void>;
}

export interface RegisterRuntimeInstanceInput {
  role: RuntimeInstanceRole;
  schedulerEnabled: boolean;
  capabilities?: Readonly<Record<string, boolean>>;
  buildVersion?: string;
}

interface OwnedHeartbeat {
  id: string;
  startedAt: Date;
  runtime: RuntimeInstanceRegistryRuntime;
  intervalMs: number;
  stopped: boolean;
  claimAdmissionOpen: boolean;
  timer: RuntimeInstanceTimer | null;
  stopPromise: Promise<void> | null;
  inFlightWrites: Set<Promise<unknown>>;
}

interface RuntimeInstanceOwnership {
  id: string;
  startedAt: Date;
}

const systemRuntime: RuntimeInstanceRegistryRuntime = {
  now: () => new Date(),
  setTimeout(callback, delayMs) {
    return setTimeout(() => void callback(), delayMs);
  },
  clearTimeout(timer) {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
};

const ownedHeartbeats = new WeakMap<RuntimeInstanceHandle, OwnedHeartbeat>();
type RegistryTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class RuntimeClaimAdmissionError extends Error {
  constructor(message = "Runtime handle is not eligible to claim tasks") {
    super(message);
    this.name = "RuntimeClaimAdmissionError";
  }
}

function timestampFrom(
  runtime: Pick<RuntimeInstanceRegistryRuntime, "now">,
): Date {
  const timestamp = runtime.now();
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error("Runtime instance clock returned an invalid timestamp");
  }
  return timestamp;
}

function buildVersion(input: RegisterRuntimeInstanceInput): string {
  return (
    input.buildVersion?.trim() ||
    process.env.BUILD_VERSION?.trim() ||
    process.env.GIT_COMMIT_SHA?.trim() ||
    process.env.npm_package_version?.trim() ||
    "development"
  );
}

function trackWrite<T>(state: OwnedHeartbeat, write: Promise<T>): Promise<T> {
  state.inFlightWrites.add(write);
  void write.then(
    () => state.inFlightWrites.delete(write),
    () => state.inFlightWrites.delete(write),
  );
  return write;
}

function scheduleHeartbeat(
  handle: RuntimeInstanceHandle,
  state: OwnedHeartbeat,
): void {
  if (state.stopped) return;
  const timer = state.runtime.setTimeout(async () => {
    if (state.timer === timer) state.timer = null;
    if (state.stopped) return;
    try {
      await heartbeatRuntimeInstance(handle);
    } catch {
      logger.error(
        { runtimeInstanceId: state.id },
        "Runtime instance heartbeat failed",
      );
    } finally {
      if (!state.stopped) scheduleHeartbeat(handle, state);
    }
  }, state.intervalMs);
  state.timer = timer;
  timer.unref?.();
}

function stopOwnedHeartbeat(state: OwnedHeartbeat): Promise<void> {
  if (state.stopPromise) return state.stopPromise;
  state.claimAdmissionOpen = false;
  state.stopped = true;
  if (state.timer) {
    state.runtime.clearTimeout(state.timer);
    state.timer = null;
  }
  state.stopPromise = (async () => {
    while (state.inFlightWrites.size > 0) {
      await Promise.allSettled([...state.inFlightWrites]);
    }
  })();
  return state.stopPromise;
}

export async function registerRuntimeInstance(
  input: RegisterRuntimeInstanceInput,
  config: RuntimeOperationsConfig,
  runtime: RuntimeInstanceRegistryRuntime = systemRuntime,
): Promise<RuntimeInstanceHandle> {
  if (input.role !== config.role) {
    throw new Error(
      `Runtime instance role ${input.role} does not match configured role ${config.role}`,
    );
  }
  if (input.role === "api" && input.schedulerEnabled) {
    throw new Error("api runtime schedulerEnabled must be false");
  }
  if (input.role === "worker" && !input.schedulerEnabled) {
    throw new Error("worker runtime schedulerEnabled must be true");
  }
  await dbReady;
  const id = randomUUID();
  const startedAt = timestampFrom(runtime);
  await db.transaction(async (transaction) => {
    await transaction.insert(runtimeInstancesTable).values({
      id,
      role: input.role,
      state: "starting",
      hostname: readHostname().trim().toLowerCase() || "unknown-host",
      processId: process.pid,
      buildVersion: buildVersion(input),
      capabilities: { ...(input.capabilities ?? {}) },
      startedAt,
      lastHeartbeatAt: startedAt,
      schedulerEnabled: input.schedulerEnabled,
    });
    await appendOperationsChanged(transaction, {
      kind: "runtime_registered",
      runtimeInstanceId: id,
      state: "starting",
      createdAt: startedAt,
    });
  });

  let handle!: RuntimeInstanceHandle;
  const state: OwnedHeartbeat = {
    id,
    startedAt: new Date(startedAt),
    runtime,
    intervalMs: config.runtimeHeartbeatMs,
    stopped: false,
    claimAdmissionOpen: true,
    timer: null,
    stopPromise: null,
    inFlightWrites: new Set(),
  };
  handle = Object.freeze({
    [runtimeInstanceHandleBrand]: true as const,
    id,
    startedAt,
    stopHeartbeat: () => stopOwnedHeartbeat(state),
  });
  ownedHeartbeats.set(handle, state);
  scheduleHeartbeat(handle, state);
  return handle;
}

export function assertRuntimeClaimHandle(handle: RuntimeInstanceHandle): void {
  const state = ownedHeartbeats.get(handle);
  if (!state || state.stopped || !state.claimAdmissionOpen) {
    throw new RuntimeClaimAdmissionError(
      "Runtime handle is forged, stopped, draining, or no longer claim-eligible",
    );
  }
}

export async function lockAndAssertRuntimeCanClaim(
  tx: RegistryTransaction,
  handle: RuntimeInstanceHandle,
  config: RuntimeOperationsConfig,
): Promise<void> {
  const state = ownedHeartbeats.get(handle);
  if (!state || state.stopped || !state.claimAdmissionOpen) {
    throw new RuntimeClaimAdmissionError();
  }
  await tx.execute(
    sql`SELECT id FROM ${runtimeInstancesTable} WHERE ${runtimeInstancesTable.id} = ${state.id} FOR UPDATE`,
  );
  const [row] = await tx
    .select()
    .from(runtimeInstancesTable)
    .where(
      and(
        eq(runtimeInstancesTable.id, state.id),
        eq(runtimeInstancesTable.startedAt, state.startedAt),
      ),
    );
  const schedulerCapableRole =
    row?.role === "worker" || row?.role === "combined";
  if (
    !state.claimAdmissionOpen ||
    state.stopped ||
    !row ||
    row.role !== config.role ||
    !schedulerCapableRole ||
    !row.schedulerEnabled ||
    !CLAIMABLE_STATES.includes(row.state as (typeof CLAIMABLE_STATES)[number])
  ) {
    throw new RuntimeClaimAdmissionError();
  }
}

/**
 * Fences an operator-initiated interactive turn to the exact HTTP runtime
 * incarnation that admitted the request. A database row ID alone is not an
 * authority token: the handle must be locally owned, admission-open, and its
 * immutable startedAt value must still match the durable runtime row.
 */
export async function lockAndAssertRuntimeCanServeInteractive(
  tx: RegistryTransaction,
  handle: RuntimeInstanceHandle,
): Promise<void> {
  const state = ownedHeartbeats.get(handle);
  if (!state || state.stopped || !state.claimAdmissionOpen) {
    throw new RuntimeClaimAdmissionError(
      "Interactive runtime handle is forged, stopped, draining, or no longer admission-eligible",
    );
  }
  await tx.execute(
    sql`SELECT id FROM ${runtimeInstancesTable} WHERE ${runtimeInstancesTable.id} = ${state.id} FOR UPDATE`,
  );
  const [row] = await tx
    .select()
    .from(runtimeInstancesTable)
    .where(
      and(
        eq(runtimeInstancesTable.id, state.id),
        eq(runtimeInstancesTable.startedAt, state.startedAt),
      ),
    );
  const httpRole = row?.role === "api" || row?.role === "combined";
  if (
    !state.claimAdmissionOpen ||
    state.stopped ||
    !row ||
    !httpRole ||
    row.capabilities.http !== true ||
    !CLAIMABLE_STATES.includes(row.state as (typeof CLAIMABLE_STATES)[number])
  ) {
    throw new RuntimeClaimAdmissionError(
      "Interactive runtime incarnation is not healthy or HTTP-capable",
    );
  }
}

/**
 * Allows an already-admitted HTTP turn to finish while gracefully draining,
 * but rejects a forged, ownership-lost, stale, or stopped incarnation.
 */
export async function lockAndAssertRuntimeCanFinalizeInteractive(
  tx: RegistryTransaction,
  handle: RuntimeInstanceHandle,
): Promise<void> {
  const state = ownedHeartbeats.get(handle);
  if (!state || state.stopped) {
    throw new RuntimeClaimAdmissionError(
      "Interactive runtime handle no longer owns finalization",
    );
  }
  await tx.execute(
    sql`SELECT id FROM ${runtimeInstancesTable} WHERE ${runtimeInstancesTable.id} = ${state.id} FOR UPDATE`,
  );
  const [row] = await tx
    .select()
    .from(runtimeInstancesTable)
    .where(
      and(
        eq(runtimeInstancesTable.id, state.id),
        eq(runtimeInstancesTable.startedAt, state.startedAt),
      ),
    );
  const httpRole = row?.role === "api" || row?.role === "combined";
  if (
    !row ||
    !httpRole ||
    row.capabilities.http !== true ||
    !["starting", "healthy", "draining"].includes(row.state)
  ) {
    throw new RuntimeClaimAdmissionError(
      "Interactive runtime incarnation no longer owns finalization",
    );
  }
}

export function heartbeatRuntimeInstance(
  handle: RuntimeInstanceHandle,
): Promise<boolean> {
  const state = ownedHeartbeats.get(handle);
  if (!state || state.stopped) return Promise.resolve(false);
  const now = timestampFrom(state.runtime);
  const write = (async () => {
    await dbReady;
    return db.transaction(async (transaction) => {
      const becameHealthy = await transaction
        .update(runtimeInstancesTable)
        .set({ state: "healthy", lastHeartbeatAt: now })
        .where(
          and(
            eq(runtimeInstancesTable.id, state.id),
            eq(runtimeInstancesTable.startedAt, state.startedAt),
            eq(runtimeInstancesTable.state, "starting"),
          ),
        )
        .returning({ id: runtimeInstancesTable.id });
      if (becameHealthy.length === 1) {
        await appendOperationsChanged(transaction, {
          kind: "runtime_state_changed",
          runtimeInstanceId: state.id,
          state: "healthy",
          createdAt: now,
        });
        return true;
      }
      const updated = await transaction
        .update(runtimeInstancesTable)
        .set({ lastHeartbeatAt: now })
        .where(
          and(
            eq(runtimeInstancesTable.id, state.id),
            eq(runtimeInstancesTable.startedAt, state.startedAt),
            inArray(runtimeInstancesTable.state, ["healthy", "draining"]),
          ),
        )
        .returning({ id: runtimeInstancesTable.id });
      return updated.length === 1;
    });
  })();
  const trackedWrite = trackWrite(state, write);
  void trackedWrite.then(
    (ownsRow) => {
      if (!ownsRow) void stopOwnedHeartbeat(state);
    },
    () => undefined,
  );
  return trackedWrite;
}

export async function markRuntimeDraining(
  handle: RuntimeInstanceHandle,
): Promise<boolean> {
  const state = ownedHeartbeats.get(handle);
  if (!state) return false;
  state.claimAdmissionOpen = false;
  await dbReady;
  const now = timestampFrom(state.runtime);
  return db.transaction(async (transaction) => {
    const updated = await transaction
      .update(runtimeInstancesTable)
      .set({ state: "draining", drainingAt: now })
      .where(
        and(
          eq(runtimeInstancesTable.id, state.id),
          eq(runtimeInstancesTable.startedAt, state.startedAt),
          inArray(runtimeInstancesTable.state, [...CLAIMABLE_STATES]),
        ),
      )
      .returning({ id: runtimeInstancesTable.id });
    if (updated.length === 1) {
      await appendOperationsChanged(transaction, {
        kind: "runtime_state_changed",
        runtimeInstanceId: state.id,
        state: "draining",
        createdAt: now,
      });
    }
    return updated.length === 1;
  });
}

export async function markRuntimeStopped(
  handle: RuntimeInstanceHandle,
): Promise<boolean> {
  const state = ownedHeartbeats.get(handle);
  if (!state) return false;
  state.claimAdmissionOpen = false;
  await stopOwnedHeartbeat(state);
  await dbReady;
  const now = timestampFrom(state.runtime);
  return db.transaction(async (transaction) => {
    const updated = await transaction
      .update(runtimeInstancesTable)
      .set({ state: "stopped", stoppedAt: now })
      .where(
        and(
          eq(runtimeInstancesTable.id, state.id),
          eq(runtimeInstancesTable.startedAt, state.startedAt),
          inArray(runtimeInstancesTable.state, [...STOPPABLE_STATES]),
        ),
      )
      .returning({ id: runtimeInstancesTable.id });
    if (updated.length === 1) {
      await appendOperationsChanged(transaction, {
        kind: "runtime_state_changed",
        runtimeInstanceId: state.id,
        state: "stopped",
        createdAt: now,
      });
    }
    return updated.length === 1;
  });
}

export async function markStaleRuntimeInstances(
  config: RuntimeOperationsConfig,
  runtime: RuntimeInstanceStaleMarkRuntime = systemRuntime,
): Promise<number> {
  await dbReady;
  const observedAt = timestampFrom(runtime);
  const cutoff = new Date(observedAt.getTime() - config.workerStaleAfterMs);
  const candidates = await db
    .select({
      id: runtimeInstancesTable.id,
      startedAt: runtimeInstancesTable.startedAt,
    })
    .from(runtimeInstancesTable)
    .where(
      and(
        inArray(runtimeInstancesTable.state, [...CLAIMABLE_STATES]),
        lte(runtimeInstancesTable.lastHeartbeatAt, cutoff),
      ),
    );

  await runtime.afterStaleCandidatesSelected?.(
    candidates.map((candidate) =>
      Object.freeze({
        id: candidate.id,
        startedAt: new Date(candidate.startedAt),
      }),
    ),
  );

  let markedCount = 0;
  for (const candidate of candidates) {
    markedCount += await db.transaction(async (transaction) => {
      const updated = await transaction
        .update(runtimeInstancesTable)
        .set({ state: "stale" })
        .where(
          and(
            eq(runtimeInstancesTable.id, candidate.id),
            eq(runtimeInstancesTable.startedAt, candidate.startedAt),
            inArray(runtimeInstancesTable.state, [...CLAIMABLE_STATES]),
            lte(runtimeInstancesTable.lastHeartbeatAt, cutoff),
          ),
        )
        .returning({ id: runtimeInstancesTable.id });
      if (updated.length === 1) {
        await appendOperationsChanged(transaction, {
          kind: "runtime_state_changed",
          runtimeInstanceId: candidate.id,
          state: "stale",
          createdAt: observedAt,
        });
      }
      return updated.length;
    });
  }
  return markedCount;
}
