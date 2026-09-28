import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeDatabase } from "@workspace/db";
import {
  deleteEntry,
  previewDeletion,
  readTextFile,
  safeResolve,
  writeBinaryFile,
  writeTextFile,
} from "./sandbox";
import {
  activateLocalEmergencyStop,
  deactivateLocalEmergencyStop,
} from "../orchestrator/local-emergency-epoch";

const base = await fsp.mkdtemp(path.join(os.tmpdir(), "acos-file-delete-"));
process.env.AGENT_SANDBOX_ROOT = base;
test.after(async () => {
  await closeDatabase();
  await fsp.rm(base, { recursive: true, force: true });
});

test("deletion review includes every folder and raw binary file, stays stable, and deletes only its scope", async () => {
  await writeBinaryFile(1, "project/原文.bin", Buffer.from([0, 255, 13, 10]));
  await writeTextFile(1, "keep.txt", "outside scope");
  await fsp.mkdir(safeResolve(1, "project/empty").abs);
  const preview = await previewDeletion(1, "project");
  assert.equal(preview.entryCount, 3);
  assert.equal(preview.totalBytes, 4);
  assert.deepEqual(preview.entries, [
    { path: "project", type: "directory", sizeBytes: 0 },
    { path: "project/empty", type: "directory", sizeBytes: 0 },
    { path: "project/原文.bin", type: "file", sizeBytes: 4 },
  ]);
  assert.deepEqual(await previewDeletion(1, "project"), preview);
  await deleteEntry(1, "project", undefined, undefined, {
    expectedVersion: preview.version,
  });
  await assert.rejects(fsp.stat(safeResolve(1, "project").abs), {
    code: "ENOENT",
  });
  assert.equal((await readTextFile(1, "keep.txt")).content, "outside scope");
  await assert.rejects(
    deleteEntry(1, "project", undefined, undefined, {
      expectedVersion: preview.version,
    }),
    { code: "VM_DELETE_MISSING" },
  );
});

test("changed bytes, new children, and replaced same-content files invalidate the inspected scope", async () => {
  await writeTextFile(2, "tree/source.txt", "one");
  const original = await previewDeletion(2, "tree");
  await writeTextFile(2, "tree/source.txt", "two");
  await assert.rejects(
    deleteEntry(2, "tree", undefined, undefined, {
      expectedVersion: original.version,
    }),
    { code: "VM_DELETE_CHANGED" },
  );
  const changed = await previewDeletion(2, "tree");
  await writeTextFile(2, "tree/new.txt", "new");
  await assert.rejects(
    deleteEntry(2, "tree", undefined, undefined, {
      expectedVersion: changed.version,
    }),
    { code: "VM_DELETE_CHANGED" },
  );
  const file = await previewDeletion(2, "tree/source.txt");
  await writeTextFile(2, "tree/source.txt", "two");
  await assert.rejects(
    deleteEntry(2, "tree/source.txt", undefined, undefined, {
      expectedVersion: file.version,
    }),
    { code: "VM_DELETE_CHANGED" },
  );
  assert.equal((await readTextFile(2, "tree/new.txt")).content, "new");
});

test("two concurrent reviewed deletes cannot both report a deletion", async () => {
  await writeTextFile(3, "one.txt", "one");
  const review = {
    expectedVersion: (await previewDeletion(3, "one.txt")).version,
  };
  const results = await Promise.allSettled([
    deleteEntry(3, "one.txt", undefined, undefined, review),
    deleteEntry(3, "one.txt", undefined, undefined, review),
  ]);
  assert.equal(
    results.filter((value) => value.status === "fulfilled").length,
    1,
  );
  const rejected = results.find((value) => value.status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.equal(rejected.reason.code, "VM_DELETE_MISSING");
});

test("admission runs before the file lock and the scope and emergency epoch are checked afterwards", async () => {
  await writeTextFile(4, "source.txt", "old");
  const review = {
    expectedVersion: (await previewDeletion(4, "source.txt")).version,
  };
  let calls = 0;
  await assert.rejects(
    deleteEntry(
      4,
      "source.txt",
      undefined,
      async () => {
        calls++;
        await writeTextFile(4, "source.txt", "new");
      },
      review,
    ),
    { code: "VM_DELETE_CHANGED" },
  );
  assert.equal(calls, 1);
  try {
    await assert.rejects(
      deleteEntry(
        4,
        "source.txt",
        undefined,
        async () => {
          activateLocalEmergencyStop();
        },
        { expectedVersion: (await previewDeletion(4, "source.txt")).version },
      ),
      /Emergency stop/,
    );
  } finally {
    deactivateLocalEmergencyStop();
  }
  assert.equal((await readTextFile(4, "source.txt")).content, "new");
});

test("root, missing, escaping, symlink, oversized, and overdeep targets never produce an actionable preview", async () => {
  await writeTextFile(5, "keep.txt", "keep");
  await assert.rejects(previewDeletion(5, "."), {
    code: "VM_DELETE_NOT_REVIEWABLE",
  });
  await assert.rejects(previewDeletion(5, "absent"), {
    code: "VM_DELETE_MISSING",
  });
  await assert.rejects(previewDeletion(5, "../escape"));
  await assert.rejects(
    deleteEntry(5, "keep.txt", undefined, undefined, { expectedVersion: "" }),
    { code: "VM_DELETE_VERSION_REQUIRED" },
  );
  // A Windows junction needs no developer-mode symlink privilege.
  const external = path.join(base, "external");
  await fsp.mkdir(external);
  await fsp.writeFile(path.join(external, "private.txt"), "untouched");
  await fsp.symlink(
    external,
    safeResolve(5, "link").abs,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(previewDeletion(5, "link"), {
    code: "VM_DELETE_NOT_REVIEWABLE",
  });
  assert.equal(
    await fsp.readFile(path.join(external, "private.txt"), "utf8"),
    "untouched",
  );
  const large = await fsp.open(safeResolve(5, "large.bin").abs, "w");
  await large.truncate(64 * 1024 * 1024 + 1);
  await large.close();
  await assert.rejects(previewDeletion(5, "large.bin"), {
    code: "VM_DELETE_NOT_REVIEWABLE",
  });
  await fsp.mkdir(safeResolve(5, `deep/${Array(34).fill("d").join("/")}`).abs, {
    recursive: true,
  });
  await assert.rejects(previewDeletion(5, "deep"), {
    code: "VM_DELETE_NOT_REVIEWABLE",
  });
});

test("a scope over 1000 entries is rejected in full instead of returning a truncated preview", async () => {
  const directory = safeResolve(6, "many").abs;
  await fsp.mkdir(directory, { recursive: true });
  for (let index = 0; index < 1000; index++)
    await fsp.writeFile(path.join(directory, `${index}.txt`), "");
  await assert.rejects(previewDeletion(6, "many"), {
    code: "VM_DELETE_NOT_REVIEWABLE",
  });
  assert.equal((await fsp.readdir(directory)).length, 1000);
});
