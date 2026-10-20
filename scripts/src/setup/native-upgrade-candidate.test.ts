import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { OwnerPrivateStorage } from "@workspace/ai-server/owner-private-storage";
import { nativeRequiredFiles } from "./native-distribution";
import { planInstallation } from "./plan";
import { createInstallationResources } from "./resources";
import {
  readNativeLaunchPointer,
  saveNativeLaunchPointer,
} from "./native-launch";
import { discoverNativeUpgradeCandidate } from "./native-upgrade-candidate";

const sourceCommit = "8946dea16eeb314e66b078995b98d0e43a631fdc",
  targetCommit = "b".repeat(40);
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
async function packageFixture(root: string, commit: string, version?: string) {
  const files = new Map(
    nativeRequiredFiles({
      platform: process.platform,
      architecture: process.arch,
    }).map((file) => [file, "fixture"]),
  );
  files.set(
    "artifacts/api-server/dist/db-migrations/meta/_journal.json",
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: [
        {
          idx: 0,
          version: "7",
          when: 1787793107186,
          tag: "0000_initial",
          breakpoints: true,
        },
      ],
    }),
  );
  files.set(
    "artifacts/api-server/dist/db-migrations/0000_initial.sql",
    "SELECT 1;\n",
  );
  if (version) {
    files.set(
      "native-release.json",
      JSON.stringify({
        schemaVersion: 1,
        applicationVersion: version,
        commit,
        upgradeProtocol: 1,
      }),
    );
    files.set("artifacts/api-server/dist/native-upgrade.mjs", "fixture");
    files.set("scripts/src/setup/stage-postgres.mjs", "fixture");
  }
  for (const [file, bytes] of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), bytes);
  }
  await writeFile(
    path.join(root, "native-distribution.json"),
    JSON.stringify({
      schemaVersion: 1,
      commit,
      target: `${process.platform}-${process.arch}`,
      nodeVersion: "24.21.0",
      postgresVersion: "17.10",
      files: [...files].map(([file, value]) => ({
        path: file,
        bytes: Buffer.byteLength(value),
        sha256: hash(value),
      })),
    }),
  );
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-upgrade-discovery-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "previous package"),
    targetRoot = path.join(root, "new package"),
    parent = path.join(root, "private");
  await packageFixture(sourceRoot, sourceCommit);
  await packageFixture(targetRoot, targetCommit, "0.5.6");
  const capabilities = {
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    postgresClientVersion: null,
    composeVersion: null,
    native: { ready: true, issues: [], managedDatabase: true },
    container: { ready: false, issues: [] },
  };
  const plan = planInstallation(
    {
      mode: "native",
      locale: "ar",
      port: 5031,
      accessMode: "approval",
      provider: "openrouter",
      phoneAccess: "local",
      toolPacks: ["data", "web"],
    },
    capabilities,
  );
  const resources = await createInstallationResources(parent, plan, {
    databaseUrl: "postgresql://agentic:fixture-secret@127.0.0.1:58242/postgres",
    providerKey: "fixture-provider-secret",
  });
  const directory = resources.directory,
    metadataFile = path.join(directory, "installation.json"),
    pointerFile = path.join(parent, "native-launch.json");
  const original = JSON.stringify({
    ...JSON.parse(await readFile(metadataFile, "utf8")),
    phase: "complete",
    workspaceRoot: sourceRoot + path.sep,
    runtimeOptions: { nativeBundleCommit: sourceCommit },
  });
  await writeFile(metadataFile, original);
  await saveNativeLaunchPointer(
    parent,
    sourceRoot + path.sep,
    sourceCommit,
    directory,
  );
  const pointer = await readFile(pointerFile, "utf8");
  const journal = {
    schemaVersion: 1,
    upgradeId: randomUUID(),
    installationId: plan.id,
    phase: "preparing",
    sourceRoot,
    targetRoot,
    sourceCommit,
    targetCommit,
    appPort: 5031,
    createdAt: new Date().toISOString(),
    originalMetadataSha256: hash(original),
    originalPointerSha256: hash(pointer),
    sourceDatabaseSha256: null as string | null,
    stagedDatabaseSha256: null as string | null,
    migrationReceiptSha256: null as string | null,
  };
  return {
    root,
    sourceRoot,
    targetRoot,
    parent,
    plan,
    directory,
    metadataFile,
    pointerFile,
    original,
    pointer,
    journal,
    options: { installationParent: parent, targetRoot },
  };
}
async function digest(root: string): Promise<string> {
  const rows = [];
  for (const name of (await readdir(root)).sort()) {
    const file = path.join(root, name),
      info = await lstat(file);
    rows.push([
      name,
      info.mode,
      info.isDirectory() ? await digest(file) : hash(await readFile(file)),
    ]);
  }
  return hash(JSON.stringify(rows));
}

