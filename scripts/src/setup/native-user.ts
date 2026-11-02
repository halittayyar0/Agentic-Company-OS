import { windowsPrivateHelperExecutable } from "@workspace/ai-server/windows-private-helper";
import { executeBoundedCommand } from "../endurance/process-supervisor";
import { SetupArgumentError } from "./cli-options";

/** PostgreSQL requires an ordinary token. Check before creating private data;
 * this does not change UAC, groups, credentials or the caller's privileges. */
export async function assertNativeUser(
  dependencies: {
    platform?: string;
    uid?: (() => number) | undefined;
    run?: typeof executeBoundedCommand;
  } = {},
): Promise<void> {
  const platform = dependencies.platform ?? process.platform;
  if (platform !== "win32") {
    const uid = Object.hasOwn(dependencies, "uid")
      ? dependencies.uid
      : process.getuid;
    if (!uid || uid() === 0)
      throw new SetupArgumentError(
        "Start this native package as an ordinary user, without sudo or root.",
      );
    return;
  }
  const unavailable = () =>
    new SetupArgumentError(
      "Could not verify this Windows account's permissions. Re-extract the complete package and start it normally.",
    );
  let result: Awaited<ReturnType<typeof executeBoundedCommand>>;
  try {
    result = await (dependencies.run ?? executeBoundedCommand)({
      command: await windowsPrivateHelperExecutable(),
      args: ["--token-role"],
      environment: {},
      cwd: process.cwd(),
      timeoutMs: 10_000,
      maxBufferBytes: 1024,
    });
    if (
      result.exitCode !== 0 ||
      result.stderr !== "ACOS_PRIVATE_STORAGE_STARTED"
    )
      throw unavailable();
  } catch {
    throw unavailable();
  }
  if (result.stdout === "administrator")
    throw new SetupArgumentError(
      'Run START.cmd normally. Do not choose "Run as administrator"; the private database requires an ordinary user.',
    );
  if (result.stdout !== "ordinary") throw unavailable();
}
