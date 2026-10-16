import path from "node:path";
import { homedir } from "node:os";
import { realpath } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createSetupSession } from "./session";
import { createInstallationExecutor } from "./installer";
import { applyInstallationPreferences } from "./preferences";
import { readInstallation } from "./resume";
import { readDistribution } from "./distribution";
import { detectInstallCapabilities, runSetupProbe } from "./preflight";
import {
  parseSetupArguments,
  setupHelp,
  SetupArgumentError,
} from "./cli-options";
import { setupCheckReport } from "./check-report";
import { readNativeDistribution } from "./native-distribution";
import {
  openNativeBrowser,
  readNativeLaunchPointer,
  saveNativeLaunchPointer,
} from "./native-launch";

export { parseSetupArguments } from "./cli-options";
export async function launchSetup(argv = process.argv.slice(2)) {
  const args = parseSetupArguments(argv),
    workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
  if (args.help) {
    process.stdout.write(setupHelp);
    return;
  }
  const distribution = await readDistribution(workspaceRoot);
  const nativeDistribution = await readNativeDistribution(workspaceRoot);
  if (nativeDistribution) {
    const bundledNode = path.join(
      workspaceRoot,
      process.platform === "win32"
        ? "runtime/node/node.exe"
        : "runtime/node/bin/node",
    );
    if (
      process.version !== `v${nativeDistribution.nodeVersion}` ||
      (await realpath(process.execPath)) !== (await realpath(bundledNode))
    )
      throw new Error("native_package_node_runtime");
    process.env.PATH = [
      path.dirname(bundledNode),
      path.join(workspaceRoot, "runtime/postgres/bin"),
      process.env.PATH ?? "",
    ].join(path.delimiter);
  }
  const capabilities: typeof detectInstallCapabilities = async () => {
    const detected = await detectInstallCapabilities(
      nativeDistribution && !distribution
        ? {
            run: (command, args) =>
              command === "docker"
                ? Promise.reject(new Error("separate_container_package"))
                : runSetupProbe(command, args),
          }
        : {},
    );
    if (nativeDistribution)
      return {
        ...detected,
        native: { ready: true, issues: [], managedDatabase: true },
        ...(!distribution
          ? {
              container: {
                ready: false,
                issues: ["container_distribution_required" as const],
              },
            }
          : {}),
      };
    return distribution
      ? {
          ...detected,
          native: { ready: false, issues: ["native_source_required"] },
          ...(!distribution.codingImage
            ? {
                coding: {
                  ready: false,
                  issues: ["coding_distribution_missing"],
                  apparmor: detected.coding?.apparmor ?? false,
                },
              }
            : {}),
        }
      : detected;
  };
  if (args.check) {
    const report = setupCheckReport(await capabilities());
    process.stdout.write(report.text);
    process.exitCode = report.exitCode;
    return;
  }
  const pnpmPath =
    distribution || nativeDistribution
      ? process.execPath
      : process.env.npm_execpath;
  if (!pnpmPath || !path.isAbsolute(pnpmPath))
    throw new Error("Start the installer with pnpm run setup");
  const controller = new AbortController();
  const installationParent =
    args.parent ?? path.join(homedir(), ".agentic-company-os", "instances");
  const resumePath =
    args.resume ??
    (nativeDistribution
      ? await readNativeLaunchPointer(
          installationParent,
          workspaceRoot,
          nativeDistribution.commit,
        )
      : null);
  const restored = resumePath
    ? await readInstallation(
        resumePath,
        workspaceRoot,
        capabilities,
        nativeDistribution?.commit,
      )
    : null;
  const executor = createInstallationExecutor({
    workspaceRoot,
    installationParent: restored
      ? path.dirname(restored.resources.directory)
      : installationParent,
    pnpmPath,
    capabilities,
    ...(nativeDistribution
      ? {
          nativeDistribution,
          onPrepared: (resources: { directory: string }) =>
            saveNativeLaunchPointer(
              restored
                ? path.dirname(restored.resources.directory)
                : installationParent,
              workspaceRoot,
              nativeDistribution.commit,
              resources.directory,
            ),
        }
      : {}),
    ...(distribution
      ? {
          prebuiltImage: distribution.image,
          codingImage: distribution.codingImage,
        }
      : {}),
    applyPreferences: applyInstallationPreferences,
    signal: controller.signal,
    ...(restored
      ? {
          resume: {
            resources: restored.resources,
            planId: restored.plan.id,
            complete: restored.complete,
          },
        }
      : {}),
  });
  let session: Awaited<ReturnType<typeof createSetupSession>> | undefined;
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    controller.abort(new Error("Installation interrupted"));
    void (async () => {
      await session?.close();
      await executor.stopNative();
    })().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  if (restored) {
    const result = await executor.execute(
      restored.plan,
      restored.credentials,
      (step, complete) => {
        if (complete) process.stdout.write(`✓ ${step}\n`);
      },
    );
    process.stdout.write(
      `Workspace: ${result.url}\n${result.phoneUrl ? `Phone: ${result.phoneUrl}\n` : ""}Operator key: ${path.join(restored.resources.directory, "secrets/operator_auth_token")}\n`,
    );
    if (nativeDistribution && !args.noBrowser)
      await openNativeBrowser(result.url);
  } else {
    session = await createSetupSession({
      capabilities,
      execute: async (plan, credentials, progress) => {
        try {
          const result = await executor.execute(plan, credentials, progress);
          if (nativeDistribution)
            await saveNativeLaunchPointer(
              installationParent,
              workspaceRoot,
              nativeDistribution.commit,
              executor.installationDirectory()!,
            );
          process.stdout.write(
            `Installation: ${executor.installationDirectory()}\nRestart: ${nativeDistribution ? `Run ${process.platform === "win32" ? "START.cmd" : "START.command"} again` : distribution ? `node "${fileURLToPath(import.meta.url)}"` : "pnpm run setup"}${nativeDistribution ? "" : ` --resume "${executor.installationDirectory()}"`}\n`,
          );
          return result;
        } catch (error) {
          if (nativeDistribution && executor.installationDirectory())
            await saveNativeLaunchPointer(
              installationParent,
              workspaceRoot,
              nativeDistribution.commit,
              executor.installationDirectory()!,
            );
          process.stderr.write(
            `Installation stopped. Configuration retained at: ${executor.installationDirectory() ?? "not yet created"}\n`,
          );
          throw error;
        }
      },
    });
    process.stdout.write(
      `Agentic Company OS setup\nOpen this private setup link in this computer's browser:\n${session.url}\nKeep this terminal open while the native workspace runs. Ctrl+C stops its owned processes.\n`,
    );
    if (nativeDistribution && !args.noBrowser)
      await openNativeBrowser(session.url);
  }
  return { executor, session, shutdown };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  launchSetup().catch((error: unknown) => {
    process.stderr.write(
      error instanceof SetupArgumentError
        ? `${error.message}\n`
        : "Setup could not start. Run with --check to inspect prerequisites, or --help for usage. Check the installation directory. No credentials were printed.\n",
    );
    process.exitCode = 1;
  });
}
