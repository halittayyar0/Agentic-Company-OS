import assert from "node:assert/strict";
import test from "node:test";
import {
  configureOllama,
  getOllamaCatalogSnapshot,
  refreshOllamaCatalog,
} from "./first-party-providers";

test("changing local servers removes the prior model catalog before discovery", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return Response.json(
      url.pathname === "/api/tags"
        ? { models: [{ name: "old-model" }] }
        : { capabilities: ["tools"] },
    );
  }) as typeof fetch;
  try {
    configureOllama({ baseUrl: "http://127.0.0.1:11434/v1" });
    assert.equal(
      (await refreshOllamaCatalog(true)).models[0]?.id,
      "ollama:old-model",
    );
    configureOllama({ baseUrl: "http://127.0.0.1:11435/v1" });
    assert.deepEqual(getOllamaCatalogSnapshot(), {
      models: [],
      fetchedAt: null,
      reachable: false,
      error: null,
    });
  } finally {
    configureOllama({ baseUrl: null });
    globalThis.fetch = originalFetch;
  }
});

test("late discovery from the previous server cannot overwrite the new server or block its refresh", async () => {
  const originalFetch = globalThis.fetch;
  for (const staleFails of [false, true]) {
    let releaseOld!: () => void;
    let announceOld!: () => void;
    const oldStarted = new Promise<void>((resolve) => {
      announceOld = resolve;
    });
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    globalThis.fetch = (async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.port === "11434" && url.pathname === "/api/tags") {
        announceOld();
        await oldGate;
        if (staleFails) throw new Error("old server unavailable");
        return Response.json({ models: [{ name: "old-model" }] });
      }
      return Response.json(
        url.pathname === "/api/tags"
          ? { models: [{ name: "new-model" }] }
          : { capabilities: ["tools"] },
      );
    }) as typeof fetch;
    configureOllama({ baseUrl: "http://127.0.0.1:11434/v1" });
    const oldRefresh = refreshOllamaCatalog(true);
    await oldStarted;
    configureOllama({ baseUrl: "http://127.0.0.1:11435/v1" });
    const newRefresh = refreshOllamaCatalog();
    // Release after one event-loop turn; a stale shared promise must not make
    // this new refresh return old-model or mark the new endpoint unreachable.
    const beforeRelease = await Promise.race([
      newRefresh.then(() => "new-ready"),
      new Promise<string>((resolve) =>
        setImmediate(() => resolve("waiting-old")),
      ),
    ]);
    releaseOld();
    try {
      await Promise.all([oldRefresh, newRefresh]);
      assert.equal(beforeRelease, "new-ready");
      const current = getOllamaCatalogSnapshot();
      assert.deepEqual(
        current.models.map((model) => model.id),
        ["ollama:new-model"],
      );
      assert.equal(current.reachable, true);
      assert.equal(current.error, null);
    } finally {
      releaseOld();
      configureOllama({ baseUrl: null });
      globalThis.fetch = originalFetch;
    }
  }
});
