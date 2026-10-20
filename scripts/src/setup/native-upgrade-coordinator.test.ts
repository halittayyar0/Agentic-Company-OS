import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import test, { type TestContext } from "node:test";
import { OwnerPrivateStorage } from "@workspace/ai-server/owner-private-storage";
import { nativeRequiredFiles } from "./native-distribution";
import { planInstallation } from "./plan";
import { createInstallationResources } from "./resources";
import { saveNativeLaunchPointer } from "./native-launch";
import {
  acquireInstallationLease,
  assertInstallationLease,
} from "./installation-lease";
import { inventoryNativeCluster } from "./native-cluster-snapshot";
import { readNativeUpgradeJournal } from "./native-upgrade-journal";
import { createNativeUpgradeCoordinator } from "./native-upgrade-coordinator";

const legacy = "8946dea16eeb314e66b078995b98d0e43a631fdc",
  targetCommit = "b".repeat(40);
const hash = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");
async function packageFixture(root: string, commit: string, version?: string) {
  const entries = [
    {
      idx: 0,
      version: "7",
      when: 1787793107186,
      tag: "0000_initial",
      breakpoints: true,
    },
  ];
  const files = new Map(
    nativeRequiredFiles({
      platform: process.platform,
      architecture: process.arch,
    }).map((file) => [file, "fixture"]),
  );
  files.set(
    "artifacts/api-server/dist/db-migrations/meta/_journal.json",
    JSON.stringify({ version: "7", dialect: "postgresql", entries }),
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
      files: [...files].map(([file, bytes]) => ({
        path: file,
        bytes: Buffer.byteLength(bytes),
        sha256: hash(bytes),
      })),
    }),
  );
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-coordinator-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "old package"),
    targetRoot = path.join(root, "new package"),
    parent = path.join(root, "private");
  await packageFixture(sourceRoot, legacy);
  await packageFixture(targetRoot, targetCommit, "0.5.6");
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
      provider: "later",
      phoneAccess: "local",
      toolPacks: ["data", "web"],
    },
    caps,
  );
  const resources = await createInstallationResources(parent, plan, {
    databaseUrl:
      "postgresql://agentic:synthetic-password@127.0.0.1:58242/postgres",
  });
  const directory = resources.directory,
    data = path.join(directory, "database");
  for (const folder of ["global", "base/1", "pg_wal", "pg_tblspc"])
    await mkdir(path.join(data, folder), { recursive: true });
  for (const [file, bytes] of [
    ["PG_VERSION", "17\n"],
    ["global/pg_control", "control"],
    ["agentic-cluster.json", "identity"],
    ["base/1/task", "completed task 73"],
  ])
    await writeFile(path.join(data, file), bytes);
  const metadataFile = path.join(directory, "installation.json"),
    pointerFile = path.join(parent, "native-launch.json");
  const saved = JSON.parse(await readFile(metadataFile, "utf8"));
  await writeFile(
    metadataFile,
    JSON.stringify({
      ...saved,
      phase: "complete",
      workspaceRoot: sourceRoot + path.sep,
      runtimeOptions: { nativeBundleCommit: legacy },
    }),
  );
  await saveNativeLaunchPointer(
    parent,
    sourceRoot + path.sep,
    legacy,
    directory,
  );
  const originalMetadata = await readFile(metadataFile, "utf8"),
    originalPointer = await readFile(pointerFile, "utf8"),
    originalHash = (await inventoryNativeCluster(data)).sha256;
  const calls: string[] = [];
  let running = false,
    failure: "migration" | "cleanup" | "inspection" | undefined;
  const coordinator = createNativeUpgradeCoordinator({
    cluster: (input) => ({
      prepare: async () => {
        calls.push(
          input.resources.directory === directory
            ? "source-prepare"
            : "copy-prepare",
        );
      },
      inspectStopped: async () => {
        const source = input.resources.directory === directory;
        assert.equal(
          running,
          false,
          "a copy cannot be inspected while its server runs",
        );
        calls.push(source ? "source-cold" : "copy-cold");
        if (!source && failure === "inspection")
          throw new Error("unclean copy");
        return {
          dataDirectory: path.join(input.resources.directory, "database"),
          postgresMajor: 17 as const,
        };
      },
    }),
    stage: async () => {
      running = true;
      calls.push("start-copy");
      return {
        stop: async () => {
          calls.push("stop-copy");
          running = false;
          if (failure === "cleanup")
            throw new Error("synthetic cleanup failure");
        },
      };
    },
    run: async (command) => {
      calls.push("migration");
      assert.equal(running, true);
      assert.equal(
        command.command,
        path.join(
          targetRoot,
          process.platform === "win32"
            ? "runtime/node/node.exe"
            : "runtime/node/bin/node",
        ),
      );
      assert.equal(command.environment.NODE_OPTIONS, "");
      assert.equal(command.args.includes("synthetic-password"), false);
      if (failure === "migration")
        throw new Error("synthetic migration failure");
      const args = command.args,
        stage = args[args.indexOf("--staging-directory") + 1],
        upgradeId = args[args.indexOf("--upgrade-id") + 1];
      const receipt = new OwnerPrivateStorage(
        path.join(stage, "migration-attempt"),
      );
      await receipt.initialize(true);
      await writeFile(
        path.join(stage, "database/base/1/task"),
        (await readFile(path.join(stage, "database/base/1/task"), "utf8")) +
          "; migrated and paused",
      );
      await receipt.write(
        "receipt.json",
        JSON.stringify({
          schemaVersion: 1,
          installationId: plan.id,
          upgradeId,
          sourceCommit: legacy,
          targetCommit,
          dataDirectory: path.join(stage, "database"),
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
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  });
  return {
    directory,
    data,
    metadataFile,
    pointerFile,
    sourceRoot,
    targetRoot,
    plan,
    coordinator,
    calls,
    originalMetadata,
    originalPointer,
    originalHash,
    options: { directory, targetRoot },
    setFailure: (value: typeof failure) => {
      failure = value;
    },
  };
}

test("coordinator completes cold-copy migration and promotion with the SAME continuously held lease", async (t) => {
  const f = await fixture(t);
  const result = await f.coordinator.upgrade(f.options);
  t.after(() => result.lease.release());
  assertInstallationLease(result.lease, f.directory, f.plan.id);
  await assert.rejects(acquireInstallationLease(f.directory, 5031, f.plan.id));
  assert.equal(result.journal.phase, "complete");
  assert.ok(f.calls.indexOf("stop-copy") < f.calls.indexOf("copy-cold"));
  const current = JSON.parse(await readFile(f.metadataFile, "utf8"));
  assert.deepEqual(current.plan.settings, f.plan.settings);
  assert.equal(current.workspaceRoot, f.targetRoot);
  assert.equal(
    (
      await inventoryNativeCluster(
        path.join(
          f.directory,
          "native-upgrades",
          result.upgradeId,
          "previous-database",
        ),
      )
    ).sha256,
    f.originalHash,
  );
  assert.match(
    await readFile(path.join(f.data, "base/1/task"), "utf8"),
    /completed task 73; migrated and paused/u,
  );
});

test("migration, cleanup and cold-inspection failures preserve source and release the lease before retry", async (t) => {
  for (const failure of ["migration", "cleanup", "inspection"] as const)
    await t.test(failure, async (t) => {
      const f = await fixture(t);
      f.setFailure(failure);
      await assert.rejects(f.coordinator.upgrade(f.options));
      assert.equal(await readFile(f.metadataFile, "utf8"), f.originalMetadata);
      assert.equal(await readFile(f.pointerFile, "utf8"), f.originalPointer);
      assert.equal(
        (await inventoryNativeCluster(f.data)).sha256,
        f.originalHash,
      );
      assert.equal(f.calls.filter((step) => step === "stop-copy").length, 1);
      const old = (await readNativeUpgradeJournal(f.directory))!;
      assert.equal(old.phase, "preparing");
      await assert.rejects(
        f.coordinator.recover(f.options),
        /preparation_retry_required/u,
      );
      const lease = await acquireInstallationLease(
        f.directory,
        5031,
        f.plan.id,
      );
      await lease.release();
      if (failure === "migration") {
        f.setFailure(undefined);
        // The old application may have accepted work after the failed preparation.
        // A new cold copy must retain it, never restore the old image.
        await writeFile(
          path.join(f.data, "base/1/task"),
          "completed task 73 plus accepted old-package work",
        );
        const result = await f.coordinator.recover({
          ...f.options,
          retryPreparation: true,
        });
        t.after(() => result.lease.release());
        assert.notEqual(result.upgradeId, old.upgradeId);
        assert.match(
          await readFile(path.join(f.data, "base/1/task"), "utf8"),
          /accepted old-package work/u,
        );
        assert.equal(
          JSON.parse(
            await readFile(
              path.join(
                f.directory,
                "native-upgrades",
                old.upgradeId,
                "journal.json",
              ),
              "utf8",
            ),
          ).phase,
          "abandoned",
        );
      }
    });
});

test("a missing original database is refused before prepare, journal creation or any initialization", async (t) => {
  const f = await fixture(t);
  await rm(f.data, { recursive: true });
  await assert.rejects(f.coordinator.upgrade(f.options), { code: "ENOENT" });
  assert.deepEqual(f.calls, []);
  assert.equal(await readNativeUpgradeJournal(f.directory), null);
  const lease = await acquireInstallationLease(f.directory, 5031, f.plan.id);
  await lease.release();
});

test("coordinator rechecks inspection under lease and refuses changed metadata before database commands", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.coordinator.upgrade({
      ...f.options,
      checkpoint: async (event) => {
        if (event === "lease:acquired")
          await writeFile(
            f.metadataFile,
            JSON.stringify({
              ...JSON.parse(f.originalMetadata),
              changed: true,
            }),
          );
      },
    }),
    /identity_changed/u,
  );
  assert.deepEqual(f.calls, []);
  assert.equal(await readNativeUpgradeJournal(f.directory), null);
});

test("a stale setup review cannot authorize an upgrade or a different recovery attempt", async (t) => {
  const f = await fixture(t);
  const releaseUnexpected = async (
    result: Awaited<ReturnType<typeof f.coordinator.upgrade>>,
  ) => {
    await result.lease.release();
    return result;
  };
  await assert.rejects(
    f.coordinator
      .upgrade({
        ...f.options,
        expectedReview: {
          sourceCommit: legacy,
          targetCommit,
          metadataSha256: "a".repeat(64),
          pointerSha256: hash(f.originalPointer),
        },
      })
      .then(releaseUnexpected),
    /review_changed/u,
  );
  assert.deepEqual(f.calls, []);
  await assert.rejects(
    f.coordinator.upgrade({
      ...f.options,
      checkpoint: (event) => {
        if (event === "retain:before")
          throw new Error("synthetic interruption");
      },
    }),
    /synthetic interruption/u,
  );
  const before = await readNativeUpgradeJournal(f.directory);
  await assert.rejects(
    f.coordinator
      .recover({
        ...f.options,
        expectedUpgradeId: "00000000-0000-0000-0000-000000000000",
      })
      .then(releaseUnexpected),
    /review_changed/u,
  );
  assert.deepEqual(await readNativeUpgradeJournal(f.directory), before);
});

test("interrupted guarded promotion recovers without rerunning migration or rolling back later work", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.coordinator.upgrade({
      ...f.options,
      checkpoint: (event) => {
        if (event === "retain:before")
          throw new Error("synthetic interruption");
      },
    }),
    /synthetic interruption/u,
  );
  assert.equal((await readNativeUpgradeJournal(f.directory))?.phase, "guarded");
  const bytes = await readFile(
    path.join(f.targetRoot, "scripts/src/setup/stage-postgres.mjs"),
    "utf8",
  );
  await writeFile(
    path.join(f.targetRoot, "scripts/src/setup/stage-postgres.mjs"),
    "changed",
  );
  await assert.rejects(
    f.coordinator.recover(f.options),
    /native_package_integrity/u,
  );
  await writeFile(
    path.join(f.targetRoot, "scripts/src/setup/stage-postgres.mjs"),
    bytes,
  );
  const result = await f.coordinator.recover(f.options);
  await result.lease.release();
  assert.equal(f.calls.filter((step) => step === "migration").length, 1);
  await writeFile(path.join(f.data, "base/1/task"), "accepted upgraded work");
  const metadata = JSON.parse(await readFile(f.metadataFile, "utf8"));
  await writeFile(
    f.metadataFile,
    JSON.stringify({ ...metadata, phase: "failed" }),
  );
  const complete = await f.coordinator.recover(f.options);
  t.after(() => complete.lease.release());
  assert.equal(
    await readFile(path.join(f.data, "base/1/task"), "utf8"),
    "accepted upgraded work",
  );
});

test("cancellation before guard preserves source; once guarded the coordinator finishes cutover", async (t) => {
  for (const afterGuard of [false, true])
    await t.test(String(afterGuard), async (t) => {
      const f = await fixture(t),
        controller = new AbortController();
      const promise = f.coordinator.upgrade({
        ...f.options,
        signal: controller.signal,
        checkpoint: (event) => {
          if (event === (afterGuard ? "guard:after" : "journal:staged"))
            controller.abort();
        },
      });
      if (afterGuard) {
        const result = await promise;
        t.after(() => result.lease.release());
        assert.equal(result.journal.phase, "complete");
      } else {
        await assert.rejects(promise, { name: "AbortError" });
        assert.equal(
          await readFile(f.metadataFile, "utf8"),
          f.originalMetadata,
        );
        const result = await f.coordinator.recover(f.options);
        t.after(() => result.lease.release());
        assert.equal(result.journal.phase, "complete");
      }
    });
});
