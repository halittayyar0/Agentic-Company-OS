import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256ExactFile } from "./native-runtime-provenance";

test("exact file digests are fresh and reject redirected files", async (t) => {
  const directory = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-exact-digest-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "lockfile");
  await writeFile(file, "first");
  const first = await sha256ExactFile(file, "fixture");
  assert.equal(first, createHash("sha256").update("first").digest("hex"));
  await writeFile(file, "second");
  assert.notEqual(await sha256ExactFile(file, "fixture"), first);
  await assert.rejects(sha256ExactFile(directory, "fixture"), /regular file/);
  const link = path.join(directory, "linked-file");
  try {
    await symlink(file, link);
  } catch (error) {
    if (
      ["EPERM", "EACCES"].includes(
        String((error as NodeJS.ErrnoException).code),
      )
    )
      return;
    throw error;
  }
  await assert.rejects(sha256ExactFile(link, "fixture"), /regular file/);
});
