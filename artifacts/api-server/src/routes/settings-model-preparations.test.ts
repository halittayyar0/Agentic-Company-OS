import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { dbReady, closeDatabase } from "@workspace/db";
import { createOperatorAuth } from "../lib/operator-auth";
import { OllamaPreparationConflict } from "../lib/ollama-preparation-store";

test("preparation routes require operator authentication, narrow inputs and explicit start/stop", async () => {
  await dbReady;
  try {
    const path = "./settings-model-preparations.js";
    const module = await import(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ERR_MODULE_NOT_FOUND") return null;
      throw error;
    });
    assert.ok(module, "authenticated preparation routes must exist");
    const requestId = randomUUID();
    let starts = 0;
    let stops = 0;
    let conflict = false;
    const token = "owned-route-token-not-a-real-credential-000";
    const app = express();
    app.use(express.json());
    app.use(
      createOperatorAuth({ token, secureCookies: false }).requireAuthentication,
    );
    app.use(
      module.createSettingsModelPreparationsRouter(() => ({
        snapshot: async (id?: string) =>
          id
            ? id === requestId
              ? { requestId, state: "requested" }
              : null
            : { revision: 1, preparation: null },
        start: async (input: { requestId: string }) => {
          starts++;
          if (conflict) throw new OllamaPreparationConflict("REQUEST_CONFLICT");
          return { requestId: input.requestId, state: "requested" };
        },
        stop: async (id: string) => {
          stops++;
          return id === requestId ? { requestId, state: "interrupted" } : null;
        },
      })),
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/settings/ollama/preparations`;
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    const input = { requestId, expectedRevision: 1, modelId: "qwen35-2b" };
    try {
      for (const [url, method] of [
        [base, "GET"],
        [base, "POST"],
        [`${base}/${requestId}`, "GET"],
        [`${base}/${requestId}/stop`, "POST"],
      ]) {
        assert.equal((await fetch(url, { method })).status, 401);
      }
      assert.equal(starts, 0);
      assert.equal(stops, 0);
      const get = await fetch(base, { headers });
      assert.equal(get.status, 200);
      assert.equal(get.headers.get("cache-control"), "no-store");
      assert.equal(starts, 0, "metadata reads cannot start preparation");
      for (const body of [
        { ...input, modelId: "anything-cloud" },
        { ...input, expectedRevision: -1 },
        { ...input, requestId: "wrong" },
        { ...input, url: "http://example.com" },
      ]) {
        assert.equal(
          (
            await fetch(base, {
              method: "POST",
              headers,
              body: JSON.stringify(body),
            })
          ).status,
          400,
        );
      }
      assert.equal(starts, 0);
      assert.equal(
        (
          await fetch(base, {
            method: "POST",
            headers,
            body: JSON.stringify(input),
          })
        ).status,
        202,
      );
      conflict = true;
      const changed = await fetch(base, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      });
      assert.equal(changed.status, 409);
      assert.deepEqual(await changed.json(), { code: "REQUEST_CONFLICT" });
      assert.equal(
        (
          await fetch(base, {
            method: "POST",
            headers,
            body: JSON.stringify(input),
          })
        ).status,
        429,
      );
      assert.equal(starts, 2, "the seventh start is rejected before dispatch");
      assert.equal((await fetch(`${base}/invalid`, { headers })).status, 400);
      assert.equal(
        (await fetch(`${base}/${randomUUID()}`, { headers })).status,
        404,
      );
      assert.equal(
        (
          await fetch(`${base}/${requestId}/stop`, {
            method: "POST",
            headers,
            body: "[]",
          })
        ).status,
        400,
      );
      assert.equal(
        (await fetch(`${base}/${requestId}/stop`, { method: "POST", headers }))
          .status,
        200,
      );
      assert.equal(stops, 1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  } finally {
    await closeDatabase();
  }
});
