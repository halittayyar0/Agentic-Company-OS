import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import {
  inspectNativeUpgrade,
  inspectNativeUpgradePackages,
  readNativeMigrationHistory,
} from "./native-upgrade-preflight";
import {
  nativeRequiredFiles,
  type NativeDistribution,
} from "./native-distribution";
import { planInstallation } from "./plan";
import { createInstallationResources } from "./resources";
import { saveNativeLaunchPointer } from "./native-launch";

const legacy = "8946dea16eeb314e66b078995b98d0e43a631fdc";
const next = "b".repeat(40);
const hash = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const prefix = "artifacts/api-server/dist/db-migrations/";
const journal = (count: number) => ({
  version: "7",
  dialect: "postgresql",
  entries: Array.from({ length: count }, (_, idx) => ({
    idx,
    version: "7",
    when: 1787793107186 + idx,
    tag: `${String(idx).padStart(4, "0")}_migration`,
    breakpoints: true,
  })),
});

test("recovery can revalidate exact source/target package compatibility without trusting guarded live metadata", async (t) => {
  const f = await fixture(t);
  await writeFile(f.metadataFile, "guarded or interrupted live record");
  const result = await inspectNativeUpgradePackages({
    sourceRoot: f.sourceRoot,
    targetRoot: f.targetRoot,
  });
  assert.equal(result.source.summary.commit, legacy);
  assert.equal(result.target.summary.commit, next);
  assert.deepEqual(result.migrations, { retained: 2, added: 1 });
  await assert.rejects(
    inspectNativeUpgradePackages({
      sourceRoot: f.targetRoot,
      targetRoot: f.sourceRoot,
    }),
    /native_upgrade_unknown_release/u,
  );
});

async function packageFixture(
  root: string,
  commit: string,
  version?: string,
  count = 2,
) {
  const content = new Map(
    nativeRequiredFiles({
      platform: process.platform,
      architecture: process.arch,
    }).map((file) => [file, "fixture"]),
  );
  content.set(`${prefix}meta/_journal.json`, JSON.stringify(journal(count)));
  for (const row of journal(count).entries)
    content.set(`${prefix}${row.tag}.sql`, `-- ${row.tag}\nSELECT 1;\n`);
  if (version)
    content.set("artifacts/api-server/dist/native-upgrade.mjs", "fixture");
  if (version) content.set("scripts/src/setup/stage-postgres.mjs", "fixture");
  if (version)
    content.set("scripts/src/setup/setup-upgrade-client.js", "fixture");
  if (version)
    content.set(
      "native-release.json",
      JSON.stringify({
        schemaVersion: 1,
        applicationVersion: version,
        commit,
        upgradeProtocol: 1,
      }),
    );
  const manifest: NativeDistribution = {
    schemaVersion: 1,
    commit,
    target: `${process.platform}-${process.arch}`,
    nodeVersion: "24.21.0",
    postgresVersion: "17.10",
    files: [...content].map(([file, bytes]) => ({
      path: file,
      bytes: Buffer.byteLength(bytes),
      sha256: hash(bytes),
    })),
  };
  for (const [file, bytes] of content) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), bytes);
  }
  await writeFile(
    path.join(root, "native-distribution.json"),
    JSON.stringify(manifest),
  );
  return manifest;
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos upgrade "),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "old package");
  const targetRoot = path.join(root, "new package");
  const parent = path.join(root, "private data");
  await packageFixture(sourceRoot, legacy);
  await packageFixture(targetRoot, next, "0.5.6", 3);
  const caps = {
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
    caps,
  );
  const resources = await createInstallationResources(parent, plan, {
    databaseUrl:
      "postgresql://agentic:private-database-password@127.0.0.1:58242/postgres",
    providerKey: "private-test-provider-key",
  });
  const metadataFile = path.join(resources.directory, "installation.json");
  const saved = JSON.parse(await readFile(metadataFile, "utf8"));
  const record = {
    ...saved,
    phase: "complete",
    workspaceRoot: sourceRoot,
    runtimeOptions: { nativeBundleCommit: legacy },
  };
  await writeFile(metadataFile, JSON.stringify(record));
  await saveNativeLaunchPointer(
    parent,
    sourceRoot,
    legacy,
    resources.directory,
  );
  return {
    root,
    sourceRoot,
    targetRoot,
    parent,
    directory: resources.directory,
    record,
    metadataFile,
    pointerFile: path.join(parent, "native-launch.json"),
    options: { directory: resources.directory, targetRoot },
  };
}

