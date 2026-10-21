import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { OwnerPrivateStorage } from "@workspace/ai-server/owner-private-storage";
import { createInstallationResources } from "./resources";
import { planInstallation } from "./plan";
import {
  saveNativeLaunchPointer,
  readNativeLaunchPointer,
} from "./native-launch";
import { acquireInstallationLease } from "./installation-lease";
import { nativeUpgradeHash } from "./native-upgrade-files";
import {
  inventoryNativeCluster,
  snapshotNativeCluster,
} from "./native-cluster-snapshot";
import {
  assertNativeUpgradeStartupReady,
  readNativeUpgradeJournal,
  writeNativeUpgradeJournal,
  type NativeUpgradeJournal,
} from "./native-upgrade-journal";
import {
  qualifyNativePromotion,
  promoteNativeUpgrade,
} from "./native-upgrade-promotion";

const caps = {
  platform: process.platform,
  architecture: process.arch,
  nodeVersion: process.version,
  postgresClientVersion: null,
  composeVersion: null,
  native: { ready: true, issues: [], managedDatabase: true },
  container: { ready: false, issues: [] },
};

async function fixture(t: TestContext) {
  const parent = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-promotion-"),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const sourceRoot = path.join(parent, "old package"),
    targetRoot = path.join(parent, "new package");
  const plan = planInstallation(
    {
      mode: "native",
      locale: "ar",
      port: 5031,
      accessMode: "approval",
      provider: "later",
      phoneAccess: "local",
      toolPacks: ["data", "web"],
    },
    caps,
  );
  const resources = await createInstallationResources(parent, plan, {
    databaseUrl:
      "postgresql://agentic:private-password@127.0.0.1:58242/postgres",
  });
  const directory = resources.directory,
    data = path.join(directory, "database");
  for (const folder of ["global", "base/1", "pg_wal", "pg_tblspc"])
    await mkdir(path.join(data, folder), { recursive: true, mode: 0o700 });
  for (const [file, value] of [
    ["global/pg_control", "control"],
    ["PG_VERSION", "17\n"],
    ["agentic-cluster.json", "identity"],
    ["base/1/old", "original complete task 73"],
  ])
    await writeFile(path.join(data, file), value, { mode: 0o600 });
  const metadataFile = path.join(directory, "installation.json"),
    pointerFile = path.join(parent, "native-launch.json");
  const saved = JSON.parse(await readFile(metadataFile, "utf8"));
  const sourceCommit = "a".repeat(40),
    targetCommit = "b".repeat(40);
  const original = JSON.stringify({
    ...saved,
    phase: "complete",
    workspaceRoot: sourceRoot + path.sep,
    runtimeOptions: {
      nativeBundleCommit: sourceCommit,
      ollamaUrl: "http://127.0.0.1:11434/v1",
      phoneUrl: "https://private.example",
    },
  });
  await writeFile(metadataFile, original);
  await saveNativeLaunchPointer(
    parent,
    sourceRoot + path.sep,
    sourceCommit,
    directory,
  );
  const pointer = await readFile(pointerFile, "utf8");
  const lease = await acquireInstallationLease(
    directory,
    plan.settings.port,
    plan.id,
  );
  t.after(() => lease.release());
  const upgradeId = randomUUID();
  const journal: NativeUpgradeJournal = {
    schemaVersion: 1,
    upgradeId,
    installationId: plan.id,
    phase: "preparing",
    sourceRoot,
    targetRoot,
    sourceCommit,
    targetCommit,
    appPort: plan.settings.port,
    createdAt: new Date().toISOString(),
    originalMetadataSha256: nativeUpgradeHash(original),
    originalPointerSha256: nativeUpgradeHash(pointer),
    sourceDatabaseSha256: null,
    stagedDatabaseSha256: null,
    migrationReceiptSha256: null,
  };
  await writeNativeUpgradeJournal(directory, journal, lease);
  const snapshot = await snapshotNativeCluster({
    directory,
    upgradeId,
    inspectStopped: async () => ({ dataDirectory: data, postgresMajor: 17 }),
  });
  await writeFile(
    path.join(snapshot.dataDirectory, "base/1/old"),
    "migrated, retained task 73, paused",
  );
  const receipt = new OwnerPrivateStorage(
    path.join(snapshot.stagingDirectory, "migration-attempt"),
  );
  await receipt.initialize(true);
  await receipt.write(
    "receipt.json",
    JSON.stringify({
      schemaVersion: 1,
      upgradeId,
      installationId: plan.id,
      sourceCommit,
      targetCommit,
      dataDirectory: snapshot.dataDirectory,
      tables: ["agents", "tasks", "runtime_controls"].map((name) => ({
        name,
        columns: ["id"],
        rows: 1,
        sha256: "c".repeat(64),
      })),
      sequences: [],
      paused: true,
      previouslyPaused: false,
      runtimeVersion: 2,
      writeAndSequenceProbe: true,
    }),
  );
  const input = {
    directory,
    lease,
    expectedSourceDatabaseSha256: snapshot.inventory.sha256,
  };
  return {
    parent,
    plan,
    directory,
    data,
    metadataFile,
    pointerFile,
    original,
    pointer,
    journal,
    lease,
    snapshot,
    receipt,
    input,
    previous: path.join(
      directory,
      "native-upgrades",
      upgradeId,
      "previous-database",
    ),
  };
}

