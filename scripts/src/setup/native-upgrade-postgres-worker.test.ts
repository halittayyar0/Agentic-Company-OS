import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { nativeRequiredFiles } from "./native-distribution";
import { createNativeUpgradePostgresWorker } from "./native-upgrade-postgres-worker";

test("staging worker validates the exact preparing attempt before any PostgreSQL command or initialization", async (t) => {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-stage-context-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, `instance-${randomUUID()}`),
    target = path.join(root, "package");
  const upgradeId = randomUUID(),
    stage = path.join(directory, "native-upgrades", upgradeId, "stage");
  await mkdir(path.join(stage, "database"), { recursive: true });
  await mkdir(path.join(directory, "secrets"));
  await mkdir(target);
  const hash = (bytes: string) =>
    createHash("sha256").update(bytes).digest("hex");
  const files = nativeRequiredFiles({
    platform: process.platform,
    architecture: process.arch,
  });
  for (const file of files) {
    await mkdir(path.dirname(path.join(target, file)), { recursive: true });
    await writeFile(path.join(target, file), "fixture");
  }
  await writeFile(
    path.join(target, "native-distribution.json"),
    JSON.stringify({
      schemaVersion: 1,
      commit: "b".repeat(40),
      target: `${process.platform}-${process.arch}`,
      nodeVersion: "24.21.0",
      postgresVersion: "17.10",
      files: files.map((file) => ({
        path: file,
        bytes: 7,
        sha256: hash("fixture"),
      })),
    }),
  );
  const original = "unchanged original metadata";
  await writeFile(path.join(directory, "installation.json"), original);
  await writeFile(path.join(root, "native-launch.json"), "original pointer");
  const journal = {
    schemaVersion: 1,
    upgradeId,
    installationId: path.basename(directory).slice(9),
    phase: "preparing",
    sourceRoot: path.join(root, "old-package"),
    targetRoot: target,
    sourceCommit: "a".repeat(40),
    targetCommit: "b".repeat(40),
    appPort: 5031,
    createdAt: new Date().toISOString(),
    originalMetadataSha256: hash(original),
    originalPointerSha256: hash("original pointer"),
    sourceDatabaseSha256: null,
    stagedDatabaseSha256: null,
    migrationReceiptSha256: null,
  };
  const journalFile = path.join(directory, "native-upgrade.json");
  await writeFile(journalFile, JSON.stringify(journal));
  const options = {
    stagingDirectory: stage,
    targetRoot: target,
    signal: new AbortController().signal,
  };
  assert.ok(await createNativeUpgradePostgresWorker(options));
  await t.test(
    "missing copied database is rejected without creating it",
    async () => {
      await rm(path.join(stage, "database"), { recursive: true });
      await assert.rejects(createNativeUpgradePostgresWorker(options), {
        code: "ENOENT",
      });
      await assert.rejects(
        readFile(path.join(stage, "database", "PG_VERSION")),
        { code: "ENOENT" },
      );
      await mkdir(path.join(stage, "database"));
    },
  );
  await t.test(
    "changed source metadata cannot start the staged server",
    async () => {
      await writeFile(
        path.join(directory, "installation.json"),
        "changed original",
      );
      await assert.rejects(
        createNativeUpgradePostgresWorker(options),
        /staging_identity/u,
      );
      await writeFile(path.join(directory, "installation.json"), original);
    },
  );
  await t.test(
    "a retired attempt or a different target commit cannot start",
    async () => {
      for (const patch of [
        { phase: "abandoned" },
        { targetCommit: "c".repeat(40) },
      ]) {
        await writeFile(journalFile, JSON.stringify({ ...journal, ...patch }));
        await assert.rejects(
          createNativeUpgradePostgresWorker(options),
          /staging_identity/u,
        );
      }
      await writeFile(journalFile, JSON.stringify(journal));
    },
  );
  await t.test(
    "original instance paths and pre-aborted starts are refused",
    async () => {
      await assert.rejects(
        createNativeUpgradePostgresWorker({
          ...options,
          stagingDirectory: directory,
        }),
        /staging_identity/u,
      );
      await assert.rejects(
        createNativeUpgradePostgresWorker({
          ...options,
          signal: AbortSignal.abort(),
        }),
        { name: "AbortError" },
      );
    },
  );
  assert.equal(
    await readFile(path.join(directory, "installation.json"), "utf8"),
    original,
  );
});
