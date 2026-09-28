import {
  activityEventsTable,
  agentsTable,
  db,
  projectMeetingTurnRequestsTable,
  runtimeControlsTable,
  tasksTable,
  type RuntimeControl,
} from "@workspace/db";
import { eq, isNotNull, sql } from "drizzle-orm";
import { assertToolPolicy } from "../execution-policy";
import { redactAuditText } from "../audit-redaction";
import { logger, safeErrorForLog } from "../logger";
import { appendOperationsChanged } from "../operations/operations-events";
import { closeAllAgentSessionsForEmergencyStop } from "../vm/browser";
import { stopAllAgentProcesses } from "../vm/sandbox";
import {
  activateLocalEmergencyStop,
  deactivateLocalEmergencyStop,
  localEmergencyStopSnapshot,
} from "./local-emergency-epoch";

const RUNTIME_CONTROL_ID = 1;

export const EMERGENCY_STOP_BLOCKED_SCOPES = [
  "agent_chat",
  "task_scheduler",
  "agent_tools",
  "approved_actions",
] as const;

export class EmergencyStopError extends Error {
  readonly code = "EMERGENCY_STOP_ACTIVE";
  readonly state: RuntimeControl;

  constructor(state: RuntimeControl) {
    super(
      state.emergencyStopReason
        ? `Emergency stop is active: ${state.emergencyStopReason}`
        : "Emergency stop is active",
    );
    this.name = "EmergencyStopError";
    this.state = state;
  }
}

export interface EmergencyStopStatus {
  emergencyStopEnabled: boolean;
  reason: string | null;
  version: number;
  updatedBy: string;
  updatedAt: Date;
  blockedScopes: typeof EMERGENCY_STOP_BLOCKED_SCOPES;
}

export interface EmergencyStopTransition extends EmergencyStopStatus {
  changed: boolean;
  releasedTaskLeases: number;
  releasedAgentLeases: number;
  terminatedAgentProcesses: number;
  closedBrowserSessions: boolean;
}

export interface LocalEmergencyStopCleanup {
  applied: boolean;
  terminatedAgentProcesses: number;
  closedBrowserSessions: boolean;
}

export type RuntimeTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

function publicStatus(state: RuntimeControl): EmergencyStopStatus {
  return {
    emergencyStopEnabled: state.emergencyStopEnabled,
    reason: state.emergencyStopReason,
    version: state.version,
    updatedBy: state.updatedBy,
    updatedAt: state.updatedAt,
    blockedScopes: EMERGENCY_STOP_BLOCKED_SCOPES,
  };
}

/**
 * Locks the singleton row inside a caller-owned transaction. Scheduler/chat
 * claims use this before taking a lease, making a stop toggle and a new claim
 * serializable across API replicas sharing PostgreSQL.
 */
export async function lockAndAssertExecutionAllowed(
  tx: RuntimeTransaction,
): Promise<RuntimeControl> {
  const state = await lockRuntimeControlState(tx);
  if (state.emergencyStopEnabled) throw new EmergencyStopError(state);
  await assertToolPolicy(tx);
  return state;
}

export async function lockRuntimeControlState(
  tx: RuntimeTransaction,
): Promise<RuntimeControl> {
  await tx.execute(
    sql`SELECT id FROM ${runtimeControlsTable} WHERE ${runtimeControlsTable.id} = ${RUNTIME_CONTROL_ID} FOR UPDATE`,
  );
  const [state] = await tx
    .select()
    .from(runtimeControlsTable)
    .where(eq(runtimeControlsTable.id, RUNTIME_CONTROL_ID));
  // Missing state is a migration/readiness failure and must fail closed.
  if (!state) throw new Error("Runtime control state is missing");
  return state;
}

export async function getEmergencyStopStatus(): Promise<EmergencyStopStatus> {
  const [state] = await db
    .select()
    .from(runtimeControlsTable)
    .where(eq(runtimeControlsTable.id, RUNTIME_CONTROL_ID));
  if (!state) throw new Error("Runtime control state is missing");
  return publicStatus(state);
}

export async function assertExecutionAllowed(): Promise<void> {
  const [state] = await db
    .select()
    .from(runtimeControlsTable)
    .where(eq(runtimeControlsTable.id, RUNTIME_CONTROL_ID));
  // A missing/unreadable control row is not interpreted as permission.
  if (!state) throw new Error("Runtime control state is missing");
  if (state.emergencyStopEnabled) throw new EmergencyStopError(state);
  await assertToolPolicy();
}

export interface EmergencyStopCleanupHooks {
  stopAgentProcesses(): number;
  closeBrowserSessions(): Promise<void>;
  onError?(error: unknown, version: number): void;
}

/**
 * Process-scoped coordinator. Each replica owns an independent instance, so a
 * shared database stop version is applied once per process (and retried after
 * partial failure) instead of only where the operator's HTTP request landed.
 */
