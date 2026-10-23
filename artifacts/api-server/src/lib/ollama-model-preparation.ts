import { createHash } from "node:crypto";
import { z } from "zod";
import { validateOllamaBaseUrl } from "@workspace/ai-server";
import type { LocalModelPreparationFailureCode } from "@workspace/db";
import type { RuntimeConfig } from "./runtime-config";
import { starterModelRecipe } from "./ollama-preparation-catalog";
import {
  OllamaPreparationConflict,
  type OllamaPreparationStore,
  type PreparationRow,
} from "./ollama-preparation-store";
import {
  OllamaPreparationProtocolError,
  readOllamaPullProgress,
} from "./ollama-preparation-protocol";
import {
  OllamaPreparationTransportError,
  type OllamaPreparationTransport,
  type OllamaPreparationAvailability,
} from "./ollama-preparation-transport";

export const PreparationStartBody = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    modelId: z.literal("qwen35-2b"),
  })
  .strict();
export type PreparationStartInput = z.infer<typeof PreparationStartBody>;
export type PreparationReceipt = Pick<
  PreparationRow,
  | "requestId"
  | "modelId"
  | "providerRevision"
  | "state"
  | "phase"
  | "observedCompletedBytes"
  | "observedTotalBytes"
  | "progressReset"
  | "failureCode"
  | "resultModelId"
  | "resultDigest"
> & { createdAt: string; updatedAt: string; finishedAt: string | null };
export interface PreparationSnapshot {
  revision: number;
  recipe: typeof starterModelRecipe;
  availability: Omit<OllamaPreparationAvailability, "server"> & {
    server: OllamaPreparationAvailability["server"] | "unconfigured";
  };
  preparation: PreparationReceipt | null;
}
export class OllamaPreparationServiceError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "SERVICE_UNAVAILABLE") {
    super(code);
    this.name = "OllamaPreparationServiceError";
  }
}

