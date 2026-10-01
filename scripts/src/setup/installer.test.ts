import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { executeBoundedCommand } from "../endurance/process-supervisor";
import { createInstallationExecutor } from "./installer";
import { planInstallation } from "./plan";
import { readInstallation } from "./resume";
import type { InstallCapabilities } from "./preflight";

const capabilities: InstallCapabilities = {
  platform: "linux",
  architecture: "x64",
  nodeVersion: "v24.20.0",
  postgresClientVersion: null,
  composeVersion: "2.40.0",
  native: { ready: true, issues: [] },
  container: { ready: true, issues: [] },
};
const topology = {
  ready: true,
  apiInstances: 1,
  workerInstances: 2,
  schedulerWorkers: 2,
  healthyWorkerIds: ["one", "two"],
};
const makePlan = (mode: string) =>
  planInstallation(
    {
      mode,
      locale: "en",
      port: 58761,
      accessMode: "approval",
      provider: "later",
      phoneAccess: "local",
      toolPacks: [],
    },
    capabilities,
  );

test("completed container resume retains operator budget limits in both config and launch", async (t) => {
  const parent = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-budget-resume-installer-"),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const base = {
    workspaceRoot: process.cwd(),
    installationParent: parent,
    pnpmPath: process.execPath,
    capabilities: async () => capabilities,
    verify: async () => topology,
    applyPreferences: async () => {},
    run: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
  };
  const first = createInstallationExecutor(base),
    plan = makePlan("container");
  t.after(() => first.stopNative());
  await first.execute(plan, {}, () => {});
  const directory = first.installationDirectory()!;
  await first.stopNative();
  const file = path.join(directory, "compose.env");
  const original = await readFile(file, "utf8");
  await writeFile(
    file,
    original +
      "MAX_TASK_FAMILY_TOKENS=987654\nMAX_TASK_FAMILY_REPORTED_COST_USD=4.5\nOPERATOR_AUTH_TOKEN=do-not-inherit\n",
  );
  const restored = await readInstallation(
    directory,
    process.cwd(),
    async () => capabilities,
  );
  let observed: NodeJS.ProcessEnv | undefined;
  const next = createInstallationExecutor({
    ...base,
    resume: {
      resources: restored.resources,
      planId: restored.plan.id,
      complete: restored.complete,
    },
    run: async (command) => {
      observed = command.environment;
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    applyPreferences: async () => {
      assert.fail("completed preferences must not be reapplied");
    },
  });
  t.after(() => next.stopNative());
  await next.execute(restored.plan, {}, () => {});
  assert.equal(observed?.MAX_TASK_FAMILY_TOKENS, "987654");
  assert.equal(observed?.MAX_TASK_FAMILY_REPORTED_COST_USD, "4.5");
  const saved = await readFile(file, "utf8");
  assert.match(saved, /MAX_TASK_FAMILY_TOKENS=987654/);
  assert.match(saved, /MAX_TASK_FAMILY_REPORTED_COST_USD=4.5/);
  assert.doesNotMatch(saved, /do-not-inherit/);
});

test("container installation finishes only after preferences and both topology checks", async (t) => {
  const parent = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-installer-flow-"),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const operations: string[] = [];
  const executor = createInstallationExecutor({
    workspaceRoot: process.cwd(),
    installationParent: parent,
    pnpmPath: process.execPath,
    capabilities: async () => capabilities,
    run: async (command) => {
      operations.push(command.command);
      assert.ok(!command.args.includes("down"));
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    verify: async () => {
      operations.push("verify");
      return topology;
    },
    applyPreferences: async (plan, context) => {
      operations.push("preferences");
      assert.equal(plan.settings.accessMode, "approval");
      assert.ok(context.operatorToken.length >= 32);
    },
  });
  const plan = makePlan("container");
  t.after(() => executor.stopNative());
  const result = await executor.execute(plan, {}, () => {});
  assert.equal(result.url, "http://127.0.0.1:58761");
  assert.deepEqual(operations, ["docker", "verify", "preferences", "verify"]);
  const manifest = JSON.parse(
    await readFile(
      path.join(executor.installationDirectory()!, "installation.json"),
      "utf8",
    ),
  );
  assert.equal(manifest.phase, "complete");
  assert.deepEqual(manifest.completedSteps, plan.steps);
  await assert.rejects(
    executor.execute(plan, {}, () => {}),
    /already owns/,
  );
});

test("a failed final health check retains private state and never marks installation complete", async (t) => {
  const parent = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-installer-failure-"),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  let probes = 0;
  const executor = createInstallationExecutor({
    workspaceRoot: process.cwd(),
    installationParent: parent,
    pnpmPath: process.execPath,
    capabilities: async () => capabilities,
    run: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    verify: async () => {
      if (++probes === 2) throw Error("unhealthy");
      return topology;
    },
    applyPreferences: async () => {},
  });
  await assert.rejects(
    executor.execute(makePlan("container"), {}, () => {}),
    /unhealthy/,
  );
  const directory = executor.installationDirectory()!;
  const manifest = JSON.parse(
    await readFile(path.join(directory, "installation.json"), "utf8"),
  );
  assert.equal(manifest.phase, "failed");
  assert.ok(!manifest.completedSteps.includes("verify_runtime"));
  assert.ok(
    (
      await readFile(
        path.join(directory, "secrets/operator_auth_token"),
        "utf8",
      )
    ).length >= 32,
  );
});

test("native build consumes the real package-manager version output before running its build", async (t) => {
  const parent = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-installer-version-"),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const pnpmPath = path.join(parent, "fixture-pnpm.cjs");
  await writeFile(
    pnpmPath,
    "if(process.argv.includes('--version')) console.log('10.17.1'); else process.exit(9);",
  );
  const executor = createInstallationExecutor({
    workspaceRoot: process.cwd(),
    installationParent: parent,
    pnpmPath,
    capabilities: async () => capabilities,
    run: async (command) =>
      command.args.includes("--eval")
        ? { stdout: "", stderr: "", exitCode: 0 }
        : executeBoundedCommand(command),
    applyPreferences: async () => {
      throw Error("must not launch after failed build");
    },
  });
  await assert.rejects(
    executor.execute(
      makePlan("native"),
      { databaseUrl: "postgresql://localhost/installer_fixture" },
      () => {},
    ),
    /exit code 9/,
  );
});
