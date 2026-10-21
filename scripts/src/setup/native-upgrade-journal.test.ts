import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createInstallationResources } from "./resources";
import { planInstallation } from "./plan";
import { readInstallation } from "./resume";
import { acquireInstallationLease } from "./installation-lease";
import { saveNativeLaunchPointer } from "./native-launch";
import {
  assertNativeUpgradeStartupReady,
  readNativeUpgradeJournal,
  validateNativeUpgradeJournal,
  writeNativeUpgradeJournal,
  type NativeUpgradeJournal,
} from "./native-upgrade-journal";

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
    path.join(await realpath(tmpdir()), "acos-upgrade-journal-"),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const plan = planInstallation(
    {
      mode: "native",
      locale: "ar",
      port: 5031,
      accessMode: "approval",
      provider: "later",
      phoneAccess: "local",
      toolPacks: ["data"],
    },
    caps,
  );
  const resources = await createInstallationResources(parent, plan, {
    databaseUrl:
      "postgresql://agentic:private-password@127.0.0.1:58242/postgres",
  });
  const directory = resources.directory,
    sourceRoot = path.join(parent, "old"),
    targetRoot = path.join(parent, "new");
  const journal: NativeUpgradeJournal = {
    schemaVersion: 1,
    upgradeId: randomUUID(),
    installationId: plan.id,
    phase: "preparing",
    sourceRoot,
    targetRoot,
    sourceCommit: "a".repeat(40),
    targetCommit: "b".repeat(40),
    appPort: 5031,
    createdAt: new Date().toISOString(),
    originalMetadataSha256: "a".repeat(64),
    originalPointerSha256: "b".repeat(64),
    sourceDatabaseSha256: null,
    stagedDatabaseSha256: null,
    migrationReceiptSha256: null,
  };
  const metadataFile = path.join(directory, "installation.json");
  const metadata = JSON.parse(await readFile(metadataFile, "utf8"));
  await writeFile(
    metadataFile,
    JSON.stringify({
      ...metadata,
      phase: "complete",
      workspaceRoot: sourceRoot,
      runtimeOptions: { nativeBundleCommit: journal.sourceCommit },
    }),
  );
  await saveNativeLaunchPointer(
    parent,
    sourceRoot,
    journal.sourceCommit,
    directory,
  );
  journal.originalMetadataSha256 = createHash("sha256")
    .update(await readFile(metadataFile))
    .digest("hex");
  journal.originalPointerSha256 = createHash("sha256")
    .update(await readFile(path.join(parent, "native-launch.json")))
    .digest("hex");
  return {
    parent,
    plan,
    resources,
    directory,
    journal,
    metadataFile,
    journalFile: path.join(directory, "native-upgrade.json"),
  };
}

test("upgrade journal has a closed schema bound to the exact instance and both package identities", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(
    validateNativeUpgradeJournal(f.journal, f.directory),
    f.journal,
  );
  for (const patch of [
    { schemaVersion: 2 },
    { phase: "unknown" },
    { extra: true },
    { upgradeId: "../escape" },
    { installationId: randomUUID() },
    { sourceRoot: "relative" },
    { targetRoot: f.directory },
    { sourceRoot: f.journal.targetRoot },
    { sourceCommit: "main" },
    { targetCommit: f.journal.sourceCommit },
    { appPort: 80 },
    { createdAt: "yesterday" },
    { originalMetadataSha256: "bad" },
    { phase: "complete" },
    { sourceDatabaseSha256: "a".repeat(64) },
  ])
    assert.throws(() =>
      validateNativeUpgradeJournal({ ...f.journal, ...patch }, f.directory),
    );
});

test("pending upgrades block ordinary native resume before probes or credential loading", async (t) => {
  const f = await fixture(t);
  assert.equal(await readNativeUpgradeJournal(f.directory), null);
  await writeFile(f.journalFile, JSON.stringify(f.journal));
  let probed = false;
  await assert.rejects(
    readInstallation(
      f.directory,
      f.journal.sourceRoot,
      async () => {
        probed = true;
        return caps;
      },
      f.journal.sourceCommit,
    ),
    /native_upgrade_recovery_required/u,
  );
  assert.equal(probed, false);
  for (const phase of [
    "staged",
    "guarded",
    "original_retained",
    "promoted",
    "pointer_bound",
  ] as const) {
    await writeFile(
      f.journalFile,
      JSON.stringify({
        ...f.journal,
        phase,
        sourceDatabaseSha256: "c".repeat(64),
        stagedDatabaseSha256: "d".repeat(64),
        migrationReceiptSha256: "e".repeat(64),
      }),
    );
    await assert.rejects(
      assertNativeUpgradeStartupReady(
        f.directory,
        f.journal.targetRoot,
        f.journal.targetCommit,
      ),
      /native_upgrade_recovery_required/u,
    );
  }
});

