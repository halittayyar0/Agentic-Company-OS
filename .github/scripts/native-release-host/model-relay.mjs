import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, writeFile, realpath, lstat } from "node:fs/promises";
import path from "node:path";

const model = "qwen3.5:2b-q4_K_M";
const hash = (value) => createHash("sha256").update(value).digest("hex");
async function bounded(source, limit) {
  const chunks = [];
  let size = 0;
  assert.ok(source, "model_response_body_required");
  for await (const part of source) {
    size += part.length;
    assert.ok(size <= limit, "bounded_model_payload_required");
    chunks.push(Buffer.from(part));
  }
  return Buffer.concat(chunks);
}

/** Transparent owned loopback transport; never dispatches or retries work. */
export async function createPrivateModelRelay({
  upstream,
  root,
  maxCalls = 12,
}) {
  const origin = new URL(upstream);
  assert.ok(
    origin.protocol === "http:" &&
      ["127.0.0.1", "[::1]"].includes(origin.hostname) &&
      origin.pathname === "/" &&
      !origin.search &&
      !origin.hash &&
      !origin.username &&
      !origin.password,
    "owned_model_origin_required",
  );
  assert.ok(
    Number.isSafeInteger(maxCalls) && maxCalls > 0 && maxCalls <= 12,
    "unchanged_model_call_cap_required",
  );
  assert.ok(path.isAbsolute(root));
  assert.equal((await lstat(root)).isSymbolicLink(), false);
  const directory = await realpath(root);
  assert.ok((await lstat(directory)).isDirectory());
  const cases = new Map(),
    pending = new Set(),
    controllers = new Set();
  let current = null,
    failures = 0,
    endpoint = "",
    closing = null,
    closed = false;
  const handle = async (request, response) => {
    const controller = new AbortController();
    controllers.add(controller);
    response.once("close", () => controller.abort());
    try {
      const allowed = new Map([
        ["/api/version", "GET"],
        ["/api/tags", "GET"],
        ["/api/show", "POST"],
        ["/v1/chat/completions", "POST"],
      ]);
      assert.equal(
        request.method,
        allowed.get(request.url),
        "owned_model_route_required",
      );
      const body = await bounded(request, 1048576);
      const inference = request.url === "/v1/chat/completions";
      let row;
      if (inference) {
        assert.ok(current && !closed, "admitted_genuine_case_required");
        assert.equal(
          JSON.parse(body.toString()).model,
          model + ":local",
          "explicit_local_selector_required",
        );
        assert.ok(
          current.rows.length < maxCalls,
          "genuine_model_call_cap_exceeded",
        );
        const index = current.rows.length + 1,
          name = current.name;
        row = {
          index,
          requestFile: path.join(
            directory,
            name + "-" + index + "-request.json",
          ),
          responseFile: path.join(
            directory,
            name + "-" + index + "-response.json",
          ),
          requestSha256: hash(body),
          responseSha256: null,
          status: null,
        };
        current.rows.push(row);
        await writeFile(row.requestFile, body, { flag: "wx", mode: 0o600 });
      }
      const upstreamResponse = await fetch(origin.origin + request.url, {
        method: request.method,
        headers: { "content-type": "application/json" },
        ...(body.length ? { body } : {}),
        redirect: "error",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(inference ? 240000 : 15000),
        ]),
      });
      const bytes = await bounded(upstreamResponse.body, 4194304);
      if (row) {
        await writeFile(row.responseFile, bytes, { flag: "wx", mode: 0o600 });
        row.responseSha256 = hash(bytes);
        row.status = upstreamResponse.status;
      }
      response.statusCode = upstreamResponse.status;
      response.setHeader(
        "content-type",
        upstreamResponse.headers.get("content-type") ?? "application/json",
      );
      response.end(bytes);
    } catch {
      failures++;
      if (response.headersSent) response.destroy();
      else {
        response.statusCode = 502;
        response.end("{}");
      }
    } finally {
      controllers.delete(controller);
    }
  };
  const server = createServer((request, response) => {
    const operation = handle(request, response);
    pending.add(operation);
    operation.then(
      () => pending.delete(operation),
      () => pending.delete(operation),
    );
  });
  const listen = async (port) => {
    assert.ok(Number.isSafeInteger(port) && port >= 0 && port < 65536);
    await new Promise((resolve, reject) => {
      const failed = (error) => reject(error);
      server.once("error", failed);
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", failed);
        resolve();
      });
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    endpoint = "http://127.0.0.1:" + address.port;
  };
  const stopListening = async () => {
    server.closeAllConnections();
    if (server.listening)
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  };
  await listen(0);
  const settled = (phase) => {
    assert.ok(phase && phase.rows.length > 0, "settled_model_capture_required");
    assert.ok(
      phase.rows.every(
        (r) =>
          r.responseSha256 && Number.isSafeInteger(r.status) && r.status > 0,
      ),
      "settled_model_capture_required",
    );
  };
  return {
    get endpoint() {
      return endpoint;
    },
    get failures() {
      return failures;
    },
    beginCase(name) {
      assert.ok(
        !closed && !closing && !current,
        "single_owned_genuine_case_required",
      );
      assert.ok(
        ["fresh", "upgraded"].includes(name) && !cases.has(name),
        "unique_known_genuine_case_required",
      );
      current = { name, rows: [], finished: false };
      cases.set(name, current);
    },
    finishCase() {
      settled(current);
      assert.equal(pending.size, 0, "model_requests_still_running");
      current.finished = true;
      const report = {
        name: current.name,
        calls: current.rows.length,
        captureHashes: current.rows.map((r) => ({
          requestSha256: r.requestSha256,
          responseSha256: r.responseSha256,
          status: r.status,
        })),
      };
      current = null;
      return report;
    },
    async readCaptures(name) {
      const phase = cases.get(name);
      settled(phase);
      assert.equal(phase.finished, true);
      const captures = [];
      for (const row of phase.rows) {
        const request = await readFile(row.requestFile),
          response = await readFile(row.responseFile);
        assert.equal(hash(request), row.requestSha256);
        assert.equal(hash(response), row.responseSha256);
        captures.push({
          status: row.status,
          request: JSON.parse(request.toString()),
          response: JSON.parse(response.toString()),
        });
      }
      return captures;
    },
    async rebind(port) {
      assert.ok(!current && !closed && !closing);
      assert.equal(pending.size, 0);
      assert.equal(controllers.size, 0);
      await stopListening();
      await listen(port);
    },
    async close() {
      if (closing) return closing;
      closing = (async () => {
        closed = true;
        for (const controller of controllers) controller.abort();
        await stopListening();
        let timer;
        try {
          await Promise.race([
            Promise.allSettled([...pending]),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("owned_relay_cleanup_timeout")),
                15000,
              );
              timer.unref();
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        assert.equal(pending.size, 0);
        assert.equal(controllers.size, 0);
        return { stopped: true, pending: 0 };
      })();
      return closing;
    },
  };
}
