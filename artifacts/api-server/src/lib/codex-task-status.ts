import { and, asc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { db, dbReady, runtimeInstancesTable as runtimes } from "@workspace/db";
import { codexConfigurationStatus } from "./codex-task-capability";
import { readRuntimeOperationsConfig } from "./runtime-operations-config";

const MAX_WORKERS = 128;
type FleetState =
  "no_worker" | "unknown" | "unavailable" | "preflight_required";
/** Read only the executing fleet's reported startup configuration. The HTTP
 * process may run on another OS and is never used as a worker capability proof.
 * A fresh heartbeat attests runtime liveness, not successful native coding. */
export async function readCodexTaskFleetStatus(
  options: { now?(): number } = {},
) {
  await dbReady;
  const sampledAt = (options.now ?? Date.now)();
  if (!Number.isSafeInteger(sampledAt) || sampledAt < 0)
    throw new Error("coding_status_clock_invalid");
  const staleAfterMs = readRuntimeOperationsConfig().workerStaleAfterMs;
  const rows = await db
    .select({
      id: runtimes.id,
      role: runtimes.role,
      startedAt: runtimes.startedAt,
      lastHeartbeatAt: runtimes.lastHeartbeatAt,
      capabilities: runtimes.capabilities,
    })
    .from(runtimes)
    .where(
      and(
        inArray(runtimes.role, ["worker", "combined"]),
        eq(runtimes.schedulerEnabled, true),
        eq(runtimes.state, "healthy"),
        isNull(runtimes.drainingAt),
        isNull(runtimes.stoppedAt),
        lte(runtimes.startedAt, new Date(sampledAt)),
        gt(runtimes.lastHeartbeatAt, new Date(sampledAt - staleAfterMs)),
        lte(runtimes.lastHeartbeatAt, new Date(sampledAt)),
      ),
    )
    .orderBy(asc(runtimes.id))
    .limit(MAX_WORKERS + 1);
  const truncated = rows.length > MAX_WORKERS;
  const workers = rows.slice(0, MAX_WORKERS).map((row) => ({
    runtimeInstanceId: row.id,
    role: row.role as "worker" | "combined",
    configurationState: codexConfigurationStatus(row.capabilities),
    configurationAt: row.startedAt.getTime(),
    heartbeatAt: row.lastHeartbeatAt.getTime(),
    staleAt: row.lastHeartbeatAt.getTime() + staleAfterMs,
  }));
  const state: FleetState = workers.some(
    (row) => row.configurationState === "preflight_required",
  )
    ? "preflight_required"
    : truncated ||
        workers.some((row) => row.configurationState === "not_reported")
      ? "unknown"
      : workers.length
        ? "unavailable"
        : "no_worker";
  return {
    state,
    sampledAt,
    truncated,
    proofScope: "worker_configuration" as const,
    requiresTaskPreflight: true as const,
    workers,
  };
}