test("complete journal permits normal restart and subsequent user changes without freezing metadata bytes", async (t) => {
  const f = await fixture(t);
  const completed = {
    ...f.journal,
    phase: "complete",
    sourceDatabaseSha256: "c".repeat(64),
    stagedDatabaseSha256: "d".repeat(64),
    migrationReceiptSha256: "e".repeat(64),
  };
  await writeFile(f.journalFile, JSON.stringify(completed));
  await assertNativeUpgradeStartupReady(
    f.directory,
    f.journal.targetRoot,
    f.journal.targetCommit,
  );
  await assert.rejects(
    assertNativeUpgradeStartupReady(
      f.directory,
      f.journal.sourceRoot,
      f.journal.sourceCommit,
    ),
  );
  const metadata = JSON.parse(await readFile(f.metadataFile, "utf8"));
  await writeFile(
    f.metadataFile,
    JSON.stringify({
      ...metadata,
      workspaceRoot: f.journal.targetRoot,
      runtimeOptions: { nativeBundleCommit: f.journal.targetCommit },
      completedSteps: ["verify_runtime"],
    }),
  );
  const result = await readInstallation(
    f.directory,
    f.journal.targetRoot,
    async () => caps,
    f.journal.targetCommit,
  );
  assert.equal(result.complete, true);
  assert.equal(result.plan.settings.locale, "ar");
  await writeFile(
    f.metadataFile,
    JSON.stringify({
      ...metadata,
      phase: "failed",
      workspaceRoot: f.journal.targetRoot,
      runtimeOptions: { nativeBundleCommit: f.journal.targetCommit },
    }),
  );
  const afterFailedRestart = await readInstallation(
    f.directory,
    f.journal.targetRoot,
    async () => caps,
    f.journal.targetCommit,
  );
  assert.equal(
    afterFailedRestart.complete,
    true,
    "an upgraded existing database must not reapply initial preferences after startup failure",
  );
});

test("abandoned pre-promotion journal permits only the unchanged source runtime identity", async (t) => {
  const f = await fixture(t);
  await writeFile(
    f.journalFile,
    JSON.stringify({ ...f.journal, phase: "abandoned" }),
  );
  await assertNativeUpgradeStartupReady(
    f.directory,
    f.journal.sourceRoot,
    f.journal.sourceCommit,
  );
  await assert.rejects(
    assertNativeUpgradeStartupReady(
      f.directory,
      f.journal.targetRoot,
      f.journal.targetCommit,
    ),
  );
});

test("journal writes require the real instance lease and reject illegal phase changes", async (t) => {
  const f = await fixture(t),
    lease = await acquireInstallationLease(f.directory, 5031, f.plan.id);
  t.after(() => lease.release());
  await writeNativeUpgradeJournal(f.directory, f.journal, lease);
  assert.deepEqual(await readNativeUpgradeJournal(f.directory), f.journal);
  await assert.rejects(
    writeNativeUpgradeJournal(
      f.directory,
      {
        ...f.journal,
        phase: "complete",
        sourceDatabaseSha256: "c".repeat(64),
        stagedDatabaseSha256: "d".repeat(64),
        migrationReceiptSha256: "e".repeat(64),
      },
      lease,
    ),
  );
  await assert.rejects(
    writeNativeUpgradeJournal(
      f.directory,
      { ...f.journal, phase: "abandoned" },
      { ...lease },
    ),
  );
  await writeNativeUpgradeJournal(
    f.directory,
    { ...f.journal, phase: "abandoned" },
    lease,
  );
  assert.equal(
    (await readNativeUpgradeJournal(f.directory))?.phase,
    "abandoned",
  );
});

test("corrupt and hardlinked journal records are errors rather than a fresh installation", async (t) => {
  const f = await fixture(t);
  await writeFile(f.journalFile, "{");
  await assert.rejects(
    readNativeUpgradeJournal(f.directory),
    /native_upgrade_journal/u,
  );
  await writeFile(f.journalFile, JSON.stringify(f.journal));
  await link(f.journalFile, path.join(f.parent, "external-copy"));
  await assert.rejects(readNativeUpgradeJournal(f.directory));
});
