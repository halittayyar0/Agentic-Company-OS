import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  db,
  dbReady,
  closeDatabase,
  localModelPreparationsTable,
  tasksTable,
  usageEventsTable,
  runtimeInstancesTable,
} from "@workspace/db";
import { createOllamaPreparationStore } from "./ollama-preparation-store";

test("operator preparation dispatches once, rechecks local admission, preserves task data and stops without replay", async (t) => {
  await dbReady;
  try {
    const path = "./ollama-model-preparation.js";
    const module = await import(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ERR_MODULE_NOT_FOUND") return null;
      throw error;
    });
    assert.ok(module, "operator model preparation service must exist");
    const runtimeId = "owned-preparation-service";
    await db.insert(runtimeInstancesTable).values({
      id: runtimeId,
      role: "api",
      hostname: "owned-test",
      processId: process.pid,
      buildVersion: "test",
      state: "healthy",
    });
    const beforeTasks = await db.select().from(tasksTable);
    const beforeUsage = await db.select().from(usageEventsTable);
    for (const mode of [
      "success",
      "stop",
      "stop-before-dispatch",
      "stop-before-ready",
      "shutdown",
      "changed-before",
      "changed-after",
      "incomplete",
      "already-available",
      "unverified",
    ] as const) {
      await t.test(mode, async () => {
        await db.delete(localModelPreparationsTable);
        const store = createOllamaPreparationStore({
          runtimeId,
          epoch: randomUUID(),
        });
        if (mode === "stop-before-dispatch") {
          const dispatch = store.markDispatched;
          store.markDispatched = async (id: string) => {
            await store.requestStop(id);
            return dispatch(id);
          };
        }
        if (mode === "stop-before-ready") {
          const finish = store.finish;
          store.finish = async (id, outcome) => {
            if (outcome.state === "ready") await store.requestStop(id);
            return finish(id, outcome);
          };
        }
        let revision = 1;
        let pulls = 0;
        let cancelled = 0;
        const service = module.createOllamaModelPreparation({
          store,
          readState: async () => ({
            revision,
            config: { ollamaBaseUrl: "http://127.0.0.1:11434" },
          }),
          transport: {
            inspect: async () => {
              if (mode === "changed-before") revision = 2;
              if (mode === "changed-after" && pulls) revision = 2;
              const available =
                mode === "already-available" ||
                (pulls > 0 && mode !== "unverified");
              return {
                server: "compatible",
                available,
                modelId: available ? "ollama:qwen3.5:2b-q4_K_M" : null,
                digest: available ? `sha256:${"d".repeat(64)}` : null,
              };
            },
            pull: async (_address: string, signal: AbortSignal) => {
              pulls++;
              return new ReadableStream<Uint8Array>({
                start(controller) {
                  if (mode === "stop" || mode === "shutdown") {
                    signal.addEventListener(
                      "abort",
                      () => {
                        cancelled++;
                        controller.error(new Error("PRIVATE_SENTINEL"));
                      },
                      { once: true },
                    );
                    controller.enqueue(
                      new TextEncoder().encode(
                        '{"status":"pulling manifest"}\n',
                      ),
                    );
                  } else {
                    controller.enqueue(
                      new TextEncoder().encode(
                        mode === "incomplete"
                          ? '{"status":"pulling manifest"}\n'
                          : '{"status":"success"}\n',
                      ),
                    );
                    controller.close();
                  }
                },
              });
            },
          },
          refreshCatalog: async () => {},
        });
        const input = {
          requestId: randomUUID(),
          expectedRevision: 1,
          modelId: "qwen35-2b",
        };
        try {
          const starts = await Promise.all([
            service.start(input),
            service.start(input),
          ]);
          assert.equal(starts[0].requestId, starts[1].requestId);
          if (mode === "stop" || mode === "shutdown") {
            for (let attempt = 0; pulls === 0 && attempt < 100; attempt++)
              await delay(10);
            assert.equal(pulls, 1);
            if (mode === "stop") await service.stop(input.requestId);
            else await service.close();
          }
          let receipt;
          for (let attempt = 0; attempt < 200; attempt++) {
            receipt = await service.snapshot(input.requestId);
            if (
              receipt &&
              ["ready", "failed", "interrupted"].includes(receipt.state)
            )
              break;
            await delay(10);
          }
          assert.ok(receipt);
          const expected =
            mode === "success" || mode === "already-available"
              ? "ready"
              : mode === "stop" ||
                  mode === "shutdown" ||
                  mode.startsWith("stop-before")
                ? "interrupted"
                : "failed";
          assert.equal(receipt.state, expected);
          assert.equal(
            pulls,
            mode === "already-available" ||
              mode === "changed-before" ||
              mode === "stop-before-dispatch"
              ? 0
              : 1,
          );
          if (mode === "stop" || mode === "shutdown")
            assert.equal(cancelled, 1);
          if (mode.startsWith("changed"))
            assert.equal(receipt.failureCode, "CONFIG_CHANGED");
          if (mode === "incomplete")
            assert.equal(receipt.failureCode, "INCOMPLETE_PROGRESS");
          if (mode === "unverified")
            assert.equal(receipt.failureCode, "MODEL_UNVERIFIED");
          const serial = JSON.stringify(receipt);
          assert.equal(
            /PRIVATE_SENTINEL|127\.0\.0\.1|ownerEpoch|requestHash/.test(serial),
            false,
          );
          if (mode !== "shutdown") await service.start(input);
          assert.equal(
            pulls,
            mode === "already-available" ||
              mode === "changed-before" ||
              mode === "stop-before-dispatch"
              ? 0
              : 1,
            "terminal replay must not send a second request",
          );
        } finally {
          await service.close();
        }
      });
    }
    assert.deepEqual(await db.select().from(tasksTable), beforeTasks);
    assert.deepEqual(await db.select().from(usageEventsTable), beforeUsage);
  } finally {
    await closeDatabase();
  }
});
