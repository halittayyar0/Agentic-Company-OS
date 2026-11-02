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

test("Windows releases from 0.5.10 require both private checker assets while published 0.5.9 remains readable", async (t) => {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-release-checker-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkerPaths = [
    "scripts/src/setup/windows-private-helper.exe",
    "artifacts/api-server/dist/windows-private-helper.exe",
  ];
  for (const version of ["0.5.9", "0.5.10", "0.5.11", "0.6.0", "1.0.0"]) {
    const value = { ...release(), applicationVersion: version };
    const bytes = JSON.stringify(value);
    await writeFile(path.join(root, "native-release.json"), bytes);
    const distribution: NativeDistribution = {
      schemaVersion: 1,
      commit,
      target: "win32-x64",
      nodeVersion: "24.22.1",
      postgresVersion: "17.11",
      files: [
        {
          path: "native-release.json",
          bytes: Buffer.byteLength(bytes),
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ],
    };
    if (version === "0.5.9") {
      assert.deepEqual(await readNativeRelease(root, distribution), value);
      continue;
    }
    await assert.rejects(
      readNativeRelease(root, distribution),
      /native_release_identity/u,
    );
    for (const missing of checkerPaths) {
      const files = [
        ...distribution.files,
        ...checkerPaths
          .filter((file) => file !== missing)
          .map((file) => ({ ...distribution.files[0], path: file })),
      ];
      await assert.rejects(
        readNativeRelease(root, { ...distribution, files }),
        /native_release_identity/u,
      );
    }
    const complete = {
      ...distribution,
      files: [
        ...distribution.files,
        ...checkerPaths.map((file) => ({
          ...distribution.files[0],
          path: file,
        })),
      ],
    };
    assert.deepEqual(await readNativeRelease(root, complete), value);
    assert.deepEqual(
      await readNativeRelease(root, { ...distribution, target: "linux-x64" }),
      value,
    );
  }
});
