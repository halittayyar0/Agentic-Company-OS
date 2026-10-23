import assert from "node:assert/strict";
import test from "node:test";
import { createOllamaPreparationTransport } from "./ollama-preparation-transport";

test("preparation transport only pulls the curated local model to a private validated server", async () => {
  const path = "./ollama-preparation-transport.js";
  const module = await import(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return null;
    throw error;
  });
  assert.ok(module, "private preparation transport must exist");
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    if (url.endsWith("/api/version"))
      return Response.json({ version: "0.40.3" });
    if (url.endsWith("/api/tags")) return Response.json({ models: [] });
    assert.ok(url.endsWith("/api/pull"));
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model: "qwen3.5:2b-q4_K_M",
      stream: true,
      insecure: false,
    });
    return new Response('{"status":"success"}\n', {
      headers: { "content-type": "application/x-ndjson" },
    });
  };
  const transport = module.createOllamaPreparationTransport(fetcher);
  const signal = new AbortController().signal;
  assert.deepEqual(await transport.inspect("http://127.0.0.1:11434", signal), {
    server: "compatible",
    available: false,
    modelId: null,
    digest: null,
  });
  const body = await transport.pull("http://127.0.0.1:11434", signal);
  assert.ok(body);
  await body.cancel();
  const count = calls.length;
  for (const url of [
    "https://example.com",
    "http://169.254.169.254",
    "http://user:secret@localhost:11434",
    "http://localhost:11434/path",
  ]) {
    await assert.rejects(transport.pull(url, signal));
  }
  assert.equal(calls.length, count, "invalid addresses must make no request");
  assert.equal(
    calls.some((url) => /generate|chat|delete/.test(url)),
    false,
  );
});

test("metadata admission rejects cloud, conflicting tags, unknown tools, runtime requirements and digests", async (t) => {
  for (const mode of [
    "local",
    "cloud",
    "conflicting-name",
    "duplicate",
    "no-tools",
    "new-runtime",
    "bad-digest",
    "old-server",
    "invalid-server",
    "oversized",
  ] as const) {
    await t.test(mode, async () => {
      const calls: string[] = [];
      const fetcher: typeof fetch = async (input, init) => {
        const url = String(input);
        calls.push(url);
        assert.equal(init?.redirect, "error");
        if (url.endsWith("/api/version"))
          return Response.json({
            version:
              mode === "old-server"
                ? "0.39.0"
                : mode === "invalid-server"
                  ? "PRIVATE_SENTINEL"
                  : "0.40.3",
          });
        const row = {
          name:
            mode === "conflicting-name" ? "other:latest" : "qwen3.5:2b-q4_K_M",
          model: "qwen3.5:2b-q4_K_M",
          digest: mode === "bad-digest" ? "PRIVATE_SENTINEL" : "a".repeat(64),
          ...(mode === "cloud"
            ? { remote_host: "https://ollama.com", remote_model: "qwen3.5:2b" }
            : {}),
        };
        if (url.endsWith("/api/tags"))
          return mode === "oversized"
            ? new Response(" ".repeat(1024 * 1024 + 1))
            : Response.json({
                models: mode === "duplicate" ? [row, row] : [row],
              });
        assert.ok(url.endsWith("/api/show"));
        assert.deepEqual(JSON.parse(String(init?.body)), {
          model: "qwen3.5:2b-q4_K_M:local",
          verbose: false,
        });
        return Response.json({
          capabilities:
            mode === "no-tools" ? ["completion"] : ["completion", "tools"],
          requires: mode === "new-runtime" ? "0.40.4" : "0.40.3",
        });
      };
      const result = await createOllamaPreparationTransport(fetcher).inspect(
        "http://127.0.0.1:11434",
        new AbortController().signal,
      );
      assert.equal(result.available, mode === "local");
      if (mode === "old-server") assert.equal(result.server, "update_required");
      if (mode === "local")
        assert.equal(result.digest, `sha256:${"a".repeat(64)}`);
      else {
        assert.equal(result.modelId, null);
        assert.equal(result.digest, null);
      }
      assert.equal(
        calls.some((url) => /pull|generate|chat|delete/.test(url)),
        false,
      );
      assert.equal(JSON.stringify(result).includes("PRIVATE_SENTINEL"), false);
    });
  }
});

test("failed pulls cancel the body, redact errors and never retry", async () => {
  for (const status of [200, 403, 500]) {
    let calls = 0;
    let cancelled = false;
    const fetcher: typeof fetch = async () => {
      calls++;
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status, headers: { "content-type": "text/html" } },
      );
    };
    const transport = createOllamaPreparationTransport(fetcher);
    await assert.rejects(
      transport.pull("http://127.0.0.1:11434", new AbortController().signal),
      (error: unknown) =>
        error instanceof Error && error.message === "DISPATCH_FAILED",
    );
    assert.equal(calls, 1);
    assert.equal(cancelled, true);
  }
  let calls = 0;
  const transport = createOllamaPreparationTransport(async () => {
    calls++;
    throw new Error("PRIVATE_SENTINEL");
  });
  await assert.rejects(
    transport.pull("http://127.0.0.1:11434", new AbortController().signal),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "DISPATCH_FAILED" &&
      !("cause" in error),
  );
  assert.equal(calls, 1);
});
