import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  db,
  dbReady,
  closeDatabase,
  localModelPreparationsTable,
  providerRuntimeConfigTable,
  runtimeInstancesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

test("durable preparation identity, one active slot, stop and lease fencing survive owner loss", async () => {
  await dbReady;
  try {
    const path = "./ollama-preparation-store.js";
    const module = await import(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ERR_MODULE_NOT_FOUND") return null;
      throw error;
    });
    assert.ok(module, "durable preparation store must exist");
    const owner = { runtimeId: "owned-preparation-api", epoch: randomUUID() };
    await db.insert(runtimeInstancesTable).values({
      id: owner.runtimeId,
      role: "api",
      hostname: "owned-test",
      processId: process.pid,
      buildVersion: "test",
      state: "healthy",
    });
    const store = module.createOllamaPreparationStore(owner);
    const input = {
      requestId: randomUUID(),
      requestHash: "a".repeat(64),
      expectedRevision: 1,
      modelId: "qwen35-2b" as const,
    };
    await db.insert(providerRuntimeConfigTable).values({
      singletonId: 1,
      revision: 1,
      ciphertext: "test-envelope",
      nonce: "n".repeat(16),
      authTag: "a".repeat(16),
    });
    const results = await Promise.all([
      store.reserve(input),
      store.reserve(input),
      store.reserve({ ...input, requestId: randomUUID() }),
    ]);
    assert.equal(
      results.filter((result: { created: boolean }) => result.created).length,
      1,
    );
    for (const result of results)
      assert.equal(result.receipt.requestId, input.requestId);
    await module
      .createOllamaPreparationStore({
        runtimeId: "another-api",
        epoch: randomUUID(),
      })
      .reconcile();
    assert.equal(
      (await store.read(input.requestId))?.state,
      "requested",
      "starting another API must preserve a live owner's lease",
    );
    await assert.rejects(
      store.reserve({ ...input, requestHash: "b".repeat(64) }),
      (error: { code?: string }) => error.code === "REQUEST_CONFLICT",
    );
    assert.equal(await store.markDispatched(input.requestId), true);
    assert.equal(
      await store.markDispatched(input.requestId),
      false,
      "a durable receipt cannot dispatch twice",
    );
    const stale = module.createOllamaPreparationStore({
      ...owner,
      epoch: randomUUID(),
    });
    assert.equal(await stale.heartbeat(input.requestId), false);
    assert.equal(
      await stale.finish(input.requestId, {
        state: "failed",
        failureCode: "DISPATCH_FAILED",
      }),
      false,
    );
    await store.requestStop(input.requestId);
    assert.equal((await store.read(input.requestId))?.state, "stopping");
    assert.equal(
      await store.progress(input.requestId, {
        phase: "downloaded",
        observedCompletedBytes: 1,
        observedTotalBytes: 1,
        progressReset: false,
        pullComplete: true,
      }),
      false,
      "stop cannot be overwritten by late success",
    );
    await store.finish(input.requestId, {
      state: "interrupted",
      failureCode: "INTERRUPTED",
    });
    assert.equal(
      (await store.reserve(input)).created,
      false,
      "terminal IDs stay consumed",
    );
    await assert.rejects(
      store.reserve({ ...input, requestId: randomUUID(), expectedRevision: 0 }),
      (error: { code?: string }) => error.code === "CONFIG_CHANGED",
    );
    const nextId = randomUUID();
    await store.reserve({ ...input, requestId: nextId });
    await db
      .update(localModelPreparationsTable)
      .set({ leaseExpiresAt: new Date(0) })
      .where(eq(localModelPreparationsTable.requestId, nextId));
    assert.equal(
      await store.heartbeat(nextId),
      false,
      "expired owners cannot renew themselves",
    );
    await store.reconcile();
    assert.equal((await store.read(nextId))?.state, "interrupted");
    assert.equal(
      await store.finish(nextId, {
        state: "ready",
        modelId: "ollama:qwen3.5:2b-q4_K_M",
        digest: `sha256:${"c".repeat(64)}`,
      }),
      false,
    );
    const changedId = randomUUID();
    await store.reserve({ ...input, requestId: changedId });
    await db
      .update(localModelPreparationsTable)
      .set({ createdAt: new Date("2100-01-01") })
      .where(eq(localModelPreparationsTable.requestId, input.requestId));
    assert.equal(
      (await store.read())?.requestId,
      changedId,
      "reopening must attach to active work even after a clock correction or restore",
    );
    await db.update(providerRuntimeConfigTable).set({ revision: 2 });
    assert.equal(
      await store.markDispatched(changedId),
      false,
      "changed configuration must fence a not-yet-dispatched request",
    );
    assert.equal(
      await store.finish(changedId, {
        state: "ready",
        modelId: "ollama:qwen3.5:2b-q4_K_M",
        digest: `sha256:${"c".repeat(64)}`,
      }),
      false,
      "Ready must fence configuration under the same database lock",
    );
    const notAcknowledgedId = randomUUID();
    assert.equal(
      (await store.requestStop(notAcknowledgedId))?.state,
      "interrupted",
      "explicit stop must consume an unacknowledged identity before a delayed start can arrive",
    );
    await assert.rejects(
      store.reserve({
        ...input,
        requestId: notAcknowledgedId,
        expectedRevision: 2,
      }),
      (error: { code?: string }) => error.code === "REQUEST_CONFLICT",
    );
  } finally {
    await closeDatabase();
  }
});
