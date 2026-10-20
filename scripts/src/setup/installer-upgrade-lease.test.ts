import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createInstallationResources } from "./resources";
import { planInstallation } from "./plan";
import { createInstallationExecutor } from "./installer";
import { acquireInstallationLease } from "./installation-lease";
import { acquireInstallationLock } from "./installation-lock";
import { nativeRequiredFiles } from "./native-distribution";
import { writeNativeUpgradeJournal } from "./native-upgrade-journal";
import { nativeUpgradeHash } from "./native-upgrade-files";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

async function fixture(t: TestContext) {
  const parent = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-installer-lease-"),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
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
      toolPacks: ["data"],
    },
    caps,
  );
  const resources = await createInstallationResources(parent, plan, {
    databaseUrl: "postgresql://agentic:fixture@127.0.0.1:58242/postgres",
  });
  const lease = await acquireInstallationLease(
    resources.directory,
    plan.settings.port,
    plan.id,
  );
  t.after(() => lease.release());
  const nativeDistribution = {
    schemaVersion: 1 as const,
    commit: "b".repeat(40),
    target: `${process.platform}-${process.arch}`,
    nodeVersion: "24.21.0",
    postgresVersion: "17.10",
    files: nativeRequiredFiles({
      platform: process.platform,
      architecture: process.arch,
    }).map((file) => ({ path: file, bytes: 1, sha256: "a".repeat(64) })),
  };
  const metadataFile = path.join(resources.directory, "installation.json");
  const metadata = JSON.parse(await readFile(metadataFile, "utf8"));
  await writeFile(
    metadataFile,
    JSON.stringify({
      ...metadata,
      phase: "complete",
      workspaceRoot: process.cwd(),
      runtimeOptions: { nativeBundleCommit: nativeDistribution.commit },
    }),
  );
  const options = {
    workspaceRoot: process.cwd(),
    installationParent: parent,
    pnpmPath: process.execPath,
    nativeDistribution,
    capabilities: async () => caps,
    resume: { resources, planId: plan.id, complete: true, lease },
    applyPreferences: async () => {
      throw new Error("must not reset existing preferences");
    },
  };
  return { parent, caps, plan, resources, lease, options };
}

test("resumed installer consumes and releases an upgrade lease even when environment checks fail", async (t) => {
  const f = await fixture(t);
  const executor = createInstallationExecutor({
    ...f.options,
    capabilities: async () => {
      throw new Error("environment rejected");
    },
  });
  await assert.rejects(
    executor.execute(f.plan, {}, () => {}),
    /environment rejected/u,
  );
  const next = await acquireInstallationLock(
    f.resources.directory,
    f.plan.settings.port,
  );
  await next();
});

test("resumed installer keeps transferred lease through preparation without reacquiring it", async (t) => {
  const f = await fixture(t);
  let prepared = false,
    stopped = false;
  const executor = createInstallationExecutor({
    ...f.options,
    managedPostgres: () => ({
      inspectStopped: async () => {
        throw new Error("ordinary resume must not enter staging");
      },
      prepare: async () => {
        prepared = true;
        await assert.rejects(
          acquireInstallationLock(f.resources.directory, f.plan.settings.port),
        );
      },
      start: async () => {
        throw new Error("fixture stops before app spawn");
      },
      stop: async () => {
        stopped = true;
      },
    }),
  });
  await assert.rejects(
    executor.execute(f.plan, {}, () => {}),
    /fixture stops before app spawn/u,
  );
  assert.equal(prepared, true);
  assert.equal(stopped, true);
  const next = await acquireInstallationLock(
    f.resources.directory,
    f.plan.settings.port,
  );
  await next();
});

test("an incomplete journal also blocks direct installer resume without rewriting installed metadata", async (t) => {
  const f = await fixture(t),
    metadataFile = path.join(f.resources.directory, "installation.json");
  const before = await readFile(metadataFile, "utf8");
  await writeNativeUpgradeJournal(
    f.resources.directory,
    {
      schemaVersion: 1,
      upgradeId: randomUUID(),
      installationId: f.plan.id,
      phase: "preparing",
      sourceRoot: path.join(f.parent, "old"),
      targetRoot: process.cwd(),
      sourceCommit: "a".repeat(40),
      targetCommit: "b".repeat(40),
      appPort: 5031,
      createdAt: new Date().toISOString(),
      originalMetadataSha256: nativeUpgradeHash(before),
      originalPointerSha256: "a".repeat(64),
      sourceDatabaseSha256: null,
      stagedDatabaseSha256: null,
      migrationReceiptSha256: null,
    },
    f.lease,
  );
  const executor = createInstallationExecutor(f.options);
  await assert.rejects(
    executor.execute(f.plan, {}, () => {}),
    /native_upgrade_recovery_required/u,
  );
  assert.equal(await readFile(metadataFile, "utf8"), before);
  const release = await acquireInstallationLock(
    f.resources.directory,
    f.plan.settings.port,
  );
  await release();
});

test("failure to save recovery metadata still stops owned services and releases the transferred lease", async (t) => {
  const parent = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-record-fault-"),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const source = `
import { createInstallationResources } from ${JSON.stringify(new URL("./resources.ts", import.meta.url).href)};
import { planInstallation } from ${JSON.stringify(new URL("./plan.ts", import.meta.url).href)};
import { createInstallationExecutor } from ${JSON.stringify(new URL("./installer.ts", import.meta.url).href)};
import { acquireInstallationLease } from ${JSON.stringify(new URL("./installation-lease.ts", import.meta.url).href)};
import { acquireInstallationLock } from ${JSON.stringify(new URL("./installation-lock.ts", import.meta.url).href)};
import { mkdir,rm } from 'node:fs/promises';
import path from 'node:path';
const parent = ${JSON.stringify(parent)};
const caps={platform:process.platform,architecture:process.arch,nodeVersion:process.version,postgresClientVersion:null,composeVersion:null,native:{ready:true,issues:[],managedDatabase:true},container:{ready:false,issues:[]}};
const plan=planInstallation({mode:'native',locale:'en',port:5031,accessMode:'approval',provider:'later',phoneAccess:'local',toolPacks:[]},caps);
const resources=await createInstallationResources(parent,plan,{databaseUrl:'postgresql://agentic:fixture@127.0.0.1:58242/postgres'});
const lease=await acquireInstallationLease(resources.directory,5031,plan.id);
let stopped=false,released=false;
const executor=createInstallationExecutor({workspaceRoot:${JSON.stringify(process.cwd())},installationParent:parent,pnpmPath:process.execPath,
nativeDistribution:{schemaVersion:1,commit:'b'.repeat(40),target:process.platform+'-'+process.arch,nodeVersion:'24.21.0',postgresVersion:'17.10',files:[]},
capabilities:async()=>caps,resume:{resources,planId:plan.id,complete:true,lease},applyPreferences:async()=>{},
managedPostgres:()=>({inspectStopped:async()=>{throw Error('unexpected')},prepare:async()=>{},start:async()=>{
const record=path.join(resources.directory,'installation.json');await rm(record);await mkdir(record);throw Error('startup failed');
},stop:async()=>{stopped=true}})});
try{await executor.execute(plan,{},()=>{})}catch{}
try{const close=await acquireInstallationLock(resources.directory,5031);await close();released=true}catch{}
process.stdout.write(JSON.stringify({stopped,released})+'\\n',()=>process.exit(0));
`;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", source],
    {
      cwd: process.cwd(),
      timeout: 20000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    },
  );
  assert.deepEqual(JSON.parse(stdout.trim()), {
    stopped: true,
    released: true,
  });
});
