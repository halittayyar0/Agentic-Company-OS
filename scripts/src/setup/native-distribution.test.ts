import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  nativeRequiredFiles,
  validateNativeDistribution,
  readNativeDistribution,
} from "./native-distribution";

const host = { platform: process.platform, architecture: process.arch };
const manifest = () => ({
  schemaVersion: 1,
  commit: "a".repeat(40),
  target: `${host.platform}-${host.architecture}`,
  nodeVersion: "24.21.0",
  postgresVersion: "17.10",
  files: nativeRequiredFiles(host).map((file: string) => ({
    path: file,
    bytes: 7,
    sha256: createHash("sha256").update("fixture").digest("hex"),
  })),
});

test("native package manifests bind the supported host, source and required executable bytes", () => {
  const valid = manifest();
  assert.deepEqual(validateNativeDistribution(valid, host), valid);
  for (const patch of [
    { commit: "main" },
    { target: "win32-arm64" },
    { target: host.platform === "linux" ? "darwin-x64" : "linux-x64" },
    { nodeVersion: "25.0.0" },
    { postgresVersion: "16.9" },
    { command: "arbitrary" },
    { files: valid.files.slice(1) },
    { files: [...valid.files, valid.files[0]] },
    {
      files: valid.files.map((row, index) =>
        index ? row : { ...row, bytes: -1 },
      ),
    },
    {
      files: valid.files.map((row, index) =>
        index ? row : { ...row, sha256: "x" },
      ),
    },
  ])
    assert.throws(() =>
      validateNativeDistribution({ ...valid, ...patch }, host),
    );
});

test("versioned native packages require the migration-only runtime while legacy archives remain valid", () => {
  const valid = manifest();
  const release = {
    path: "native-release.json",
    bytes: 7,
    sha256: valid.files[0].sha256,
  };
  assert.throws(() =>
    validateNativeDistribution(
      { ...valid, files: [...valid.files, release] },
      host,
    ),
  );
  const entry = {
    ...release,
    path: "artifacts/api-server/dist/native-upgrade.mjs",
  };
  assert.doesNotThrow(() =>
    validateNativeDistribution(
      { ...valid, files: [...valid.files, release, entry] },
      host,
    ),
  );
});

test("native package inventory rejects traversal, Windows aliases and duplicate normalized names", () => {
  const valid = manifest();
  for (const file of [
    "../outside",
    "/absolute",
    "C:/outside",
    "a\\outside",
    "a/../outside",
    "a//b",
    "a/./b",
    "a/b ",
    "a/b.",
    "a/NUL",
    "a/b:stream",
    "a/\u0000",
  ]) {
    assert.throws(() =>
      validateNativeDistribution(
        {
          ...valid,
          files: [...valid.files, { ...valid.files[0], path: file }],
        },
        host,
      ),
    );
  }
  assert.throws(() =>
    validateNativeDistribution(
      {
        ...valid,
        files: [
          ...valid.files,
          { ...valid.files[0], path: valid.files[0].path.toUpperCase() },
        ],
      },
      host,
    ),
  );
});

test("native package loading verifies shipped bytes and never treats a broken manifest as source setup", async (t) => {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-native-package-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await readNativeDistribution(root), null);
  const valid = manifest();
  for (const row of valid.files) {
    const file = path.join(root, row.path);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "fixture");
  }
  const file = path.join(root, "native-distribution.json");
  await writeFile(file, JSON.stringify(valid));
  assert.deepEqual(await readNativeDistribution(root), valid);
  await writeFile(path.join(root, valid.files[0].path), "changed");
  await assert.rejects(
    readNativeDistribution(root),
    /native_package_integrity/u,
  );
  await writeFile(path.join(root, valid.files[0].path), "fixture");
  const missing = path.join(root, valid.files[1].path);
  const saved = await readFile(missing);
  await rm(missing);
  await assert.rejects(
    readNativeDistribution(root),
    /native_package_integrity/u,
  );
  await writeFile(missing, saved);
  await writeFile(file, "{");
  await assert.rejects(readNativeDistribution(root));
});