async function tree(root: string): Promise<unknown[]> {
  const result: unknown[] = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const name = entry.name,
      file = path.join(root, name);
    const content = entry.isDirectory()
      ? await tree(file)
      : hash(await readFile(file));
    const info = await lstat(file);
    result.push([name, info.mode, info.nlink, content]);
  }
  return result;
}

async function changeInventoriedFile(
  root: string,
  file: string,
  bytes: string,
) {
  const manifestFile = path.join(root, "native-distribution.json");
  const manifest = JSON.parse(
    await readFile(manifestFile, "utf8"),
  ) as NativeDistribution;
  const row = manifest.files.find((entry) => entry.path === file)!;
  row.bytes = Buffer.byteLength(bytes);
  row.sha256 = hash(bytes);
  await writeFile(path.join(root, file), bytes);
  await writeFile(manifestFile, JSON.stringify(manifest));
}

test("upgrade inspection recognizes the reviewed legacy release, preserves exact identity and writes nothing", async (t) => {
  const f = await fixture(t),
    before = await tree(f.root);
  const report = await inspectNativeUpgrade(f.options);
  assert.equal(report.source.applicationVersion, "0.5.5");
  assert.equal(report.source.commit, legacy);
  assert.equal(report.source.root, f.sourceRoot);
  assert.equal(report.target.applicationVersion, "0.5.6");
  assert.equal(report.target.commit, next);
  assert.equal(report.installation.directory, f.directory);
  assert.equal(report.installation.id, f.record.plan.id);
  assert.equal(report.installation.locale, "ar");
  assert.equal(
    report.installation.metadataSha256,
    hash(await readFile(f.metadataFile)),
  );
  assert.equal(
    report.installation.pointerSha256,
    hash(await readFile(f.pointerFile)),
  );
  assert.equal(report.migrations.retained, 2);
  assert.equal(report.migrations.added, 1);
  assert.doesNotMatch(
    JSON.stringify(report),
    /private-(?:test-provider-key|database-password)/u,
  );
  assert.deepEqual(await tree(f.root), before);
});

test("upgrade inspection accepts versioned predecessors and equal migration history with a newer patch", async (t) => {
  const f = await fixture(t);
  await packageFixture(f.sourceRoot, legacy, "0.5.6");
  await packageFixture(f.targetRoot, next, "0.5.7", 2);
  const report = await inspectNativeUpgrade(f.options);
  assert.equal(report.source.applicationVersion, "0.5.6");
  assert.equal(report.migrations.added, 0);
});

test("upgrade inspection accepts bootstrap's trailing directory separator without relaxing the stored pointer identity", async (t) => {
  const f = await fixture(t),
    storedRoot = f.sourceRoot + path.sep;
  await writeFile(
    f.metadataFile,
    JSON.stringify({ ...f.record, workspaceRoot: storedRoot }),
  );
  const pointer = JSON.parse(await readFile(f.pointerFile, "utf8"));
  await writeFile(
    f.pointerFile,
    JSON.stringify({ ...pointer, workspaceRoot: storedRoot }),
  );
  const report = await inspectNativeUpgrade({
    ...f.options,
    targetRoot: f.targetRoot + path.sep,
  });
  assert.equal(report.source.root, f.sourceRoot);
  assert.equal(report.target.root, f.targetRoot);
  await writeFile(f.pointerFile, JSON.stringify(pointer));
  await assert.rejects(
    inspectNativeUpgrade(f.options),
    /native_launch_identity/u,
  );
});

test("upgrade compatibility rejects missing identities, unknown predecessors, downgrades and protocols", async (t) => {
  for (const [sourceVersion, targetVersion] of [
    [undefined, undefined],
    ["0.5.6", "0.5.6"],
    ["0.5.7", "0.5.6"],
    ["0.4.9", "0.5.6"],
    ["0.5.4", "0.5.6"],
    ["0.5.5", "0.6.0"],
    ["1.0.0", "2.0.0"],
    ["0.5.5", "0.5.6-beta.1"],
  ] as const) {
    const f = await fixture(t);
    await packageFixture(f.sourceRoot, legacy, sourceVersion);
    await packageFixture(f.targetRoot, next, targetVersion, 3);
    await assert.rejects(
      inspectNativeUpgrade(f.options),
      /native_(?:upgrade|release)/u,
    );
  }
  const f = await fixture(t);
  const unknown = "c".repeat(40);
  await packageFixture(f.sourceRoot, unknown);
  await writeFile(
    f.metadataFile,
    JSON.stringify({
      ...f.record,
      runtimeOptions: { nativeBundleCommit: unknown },
    }),
  );
  await writeFile(
    f.pointerFile,
    JSON.stringify({
      schemaVersion: 1,
      workspaceRoot: f.sourceRoot,
      commit: unknown,
      directory: f.directory,
    }),
  );
  await assert.rejects(inspectNativeUpgrade(f.options), /native_upgrade/u);
  const protocolFixture = await fixture(t);
  await changeInventoriedFile(
    protocolFixture.targetRoot,
    "native-release.json",
    JSON.stringify({
      schemaVersion: 1,
      applicationVersion: "0.5.6",
      commit: next,
      upgradeProtocol: 2,
    }),
  );
  await assert.rejects(
    inspectNativeUpgrade(protocolFixture.options),
    /native_release_identity/u,
  );
});

