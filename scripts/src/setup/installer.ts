import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  executeBoundedCommand,
  ProcessSupervisor,
  type BoundedCommandExecution,
} from "../endurance/process-supervisor";
import { waitForRuntimeTopology } from "../endurance/runtime-probe";
import { writeExactOutputBundle } from "../endurance/safe-output";
import { buildContainerDeployment, buildNativeDeployment } from "./deployment";
import { detectInstallCapabilities } from "./preflight";
import {
  planInstallation,
  type InstallationPlan,
  type InstallationStep,
} from "./plan";
import {
  assertInstallPortAvailable,
  createInstallationResources,
  type InstallationResources,
} from "./resources";
import type { InstallationExecutor } from "./session";
import {
  inspectPhoneAccess,
  configurePhoneAccess,
  verifyPhoneAccess,
  type PhoneConnection,
} from "./phone-access";
import { acquireInstallationLock } from "./installation-lock";
import { readInstallationBudgetOverrides } from "./budget-overrides";

const DATABASE_PROBE = `
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(process.argv[1]);
const { Client } = require('pg');
const client = new Client({ connectionString: await readFile(process.argv[2], 'utf8'), connectionTimeoutMillis: 10000, statement_timeout: 10000 });
try { await client.connect(); await client.query('SELECT current_database()'); }
catch { process.exitCode = 1; }
finally { await client.end().catch(() => {}); }
`;

