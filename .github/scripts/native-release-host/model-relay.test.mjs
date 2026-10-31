import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createPrivateModelRelay } from "./model-relay.mjs";

const model = "qwen3.5:2b-q4_K_M";
const hash = (value) => createHash("sha256").update(value).digest("hex");
async function fixture(t, handler, maxCalls = 12) {
  const parent = await realpath(tmpdir()),
    root = await mkdtemp(path.join(parent, "acos-relay-unit-"));
  const upstream = createServer(handler);
  await new Promise((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", resolve);
  });
  const relay = await createPrivateModelRelay({
    upstream: "http://127.0.0.1:" + upstream.address().port,
    root,
    maxCalls,
  });
  t.after(async () => {
    await relay.close();
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
    const checked = await realpath(root);
    assert.equal(path.dirname(checked), parent);
    assert.ok(path.basename(checked).startsWith("acos-relay-unit-"));
    await rm(checked, { recursive: true });
  });
  return { root, relay };
}

test("loopback unit relay preserves raw payload/status and excludes authorization from its upstream", async (t) => {
  let received, authorization;
  const reply = Buffer.from('{"unitFixture":true,"text":"73 日本語"}');
  const { root, relay } = await fixture(t, async (req, res) => {
    authorization = req.headers.authorization;
    const parts = [];
    for await (const part of req) parts.push(part);
    received = Buffer.concat(parts);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(reply);
  });
  relay.beginCase("fresh");
  const request = Buffer.from(
    JSON.stringify({
      model: model + ":local",
      messages: [{ role: "user", content: "Unit fixture only" }],
      outputFile: "../must-not-create",
    }),
  );
  const response = await fetch(relay.endpoint + "/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: "Bearer synthetic-unit-value",
      "content-type": "application/json",
    },
    body: request,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), reply);
  const receipt = relay.finishCase();
  assert.equal(receipt.calls, 1);
  assert.equal(receipt.captureHashes[0].requestSha256, hash(request));
  assert.equal(receipt.captureHashes[0].responseSha256, hash(reply));
  assert.deepEqual(received, request);
  assert.equal(authorization, undefined);
  assert.deepEqual((await readdir(root)).sort(), [
    "fresh-1-request.json",
    "fresh-1-response.json",
  ]);
  const captures = await relay.readCaptures("fresh");
  assert.equal(captures[0].status, 200);
  assert.deepEqual(captures[0].response, JSON.parse(reply));
  await readFile(path.join(root, "fresh-1-request.json"));
});

test("unit relay refuses inference outside its case, cloud selectors and calls above the unchanged cap", async (t) => {
  let requests = 0;
  const { relay } = await fixture(
    t,
    async (req, res) => {
      requests++;
      for await (const part of req) {
      }
      res.end("{}");
    },
    2,
  );
  const send = async (selected = model + ":local") => {
    const response = await fetch(relay.endpoint + "/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: selected }),
    });
    await response.arrayBuffer();
    return response.status;
  };
  assert.equal(await send(), 502);
  assert.equal(requests, 0);
  assert.throws(() => relay.beginCase("../escape"));
  relay.beginCase("fresh");
  assert.equal(await send(model + ":cloud"), 502);
  assert.equal(requests, 0);
  assert.equal(await send(), 200);
  assert.equal(await send(), 200);
  assert.equal(await send(), 502);
  assert.equal(requests, 2);
  assert.equal(relay.finishCase().calls, 2);
  assert.equal(relay.failures, 3);
  assert.throws(() => relay.beginCase("fresh"));
});

test("unit upstream transport loss is retained as one failed inference and never replayed", async (t) => {
  let requests = 0;
  const { relay } = await fixture(t, async (req, res) => {
    requests++;
    for await (const part of req) {
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.write("{");
    res.socket.destroy();
  });
  relay.beginCase("upgraded");
  const outcome = await fetch(relay.endpoint + "/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: model + ":local" }),
  }).then(
    async (r) => {
      await r.arrayBuffer();
      return r.status;
    },
    () => null,
  );
  assert.ok(outcome === null || outcome === 502);
  assert.equal(requests, 1);
  assert.equal(relay.failures, 1);
  assert.throws(() => relay.finishCase(), /settled_model_capture_required/);
});
