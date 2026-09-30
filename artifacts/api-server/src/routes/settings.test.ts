import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, rmdir, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import {
  db,
  dbReady,
  closeDatabase,
  runtimeControlsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { createSettingsRouter, maskKey } from "./settings";
import {
  readRuntimeConfigSnapshot,
  writeRuntimeConfigSnapshot,
} from "../lib/runtime-config";
import type {
  createChatCompletion,
  getFullModelCatalog,
} from "@workspace/ai-server";

test("credential previews cannot disclose short secrets", () => {
  for (let length = 1; length <= 12; length++)
    assert.equal(maskKey("s".repeat(length)), "*".repeat(length));
  assert.equal(maskKey("test-prefix-secret-suffix"), "test********ffix");
  assert.equal(maskKey(null), null);
});

test("settings saves fence old revisions, preserve unknown commits and keep connection tests explicit and redacted", async (t) => {
  const originalCwd = process.cwd();
  const directory = await mkdtemp(path.join(tmpdir(), "acos-settings-"));
  process.chdir(directory);
  await dbReady;
  let refreshFails = false;
  let mode: "good" | "empty" | "failure" | "change" = "good";
  let calls = 0;
  let wakeCalls = 0;
  const catalog: ReturnType<typeof getFullModelCatalog> = {
    providers: [{ id: "openai", label: "OpenAI", available: true }],
    liveSyncedAt: null,
    models: [
      {
        id: "openai:gpt-5.6-terra",
        provider: "openai",
        label: "Terra",
        description: "Original description",
        tier: "standard",
        supportsTools: true,
        isDefault: true,
      },
    ],
  };
  const dependencies = {
    environment: { OPENAI_API_KEY: "test-environment-key" },
    readState: async () => ({
      ...(await readRuntimeConfigSnapshot()),
      storage: "local-file" as const,
    }),
    writeState: writeRuntimeConfigSnapshot,
    wakeProviderTasks: async () => {
      wakeCalls++;
      return 0;
    },
    refreshCatalog: async () => {
      if (refreshFails) throw new Error("credential-bearing upstream details");
    },
    catalog: () => catalog,
    complete: (async (params) => {
      calls++;
      assert.equal(params.disableRetries, true);
      assert.equal(params.maxTokens, 10);
      assert.ok(params.signal);
      if (mode === "failure")
        throw new Error("test-secret-must-not-be-returned");
      if (mode === "change")
        await writeRuntimeConfigSnapshot({
          openaiApiKey: "changed-during-test",
        });
      return {
        provider: "openai",
        completion: {
          choices: [
            {
              message: {
                content:
                  mode === "empty" ? "" : "test-secret-must-not-be-returned",
              },
            },
          ],
        },
      } as Awaited<ReturnType<typeof createChatCompletion>>;
    }) satisfies typeof createChatCompletion,
  };
  const app = express();
  app.use(express.json());
  app.use("/api", createSettingsRouter(dependencies));
  app.use("/other", createSettingsRouter(dependencies));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db
      .update(runtimeControlsTable)
      .set({ emergencyStopEnabled: false })
      .where(eq(runtimeControlsTable.id, 1));
    await closeDatabase();
    process.chdir(originalCwd);
    await rm(path.join(directory, "data/runtime-config.json"), { force: true });
    await rmdir(path.join(directory, "data"));
    await rmdir(directory);
  });
  const request = async (url: string, method = "GET", body?: unknown) => {
    const response = await fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      data: (await response.json()) as Record<string, any>,
    };
  };
  const initial = await request("/api/settings/llm");
  assert.equal(initial.data.revision, 0);
  assert.equal(initial.data.openai.keySource, "environment");
  assert.equal(initial.data.openrouter.configured, false);
  assert.equal(
    JSON.stringify(initial.data).includes("test-environment-key"),
    false,
  );
  refreshFails = true;
  const unreadable = await request("/api/settings/llm");
  assert.equal(unreadable.status, 503);
  assert.equal(unreadable.data.code, "LLM_SETTINGS_UNAVAILABLE");
  assert.equal(
    JSON.stringify(unreadable.data).includes("credential-bearing"),
    false,
  );
  refreshFails = false;
  const first = await request("/api/settings/llm", "PUT", {
    openaiApiKey: "12345678901",
    expectedRevision: 0,
  });
  assert.equal(first.status, 200);
  assert.equal(first.data.revision, 1);
  assert.equal(wakeCalls, 1);
  const stored = await request("/api/settings/llm");
  assert.equal(stored.data.openai.keyPreview, "***********");
  assert.equal(stored.data.openai.keySource, "runtime");
  const racing = await Promise.all([
    request("/api/settings/llm", "PUT", {
      openaiApiKey: "newer-secret",
      expectedRevision: 1,
    }),
    request("/api/settings/llm", "PUT", {
      openrouterApiKey: "other-secret",
      expectedRevision: 1,
    }),
  ]);
  assert.deepEqual(racing.map((result) => result.status).sort(), [200, 409]);
  assert.equal(wakeCalls, 2);
  assert.equal((await readRuntimeConfigSnapshot()).revision, 2);
  for (const patch of [
    {},
    { openaiApiKey: "x", baseUrl: "https://untrusted.invalid" },
    { openaiApiKey: "x", expectedRevision: -1 },
  ])
    assert.equal(
      (await request("/api/settings/llm", "PUT", patch)).status,
      400,
    );
  refreshFails = true;
  const unknown = await request("/api/settings/llm", "PUT", {
    openaiApiKey: "saved-before-response-failed",
    expectedRevision: 2,
  });
  assert.equal(unknown.status, 503);
  assert.equal(unknown.data.code, "LLM_SETTINGS_UNCONFIRMED");
  assert.equal(wakeCalls, 2);
  assert.equal((await readRuntimeConfigSnapshot()).revision, 3);
  refreshFails = false;
  const removed = await request("/api/settings/llm", "PUT", {
    openaiApiKey: null,
    expectedRevision: 3,
  });
  assert.equal(removed.data.revision, 4);
  assert.equal(wakeCalls, 3);
  const fallback = await request("/api/settings/llm");
  assert.equal(fallback.data.openai.configured, true);
  assert.equal(fallback.data.openai.keySource, "environment");
  assert.equal(
    JSON.parse(
      await readFile(path.join(directory, "data/runtime-config.json"), "utf8"),
    )._revision,
    4,
  );

  assert.equal(
    (await request("/api/settings/llm/test", "POST", {})).status,
    400,
  );
  assert.equal(
    (
      await request("/api/settings/llm/test", "POST", {
        model: "not-in-catalog",
      })
    ).status,
    400,
  );
  const body = { model: catalog.models[0].id, expectedRevision: 4 };
  const good = await request("/api/settings/llm/test", "POST", body);
  assert.equal(good.status, 200);
  assert.equal(good.data.sample, "");
  assert.equal(good.data.revision, 4);
  mode = "empty";
  assert.equal(
    (await request("/api/settings/llm/test", "POST", body)).data.code,
    "LLM_TEST_EMPTY_RESPONSE",
  );
  mode = "failure";
  const failure = await request("/api/settings/llm/test", "POST", body);
  assert.equal(failure.status, 502);
  assert.equal(JSON.stringify(failure.data).includes("test-secret"), false);
  await db
    .update(runtimeControlsTable)
    .set({ emergencyStopEnabled: true })
    .where(eq(runtimeControlsTable.id, 1));
  assert.equal(
    (await request("/api/settings/llm/test", "POST", body)).status,
    423,
  );
  assert.equal(calls, 3);
  assert.equal(
    (await request("/api/settings/llm/test", "POST", body)).status,
    429,
  );
  await db
    .update(runtimeControlsTable)
    .set({ emergencyStopEnabled: false })
    .where(eq(runtimeControlsTable.id, 1));
  assert.equal(
    (
      await request("/other/settings/llm/test", "POST", {
        ...body,
        expectedRevision: 0,
      })
    ).status,
    409,
  );
  assert.equal(calls, 3);
  mode = "change";
  assert.equal(
    (await request("/other/settings/llm/test", "POST", body)).data.code,
    "LLM_TEST_STALE",
  );
});
