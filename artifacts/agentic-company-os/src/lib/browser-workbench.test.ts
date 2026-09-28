import assert from "node:assert/strict";
import test from "node:test";
import {
  browserPoint,
  browserUrl,
  parseBrowserRequest,
  readBrowserControl,
  readBrowserReceipt,
  readBrowserView,
  validBrowserText,
  browserLocalState,
  updateBrowserLocal,
  settleBrowserRequest,
  browserStorageKey,
  sameBrowserRequest,
  browserReviewSnapshot,
  clearBrowserReview,
  isBrowserRequestCurrent,
} from "./browser-workbench";
import { loadBrowserCopy } from "./browser-copy";
import { LOCALES } from "./i18n";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const request = {
  id,
  agentId: 2,
  kind: "input" as const,
  status: "pending" as const,
  startedAt: 1000,
};
test("recovery accepts only exact metadata, scopes the agent and never restores pending as dispatchable", () => {
  assert.equal(parseBrowserRequest(null, 2), null);
  assert.deepEqual(parseBrowserRequest(JSON.stringify(request), 2), {
    ...request,
    status: "unknown",
  });
  for (const value of [
    { ...request, text: "password" },
    { ...request, leaseId: id },
    { ...request, agentId: 3 },
    { ...request, status: "succeeded" },
    { ...request, startedAt: Infinity },
    { ...request, id: "bad" },
    [],
  ])
    assert.throws(() => parseBrowserRequest(JSON.stringify(value), 2));
});
test("text and addresses preserve multilingual input while rejecting lossy or executable input", () => {
  for (const text of [
    "\ufeff原文繁體\nالعربية Русский Türkçe 🙂",
    " ",
    "x".repeat(4096),
  ])
    assert.equal(validBrowserText(text), true);
  for (const text of ["", "x".repeat(4097), "\ud800", "bad\0text"])
    assert.equal(validBrowserText(text), false);
  assert.equal(
    browserUrl(" example.org/a?q=原文 "),
    "https://example.org/a?q=%E5%8E%9F%E6%96%87",
  );
  for (const value of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:secret@example.org",
    "a b",
    "",
  ])
    assert.equal(browserUrl(value), null);
});
test("letterboxed pointer targets remain inside the actual image including its far edges", () => {
  const rect = { left: 10, top: 20, width: 300, height: 300 };
  assert.equal(browserPoint(20, 25, rect, 1280, 800), null);
  assert.deepEqual(browserPoint(310, 263.75, rect, 1280, 800), {
    x: 1279,
    y: 799,
  });
  assert.deepEqual(browserPoint(160, 170, rect, 1280, 800), { x: 640, y: 400 });
  assert.equal(browserPoint(NaN, 10, rect, 1280, 800), null);
});
test("public control masks secrets and mutation receipts match the dispatched action", () => {
  const control = {
    owner: "operator",
    leaseId: id,
    leaseExpiresAt: "2026-09-27T08:00:00Z",
    agentActionInFlight: false,
  };
  assert.equal(readBrowserControl(control).leaseId, null);
  assert.equal(readBrowserControl(control, true).leaseId, id);
  assert.throws(() => readBrowserControl({ ...control, leaseId: null }, true));
  assert.throws(() =>
    readBrowserControl({ ...control, leaseExpiresAt: "invalid" }),
  );
  readBrowserReceipt({ path: "type_text", deleted: true }, "type_text");
  readBrowserReceipt(
    { path: "browser-session", deleted: false },
    "browser-session",
  );
  assert.throws(() =>
    readBrowserReceipt({ path: "keydown", deleted: true }, "type_text"),
  );
  assert.throws(() =>
    readBrowserReceipt({ path: "type_text", deleted: false }, "type_text"),
  );
  const view = {
    available: false,
    visible: false,
    width: 1280,
    height: 800,
    pngBase64: null,
    title: null,
    url: null,
    note: "private upstream message",
    control,
  };
  assert.equal(readBrowserView(view).note, null);
  assert.throws(() => readBrowserView({ ...view, available: true }));
  assert.throws(() => readBrowserView({ ...view, width: 1000000 }));
});
test("local metadata acknowledgements cannot clear a newer request or persist typed secrets", () => {
  const data = new Map<string, string>();
  let failed = false;
  const prior = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener() {},
      sessionStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (failed) throw new Error("blocked");
          data.set(key, value);
        },
        removeItem: (key: string) => {
          if (failed) throw new Error("blocked");
          data.delete(key);
        },
      },
    },
  });
  try {
    updateBrowserLocal(
      2,
      {
        request,
        text: "SECRET",
        address: "https://example.org?secret=PRIVATE",
      },
      true,
    );
    assert.deepEqual(JSON.parse(data.get(browserStorageKey(2))!), request);
    const next = { ...request, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    updateBrowserLocal(2, { request: next }, true);
    settleBrowserRequest(2, request, false);
    assert.equal(browserLocalState(2).request?.id, next.id);
    settleBrowserRequest(2, next, true);
    assert.equal(browserLocalState(2).request?.status, "unknown");
    failed = true;
    settleBrowserRequest(2, next, false);
    assert.equal(browserLocalState(2).storageError, true);
    assert.equal(browserLocalState(2).text, "SECRET");
    assert.equal(JSON.stringify([...data.values()]).includes("SECRET"), false);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: prior,
    });
  }
});
test("browser request versions distinguish legacy IDs and exact metadata survives a same-ID late response", () => {
  const tracked = { ...request, protocolVersion: 1 as const };
  assert.equal(
    parseBrowserRequest(JSON.stringify(tracked), 2)?.protocolVersion,
    1,
  );
  assert.equal(
    parseBrowserRequest(JSON.stringify(request), 2)?.protocolVersion,
    undefined,
  );
  assert.equal(
    sameBrowserRequest(tracked, { ...tracked, status: "unknown" }),
    true,
  );
  assert.equal(
    sameBrowserRequest(tracked, { ...tracked, kind: "navigate" }),
    false,
  );
  assert.equal(sameBrowserRequest(tracked, request), false);
  const previous = globalThis.window;
  const values = new Map<string, string>();
  let drop = false;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener() {},
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (!drop) values.set(key, value);
        },
        removeItem: (key: string) => values.delete(key),
      },
    },
  });
  try {
    const original = { ...tracked, agentId: 33 };
    updateBrowserLocal(33, { request: original }, true);
    const newer = { ...original, kind: "navigate" as const };
    updateBrowserLocal(33, { request: newer }, true);
    settleBrowserRequest(33, original, false);
    assert.equal(browserLocalState(33).request?.kind, "navigate");
    updateBrowserLocal(33, { request: { ...newer, status: "unknown" } }, true);
    const snapshot = browserReviewSnapshot(33)!;
    values.set(
      browserStorageKey(33),
      JSON.stringify({ ...newer, startedAt: newer.startedAt + 1 }),
    );
    assert.equal(
      isBrowserRequestCurrent(33, newer),
      false,
      "in-memory identity alone cannot accept a late lease",
    );
    assert.equal(
      clearBrowserReview(33, snapshot),
      false,
      "review cannot erase externally changed same-ID metadata",
    );
    drop = true;
    assert.equal(
      updateBrowserLocal(34, { request: { ...tracked, agentId: 34 } }, true)
        .storageError,
      true,
    );
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previous,
    });
  }
});

test("all seven browser language packs have the same non-empty messages", async () => {
  const en = await loadBrowserCopy("en");
  for (const locale of LOCALES) {
    const copy = await loadBrowserCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(en).sort());
    assert.ok(
      Object.values(copy).every(
        (value) => typeof value === "string" && value.trim().length > 0,
      ),
    );
  }
});
