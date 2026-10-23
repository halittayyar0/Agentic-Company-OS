import {
  db,
  dbReady,
  localModelPreparationsTable as table,
  providerRuntimeConfigTable,
  type LocalModelPreparationFailureCode,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { OllamaPullProgress } from "./ollama-preparation-protocol";
import { createHash } from "node:crypto";

export type PreparationRow = typeof table.$inferSelect;
export interface PreparationStart {
  requestId: string;
  requestHash: string;
  expectedRevision: number;
  modelId: "qwen35-2b";
}
export class OllamaPreparationConflict extends Error {
  constructor(readonly code: "REQUEST_CONFLICT" | "CONFIG_CHANGED") {
    super(code);
    this.name = "OllamaPreparationConflict";
  }
}
export type PreparationFinish =
  | { state: "ready"; modelId: string; digest: string }
  | {
      state: "failed" | "interrupted";
      failureCode: LocalModelPreparationFailureCode;
    };
const activeStates = [
  "requested",
  "downloading",
  "verifying",
  "stopping",
] as const;
const writableStates = ["requested", "downloading", "verifying"] as const;

export function createOllamaPreparationStore(owner: {
  runtimeId: string;
  epoch: string;
}) {
  const owned = (id: string) =>
    and(
      eq(table.requestId, id),
      eq(table.ownerRuntimeId, owner.runtimeId),
      eq(table.ownerEpoch, owner.epoch),
      sql`${table.leaseExpiresAt} > clock_timestamp()`,
    );
  async function read(requestId?: string): Promise<PreparationRow | null> {
    await dbReady;
    const [row] = await db
      .select()
      .from(table)
      .where(requestId ? eq(table.requestId, requestId) : undefined)
      .orderBy(
        sql`case when ${table.state} in ('requested','downloading','verifying','stopping') then 0 else 1 end`,
        desc(table.createdAt),
        desc(table.requestId),
      )
      .limit(1);
    return row ?? null;
  }
  async function reserve(
    input: PreparationStart,
  ): Promise<{ receipt: PreparationRow; created: boolean }> {
    await dbReady;
    return db.transaction(async (transaction) => {
      // Configuration precedes preparation locks, matching provider saves.
      const [configuration] = await transaction
        .select({ revision: providerRuntimeConfigTable.revision })
        .from(providerRuntimeConfigTable)
        .where(eq(providerRuntimeConfigTable.singletonId, 1))
        .for("update");
      const [existing] = await transaction
        .select()
        .from(table)
        .where(eq(table.requestId, input.requestId));
      if (existing) {
        if (existing.requestHash !== input.requestHash)
          throw new OllamaPreparationConflict("REQUEST_CONFLICT");
        return { receipt: existing, created: false };
      }
      if (configuration && configuration.revision !== input.expectedRevision)
        throw new OllamaPreparationConflict("CONFIG_CHANGED");
      const [inserted] = await transaction
        .insert(table)
        .values({
          requestId: input.requestId,
          requestHash: input.requestHash,
          providerRevision: input.expectedRevision,
          modelId: input.modelId,
          state: "requested",
          ownerRuntimeId: owner.runtimeId,
          ownerEpoch: owner.epoch,
          leaseExpiresAt: sql`clock_timestamp() + interval '30 seconds'`,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) return { receipt: inserted, created: true };
      const [raced] = await transaction
        .select()
        .from(table)
        .where(eq(table.requestId, input.requestId));
      if (raced) {
        if (raced.requestHash !== input.requestHash)
          throw new OllamaPreparationConflict("REQUEST_CONFLICT");
        return { receipt: raced, created: false };
      }
      const [active] = await transaction
        .select()
        .from(table)
        .where(inArray(table.state, [...activeStates]))
        .limit(1);
      if (!active) throw new OllamaPreparationConflict("REQUEST_CONFLICT");
      return { receipt: active, created: false };
    });
  }
  async function markDispatched(requestId: string): Promise<boolean> {
    return withCurrentRevision(requestId, async (transaction) => {
      const rows = await transaction
        .update(table)
        .set({
          state: "downloading",
          dispatchedAt: sql`clock_timestamp()`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            owned(requestId),
            eq(table.state, "requested"),
            isNull(table.dispatchedAt),
          ),
        )
        .returning({ id: table.requestId });
      return rows.length === 1;
    });
  }
  async function withCurrentRevision(
    requestId: string,
    operation: (
      transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
    ) => Promise<boolean>,
  ): Promise<boolean> {
    return db.transaction(async (transaction) => {
      const [configuration] = await transaction
        .select({ revision: providerRuntimeConfigTable.revision })
        .from(providerRuntimeConfigTable)
        .where(eq(providerRuntimeConfigTable.singletonId, 1))
        .for("update");
      const [receipt] = await transaction
        .select({ revision: table.providerRevision })
        .from(table)
        .where(eq(table.requestId, requestId));
      if (
        !receipt ||
        (configuration && configuration.revision !== receipt.revision)
      )
        return false;
      return operation(transaction);
    });
  }
  async function heartbeat(requestId: string): Promise<boolean> {
    const rows = await db
      .update(table)
      .set({
        leaseExpiresAt: sql`clock_timestamp() + interval '30 seconds'`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(and(owned(requestId), inArray(table.state, [...writableStates])))
      .returning({ id: table.requestId });
    return rows.length === 1;
  }
  async function progress(
    requestId: string,
    event: OllamaPullProgress,
  ): Promise<boolean> {
    const rows = await db
      .update(table)
      .set({
        state:
          event.phase === "checking" || event.pullComplete
            ? "verifying"
            : "downloading",
        phase: event.phase,
        observedCompletedBytes: event.observedCompletedBytes,
        observedTotalBytes: event.observedTotalBytes,
        progressReset: event.progressReset,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          owned(requestId),
          inArray(table.state, ["downloading", "verifying"]),
        ),
      )
      .returning({ id: table.requestId });
    return rows.length === 1;
  }
  async function finish(
    requestId: string,
    outcome: PreparationFinish,
  ): Promise<boolean> {
    const values =
      outcome.state === "ready"
        ? {
            state: outcome.state,
            resultModelId: outcome.modelId,
            resultDigest: outcome.digest,
            phase: "downloaded" as const,
            failureCode: null,
          }
        : {
            state: outcome.state,
            failureCode: outcome.failureCode,
            resultModelId: null,
            resultDigest: null,
          };
    const write = async (
      transaction: Pick<typeof db, "update">,
    ): Promise<boolean> => {
      const rows = await transaction
        .update(table)
        .set({
          ...values,
          finishedAt: sql`clock_timestamp()`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            owned(requestId),
            inArray(
              table.state,
              outcome.state === "ready"
                ? [...writableStates]
                : [...activeStates],
            ),
          ),
        )
        .returning({ id: table.requestId });
      return rows.length === 1;
    };
    return outcome.state === "ready"
      ? withCurrentRevision(requestId, write)
      : write(db);
  }
  async function requestStop(
    requestId: string,
  ): Promise<PreparationRow | null> {
    await dbReady;
    // Fence a Start whose HTTP acknowledgement was lost or is still in flight.
    // A terminal cancellation receipt never occupies the active slot.
    await db
      .insert(table)
      .values({
        requestId,
        requestHash: createHash("sha256")
          .update(JSON.stringify({ kind: "stop-before-start", requestId }))
          .digest("hex"),
        modelId: "qwen35-2b",
        providerRevision: 0,
        state: "interrupted",
        ownerRuntimeId: owner.runtimeId,
        ownerEpoch: owner.epoch,
        leaseExpiresAt: sql`clock_timestamp()`,
        failureCode: "INTERRUPTED",
        finishedAt: sql`clock_timestamp()`,
      })
      .onConflictDoNothing();
    await db
      .update(table)
      .set({ state: "stopping", updatedAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(table.requestId, requestId),
          inArray(table.state, [...writableStates]),
        ),
      );
    return read(requestId);
  }
  async function reconcile(): Promise<void> {
    await dbReady;
    await db
      .update(table)
      .set({
        state: "interrupted",
        failureCode: "INTERRUPTED",
        finishedAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          inArray(table.state, [...activeStates]),
          sql`(${table.leaseExpiresAt} <= clock_timestamp() or not exists(select 1 from runtime_instances r where r.id = ${table.ownerRuntimeId} and r.state in ('starting','healthy','draining')))`,
        ),
      );
  }
  return {
    read,
    reserve,
    markDispatched,
    heartbeat,
    progress,
    finish,
    requestStop,
    reconcile,
  };
}
export type OllamaPreparationStore = ReturnType<
  typeof createOllamaPreparationStore
>;