test("native installer discovers a verified remembered predecessor without writes or weaker normal resume", async (t) => {
  const f = await fixture(t),
    before = await digest(f.root);
  const result = await discoverNativeUpgradeCandidate(f.options);
  assert.equal(result?.mode, "upgrade");
  assert.equal(result?.directory, f.directory);
  assert.equal(result?.locale, "ar");
  assert.equal(result?.sourceVersion, "0.5.5");
  assert.equal(result?.targetVersion, "0.5.6");
  assert.equal(result?.installationId, f.plan.id);
  assert.equal(result?.metadataSha256, hash(f.original));
  assert.equal(result?.pointerSha256, hash(f.pointer));
  assert.doesNotMatch(
    JSON.stringify(result),
    /fixture-secret|fixture-provider-secret|postgresql:/u,
  );
  await assert.rejects(
    readNativeLaunchPointer(f.parent, f.targetRoot, targetCommit),
    /native_launch_identity/u,
  );
  assert.equal(await digest(f.root), before);
});

test("absent remembered state stays fresh without creating directories; same package stays a normal resume", async (t) => {
  const f = await fixture(t),
    missing = path.join(f.root, "not-created");
  assert.equal(
    await discoverNativeUpgradeCandidate({
      ...f.options,
      installationParent: missing,
    }),
    null,
  );
  await assert.rejects(lstat(missing), { code: "ENOENT" });
  await writeFile(
    f.metadataFile,
    JSON.stringify({
      ...JSON.parse(f.original),
      workspaceRoot: f.targetRoot,
      runtimeOptions: { nativeBundleCommit: targetCommit },
    }),
  );
  await writeFile(
    f.pointerFile,
    JSON.stringify({
      schemaVersion: 1,
      workspaceRoot: f.targetRoot,
      commit: targetCommit,
      directory: f.directory,
    }),
  );
  assert.equal(await discoverNativeUpgradeCandidate(f.options), null);
});

test("preparing attempts offer a fresh-copy retry and guarded/pointer-bound attempts offer exact-target recovery", async (t) => {
  const f = await fixture(t);
  const journalFile = path.join(f.directory, "native-upgrade.json");
  await new OwnerPrivateStorage(f.directory).write(
    "native-upgrade.json",
    JSON.stringify(f.journal),
  );
  assert.equal(
    (await discoverNativeUpgradeCandidate(f.options))?.mode,
    "retry",
  );
  const attempt = new OwnerPrivateStorage(
    path.join(f.directory, "native-upgrades", f.journal.upgradeId),
  );
  await mkdir(path.dirname(attempt.directory));
  await attempt.initialize(true);
  await attempt.write("original-installation.json", f.original);
  const guarded = {
    ...JSON.parse(f.original),
    phase: "native_upgrade_incomplete",
    workspaceRoot: f.targetRoot,
    runtimeOptions: { nativeBundleCommit: targetCommit },
  };
  await writeFile(f.metadataFile, JSON.stringify(guarded));
  for (const phase of ["guarded", "pointer_bound"]) {
    await writeFile(
      journalFile,
      JSON.stringify({
        ...f.journal,
        phase,
        sourceDatabaseSha256: "c".repeat(64),
        stagedDatabaseSha256: "d".repeat(64),
        migrationReceiptSha256: "e".repeat(64),
      }),
    );
    if (phase === "pointer_bound")
      await writeFile(
        f.pointerFile,
        JSON.stringify({
          schemaVersion: 1,
          workspaceRoot: f.targetRoot,
          commit: targetCommit,
          directory: f.directory,
        }),
      );
    const result = await discoverNativeUpgradeCandidate(f.options);
    assert.equal(result?.mode, "recover");
    assert.equal(result?.upgradeId, f.journal.upgradeId);
    assert.equal(result?.locale, "ar");
  }
  const before = await digest(f.root);
  await assert.rejects(
    discoverNativeUpgradeCandidate({ ...f.options, targetRoot: f.sourceRoot }),
    /native_upgrade_candidate_invalid/u,
  );
  assert.equal(await digest(f.root), before);
});

test("explicit installation discovery still requires its own exact remembered pointer", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await discoverNativeUpgradeCandidate({
        ...f.options,
        directory: f.directory,
      })
    )?.directory,
    f.directory,
  );
  await writeFile(
    f.pointerFile,
    JSON.stringify({
      schemaVersion: 1,
      workspaceRoot: f.sourceRoot,
      commit: sourceCommit,
      directory: path.join(f.parent, `instance-${randomUUID()}`),
    }),
  );
  await assert.rejects(
    discoverNativeUpgradeCandidate({ ...f.options, directory: f.directory }),
    /native_upgrade_candidate_invalid/u,
  );
});

test("corrupt remembered state, different instance ids and changed package bytes never silently become a fresh install", async (t) => {
  const f = await fixture(t);
  for (const value of [
    "not JSON",
    JSON.stringify({
      schemaVersion: 1,
      workspaceRoot: f.sourceRoot,
      commit: sourceCommit,
      directory: f.sourceRoot,
    }),
    f.pointer.replace(f.plan.id, randomUUID()),
  ]) {
    await writeFile(f.pointerFile, value);
    await assert.rejects(
      discoverNativeUpgradeCandidate(f.options),
      /native_upgrade_candidate_invalid/u,
    );
  }
  await writeFile(f.pointerFile, f.pointer);
  await writeFile(
    path.join(f.targetRoot, "scripts/src/setup/bootstrap.mjs"),
    "altered bytes",
  );
  await assert.rejects(
    discoverNativeUpgradeCandidate(f.options),
    /native_upgrade_candidate_invalid/u,
  );
});
