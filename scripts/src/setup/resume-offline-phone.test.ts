import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { planInstallation } from "./plan";
import { createInstallationResources } from "./resources";
import { readInstallation } from "./resume";
import { createInstallationExecutor } from "./installer";
import type { InstallCapabilities } from "./preflight";

const caps: InstallCapabilities = {
  platform: process.platform,
  architecture: process.arch,
  nodeVersion: process.version,
  postgresClientVersion: null,
  composeVersion: "2.40.0",
  native: { ready: true, issues: [] },
  container: { ready: true, issues: [] },
  phone: { ready: true },
};
const offline = { ...caps, phone: { ready: false } };
const topology = {
  ready: true,
  apiInstances: 1,
  workerInstances: 2,
  schedulerWorkers: 2,
  healthyWorkerIds: ["one", "two"],
};

async function saved(t: TestContext) {
  const parent = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-offline-phone-"),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const plan = planInstallation(
    {
      mode: "container",
      locale: "tr",
      port: 58762,
      accessMode: "read_only",
      provider: "later",
      phoneAccess: "private_network",
      toolPacks: ["data"],
    },
    caps,
  );
  const resources = await createInstallationResources(parent, plan, {});
  const manifest = path.join(resources.directory, "installation.json");
  const original = JSON.parse(await readFile(manifest, "utf8"));
  await writeFile(
    manifest,
    JSON.stringify({
      ...original,
      phase: "complete",
      workspaceRoot: process.cwd(),
    }),
  );
  const secrets = await Promise.all(
    Object.values(resources.secretFiles).map((file) => readFile(file!, "utf8")),
  );
  return { parent, plan, resources, manifest, secrets };
}

test("offline phone does not prevent reading an existing installation or rewrite its saved selection", async (t) => {
  const s = await saved(t);
  const before = await readFile(s.manifest, "utf8");
  const restored = await readInstallation(
    s.resources.directory,
    process.cwd(),
    async () => offline,
  );
  assert.equal(restored.complete, true);
  assert.equal(restored.plan.id, s.plan.id);
  assert.deepEqual(restored.plan.settings, s.plan.settings);
  assert.equal(await readFile(s.manifest, "utf8"), before);
});

test("offline resume starts only the local container boundary and retains preferences and secret bytes", async (t) => {
  const s = await saved(t);
  const commands: Parameters<
    typeof import("../endurance/process-supervisor").executeBoundedCommand
  >[0][] = [];
  const steps: string[] = [];
  const executor = createInstallationExecutor({
    workspaceRoot: process.cwd(),
    installationParent: s.parent,
    pnpmPath: process.execPath,
    capabilities: async () => offline,
    resume: { resources: s.resources, planId: s.plan.id, complete: true },
    run: async (command) => {
      commands.push(command);
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    verify: async () => topology,
    applyPreferences: async () => {
      throw Error("completed preferences must not be replaced");
    },
  });
  t.after(() => executor.stopNative());
  const result = await executor.execute(s.plan, {}, (step, complete) => {
    if (complete) steps.push(step);
  });
  assert.equal(result.url, "http://127.0.0.1:58762");
  assert.equal(result.phoneUrl, undefined);
  assert.equal(
    (result as { phoneUnavailable?: boolean }).phoneUnavailable,
    true,
  );
  assert.equal(commands.length, 1);
  assert.equal(commands[0].command, "docker");
  assert.equal(
    commands[0].environment?.TRUSTED_HOSTS,
    "localhost,127.0.0.1,app",
  );
  assert.equal(
    commands[0].environment?.CORS_ALLOWED_ORIGINS,
    "http://127.0.0.1:58762",
  );
  assert.equal(steps.includes("configure_phone"), false);
  const manifest = JSON.parse(await readFile(s.manifest, "utf8"));
  assert.equal(manifest.phase, "complete");
  assert.equal(manifest.runtimeOptions.phoneUnavailable, true);
  assert.deepEqual(manifest.plan.settings, s.plan.settings);
  assert.deepEqual(
    await Promise.all(
      Object.values(s.resources.secretFiles).map((file) =>
        readFile(file!, "utf8"),
      ),
    ),
    s.secrets,
  );
});

test("fresh private-phone installation still rejects an offline network before any services start", async (t) => {
  const s = await saved(t);
  const executor = createInstallationExecutor({
    workspaceRoot: process.cwd(),
    installationParent: s.parent,
    pnpmPath: process.execPath,
    capabilities: async () => offline,
    run: async () => {
      throw Error("must not start a service");
    },
    applyPreferences: async () => {},
  });
  await assert.rejects(
    executor.execute(s.plan, {}, () => {}),
    /Private phone access/,
  );
  assert.equal(executor.installationDirectory(), null);
});

test("offline resume still rejects missing required container prerequisites", async (t) => {
  const s = await saved(t);
  await assert.rejects(
    readInstallation(s.resources.directory, process.cwd(), async () => ({
      ...offline,
      container: { ready: false, issues: ["docker_engine_unavailable"] },
    })),
    /docker_engine_unavailable/,
  );
});

test("a late phone listener conflict keeps resume local and the next restart retries the saved private route", async (t) => {
  const s = await saved(t);
  let conflict = true;
  const calls: string[] = [];
  const connection = {
    url: "https://owned.example.ts.net:8443",
    target: "http://127.0.0.1:58762",
    port: 58762,
  };
  const makeExecutor = () =>
    createInstallationExecutor({
      workspaceRoot: process.cwd(),
      installationParent: s.parent,
      pnpmPath: process.execPath,
      capabilities: async () => caps,
      resume: { resources: s.resources, planId: s.plan.id, complete: true },
      inspectPhone: async () => {
        calls.push("inspect");
        if (conflict) throw Error("fixture-private-phone-conflict");
        return connection;
      },
      configurePhone: async (value) => {
        assert.deepEqual(value, connection);
        calls.push("configure");
      },
      verifyPhone: async (value, token) => {
        assert.deepEqual(value, connection);
        assert.equal(token, s.secrets[1]);
        calls.push("verify-phone");
      },
      run: async (command) => {
        calls.push("docker");
        assert.equal(
          command.environment?.TRUSTED_HOSTS?.split(",").includes(
            "owned.example.ts.net",
          ),
          !conflict,
        );
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      verify: async () => topology,
      applyPreferences: async () => {
        throw Error("no preference rewrite");
      },
    });
  const first = makeExecutor();
  t.after(() => first.stopNative());
  const local = await first.execute(s.plan, {}, () => {});
  assert.equal(local.phoneUnavailable, true);
  assert.deepEqual(calls, ["inspect", "docker"]);
  assert.equal(
    (await readFile(s.manifest, "utf8")).includes(
      "fixture-private-phone-conflict",
    ),
    false,
  );
  await first.stopNative();
  conflict = false;
  calls.length = 0;
  const second = makeExecutor();
  t.after(() => second.stopNative());
  const restored = await readInstallation(
    s.resources.directory,
    process.cwd(),
    async () => caps,
  );
  const phone = await second.execute(
    restored.plan,
    restored.credentials,
    () => {},
  );
  assert.equal(phone.phoneUnavailable, undefined);
  assert.equal(phone.phoneUrl, connection.url);
  assert.deepEqual(calls, ["inspect", "docker", "configure", "verify-phone"]);
  const manifest = JSON.parse(await readFile(s.manifest, "utf8"));
  assert.equal(manifest.runtimeOptions.phoneUnavailable, undefined);
  assert.deepEqual(manifest.plan.settings, s.plan.settings);
});
