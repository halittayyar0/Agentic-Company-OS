import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import {
  configureOllama,
  getFullModelCatalog,
  refreshOllamaCatalog,
} from "@workspace/ai-server";
import { closeDatabase } from "@workspace/db";
import { ownedOllamaPeer } from "../../../../lib/ai-server/src/testing/ollama-boundary-peer";
import { createSettingsRouter } from "./settings";
import {
  readRuntimeConfigSnapshot,
  writeRuntimeConfigSnapshot,
} from "../lib/runtime-config";

test("HTTP cloud consent binds to the observed revision and private server without inference", async (t) => {
  const cwd = process.cwd();
  const directory = await mkdtemp(path.join(tmpdir(), "acos-ollama-consent-"));
  process.chdir(directory);
  const peer = await ownedOllamaPeer({
    tags: [
      { name: "owned:latest" },
      {
        name: "remote:free",
        remote_host: "https://ollama.com",
        remote_model: "owned-cloud",
      },
      { name: "unknown:latest", remote_host: "https://ollama.com" },
    ],
  });
  const other = await ownedOllamaPeer();
  const unsupported = await ownedOllamaPeer({ version: "0.17.0" });
  const environment = { OLLAMA_BASE_URL: peer.origin };
  configureOllama({ baseUrl: peer.origin });
  let wakeCalls = 0;
  const app = express();
  app.use(express.json());
  app.use(
    createSettingsRouter({
      environment,
      readState: async () => ({
        ...(await readRuntimeConfigSnapshot()),
        storage: "local-file" as const,
      }),
      writeState: (patch, revision) =>
        writeRuntimeConfigSnapshot(patch, revision, environment),
      refreshCatalog: async () => {
        await refreshOllamaCatalog(true);
      },
      catalog: getFullModelCatalog,
      wakeProviderTasks: async () => {
        wakeCalls++;
        return 0;
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const request = async (body?: unknown) => {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/settings/llm`,
      {
        method: body === undefined ? "GET" : "PUT",
        // Each state-changing fixture request owns its socket. A busy build
        // must not turn an idle keep-alive reset into a missing revision step.
        headers: { "content-type": "application/json", connection: "close" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    const data = (await response.json()) as {
      code?: string;
      ollama: {
        cloudEnabled: boolean;
        serverVersion: string | null;
        localEnforcementSupported: boolean;
        localModelCount: number;
        cloudModelCount: number;
        unknownModelCount: number;
      };
    };
    return { status: response.status, data };
  };
  t.after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await peer.close();
    await other.close();
    await unsupported.close();
    configureOllama({ baseUrl: null });
    await closeDatabase();
    process.chdir(cwd);
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  });
  await t.test(
    "public state separates location and server support; cloud is off by default",
    async () => {
      const initial = await request();
      assert.equal(initial.status, 200);
      assert.equal(initial.data.ollama.cloudEnabled, false);
      assert.equal(initial.data.ollama.serverVersion, "0.18.0");
      assert.equal(initial.data.ollama.localEnforcementSupported, true);
      assert.equal(initial.data.ollama.localModelCount, 1);
      assert.equal(initial.data.ollama.cloudModelCount, 1);
      assert.equal(initial.data.ollama.unknownModelCount, 1);
    },
  );
  await t.test(
    "enabling requires exact revision and cannot accept browser-supplied origins",
    async () => {
      assert.equal((await request({ ollamaCloudEnabled: true })).status, 400);
      assert.equal(
        (
          await request({
            ollamaCloudEnabled: true,
            ollamaCloudOrigin: other.origin,
            expectedRevision: 0,
          })
        ).status,
        400,
      );
      assert.equal((await readRuntimeConfigSnapshot()).revision, 0);
      const saved = await request({
        ollamaCloudEnabled: true,
        expectedRevision: 0,
      });
      assert.equal(saved.status, 200);
      assert.equal(
        (await readRuntimeConfigSnapshot()).config.ollamaCloudOrigin,
        peer.origin,
      );
      assert.equal((await request()).data.ollama.cloudEnabled, true);
    },
  );
  await t.test(
    "stale consent and address writers preserve the committed origin",
    async () => {
      const stale = await request({
        ollamaCloudEnabled: false,
        expectedRevision: 0,
      });
      assert.equal(stale.status, 409);
      assert.equal(
        (await readRuntimeConfigSnapshot()).config.ollamaCloudOrigin,
        peer.origin,
      );
    },
  );
  await t.test(
    "changing and restoring addresses revoke consent instead of carrying it",
    async () => {
      const moved = await request({
        ollamaBaseUrl: other.origin,
        expectedRevision: 1,
      });
      assert.equal(moved.status, 200);
      assert.equal(
        (await readRuntimeConfigSnapshot()).config.ollamaCloudOrigin,
        null,
      );
      assert.equal((await request()).data.ollama.cloudEnabled, false);
      const enabled = await request({
        ollamaCloudEnabled: true,
        expectedRevision: 2,
      });
      assert.equal(enabled.status, 200);
      assert.equal(
        (await readRuntimeConfigSnapshot()).config.ollamaCloudOrigin,
        other.origin,
      );
      const restored = await request({
        ollamaBaseUrl: null,
        expectedRevision: 3,
      });
      assert.equal(restored.status, 200);
      assert.equal(
        (await readRuntimeConfigSnapshot()).config.ollamaCloudOrigin,
        null,
      );
      assert.equal((await request()).data.ollama.cloudEnabled, false);
    },
  );
  await t.test(
    "one reviewed save can choose a new origin and separately consent to that exact origin",
    async () => {
      const saved = await request({
        ollamaBaseUrl: other.origin,
        ollamaCloudEnabled: true,
        expectedRevision: 4,
      });
      assert.equal(saved.status, 200);
      assert.equal(
        (await readRuntimeConfigSnapshot()).config.ollamaCloudOrigin,
        other.origin,
      );
      assert.equal((await request()).data.ollama.cloudEnabled, true);
      assert.equal(
        (await request({ ollamaCloudEnabled: false, expectedRevision: 5 }))
          .status,
        200,
      );
      assert.equal(
        (await readRuntimeConfigSnapshot()).config.ollamaCloudOrigin,
        null,
      );
    },
  );
  await t.test(
    "unsupported server metadata never confirms enabling as ready or wakes work",
    async () => {
      const beforeWake = wakeCalls;
      const saved = await request({
        ollamaBaseUrl: unsupported.origin,
        ollamaCloudEnabled: true,
        expectedRevision: 6,
      });
      assert.equal(saved.status, 503);
      assert.equal(saved.data.code, "LLM_SETTINGS_UNCONFIRMED");
      assert.equal((await readRuntimeConfigSnapshot()).revision, 7);
      assert.equal(
        (await request()).data.ollama.localEnforcementSupported,
        false,
      );
      assert.equal(wakeCalls, beforeWake);
    },
  );
  assert.equal(
    peer.completions().length +
      other.completions().length +
      unsupported.completions().length,
    0,
  );
  assert.ok(wakeCalls > 0);
});