export function createInstallationExecutor(options: {
  workspaceRoot: string;
  installationParent: string;
  pnpmPath: string;
  prebuiltImage?: string;
  // This must persist every selected policy/tool/language setting before setup
  // can finish. Kept mandatory so a UI-only selection cannot claim completion.
  applyPreferences: (
    plan: InstallationPlan,
    context: { baseUrl: string; operatorToken: string; directory: string },
  ) => Promise<void>;
  capabilities?: typeof detectInstallCapabilities;
  run?: typeof executeBoundedCommand;
  verify?: typeof waitForRuntimeTopology;
  signal?: AbortSignal;
  resume?: {
    resources: InstallationResources;
    planId: string;
    complete: boolean;
  };
}) {
  const run = options.run ?? executeBoundedCommand;
  const verify = options.verify ?? waitForRuntimeTopology;
  if (
    !path.isAbsolute(options.workspaceRoot) ||
    !path.isAbsolute(options.installationParent) ||
    !path.isAbsolute(options.pnpmPath)
  )
    throw new Error("Installation launcher paths must be absolute");
  let supervisor: ProcessSupervisor | null = null;
  let resources: InstallationResources | null = null;
  let active = false;
  let releaseLock: (() => Promise<void>) | undefined;
  const command = (
    command: string,
    args: string[],
    environment: NodeJS.ProcessEnv = {},
    cwd = options.workspaceRoot,
    timeoutMs = 15 * 60_000,
  ): BoundedCommandExecution => ({
    command,
    args,
    cwd,
    environment: { ...process.env, ...environment },
    timeoutMs,
    maxBufferBytes: 4 * 1024 * 1024,
    ignoreInheritedStdio: false,
    signal: options.signal,
  });

  const execute: InstallationExecutor = async (plan, credentials, progress) => {
    if (active) throw new Error("This installer already owns an installation");
    if (options.resume && options.resume.planId !== plan.id)
      throw new Error("Resume identity does not match the plan");
    active = true;
    const completed: InstallationStep[] = [];
    let currentStep: InstallationStep | null = null;
    let phone: PhoneConnection | undefined;
    const record = async (phase: string) => {
      if (!resources) return;
      await writeExactOutputBundle({
        outputDirectory: resources.directory,
        overwrite: true,
        files: [
          {
            path: path.join(resources.directory, "installation.json"),
            bytes: JSON.stringify(
              {
                schemaVersion: 1,
                plan,
                phase,
                currentStep,
                completedSteps: completed,
                secretFiles: resources.secretFiles,
                workspaceRoot: options.workspaceRoot,
                runtimeOptions: {
                  ollamaUrl: credentials.ollamaUrl,
                  phoneUrl: phone?.url,
                },
              },
              null,
              2,
            ),
          },
        ],
      });
    };
    const step = async (
      name: InstallationStep,
      operation: () => Promise<void>,
    ) => {
      currentStep = name;
      options.signal?.throwIfAborted();
      progress(name, false);
      await record("installing");
      await operation();
      options.signal?.throwIfAborted();
      completed.push(name);
      await record("installing");
      progress(name, true);
    };
    const baseUrl = `http://127.0.0.1:${plan.settings.port}`;
    try {
      await step("check_environment", async () => {
        if (options.prebuiltImage && plan.settings.mode !== "container")
          throw new Error(
            "The portable distribution supports containers; use source setup for native installation",
          );
        planInstallation(
          plan.settings,
          await (options.capabilities ?? detectInstallCapabilities)(),
        );
        const relative = path.relative(
          options.workspaceRoot,
          options.installationParent,
        );
        if (
          !relative ||
          (!relative.startsWith(`..${path.sep}`) &&
            relative !== ".." &&
            !path.isAbsolute(relative))
        )
          throw new Error("Installation data must be outside the checkout");
        if (!options.resume || plan.settings.mode === "native")
          await assertInstallPortAvailable(plan.settings.port);
        if (plan.settings.phoneAccess === "private_network")
          phone = await inspectPhoneAccess(plan.settings.port);
      });
      await step("prepare_private_config", async () => {
        if (options.resume) {
          releaseLock = await acquireInstallationLock(
            options.resume.resources.directory,
            plan.settings.port,
          );
          resources = options.resume.resources;
          return;
        }
        resources = await createInstallationResources(
          options.installationParent,
          plan,
          credentials,
        );
        releaseLock = await acquireInstallationLock(
          resources.directory,
          plan.settings.port,
        );
        await writeFile(
          path.join(resources.directory, "runtime.env"),
          "# Isolated installation; values come from its launcher.\n",
          { flag: "wx", mode: 0o600 },
        );
      });
      const owned = resources! as InstallationResources;
      if (plan.settings.mode === "native") {
        await step("connect_postgres", async () => {
          await run(
            command(
              process.execPath,
              [
                "--input-type=module",
                "--eval",
                DATABASE_PROBE,
                path.join(options.workspaceRoot, "lib/db/package.json"),
                owned.secretFiles.database_url,
              ],
              {},
              options.workspaceRoot,
              25_000,
            ),
          );
        });
        await step("build_application", async () => {
          const version = await run(
            command(
              process.execPath,
              [options.pnpmPath, "--version"],
              {},
              options.workspaceRoot,
              10_000,
            ),
          );
          if (version.stdout.trim() !== "10.17.1")
            throw new Error("Pinned pnpm 10.17.1 is required");
          await run(
            command(process.execPath, [options.pnpmPath, "run", "build"], {
              CI: "true",
            }),
          );
        });
        await step("start_native", async () => {
          supervisor = new ProcessSupervisor({
            runId: `setup-${plan.id}`,
            logLimitBytes: 1024 * 1024,
          });
          for (const spec of buildNativeDeployment(
            options.workspaceRoot,
            plan,
            owned,
            credentials,
            phone?.url,
          ))
            supervisor.start(spec);
        });
      } else {
        await step("compose_up", async () => {
          const deployment = buildContainerDeployment(
            options.workspaceRoot,
            plan,
            owned,
            credentials,
            phone?.url,
            options.prebuiltImage,
          );
          if (options.resume)
            Object.assign(
              deployment.environment,
              await readInstallationBudgetOverrides(owned.directory),
            );
          await writeExactOutputBundle({
            outputDirectory: owned.directory,
            overwrite: Boolean(options.resume),
            files: [
              {
                path: path.join(owned.directory, "compose.env"),
                bytes:
                  Object.entries(deployment.environment)
                    .map(([key, value]) => `${key}=${value}`)
                    .join("\n") + "\n",
              },
              {
                path: path.join(owned.directory, "compose.override.json"),
                bytes: JSON.stringify(deployment.override, null, 2),
              },
            ],
          });
          await run(command("docker", deployment.args, deployment.environment));
        });
      }
      const operatorToken = await readFile(
        owned.secretFiles.operator_auth_token,
        "utf8",
      );
      await step("apply_preferences", async () => {
        await verify(
          { baseUrl, operatorToken },
          { timeoutMs: 180_000, intervalMs: 1000 },
        );
        if (!options.resume?.complete)
          await options.applyPreferences(plan, {
            baseUrl,
            operatorToken,
            directory: owned.directory,
          });
      });
      if (phone)
        await step("configure_phone", async () => {
          await configurePhoneAccess(phone!);
          await verifyPhoneAccess(phone!, operatorToken);
        });
      await step("verify_runtime", async () => {
        await verify(
          { baseUrl, operatorToken },
          { timeoutMs: 60_000, intervalMs: 1000 },
        );
      });
      await record("complete");
      return {
        url: baseUrl,
        operatorToken,
        ...(phone ? { phoneUrl: phone.url } : {}),
      };
    } catch (error) {
      // Keep the database, secrets, build and manifest for recovery. Only child
      // processes owned by this launcher are stopped; no volumes are deleted.
      await supervisor?.stopAll();
      await record("failed");
      await releaseLock?.();
      throw error;
    }
  };
  return {
    execute,
    stopNative: async () => {
      await supervisor?.stopAll();
      await releaseLock?.();
    },
    installationDirectory: () => resources?.directory ?? null,
  };
}
