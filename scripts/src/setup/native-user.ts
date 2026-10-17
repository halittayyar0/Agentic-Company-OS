import path from "node:path";
import { executeBoundedCommand } from "../endurance/process-supervisor";
import { SetupArgumentError } from "./cli-options";

const WINDOWS_TOKEN_ROLE = `[Console]::Write($(if (([System.Security.Principal.WindowsPrincipal]::new([System.Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) { 'administrator' } else { 'ordinary' }))`;

/** PostgreSQL requires an ordinary token. Check before creating private data;
 * this does not change UAC, groups, credentials or the caller's privileges. */
export async function assertNativeUser(
  dependencies: {
    platform?: string;
    uid?: (() => number) | undefined;
    systemRoot?: string;
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
      "Could not verify this Windows account's permissions. Use a normal terminal with the system PowerShell available.",
    );
  const systemRoot =
    dependencies.systemRoot ?? process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!systemRoot || !path.isAbsolute(systemRoot)) throw unavailable();
  let result: Awaited<ReturnType<typeof executeBoundedCommand>>;
  try {
    result = await (dependencies.run ?? executeBoundedCommand)({
      command: path.join(
        systemRoot,
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      ),
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(WINDOWS_TOKEN_ROLE, "utf16le").toString("base64"),
      ],
      environment: process.env,
      cwd: process.cwd(),
      timeoutMs: 10_000,
      maxBufferBytes: 1024,
    });
  } catch {
    throw unavailable();
  }
  if (result.stdout.trim() === "administrator")
    throw new SetupArgumentError(
      'Run START.cmd normally. Do not choose "Run as administrator"; the private database requires an ordinary user.',
    );
  if (result.stdout.trim() !== "ordinary") throw unavailable();
}