test("upgrade inspection rejects same-commit repacks and nested source, target or instance roots", async (t) => {
  const f = await fixture(t);
  await packageFixture(f.targetRoot, legacy, "0.5.6", 3);
  await assert.rejects(
    inspectNativeUpgrade(f.options),
    /native_upgrade_unsupported_version/u,
  );
  for (const root of [
    path.join(f.sourceRoot, "nested package"),
    path.join(f.directory, "nested package"),
    f.root,
  ]) {
    await packageFixture(root, next, "0.5.6", 3);
    await assert.rejects(
      inspectNativeUpgrade({ ...f.options, targetRoot: root }),
      /native_upgrade_path/u,
    );
  }
});

test("upgrade inspection rejects hardlinked metadata and pointer files and redacts invalid database URLs", async (t) => {
  for (const which of ["metadataFile", "pointerFile"] as const) {
    const f = await fixture(t);
    await link(f[which], path.join(f.root, "linked-private-metadata"));
    await assert.rejects(
      inspectNativeUpgrade(f.options),
      /Invalid private installation file/u,
    );
  }
  const f = await fixture(t);
  await writeFile(
    path.join(f.directory, "secrets/database_url"),
    "private-database-password",
  );
  await assert.rejects(inspectNativeUpgrade(f.options), (error: Error) => {
    assert.equal(error.message, "native_upgrade_database_identity");
    assert.doesNotMatch(error.message, /private-database-password/u);
    return true;
  });
});

test("upgrade inspection refuses changed package bytes and a different native target", async (t) => {
  for (const which of ["sourceRoot", "targetRoot"] as const) {
    const f = await fixture(t);
    await writeFile(
      path.join(f[which], "scripts/src/setup/bootstrap.mjs"),
      "tampered",
    );
    await assert.rejects(
      inspectNativeUpgrade(f.options),
      /native_package_integrity/u,
    );
  }
  const f = await fixture(t),
    file = path.join(f.targetRoot, "native-distribution.json");
  const value = JSON.parse(await readFile(file, "utf8"));
  await writeFile(
    file,
    JSON.stringify({
      ...value,
      target: process.platform === "linux" ? "darwin-x64" : "linux-x64",
    }),
  );
  await assert.rejects(
    inspectNativeUpgrade(f.options),
    /native_package_manifest/u,
  );
});

test("upgrade inspection refuses altered or non-prefix migration history even with internally consistent inventories", async (t) => {
  for (const mutation of [
    "sql",
    "timestamp",
    "tag",
    "truncate",
    "duplicate",
    "unlisted",
  ] as const) {
    const f = await fixture(t);
    if (mutation === "sql")
      await changeInventoriedFile(
        f.targetRoot,
        `${prefix}0000_migration.sql`,
        "SELECT 'rewritten';",
      );
    else {
      const value = journal(mutation === "truncate" ? 1 : 3);
      if (mutation === "timestamp") value.entries[0].when++;
      if (mutation === "tag") value.entries[0].tag = "0000_other";
      if (mutation === "duplicate") value.entries[1] = { ...value.entries[0] };
      if (mutation === "unlisted") value.entries[2].tag = "0002_missing";
      await changeInventoriedFile(
        f.targetRoot,
        `${prefix}meta/_journal.json`,
        JSON.stringify(value),
      );
    }
    await assert.rejects(
      inspectNativeUpgrade(f.options),
      /native_upgrade_migration/u,
      mutation,
    );
  }
});

