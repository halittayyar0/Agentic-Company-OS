import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  emptyFileSession,
  readFileSession,
  writeFileSession,
  recoverFileSession,
  settleFileWrite,
  editableFileText,
  type FileWriteRecord,
} from "./file-session";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
const request = (): FileWriteRecord => ({
  id: randomUUID(),
  agentId: 2,
  kind: "edit",
  path: "原文.txt",
  content: "Submitted\r\nمتن",
  expectedVersion: "a".repeat(64),
  status: "pending",
  startedAt: new Date().toISOString(),
});
test("file draft reload preserves multiple original sources and requires review without resending", () => {
  const session = emptyFileSession(2);
  session.drafts = ["原文.txt", "other.txt"].map((path) => ({
    path,
    content: "\ufeffNew\r\nLine\nMixed\r",
    baseContent: "\ufeffBase\r\n",
    version: "a".repeat(64),
    needsReview: false,
  }));
  session.newPath = "folder/新規.txt";
  session.request = request();
  const store = storage();
  assert.equal(writeFileSession(session, store), true);
  const loaded = readFileSession(2, store);
  assert.equal(loaded.damaged, false);
  assert.deepEqual(loaded.session, session);
  const recovered = recoverFileSession(loaded.session);
  assert.equal(recovered.request?.status, "unknown");
  assert.ok(recovered.drafts.every((draft) => draft.needsReview));
  assert.equal(recovered.drafts[0].content, session.drafts[0].content);
  assert.deepEqual(readFileSession(3, store).session, emptyFileSession(3));
});
test("late file responses merge newer drafts and cannot replace a later request", () => {
  const session = emptyFileSession(2);
  const r = request();
  session.request = r;
  session.drafts = [
    {
      path: r.path,
      content: "Typed later",
      baseContent: "Before",
      version: r.expectedVersion,
      needsReview: false,
    },
    {
      path: "other.txt",
      content: "Keep",
      baseContent: "Base",
      version: "b".repeat(64),
      needsReview: true,
    },
  ];
  const result = {
    path: r.path,
    sizeBytes: Buffer.byteLength(r.content),
    version: "c".repeat(64),
  };
  const next = settleFileWrite(session, r, result);
  assert.equal(next.request, null);
  assert.equal(next.drafts[0].content, "Typed later");
  assert.equal(next.drafts[0].baseContent, r.content);
  assert.equal(next.drafts[0].version, result.version);
  assert.deepEqual(next.drafts[1], session.drafts[1]);
  const newer = { ...session, request: request() };
  assert.equal(settleFileWrite(newer, r, result), newer);
  assert.equal(settleFileWrite(session, r).request?.status, "unknown");
  assert.equal(settleFileWrite(session, r).drafts[0].needsReview, true);
  session.drafts[0].content = r.content;
  assert.deepEqual(
    settleFileWrite(session, r, result).drafts.map((draft) => draft.path),
    ["other.txt"],
  );
});
test("create completion never clears a newer path draft", () => {
  const session = emptyFileSession(2);
  const r = {
    ...request(),
    kind: "create" as const,
    expectedVersion: "missing",
    content: "",
  };
  session.request = r;
  session.newPath = "next.txt";
  const result = { path: r.path, sizeBytes: 0, version: "c".repeat(64) };
  assert.equal(settleFileWrite(session, r, result).newPath, "next.txt");
  session.newPath = r.path;
  assert.equal(settleFileWrite(session, r, result).newPath, "");
});
test("invalid recovery records and exhausted storage fail closed without truncating input", () => {
  const store = storage();
  const session = emptyFileSession(2);
  session.request = request();
  writeFileSession(session, store);
  session.newPath = "\u0001".repeat(200000);
  assert.equal(writeFileSession(session, store), false);
  assert.equal(readFileSession(2, store).session.newPath, "");
  assert.equal(session.newPath.length, 200000);
  session.newPath = "x".repeat(100001);
  assert.equal(writeFileSession(session, store), false);
  assert.equal(readFileSession(2, store).damaged, false);
  for (const bad of [
    "{",
    JSON.stringify({
      ...emptyFileSession(2),
      request: { ...request(), agentId: 3 },
    }),
    JSON.stringify({ ...emptyFileSession(2), extra: "unexpected" }),
    JSON.stringify({
      ...emptyFileSession(2),
      request: {
        ...request(),
        kind: "create",
        content: "overwrite",
        expectedVersion: "missing",
      },
    }),
  ])
    assert.equal(
      readFileSession(2, { getItem: () => bad, setItem() {} }).damaged,
      true,
    );
  assert.equal(
    writeFileSession(emptyFileSession(2), {
      getItem: () => null,
      setItem() {
        throw Error("quota");
      },
    }),
    false,
  );
  assert.equal(editableFileText("\ufeff原文\r\n"), true);
  for (const value of [
    "bad\0text",
    "\ud800",
    "x".repeat(131073),
    "原".repeat(50000),
  ])
    assert.equal(editableFileText(value), false);
});
