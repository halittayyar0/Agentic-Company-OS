import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  readDeletionRecord,
  writeDeletionRecord,
  validDeletionPreview,
  type DeletionRecord,
} from "./file-deletion";
import { loadFileCopy } from "./file-copy";
import { LOCALES } from "./i18n";

test("deletion scope validation rejects partial, escaping, duplicate and inconsistent manifests", () => {
  const valid = {
    path: "folder",
    version: "a".repeat(64),
    entryCount: 2,
    totalBytes: 12,
    entries: [
      { path: "folder", type: "directory", sizeBytes: 0 },
      { path: "folder/原文.txt", type: "file", sizeBytes: 12 },
    ],
  };
  assert.equal(validDeletionPreview(valid, "folder"), true);
  for (const value of [
    null,
    {},
    { ...valid, truncated: true },
    { ...valid, entryCount: 1 },
    { ...valid, totalBytes: 13 },
    { ...valid, path: "other" },
    { ...valid, version: "missing" },
    { ...valid, entries: [valid.entries[0], valid.entries[0]], totalBytes: 0 },
    {
      ...valid,
      entries: [
        valid.entries[0],
        { ...valid.entries[1], path: "folder/../secret.txt" },
      ],
    },
    {
      ...valid,
      entries: [
        valid.entries[0],
        { ...valid.entries[1], path: "folder/missing/child.txt" },
      ],
    },
    {
      ...valid,
      entries: [valid.entries[0], { ...valid.entries[1], type: "symlink" }],
    },
    {
      ...valid,
      entries: [{ ...valid.entries[0], type: "file" }, valid.entries[1]],
    },
  ])
    assert.equal(validDeletionPreview(value, "folder"), false);
});

test("deletion recovery preserves exact scope and treats a pending request as unknown without re-dispatch", () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
  const record: DeletionRecord = {
    id: randomUUID(),
    agentId: 2,
    path: "原文/ملف.txt",
    expectedVersion: "a".repeat(64),
    status: "pending",
    startedAt: new Date().toISOString(),
  };
  assert.equal(writeDeletionRecord(2, record, storage), true);
  assert.deepEqual(readDeletionRecord(2, storage), {
    record: { ...record, status: "unknown" },
    damaged: false,
  });
  assert.deepEqual(readDeletionRecord(3, storage), {
    record: null,
    damaged: false,
  });
  // JSON escaping can exceed the recovery cap even for a supported path
  // length. Refuse dispatch preparation without replacing the previous record.
  assert.equal(
    writeDeletionRecord(
      2,
      { ...record, path: Array(8).fill("\u0001".repeat(225)).join("/") },
      storage,
    ),
    false,
  );
  assert.equal(readDeletionRecord(2, storage).record?.path, record.path);
  writeDeletionRecord(2, { ...record, agentId: 3 }, storage);
  assert.equal(readDeletionRecord(2, storage).damaged, true);
  const broken = {
    getItem: () => "{",
    setItem: () => {
      throw Error("blocked");
    },
  };
  assert.equal(readDeletionRecord(2, broken).damaged, true);
  assert.equal(writeDeletionRecord(2, record, broken), false);
  assert.equal(writeDeletionRecord(2, null, storage), true);
  assert.equal(readDeletionRecord(2, storage).record, null);
});

test("all seven deletion languages include every review and recovery control", async () => {
  const english = await loadFileCopy("en");
  for (const locale of LOCALES) {
    const copy = await loadFileCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(english).sort());
    assert.ok(Object.values(copy).every((value) => value.trim().length > 0));
    if (locale !== "en") assert.notEqual(copy.unknownHelp, english.unknownHelp);
  }
});