test("promotion keeps original database, secret paths and preferences while binding only the new package", async (t) => {
  const f = await fixture(t);
  const originalInventory = await inventoryNativeCluster(f.data);
  await qualifyNativePromotion(f.input);
  const result = await promoteNativeUpgrade(f.input);
  assert.equal(result.phase, "complete");
  assert.deepEqual(await inventoryNativeCluster(f.previous), originalInventory);
  assert.equal(
    await readFile(path.join(f.data, "base/1/old"), "utf8"),
    "migrated, retained task 73, paused",
  );
  const installed = JSON.parse(await readFile(f.metadataFile, "utf8"));
  assert.deepEqual(installed.plan, JSON.parse(f.original).plan);
  assert.deepEqual(installed.secretFiles, JSON.parse(f.original).secretFiles);
  assert.equal(
    installed.runtimeOptions.ollamaUrl,
    JSON.parse(f.original).runtimeOptions.ollamaUrl,
  );
  assert.equal(
    installed.runtimeOptions.phoneUrl,
    JSON.parse(f.original).runtimeOptions.phoneUrl,
  );
  assert.equal(installed.workspaceRoot, f.journal.targetRoot);
  assert.equal(
    installed.runtimeOptions.nativeBundleCommit,
    f.journal.targetCommit,
  );
  assert.equal(
    await readNativeLaunchPointer(
      f.parent,
      f.journal.targetRoot,
      f.journal.targetCommit,
    ),
    f.directory,
  );
  await assert.rejects(
    readNativeLaunchPointer(
      f.parent,
      f.journal.sourceRoot + path.sep,
      f.journal.sourceCommit,
    ),
  );
  await assertNativeUpgradeStartupReady(
    f.directory,
    f.journal.targetRoot,
    f.journal.targetCommit,
  );
  await writeFile(path.join(f.data, "base/1/old"), "newly accepted user work");
  installed.phase = "failed";
  await writeFile(f.metadataFile, JSON.stringify(installed));
  await promoteNativeUpgrade(f.input);
  assert.equal(
    await readFile(path.join(f.data, "base/1/old"), "utf8"),
    "newly accepted user work",
  );
  assert.equal(
    JSON.parse(await readFile(f.metadataFile, "utf8")).phase,
    "failed",
  );
});

