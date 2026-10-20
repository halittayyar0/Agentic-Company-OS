import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createNativeRelease,
  readNativeRelease,
  validateNativeRelease,
} from "./native-release";
import type { NativeDistribution } from "./native-distribution";

const commit = "b".repeat(40);
const release = () => ({
  schemaVersion: 1,
  applicationVersion: "0.5.6",
  commit,
  upgradeProtocol: 1,
});

test("release identity has one strict stable version and upgrade protocol", () => {
  assert.deepEqual(createNativeRelease("0.5.6", commit), release());
  assert.deepEqual(validateNativeRelease(release(), commit), release());
  for (const patch of [
    { applicationVersion: "0.5.6-beta.1" },
    { applicationVersion: "v0.5.6" },
    { applicationVersion: "0.05.6" },
    { applicationVersion: "0.5.9007199254740992" },
    { applicationVersion: "0.5.6\n" },
    { commit: "main" },
    { commit: "c".repeat(40) },
    { schemaVersion: 2 },
    { upgradeProtocol: 2 },
    { upgradeProtocol: "1" },
    { extra: "ignored" },
  ]) {
    assert.throws(() =>
      validateNativeRelease({ ...release(), ...patch }, commit),
    );
  }
  for (const value of [null, [], {}, "0.5.6"])
    assert.throws(() => validateNativeRelease(value, commit));
  assert.throws(() => createNativeRelease("bad", commit));
  assert.throws(() => createNativeRelease("0.5.6", "main"));
});

test("release readers require inventoried metadata and bind its actual bytes to the package", async (t) => {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-release-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = JSON.stringify(release());
  const distribution: NativeDistribution = {
    schemaVersion: 1,
    commit,
    target: `${process.platform}-${process.arch}`,
    nodeVersion: "24.21.0",
    postgresVersion: "17.10",
    files: [
      {
        path: "native-release.json",
        bytes: Buffer.byteLength(bytes),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ],
  };
  await writeFile(path.join(root, "native-release.json"), bytes);
  assert.deepEqual(await readNativeRelease(root, distribution), release());
  assert.equal(
    await readNativeRelease(root, { ...distribution, files: [] }),
    null,
  );
  await writeFile(
    path.join(root, "native-release.json"),
    " ".repeat(bytes.length),
  );
  await assert.rejects(
    readNativeRelease(root, distribution),
    /native_release/u,
  );
  await rm(path.join(root, "native-release.json"));
  await mkdir(path.join(root, "native-release.json"));
  await assert.rejects(
    readNativeRelease(root, distribution),
    /native_release/u,
  );
});
