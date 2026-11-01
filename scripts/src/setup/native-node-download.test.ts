import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pins = JSON.parse(
  await readFile(
    new URL("../../../deploy/native-runtimes.json", import.meta.url),
    "utf8",
  ),
);
const target = "darwin-x64";
const pin = pins.targets[target].node;
const downloader = async () =>
  (
    await import(
      new URL("../../native-runtime-download.mjs", import.meta.url).href
    )
  ).fetchPinnedNodeArchive;
const transportFailure = (code?: string) =>
  new TypeError("fetch failed", {
    cause: Object.assign(
      new Error("synthetic transport failure"),
      code ? { code } : {},
    ),
  });

test("native Node archive recovers connect timeouts before the response without changing the request", async () => {
  const fetchArchive = await downloader();
  const controller = new AbortController();
  const waits: number[] = [];
  const timeouts: number[] = [];
  const response = new Response("pinned archive body");
  let attempts = 0;
  const result = await fetchArchive(target, pin, {
    timeoutSignal: (ms: number) => {
      timeouts.push(ms);
      return controller.signal;
    },
    wait: async (ms: number, signal: AbortSignal) => {
      assert.equal(signal, controller.signal);
      waits.push(ms);
    },
    fetchImpl: async (url: string, options: RequestInit) => {
      assert.equal(url, pin.url);
      assert.deepEqual(Object.keys(options).sort(), ["redirect", "signal"]);
      assert.equal(options.redirect, "error");
      assert.equal(options.signal, controller.signal);
      if (++attempts < 3) throw transportFailure("UND_ERR_CONNECT_TIMEOUT");
      return response;
    },
  });
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [250, 500]);
  assert.deepEqual(timeouts, [120_000]);
  assert.equal(result, response);
  assert.equal(response.bodyUsed, false);
  assert.equal(await response.text(), "pinned archive body");
});

test("native Node archive transport exhaustion stops after three attempts", async () => {
  const fetchArchive = await downloader();
  for (const code of [
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
    "ECONNRESET",
    "ETIMEDOUT",
    "EAI_AGAIN",
  ]) {
    let attempts = 0;
    const waits: number[] = [];
    await assert.rejects(
      fetchArchive(target, pin, {
        timeoutSignal: () => new AbortController().signal,
        wait: async (ms: number) => {
          waits.push(ms);
        },
        fetchImpl: async () => {
          attempts++;
          throw transportFailure(code);
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /3 attempts/u);
        assert.ok(error.cause instanceof Error);
        assert.equal(error.cause.message, code);
        return true;
      },
    );
    assert.equal(attempts, 3, code);
    assert.deepEqual(waits, [250, 500]);
  }
});

test("native Node archive refuses TLS, permanent DNS, redirect and unclassified failures without retry", async () => {
  const fetchArchive = await downloader();
  for (const code of [
    "CERT_HAS_EXPIRED",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "ENOTFOUND",
    "EACCES",
    "unexpected redirect",
    undefined,
  ]) {
    const failure = transportFailure(code);
    let attempts = 0;
    await assert.rejects(
      fetchArchive(target, pin, {
        timeoutSignal: () => new AbortController().signal,
        wait: async () => {
          assert.fail("Permanent failure must not wait");
        },
        fetchImpl: async () => {
          attempts++;
          throw failure;
        },
      }),
      (error: unknown) => error === failure,
    );
    assert.equal(attempts, 1);
  }
});

test("native Node archive shares one deadline across acquisition and backoff", async () => {
  const fetchArchive = await downloader();
  for (const phase of ["before", "fetch", "backoff"]) {
    const controller = new AbortController();
    const reason = new DOMException("Synthetic total deadline", "TimeoutError");
    let attempts = 0;
    let waits = 0;
    if (phase === "before") controller.abort(reason);
    await assert.rejects(
      fetchArchive(target, pin, {
        timeoutSignal: (ms: number) => {
          assert.equal(ms, 120_000);
          return controller.signal;
        },
        fetchImpl: async (_url: string, options: RequestInit) => {
          assert.equal(options.signal, controller.signal);
          attempts++;
          if (phase === "fetch") controller.abort(reason);
          throw transportFailure("UND_ERR_CONNECT_TIMEOUT");
        },
        wait: async (_ms: number, signal: AbortSignal) => {
          assert.equal(signal, controller.signal);
          waits++;
          controller.abort(reason);
          signal.throwIfAborted();
        },
      }),
      (error: unknown) => error === reason,
    );
    assert.equal(attempts, phase === "before" ? 0 : 1);
    assert.equal(waits, phase === "backoff" ? 1 : 0);
  }
});

test("native Node archive HTTP and body failures never trigger a new request", async () => {
  const fetchArchive = await downloader();
  for (const response of [
    new Response("unavailable", { status: 503 }),
    new Response("missing", { status: 404 }),
    new Response("redirect", { status: 302 }),
    new Response(null, { status: 204 }),
  ]) {
    let attempts = 0;
    await assert.rejects(
      fetchArchive(target, pin, {
        timeoutSignal: () => new AbortController().signal,
        fetchImpl: async () => {
          attempts++;
          return response;
        },
        wait: async () => {
          assert.fail("HTTP and body refusals must not wait");
        },
      }),
      /Pinned Node download failed/u,
    );
    assert.equal(attempts, 1);
    assert.equal(response.bodyUsed, false);
  }
  const failure = transportFailure("UND_ERR_SOCKET");
  let attempts = 0;
  const response = await fetchArchive(target, pin, {
    timeoutSignal: () => new AbortController().signal,
    wait: async () => {
      assert.fail("Body failures must not wait");
    },
    fetchImpl: async () => {
      attempts++;
      return new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(failure);
          },
        }),
      );
    },
  });
  await assert.rejects(
    response.arrayBuffer(),
    (error: unknown) => error === failure,
  );
  assert.equal(attempts, 1);
});

test("native Node archive acquisition admits only reviewed target pins before any network attempt", async () => {
  const fetchArchive = await downloader();
  for (const [name, value] of Object.entries(pins.targets)) {
    const reviewed = (value as { node: { url: string; version: string } }).node;
    let attempts = 0;
    await fetchArchive(name, reviewed, {
      timeoutSignal: () => new AbortController().signal,
      fetchImpl: async (url: string) => {
        attempts++;
        assert.equal(url, reviewed.url);
        return new Response("archive");
      },
    });
    assert.equal(attempts, 1);
    for (const rejected of [
      { ...reviewed, url: reviewed.url + "?unreviewed" },
      { ...reviewed, url: "https://example.invalid/archive" },
      { ...reviewed, version: "24.99.0" },
    ]) {
      await assert.rejects(
        fetchArchive(name, rejected, {
          timeoutSignal: () => {
            assert.fail("Reject pin before starting deadline");
          },
          fetchImpl: async () => {
            assert.fail("Reject pin before network");
          },
        }),
        /reviewed download destination/u,
      );
    }
  }
});