const interruptions = [
  "guard:before",
  "guard:after",
  "journal:guarded",
  "retain:before",
  "retain:after",
  "journal:original_retained",
  "promote:before",
  "promote:after",
  "journal:promoted",
  "pointer:before",
  "pointer:after",
  "journal:pointer_bound",
  "finalize:before",
  "finalize:after",
  "journal:complete",
];
test(
  "promotion recovers every before/after interruption without starting an ambiguous installation",
  { timeout: 300000, concurrency: process.platform === "darwin" ? 1 : 2 },
  async (t) => {
    await Promise.all(
      interruptions.map((interruption) =>
        t.test(interruption, async (sub) => {
          const f = await fixture(sub);
          await qualifyNativePromotion(f.input);
          await assert.rejects(
            promoteNativeUpgrade({
              ...f.input,
              checkpoint: (event) => {
                if (event === interruption) throw new Error("simulated crash");
              },
            }),
            /simulated crash/u,
          );
          const journal = await readNativeUpgradeJournal(f.directory);
          if (journal?.phase !== "complete")
            await assert.rejects(
              assertNativeUpgradeStartupReady(
                f.directory,
                f.journal.targetRoot,
                f.journal.targetCommit,
              ),
            );
          const metadata = JSON.parse(await readFile(f.metadataFile, "utf8"));
          if (metadata.workspaceRoot === f.journal.targetRoot)
            assert.notEqual(
              metadata.runtimeOptions.nativeBundleCommit,
              f.journal.sourceCommit,
            );
          let recovery = f.input;
          if (interruption === "promote:after") {
            await f.lease.release();
            const replacement = await acquireInstallationLease(
              f.directory,
              f.plan.settings.port,
              f.plan.id,
            );
            sub.after(() => replacement.release());
            recovery = { ...f.input, lease: replacement };
          }
          assert.equal(
            (await promoteNativeUpgrade(recovery)).phase,
            "complete",
          );
          assert.equal(
            await readFile(path.join(f.previous, "base/1/old"), "utf8"),
            "original complete task 73",
          );
          assert.equal(
            await readFile(path.join(f.data, "base/1/old"), "utf8"),
            "migrated, retained task 73, paused",
          );
        }),
      ),
    );
  },
);

test(
  "promotion refuses changed receipt, source, staging, pointer or metadata before moving original data",
  { concurrency: process.platform === "darwin" ? 1 : 2 },
  async (t) => {
    await Promise.all(
      (["receipt", "source", "staging", "pointer", "metadata"] as const).map(
        (changed) =>
          t.test(changed, async (sub) => {
            const f = await fixture(sub);
            await qualifyNativePromotion(f.input);
            if (changed === "receipt")
              await f.receipt.write("receipt.json", "{}");
            if (changed === "source")
              await writeFile(
                path.join(f.data, "base/1/old"),
                "changed source",
              );
            if (changed === "staging")
              await writeFile(
                path.join(f.snapshot.dataDirectory, "base/1/old"),
                "changed staging",
              );
            if (changed === "pointer") await writeFile(f.pointerFile, "{}");
            if (changed === "metadata") await writeFile(f.metadataFile, "{}");
            await assert.rejects(promoteNativeUpgrade(f.input));
            await lstat(f.data);
            await assert.rejects(lstat(f.previous), { code: "ENOENT" });
          }),
      ),
    );
  },
);

test("staging qualification refuses a mismatched migration receipt and a forged lease", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    qualifyNativePromotion({ ...f.input, lease: { ...f.lease } }),
  );
  const receipt = JSON.parse((await f.receipt.read("receipt.json"))!);
  await f.receipt.write(
    "receipt.json",
    JSON.stringify({ ...receipt, targetCommit: "d".repeat(40) }),
  );
  await assert.rejects(qualifyNativePromotion(f.input));
  assert.equal(
    (await readNativeUpgradeJournal(f.directory))?.phase,
    "preparing",
  );
  assert.equal(await readFile(f.metadataFile, "utf8"), f.original);
});

test("qualification rejects a cross-filesystem staging layout before guarding the original installation", async (t) => {
  const f = await fixture(t),
    originalStat = fs.lstat.bind(fs);
  t.mock.method(fs, "lstat", async (...args: Parameters<typeof fs.lstat>) => {
    const result = await originalStat(...args);
    if (String(args[0]) === f.snapshot.dataDirectory) {
      if (typeof result.dev === "bigint") result.dev += 1n;
      else result.dev += 1;
    }
    return result;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      qualifyNativePromotion(f.input),
      /native_upgrade_filesystem_unsupported/u,
    );
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal(await readFile(f.metadataFile, "utf8"), f.original);
  assert.equal(
    (await readNativeUpgradeJournal(f.directory))?.phase,
    "preparing",
  );
});