export function createLocalEmergencyStopCoordinator(
  hooks: EmergencyStopCleanupHooks,
): (
  state: Pick<RuntimeControl, "emergencyStopEnabled" | "version">,
  options?: { force?: boolean },
) => Promise<LocalEmergencyStopCleanup> {
  let appliedVersion: number | null = null;
  let inFlight: {
    version: number;
    promise: Promise<LocalEmergencyStopCleanup>;
  } | null = null;

  return async (state, options = {}) => {
    if (!state.emergencyStopEnabled) {
      return {
        applied: false,
        terminatedAgentProcesses: 0,
        closedBrowserSessions: false,
      };
    }
    if (!options.force && appliedVersion === state.version) {
      return {
        applied: false,
        terminatedAgentProcesses: 0,
        closedBrowserSessions: true,
      };
    }
    while (inFlight) {
      if (inFlight.version === state.version) return inFlight.promise;
      await inFlight.promise;
    }

    const cleanup = (async (): Promise<LocalEmergencyStopCleanup> => {
      const terminatedAgentProcesses = hooks.stopAgentProcesses();
      try {
        await hooks.closeBrowserSessions();
        appliedVersion = state.version;
        return {
          applied: true,
          terminatedAgentProcesses,
          closedBrowserSessions: true,
        };
      } catch (error) {
        // Do not mark this version as applied: the next heartbeat or idempotent
        // PUT must retry rather than trusting a partial local result.
        hooks.onError?.(error, state.version);
        return {
          applied: true,
          terminatedAgentProcesses,
          closedBrowserSessions: false,
        };
      }
    })();
    inFlight = { version: state.version, promise: cleanup };
    try {
      return await cleanup;
    } finally {
      if (inFlight?.promise === cleanup) inFlight = null;
    }
  };
}

const applyLocalEmergencyStop = createLocalEmergencyStopCoordinator({
  stopAgentProcesses: stopAllAgentProcesses,
  closeBrowserSessions: closeAllAgentSessionsForEmergencyStop,
  onError: (error, version) => {
    logger.error(
      { error: safeErrorForLog(error), version },
      "Emergency stop could not close every browser session",
    );
  },
});

const DEFAULT_EMERGENCY_STOP_MONITOR_MS = 20_000;
let emergencyStopMonitorTimer: ReturnType<typeof setInterval> | null = null;
let emergencyStopMonitorPoll: Promise<void> | null = null;

export interface EmergencyStopMonitorOptions {
  intervalMs?: number;
  /** Dependency seam for deterministic overlap/retry regression tests. */
  synchronize?: () => Promise<unknown>;
}

/**
 * Starts a process-local observer independently from the task scheduler. This
 * matters for API replicas with scheduling disabled: they must still notice a
 * stop accepted by another replica and extinguish their own local resources.
 */
export function startEmergencyStopMonitor(
  options: EmergencyStopMonitorOptions = {},
): void {
  if (emergencyStopMonitorTimer) return;
  const synchronize =
    options.synchronize ?? synchronizeEmergencyStopForThisProcess;
  const requestedInterval =
    options.intervalMs ?? DEFAULT_EMERGENCY_STOP_MONITOR_MS;
  const intervalMs =
    Number.isFinite(requestedInterval) && requestedInterval > 0
      ? Math.floor(requestedInterval)
      : DEFAULT_EMERGENCY_STOP_MONITOR_MS;

  const poll = () => {
    if (emergencyStopMonitorPoll) return;
    emergencyStopMonitorPoll = synchronize()
      .then(() => undefined)
      .catch((error) => {
        logger.error(
          { error: safeErrorForLog(error) },
          "Emergency stop monitor poll failed",
        );
      })
      .finally(() => {
        emergencyStopMonitorPoll = null;
      });
  };

  poll();
  emergencyStopMonitorTimer = setInterval(poll, intervalMs);
  emergencyStopMonitorTimer.unref?.();
}

/** Stops future polls and waits for the current local cleanup before shutdown. */
export async function stopEmergencyStopMonitor(): Promise<void> {
  if (emergencyStopMonitorTimer) {
    clearInterval(emergencyStopMonitorTimer);
    emergencyStopMonitorTimer = null;
  }
  await emergencyStopMonitorPoll;
}

/**
 * Applies a persisted stop to process-local children and browser sessions.
 * Every API replica calls this from its scheduler heartbeat. `force` is used
 * by an operator PUT so a retry also repairs a prior partial local cleanup.
 */
export async function synchronizeEmergencyStopForThisProcess(
  options: { force?: boolean } = {},
): Promise<LocalEmergencyStopCleanup> {
  const [state] = await db
    .select()
    .from(runtimeControlsTable)
    .where(eq(runtimeControlsTable.id, RUNTIME_CONTROL_ID));
  if (!state) throw new Error("Runtime control state is missing");
  if (state.emergencyStopEnabled) activateLocalEmergencyStop();
  else deactivateLocalEmergencyStop();
  return applyLocalEmergencyStop(state, options);
}