test("migration history must still match its verified inventory when read again", async (t) => {
  const f = await fixture(t);
  const manifest = JSON.parse(
    await readFile(path.join(f.targetRoot, "native-distribution.json"), "utf8"),
  ) as NativeDistribution;
  await writeFile(
    path.join(f.targetRoot, `${prefix}meta/_journal.json`),
    JSON.stringify(journal(2)),
  );
  await assert.rejects(
    readNativeMigrationHistory(f.targetRoot, manifest),
    /native_upgrade_migration/u,
  );
});

test("upgrade inspection refuses incomplete, foreign, unsafe or nonnative installation records without writes", async (t) => {
  for (const patch of [
    { phase: "failed" },
    { schemaVersion: 2 },
    { workspaceRoot: "relative" },
    { workspaceRoot: path.resolve("missing-package") },
    { runtimeOptions: { nativeBundleCommit: next } },
  ]) {
    const f = await fixture(t);
    await writeFile(f.metadataFile, JSON.stringify({ ...f.record, ...patch }));
    const before = await tree(f.root);
    await assert.rejects(inspectNativeUpgrade(f.options));
    assert.deepEqual(await tree(f.root), before);
  }
  for (const settings of [{ mode: "container" }, { codingRuntime: true }]) {
    const f = await fixture(t);
    await writeFile(
      f.metadataFile,
      JSON.stringify({
        ...f.record,
        plan: {
          ...f.record.plan,
          settings: { ...f.record.plan.settings, ...settings },
        },
      }),
    );
    await assert.rejects(inspectNativeUpgrade(f.options), /native_upgrade/u);
  }
  const f = await fixture(t);
  const before = await tree(f.root);
  await assert.rejects(
    inspectNativeUpgrade({
      ...f.options,
      directory: path.join(f.root, "absent"),
    }),
  );
  assert.deepEqual(await tree(f.root), before);
  await assert.rejects(
    inspectNativeUpgrade({ ...f.options, targetRoot: f.sourceRoot }),
    /native_upgrade/u,
  );
  await assert.rejects(
    inspectNativeUpgrade({ ...f.options, targetRoot: f.directory }),
    /native_upgrade/u,
  );
});

test("upgrade inspection requires the original remembered instance and complete regular secret files", async (t) => {
  for (const change of [
    "pointer",
    "missing-pointer",
    "id",
    "missing-secret",
    "credential",
    "linked-secret",
  ] as const) {
    const f = await fixture(t);
    const secret = path.join(f.directory, "secrets", "operator_auth_token");
    if (change === "pointer") {
      const value = JSON.parse(await readFile(f.pointerFile, "utf8"));
      await writeFile(
        f.pointerFile,
        JSON.stringify({
          ...value,
          directory: path.join(
            f.parent,
            "instance-12345678-1234-1234-1234-123456789012",
          ),
        }),
      );
    }
    if (change === "missing-pointer") await rm(f.pointerFile);
    if (change === "id")
      await writeFile(
        f.metadataFile,
        JSON.stringify({
          ...f.record,
          plan: {
            ...f.record.plan,
            id: "12345678-1234-1234-1234-123456789012",
          },
        }),
      );
    if (change === "missing-secret") await rm(secret);
    if (change === "credential")
      await writeFile(
        path.join(f.directory, "secrets", "database_url"),
        "postgresql://agentic:private-database-password@remote.example/postgres",
      );
    if (change === "linked-secret")
      await link(secret, path.join(f.root, "linked-credential"));
    const before = await tree(f.root);
    await assert.rejects(inspectNativeUpgrade(f.options));
    assert.deepEqual(await tree(f.root), before);
  }
});

test("upgrade inspection rejects redirected package, instance and secret directory paths", async (t) => {
  for (const which of ["package", "instance", "secrets"] as const) {
    const f = await fixture(t);
    const alias = path.join(f.root, `alias-${which}`);
    const actual =
      which === "package"
        ? f.sourceRoot
        : which === "instance"
          ? f.directory
          : path.join(f.directory, "secrets");
    await symlink(
      actual,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    if (which === "package")
      await writeFile(
        f.metadataFile,
        JSON.stringify({ ...f.record, workspaceRoot: alias }),
      );
    if (which === "secrets") {
      // Redirect an ancestor, not just a credential file leaf.
      const { rename } = await import("node:fs/promises");
      await rm(alias);
      await rename(actual, actual + "-original");
      await symlink(
        actual + "-original",
        actual,
        process.platform === "win32" ? "junction" : "dir",
      );
    }
    await assert.rejects(
      inspectNativeUpgrade(
        which === "instance" ? { ...f.options, directory: alias } : f.options,
      ),
    );
  }
});
