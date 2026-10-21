import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { OwnerPrivateStorage } from "@workspace/ai-server/owner-private-storage";
import {
  inventoryNativeCluster,
  snapshotNativeCluster,
} from "./native-cluster-snapshot";

async function fixture(t: TestContext) {
  const parent = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-cold-copy-"),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const directory = path.join(parent, `instance-${randomUUID()}`);
  await new OwnerPrivateStorage(directory).initialize(true);
  const data = path.join(directory, "database");
  for (const name of ["base/1", "global", "pg_wal", "pg_tblspc", "empty"])
    await mkdir(path.join(data, name), { recursive: true, mode: 0o700 });
  for (const [name, bytes] of [
    ["PG_VERSION", "17\n"],
    ["agentic-cluster.json", "owned-marker"],
    ["global/pg_control", "control"],
    ["pg_wal/000000010000000000000001", "wal"],
  ])
    await writeFile(path.join(data, name), bytes, { mode: 0o600 });
  const payload = Buffer.alloc(1024 * 1024 + 37, 43);
  payload[payload.length - 1] = 249;
  await writeFile(path.join(data, "base/1/42"), payload, { mode: 0o600 });
  let inspections = 0;
  const options = {
    directory,
    upgradeId: randomUUID(),
    inspectStopped: async () => {
      inspections++;
      return { dataDirectory: data, postgresMajor: 17 as const };
    },
  };
  return {
    parent,
    directory,
    data,
    options,
    payload,
    inspections: () => inspections,
  };
}

test("cold snapshot copies every regular file and empty directory, verifies hashes and preserves original bytes", async (t) => {
  const f = await fixture(t),
    before = await inventoryNativeCluster(f.data);
  const copy = await snapshotNativeCluster(f.options);
  assert.equal(f.inspections(), 2);
  assert.equal(copy.upgradeId, f.options.upgradeId);
  assert.equal(
    copy.stagingDirectory,
    path.join(f.directory, "native-upgrades", f.options.upgradeId, "stage"),
  );
  assert.deepEqual(copy.inventory, before);
  assert.deepEqual(await inventoryNativeCluster(f.data), before);
  assert.deepEqual(await inventoryNativeCluster(copy.dataDirectory), before);
  assert.deepEqual(
    await readFile(path.join(copy.dataDirectory, "base/1/42")),
    f.payload,
  );
  assert.deepEqual(await readdir(path.join(copy.dataDirectory, "empty")), []);
  const sourceFile = await lstat(path.join(f.data, "base/1/42"));
  const copiedFile = await lstat(path.join(copy.dataDirectory, "base/1/42"));
  assert.equal(copiedFile.nlink, 1);
  assert.notEqual(copiedFile.ino, sourceFile.ino);
  assert.equal(
    copy.inventory.sha256,
    createHash("sha256")
      .update(
        JSON.stringify({
          directories: before.directories,
          files: before.files,
          bytes: before.bytes,
        }),
      )
      .digest("hex"),
  );
});

test("cold snapshot requires stopped identity before creating a staging area and again after copying", async (t) => {
  const f = await fixture(t),
    before = await inventoryNativeCluster(f.data);
  await assert.rejects(
    snapshotNativeCluster({
      ...f.options,
      inspectStopped: async () => {
        throw new Error("cluster still running");
      },
    }),
    /cluster still running/u,
  );
  await assert.rejects(lstat(path.join(f.directory, "native-upgrades")), {
    code: "ENOENT",
  });
  let checks = 0;
  await assert.rejects(
    snapshotNativeCluster({
      ...f.options,
      inspectStopped: async () => {
        if (++checks === 2) throw new Error("source no longer stopped");
        return { dataDirectory: f.data, postgresMajor: 17 };
      },
    }),
    /source no longer stopped/u,
  );
  assert.deepEqual(await inventoryNativeCluster(f.data), before);
  await assert.rejects(
    snapshotNativeCluster({
      ...f.options,
      upgradeId: randomUUID(),
      inspectStopped: async () => ({
        dataDirectory: f.parent,
        postgresMajor: 17,
      }),
    }),
    /native_snapshot_identity/u,
  );
});

test("cold snapshot never reuses a previous staging identity or accepts a path traversal", async (t) => {
  const f = await fixture(t);
  const first = await snapshotNativeCluster(f.options);
  await writeFile(
    path.join(first.dataDirectory, "keep"),
    "retained previous attempt",
  );
  await assert.rejects(snapshotNativeCluster(f.options), { code: "EEXIST" });
  assert.equal(
    await readFile(path.join(first.dataDirectory, "keep"), "utf8"),
    "retained previous attempt",
  );
  for (const upgradeId of ["../outside", "", "a".repeat(36)])
    await assert.rejects(
      snapshotNativeCluster({ ...f.options, upgradeId }),
      /native_snapshot_identity/u,
    );
});

test("cold snapshot refuses redirected and hardlinked files instead of following them", async (t) => {
  for (const kind of ["directory", "hardlink"] as const) {
    const f = await fixture(t);
    if (kind === "directory") {
      const outside = path.join(f.parent, "outside");
      await mkdir(outside);
      await symlink(
        outside,
        path.join(f.data, "redirect"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } else
      await link(
        path.join(f.data, "base/1/42"),
        path.join(f.parent, "external-link"),
      );
    await assert.rejects(
      snapshotNativeCluster(f.options),
      /native_snapshot_path/u,
    );
    await assert.rejects(lstat(path.join(f.directory, "native-upgrades")), {
      code: "ENOENT",
    });
  }
});

test("cold snapshot detects source changes during staging and leaves the original namespace in place", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  await assert.rejects(
    snapshotNativeCluster({
      ...f.options,
      inspectStopped: async () => {
        if (++calls === 2)
          await writeFile(
            path.join(f.data, "base/1/42"),
            "concurrent external write",
          );
        return { dataDirectory: f.data, postgresMajor: 17 };
      },
    }),
    /native_snapshot_changed/u,
  );
  assert.equal(
    await readFile(path.join(f.data, "base/1/42"), "utf8"),
    "concurrent external write",
  );
});

test("cancelled or failed copies preserve source bytes and do not return verified staging", async (t) => {
  for (const cause of ["abort", "exclusive-create"] as const) {
    const f = await fixture(t),
      before = await inventoryNativeCluster(f.data);
    const abort = new AbortController();
    const stage = path.join(
      f.directory,
      "native-upgrades",
      f.options.upgradeId,
      "stage/database",
    );
    await assert.rejects(
      snapshotNativeCluster({
        ...f.options,
        signal: abort.signal,
        onProgress: async (progress) => {
          if (progress.phase !== "copy" || progress.copiedFiles !== 0) return;
          if (cause === "abort") abort.abort(new Error("operator cancelled"));
          else
            await writeFile(path.join(stage, "PG_VERSION"), "preexisting file");
        },
      }),
    );
    assert.deepEqual(await inventoryNativeCluster(f.data), before);
    assert.equal(f.inspections(), 1);
  }
});