/**
 * Persists an operator transition and revokes scheduler/chat leases in the
 * same transaction. Cleanup of process-local browser/child-process state is
 * best effort after the durable stop commits; failure never re-enables work.
 */
export async function setEmergencyStop(input: {
  enabled: boolean;
  reason: string | null;
  updatedBy?: string;
}): Promise<EmergencyStopTransition> {
  const normalizedReason = input.reason?.trim() || null;
  const updatedBy = input.updatedBy?.trim().slice(0, 100) || "operator";
  const localBefore = localEmergencyStopSnapshot();
  if (input.enabled) activateLocalEmergencyStop();
  let transition;
  try {
    transition = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM ${runtimeControlsTable} WHERE ${runtimeControlsTable.id} = ${RUNTIME_CONTROL_ID} FOR UPDATE`,
      );
      const [current] = await tx
        .select()
        .from(runtimeControlsTable)
        .where(eq(runtimeControlsTable.id, RUNTIME_CONTROL_ID));
      if (!current) throw new Error("Runtime control state is missing");

      const changed =
        current.emergencyStopEnabled !== input.enabled ||
        current.emergencyStopReason !== normalizedReason;
      if (!changed) {
        return {
          state: current,
          changed: false,
          releasedTaskLeases: 0,
          releasedAgentLeases: 0,
        };
      }

      const [state] = await tx
        .update(runtimeControlsTable)
        .set({
          emergencyStopEnabled: input.enabled,
          emergencyStopReason: normalizedReason,
          version: sql`${runtimeControlsTable.version} + 1`,
          updatedBy,
          updatedAt: new Date(),
        })
        .where(eq(runtimeControlsTable.id, RUNTIME_CONTROL_ID))
        .returning();
      if (!state) throw new Error("Runtime control update failed");

      if (input.enabled) {
        // Releasing a stop must not revive the remaining participants of an old
        // meeting turn. Invalidate its durable fence before releasing agents.
        await tx
          .update(projectMeetingTurnRequestsTable)
          .set({
            state: "unconfirmed",
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(projectMeetingTurnRequestsTable.state, "running"));
        // Runtime control is the global gate. After it, keep the same
        // agent-before-task order used by every task/approval mutation so the
        // safety stop cannot become the deadlock victim and roll back.
        await tx.execute(
          sql`SELECT id FROM ${agentsTable} ORDER BY ${agentsTable.id} FOR UPDATE`,
        );
        await tx.execute(
          sql`SELECT id FROM ${tasksTable} ORDER BY ${tasksTable.id} FOR UPDATE`,
        );
      }
      const releasedAgents = input.enabled
        ? await tx
            .update(agentsTable)
            .set({
              status: "idle",
              currentTaskId: null,
              currentAction: null,
              runLeaseOwner: null,
              runLeaseExpiresAt: null,
              lastActiveAt: new Date(),
            })
            .where(isNotNull(agentsTable.runLeaseOwner))
            .returning({ id: agentsTable.id })
        : [];
      const releasedTasks = input.enabled
        ? await tx
            .update(tasksTable)
            .set({ leaseOwner: null, leaseExpiresAt: null })
            .where(isNotNull(tasksTable.leaseOwner))
            .returning({ id: tasksTable.id })
        : [];

      await tx.insert(activityEventsTable).values({
        type: "task_status_changed",
        summary: input.enabled
          ? "Operator acil durdurmayi etkinlestirdi; yeni ajan yurutmeleri engellendi."
          : "Operator acil durdurmayi kaldirdi; yeni ajan yurutmeleri yeniden etkin.",
        detail: {
          actor: "operator",
          owner: "operator",
          emergencyStopEnabled: input.enabled,
          reason: normalizedReason
            ? redactAuditText(normalizedReason, 500)
            : null,
          version: state.version,
          releasedTaskLeases: releasedTasks.length,
          releasedAgentLeases: releasedAgents.length,
        },
        severity: input.enabled ? "critical" : "info",
      });
      await appendOperationsChanged(tx, {
        kind: "runtime_control_changed",
        enabled: input.enabled,
        createdAt: state.updatedAt,
      });

      return {
        state,
        changed: true,
        releasedTaskLeases: releasedTasks.length,
        releasedAgentLeases: releasedAgents.length,
      };
    });
  } catch (error) {
    if (input.enabled && !localBefore.stopped) deactivateLocalEmergencyStop();
    throw error;
  }

  if (!input.enabled) deactivateLocalEmergencyStop();

  const cleanup = input.enabled
    ? await synchronizeEmergencyStopForThisProcess({ force: true })
    : {
        applied: false,
        terminatedAgentProcesses: 0,
        closedBrowserSessions: false,
      };

  return {
    ...publicStatus(transition.state),
    changed: transition.changed,
    releasedTaskLeases: transition.releasedTaskLeases,
    releasedAgentLeases: transition.releasedAgentLeases,
    terminatedAgentProcesses: cleanup.terminatedAgentProcesses,
    closedBrowserSessions: cleanup.closedBrowserSessions,
  };
}