function receipt(row: PreparationRow): PreparationReceipt {
  return {
    requestId: row.requestId,
    modelId: row.modelId,
    providerRevision: row.providerRevision,
    state: row.state,
    phase: row.phase,
    observedCompletedBytes: row.observedCompletedBytes,
    observedTotalBytes: row.observedTotalBytes,
    progressReset: row.progressReset,
    failureCode: row.failureCode,
    resultModelId: row.resultModelId,
    resultDigest: row.resultDigest,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export function createOllamaModelPreparation(dependencies: {
  store: OllamaPreparationStore;
  readState(): Promise<{ revision: number; config: RuntimeConfig }>;
  transport: OllamaPreparationTransport;
  refreshCatalog(): Promise<unknown>;
  environment?: NodeJS.ProcessEnv;
}) {
  const { store, transport } = dependencies;
  const jobs = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  let closing = false;
  const addressFor = (state: { config: RuntimeConfig }): string | null => {
    const address =
      state.config.ollamaBaseUrl ??
      (dependencies.environment ?? process.env).OLLAMA_BASE_URL?.trim();
    if (!address) return null;
    try {
      return validateOllamaBaseUrl(address).origin;
    } catch {
      return null;
    }
  };

  async function run(
    row: PreparationRow,
    controller: AbortController,
  ): Promise<void> {
    const deadline = AbortSignal.timeout(2 * 60 * 60 * 1000);
    const signal = AbortSignal.any([controller.signal, deadline]);
    let failure: LocalModelPreparationFailureCode = "INTERRUPTED";
    let address: string | null = null;
    let monitoring = Promise.resolve();
    let checking = false;
    const abort = (code: LocalModelPreparationFailureCode) => {
      failure = code;
      controller.abort();
    };
    const abortFencedWrite = async (): Promise<void> => {
      if (controller.signal.aborted) return;
      const latest = await store.read(row.requestId);
      abort(latest?.state === "stopping" ? "INTERRUPTED" : "CONFIG_CHANGED");
    };
    const current = async (): Promise<boolean> => {
      const state = await dependencies.readState();
      if (
        state.revision !== row.providerRevision ||
        (address !== null && addressFor(state) !== address)
      ) {
        abort("CONFIG_CHANGED");
        return false;
      }
      if (signal.aborted || closing) return false;
      return true;
    };
    const timer = setInterval(() => {
      if (checking || signal.aborted) return;
      checking = true;
      monitoring = (async () => {
        if (!(await current()) || !(await store.heartbeat(row.requestId)))
          abort(failure);
      })()
        .catch(() => abort("INTERRUPTED"))
        .finally(() => {
          checking = false;
        });
    }, 5_000);
    timer.unref();
    try {
      const state = await dependencies.readState();
      address = addressFor(state);
      if (!address)
        throw new OllamaPreparationTransportError("SERVER_UNAVAILABLE");
      if (!(await current()))
        throw new OllamaPreparationConflict("CONFIG_CHANGED");
      let availability = await transport.inspect(address, signal);
      if (!(await current()))
        throw new OllamaPreparationConflict("CONFIG_CHANGED");
      if (availability.server !== "compatible") {
        failure =
          availability.server === "update_required"
            ? "RUNTIME_UPDATE_REQUIRED"
            : "SERVER_UNAVAILABLE";
        throw new Error(failure);
      }
      if (!availability.available) {
        if (!(await store.markDispatched(row.requestId))) {
          await abortFencedWrite();
          throw new Error("CONFIG_CHANGED");
        }
        if (!(await current()))
          throw new OllamaPreparationConflict("CONFIG_CHANGED");
        const body = await transport.pull(address, signal);
        let lastPersistedAt = 0;
        for await (const event of readOllamaPullProgress(body)) {
          if (signal.aborted) throw new Error("INTERRUPTED");
          const now = Date.now();
          if (
            event.pullComplete ||
            event.progressReset ||
            now - lastPersistedAt >= 500
          ) {
            if (!(await store.progress(row.requestId, event))) {
              abort("INTERRUPTED");
              throw new Error("INTERRUPTED");
            }
            lastPersistedAt = now;
          }
        }
        if (!(await current()))
          throw new OllamaPreparationConflict("CONFIG_CHANGED");
        availability = await transport.inspect(address, signal);
      }
      if (!(await current()))
        throw new OllamaPreparationConflict("CONFIG_CHANGED");
      if (
        !availability.available ||
        !availability.modelId ||
        !availability.digest
      )
        throw new OllamaPreparationTransportError("MODEL_UNVERIFIED");
      // Synchronize the ordinary catalog before publishing Ready. Otherwise a
      // recent empty cache can keep first-job admission and focus recovery stale.
      await dependencies.refreshCatalog().catch(() => {
        throw new OllamaPreparationTransportError("MODEL_UNVERIFIED");
      });
      if (!(await current()))
        throw new OllamaPreparationConflict("CONFIG_CHANGED");
      if (
        !(await store.finish(row.requestId, {
          state: "ready",
          modelId: availability.modelId,
          digest: availability.digest,
        }))
      ) {
        await abortFencedWrite();
        throw new Error("CONFIG_CHANGED");
      }
    } catch (error) {
      if (deadline.aborted) failure = "DEADLINE_EXCEEDED";
      else if (!controller.signal.aborted) {
        if (
          error instanceof OllamaPreparationProtocolError ||
          error instanceof OllamaPreparationTransportError
        )
          failure = error.code;
        else if (error instanceof OllamaPreparationConflict)
          failure = "CONFIG_CHANGED";
      }
      await store.finish(row.requestId, {
        state: failure === "INTERRUPTED" ? "interrupted" : "failed",
        failureCode: failure,
      });
    } finally {
      clearInterval(timer);
      controller.abort();
      await monitoring;
    }
  }

  async function start(
    input: PreparationStartInput,
  ): Promise<PreparationReceipt> {
    if (closing) throw new OllamaPreparationServiceError("SERVICE_UNAVAILABLE");
    const parsed = PreparationStartBody.safeParse(input);
    if (!parsed.success)
      throw new OllamaPreparationServiceError("INVALID_REQUEST");
    const request = parsed.data;
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          expectedRevision: request.expectedRevision,
          modelId: request.modelId,
        }),
      )
      .digest("hex");
    // Terminal idempotent replay is a read even when the current connection changed.
    const existing = await store.read(request.requestId);
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new OllamaPreparationConflict("REQUEST_CONFLICT");
      return receipt(existing);
    }
    const state = await dependencies.readState();
    if (state.revision !== request.expectedRevision)
      throw new OllamaPreparationConflict("CONFIG_CHANGED");
    if (!addressFor(state))
      throw new OllamaPreparationServiceError("INVALID_REQUEST");
    await store.reconcile();
    const reserved = await store.reserve({ ...request, requestHash });
    if (reserved.created) {
      if (closing)
        await store.finish(request.requestId, {
          state: "interrupted",
          failureCode: "INTERRUPTED",
        });
      else {
        const controller = new AbortController();
        const promise = run(reserved.receipt, controller)
          .catch(() => undefined)
          .finally(() => jobs.delete(request.requestId));
        jobs.set(request.requestId, { controller, promise });
      }
    }
    return receipt(reserved.receipt);
  }

  async function snapshot(): Promise<PreparationSnapshot>;
  async function snapshot(
    requestId: string,
  ): Promise<PreparationReceipt | null>;
  async function snapshot(
    requestId?: string,
  ): Promise<PreparationSnapshot | PreparationReceipt | null> {
    await store.reconcile();
    const row = await store.read(requestId);
    if (requestId !== undefined) return row ? receipt(row) : null;
    const state = await dependencies.readState();
    const address = addressFor(state);
    const availability: PreparationSnapshot["availability"] = address
      ? await transport.inspect(address, AbortSignal.timeout(15_000))
      : {
          server: "unconfigured",
          available: false,
          modelId: null,
          digest: null,
        };
    // Never combine metadata from the previous saved server with a new revision.
    const after = await dependencies.readState();
    if (after.revision !== state.revision || addressFor(after) !== address)
      throw new OllamaPreparationConflict("CONFIG_CHANGED");
    return {
      revision: state.revision,
      recipe: starterModelRecipe,
      availability,
      preparation: row ? receipt(row) : null,
    };
  }
  async function stop(requestId: string): Promise<PreparationReceipt | null> {
    const row = await store.requestStop(requestId);
    const job = jobs.get(requestId);
    if (job) {
      job.controller.abort();
      await job.promise;
    }
    const settled = job ? await store.read(requestId) : row;
    return settled ? receipt(settled) : null;
  }
  async function close(): Promise<void> {
    closing = true;
    const active = [...jobs.values()];
    for (const job of active) job.controller.abort();
    await Promise.all(active.map((job) => job.promise));
  }
  return { start, snapshot, stop, close };
}
export type OllamaModelPreparation = ReturnType<
  typeof createOllamaModelPreparation
>;
