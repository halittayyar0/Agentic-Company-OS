import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { closeDatabase } from "@workspace/db";
import {
  configureOllama,
  type getFullModelCatalog,
} from "@workspace/ai-server";
import { createSettingsRouter } from "./settings";
import {
  readRuntimeConfigSnapshot,
  writeRuntimeConfigSnapshot,
} from "../lib/runtime-config";

test("Settings saves private local-model addresses with revision fencing and no inference", async () => {
  const originalCwd = process.cwd();
  const directory = await mkdtemp(path.join(tmpdir(), "acos-ollama-settings-"));
  process.chdir(directory);
  let inferenceCalls = 0;
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createSettingsRouter({
      environment: { OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1" },
      readState: async () => ({
        ...(await readRuntimeConfigSnapshot()),
        storage: "local-file" as const,
      }),
      writeState: writeRuntimeConfigSnapshot,
      refreshCatalog: async () => undefined,
      catalog: () =>
        ({ providers: [], models: [], liveSyncedAt: null }) as ReturnType<
          typeof getFullModelCatalog
        >,
      complete: async () => {
        inferenceCalls++;
        throw new Error("Unrequested inference");
      },
      wakeProviderTasks: async () => 0,
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const request = async (body?: unknown) => {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/settings/llm`,
      {
        method: body === undefined ? "GET" : "PUT",
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    return {
      status: response.status,
      data: (await response.json()) as {
        revision?: number;
        code?: string;
        ollama: {
          baseUrl: string | null;
          addressSource: "runtime" | "environment" | "none";
          hasAddressInEnv: boolean;
        };
      },
    };
  };
  try {
    const saved = await request({
      ollamaBaseUrl: "http://192.168.1.2:11434/",
      expectedRevision: 0,
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.revision, 1);
    const connected = await request();
    assert.equal(connected.data.ollama.baseUrl, "http://192.168.1.2:11434/v1");
    assert.equal(connected.data.ollama.addressSource, "runtime");
    assert.equal(connected.data.ollama.hasAddressInEnv, true);
    for (const unsafe of [
      "https://public.example",
      "http://169.254.169.254",
      "http://user:secret@127.0.0.1",
      "http://127.0.0.1?token=secret",
    ]) {
      const result = await request({
        ollamaBaseUrl: unsafe,
        expectedRevision: 1,
      });
      assert.equal(result.status, 400);
      assert.equal(result.data.code, "LLM_SETTINGS_INVALID");
    }
    assert.equal((await readRuntimeConfigSnapshot()).revision, 1);
    assert.equal(
      (await request({ ollamaBaseUrl: null, expectedRevision: 0 })).status,
      409,
    );
    assert.equal(
      (await request({ ollamaBaseUrl: null, expectedRevision: 1 })).status,
      200,
    );
    const fallback = await request();
    assert.equal(fallback.data.ollama.baseUrl, "http://127.0.0.1:11434/v1");
    assert.equal(fallback.data.ollama.addressSource, "environment");
    assert.equal(inferenceCalls, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    configureOllama({ baseUrl: null });
    await closeDatabase();
    process.chdir(originalCwd);
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
