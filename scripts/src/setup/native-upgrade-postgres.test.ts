import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
import { OwnerPrivateStorage } from "@workspace/ai-server/owner-private-storage";
import {
  prepareNativeUpgradePostgresConfiguration,
  restoreNativeUpgradePostgresConfiguration,
} from "./native-upgrade-postgres";

test("staged PostgreSQL uses controlled configuration and cannot follow the copied configuration into original data", async (t) => {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-stage-config-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const instance = path.join(root, `instance-${randomUUID()}`);
  const stage = path.join(instance, "native-upgrades", randomUUID(), "stage");
  await mkdir(path.dirname(stage), { recursive: true });
  await new OwnerPrivateStorage(stage).initialize(true);
  const data = path.join(stage, "database");
  await mkdir(data);
  await writeFile(
    path.join(data, "postgresql.conf"),
    "include '/untrusted/config'\ndata_directory='/original/database'\n",
  );
  await writeFile(
    path.join(data, "postgresql.auto.conf"),
    "archive_command='external program'\n",
  );
  const args = await prepareNativeUpgradePostgresConfiguration(stage);
  assert.ok(args.includes(`data_directory=${data}`));
  assert.ok(
    args.includes(`config_file=${path.join(stage, "upgrade-postgresql.conf")}`),
  );
  assert.ok(args.includes("archive_mode=off"));
  assert.ok(args.includes("shared_preload_libraries="));
  assert.equal(
    await readFile(path.join(data, "postgresql.auto.conf"), "utf8"),
    "# Native upgrade staging; copied auto-configuration is inactive.\n",
  );
  assert.match(
    await readFile(path.join(stage, "upgrade-pg_hba.conf"), "utf8"),
    /127\.0\.0\.1\/32 scram-sha-256/u,
  );
  assert.match(
    await readFile(path.join(data, "postgresql.conf"), "utf8"),
    /untrusted\/config/u,
  );
  await assert.rejects(prepareNativeUpgradePostgresConfiguration(stage), {
    code: "EEXIST",
  });
  await writeFile(path.join(data, "postmaster.pid"), "still running");
  await assert.rejects(
    restoreNativeUpgradePostgresConfiguration(stage),
    /native_upgrade_staging_state/u,
  );
  await rm(path.join(data, "postmaster.pid"));
  await restoreNativeUpgradePostgresConfiguration(stage);
  assert.equal(
    await readFile(path.join(data, "postgresql.auto.conf"), "utf8"),
    "archive_command='external program'\n",
  );
  const original = path.join(instance, "database");
  await mkdir(original);
  await writeFile(path.join(original, "postgresql.auto.conf"), "keep original");
  await assert.rejects(
    prepareNativeUpgradePostgresConfiguration(instance),
    /native_upgrade_staging_identity/u,
  );
  assert.equal(
    await readFile(path.join(original, "postgresql.auto.conf"), "utf8"),
    "keep original",
  );
});
