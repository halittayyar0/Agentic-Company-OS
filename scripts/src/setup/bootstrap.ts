import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createSetupSession } from "./session";
import { createInstallationExecutor } from "./installer";
import { applyInstallationPreferences } from "./preferences";
import { readInstallation } from "./resume";

export function parseSetupArguments(argv: string[]) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  let resume: string | undefined, parent: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (
      (args[i] === "--resume" || args[i] === "--data-dir") &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    ) {
      if (args[i] === "--resume") {
        if (resume) throw new Error("Duplicate resume path");
        resume = path.resolve(args[++i]);
      } else {
        if (parent) throw new Error("Duplicate data directory");
        parent = path.resolve(args[++i]);
      }
    } else
      throw new Error(
        "Usage: pnpm setup [--resume <installation directory>] [--data-dir <private parent directory>]",
      );
  }
  if (resume && parent)
    throw new Error("Resume already identifies its data directory");
  return { resume, parent };
}
export async function launchSetup(argv = process.argv.slice(2)) {
  const args = parseSetupArguments(argv),
    workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const pnpmPath = process.env.npm_execpath;
  if (!pnpmPath || !path.isAbsolute(pnpmPath))
    throw new Error("Start the installer with pnpm setup");
  const controller = new AbortController();
  const restored = args.resume
    ? await readInstallation(args.resume, workspaceRoot)
    : null;
  const executor = createInstallationExecutor({
    workspaceRoot,
    installationParent: restored
      ? path.dirname(restored.resources.directory)
      : (args.parent ??
        path.join(homedir(), ".agentic-company-os", "instances")),
    pnpmPath,
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
  } else {
    session = await createSetupSession({
      execute: async (plan, credentials, progress) => {
        try {
          const result = await executor.execute(plan, credentials, progress);
          process.stdout.write(
            `Installation: ${executor.installationDirectory()}\nRestart: pnpm setup --resume "${executor.installationDirectory()}"\n`,
          );
          return result;
        } catch (error) {
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
  }
  return { executor, session, shutdown };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  launchSetup().catch(() => {
    process.stderr.write(
      "Setup could not start. Check prerequisites and the installation directory. No credentials were printed.\n",
    );
    process.exitCode = 1;
  });
}
