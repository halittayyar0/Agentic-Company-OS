import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createPreparationSmokePeer } from "./local-model-preparation-smoke";

test("controlled preparation begins missing, streams a gated pull and exposes local metadata only after success", async () => {
  assert.equal(typeof createPreparationSmokePeer, "function");
  const peer = createPreparationSmokePeer();
  const server = createServer(async (req, res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    const body = parts.length
      ? JSON.parse(Buffer.concat(parts).toString())
      : {};
    assert.ok(req.method && req.url);
    assert.equal(peer.handle(req.method, req.url, body, res), true);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}`;
  try {
    assert.deepEqual(
      (
        (await (await fetch(endpoint + "/api/tags")).json()) as {
          models: unknown[];
        }
      ).models,
      [],
    );
    const response = await fetch(endpoint + "/api/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: peer.model,
        stream: true,
        insecure: false,
      }),
    });
    assert.equal(peer.pulls, 1);
    assert.equal(peer.available, false);
    assert.equal(response.headers.get("content-type"), "application/x-ndjson");
    peer.finish();
    const frames = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(frames.at(-1).status, "success");
    assert.equal(peer.available, true);
    assert.equal(
      (
        (await (await fetch(endpoint + "/api/tags")).json()) as {
          models: { name: string }[];
        }
      ).models[0].name,
      peer.model,
    );
    peer.reset();
    assert.equal(
      peer.available,
      false,
      "a historical ready receipt cannot substitute for current model files",
    );
    const controller = new AbortController();
    const cancelled = await fetch(endpoint + "/api/pull", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: peer.model,
        stream: true,
        insecure: false,
      }),
    });
    controller.abort();
    await cancelled.body?.cancel().catch(() => undefined);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      peer.available,
      false,
      "interrupted transfers never make the fixture ready",
    );
    assert.equal(peer.pulls, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
