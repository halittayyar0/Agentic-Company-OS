import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInstallationExecutor } from "./installer";
import { applyInstallationPreferences } from "./preferences";
import { planInstallation } from "./plan";
import { detectInstallCapabilities } from "./preflight";
import { readInstallation } from "./resume";
import { buildContainerDeployment } from "./deployment";
import { executeBoundedCommand } from "../endurance/process-supervisor";
import { reserveLoopbackPorts } from "../endurance/native-postgres-harness";
import { proveDatabaseBackup } from "./backup-restore-proof";
import { parseContainerSmokeOptions } from "./container-install-smoke-options";
import {
  applyFixtureBuildNetwork,
  parseFixtureBuildNetwork,
} from "./container-install-smoke-build";

const source = fileURLToPath(new URL("../../..", import.meta.url));
const { image, codingImage, codingRuntime } = parseContainerSmokeOptions(
  process.argv.slice(2),
);
const fixtureBuildNetwork = parseFixtureBuildNetwork(
  process.env.ACOS_TEST_CONTAINER_BUILD_NETWORK,
);
const directory = await mkdtemp(
  path.join(tmpdir(), "acos-container-install-proof-"),
);
const [port] = await reserveLoopbackPorts(1);
const capabilities = await detectInstallCapabilities();
const plan = planInstallation(
  {
    mode: "container",
    locale: "en",
    port,
    accessMode: "approval",
    provider: "later",
    phoneAccess: "local",
    toolPacks: ["data", "code"],
    ...(codingRuntime ? { codingRuntime: true } : {}),
  },
  capabilities,
);
const options = {
  workspaceRoot: source,
  installationParent: directory,
  pnpmPath: process.execPath,
  applyPreferences: applyInstallationPreferences,
  ...(fixtureBuildNetwork
    ? {
        run: async (command: Parameters<typeof executeBoundedCommand>[0]) => {
          await applyFixtureBuildNetwork(
            command,
            directory,
            fixtureBuildNetwork,
          );
          return executeBoundedCommand(command);
        },
      }
    : {}),
  ...(image ? { prebuiltImage: image } : {}),
  ...(codingImage ? { codingImage } : {}),
};
const installer = createInstallationExecutor(options);
let privateDirectory: string | null = null;
try {
  const result = await installer.execute(plan, {}, () => {});
  privateDirectory = installer.installationDirectory();
  assert.ok(privateDirectory);
  const headers = {
    authorization: `Bearer ${result.operatorToken}`,
    "content-type": "application/json",
  };
  async function codingConfiguration() {
    const response = await fetch(`${result.url}/api/connections/codex`, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(response.status, 200);
    const status = (await response.json()) as {
      state: string;
      proofScope: string;
      requiresTaskPreflight: boolean;
      truncated: boolean;
      workers: Array<{ role: string; configurationState: string }>;
    };
    assert.equal(status.proofScope, "worker_configuration");
    assert.equal(status.requiresTaskPreflight, true);
    assert.equal(status.truncated, false);
    assert.equal(status.workers.length, 2);
    assert.equal(
      status.state,
      codingRuntime ? "preflight_required" : "unavailable",
    );
    assert.ok(
      status.workers.every(
        (worker) =>
          worker.role === "worker" &&
          worker.configurationState ===
            (codingRuntime ? "preflight_required" : "disabled"),
      ),
    );
    return status;
  }
  await codingConfiguration();
  assert.equal(
    (
      await fetch(`${result.url}/api/skills`, {
        signal: AbortSignal.timeout(20000),
      })
    ).status,
    401,
  );
  assert.equal(
    (await fetch(result.url, { signal: AbortSignal.timeout(20000) })).status,
    200,
  );
  const saved = await fetch(`${result.url}/api/skills/extensions`, {
    method: "PUT",
    headers,
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      manifest: {
        schemaVersion: 1,
        id: "user-container-resume",
        title: "Resume proof",
        description: "Container installer acceptance",
        kind: "skill",
        instructions: "Verify the saved fixture.",
      },
      enabled: true,
      expectedRevision: 0,
    }),
  });
  assert.equal(saved.status, 200);
  await installer.stopNative();
  const restored = await readInstallation(privateDirectory, source);
  assert.equal(restored.complete, true);
  const reviewedDeployment = buildContainerDeployment(
    source,
    plan,
    restored.resources,
    {},
    undefined,
    image,
    codingRuntime
      ? { image: codingImage, apparmor: capabilities.coding!.apparmor }
      : undefined,
  );
  const composeArgs = reviewedDeployment.args.slice(
    0,
    reviewedDeployment.args.indexOf("up"),
  );
  const compose = (args: string[]) =>
    executeBoundedCommand({
      command: "docker",
      args: [...composeArgs, ...args],
      cwd: source,
      environment: { ...process.env, ...reviewedDeployment.environment },
      timeoutMs: 120000,
      maxBufferBytes: 1048576,
    });
  // A live no-op "up" is weaker than restoring stopped services. Only this
  // fresh UUID-scoped fixture is stopped; its database volume is retained.
  await compose(["stop"]);
  const resumed = createInstallationExecutor({
    ...options,
    resume: {
      resources: restored.resources,
      planId: restored.plan.id,
      complete: true,
    },
  });
  try {
    const again = await resumed.execute(
      restored.plan,
      restored.credentials,
      () => {},
    );
    assert.equal(again.operatorToken, result.operatorToken);
    const workerConfiguration = await codingConfiguration();
    const entries = (await (
      await fetch(`${again.url}/api/skills/extensions`, {
        headers,
        signal: AbortSignal.timeout(20000),
      })
    ).json()) as Array<{ id: string }>;
    assert.ok(entries.some((entry) => entry.id === "user-container-resume"));
    assert.equal(
      JSON.parse(
        await readFile(
          path.join(privateDirectory, "installation.json"),
          "utf8",
        ),
      ).phase,
      "complete",
    );
    const archivePath = path.join(directory, "agentic-os.dump");
    const backup = await proveDatabaseBackup({
      database: "agentic_os",
      dumpPath: "/tmp/agentic-os.dump",
      connectionArgs: ["-U", "agentic"],
      command: (name, args) => compose(["exec", "-T", "db", name, ...args]),
      copyArchive: async () => {
        await compose(["cp", "db:/tmp/agentic-os.dump", archivePath]);
        // Restore the copy that crossed the host boundary, not only the original.
        await compose(["cp", archivePath, "db:/tmp/agentic-os.dump"]);
        return archivePath;
      },
    });
    await writeFile(
      path.join(directory, "evidence.json"),
      JSON.stringify(
        {
          passed: true,
          image: image ?? "local-source-build",
          codingImage: codingImage ?? null,
          codingRuntime,
          fixtureBuildNetwork: fixtureBuildNetwork ?? "default",
          workerConfiguration,
          proofScope:
            "Installer/API/two workers/PostgreSQL, preferences, resume and backup. No account sign-in, inference or generated coding delivery.",
          backup,
          checks: [
            "real container installation",
            "private authentication",
            "static UI",
            "preferences and custom guide persisted",
            "installation resume after stopping all fixture services",
            "worker-only coding configuration before and after restart; every coding task still requires native preflight",
            "binary backup copied through host and restored into a fresh database",
            "restored roster, migration journal entry count, application writes and sequence state",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      `Container installation and resume passed. Evidence: ${path.join(directory, "evidence.json")}`,
    );
  } finally {
    await resumed.stopNative();
  }
} finally {
  await installer.stopNative();
  privateDirectory ??= installer.installationDirectory();
  if (privateDirectory) {
    const restored = await readInstallation(privateDirectory, source);
    const deployment = buildContainerDeployment(
      source,
      plan,
      restored.resources,
      {},
      undefined,
      image,
      codingRuntime
        ? { image: codingImage, apparmor: capabilities.coding!.apparmor }
        : undefined,
    );
    const args = deployment.args.slice(0, deployment.args.indexOf("up"));
    // Remove only this fresh test's UUID-scoped project and its disposable data.
    await executeBoundedCommand({
      command: "docker",
      args: [...args, "down", "--volumes", "--remove-orphans"],
      cwd: source,
      environment: { ...process.env, ...deployment.environment },
      timeoutMs: 120000,
      maxBufferBytes: 1048576,
    });
  }
}
