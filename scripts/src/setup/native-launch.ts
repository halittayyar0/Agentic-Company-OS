import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { readBoundedRegularFile } from "./resume";
import { ensureExactOutputDirectory } from "../endurance/safe-output";

export function browserLaunchCommand(
  value: string,
  platform: string = process.platform,
) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.search ||
    !url.port ||
    /[\r\n\0]/u.test(value)
  )
    throw new Error("native_browser_url");
  if (platform === "win32")
    return {
      command: path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "rundll32.exe",
      ),
      args: ["url.dll,FileProtocolHandler", url.href],
    };
  if (platform === "darwin")
    return { command: "/usr/bin/open", args: [url.href] };
  if (platform === "linux") return { command: "xdg-open", args: [url.href] };
  throw new Error("native_browser_platform");
}

export async function openNativeBrowser(url: string): Promise<boolean> {
  const command = browserLaunchCommand(url);
  return new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      stdio: "ignore",
      windowsHide: true,
      detached: true,
    });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

export async function readNativeLaunchPointer(
  parent: string,
  root: string,
  commit: string,
): Promise<string | null> {
  let raw: string;
  try {
    raw = await readBoundedRegularFile(
      path.join(parent, "native-launch.json"),
      8192,
      { rejectSymlinks: true },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const value = JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !==
      "commit,directory,schemaVersion,workspaceRoot" ||
    value.schemaVersion !== 1 ||
    value.commit !== commit ||
    value.workspaceRoot !== root ||
    typeof value.directory !== "string" ||
    !path.isAbsolute(value.directory) ||
    path.dirname(value.directory) !== parent ||
    !/^instance-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(
      path.basename(value.directory),
    )
  )
    throw new Error(
      "native_launch_identity: use the original package or an explicit new data directory",
    );
  return value.directory;
}

export async function saveNativeLaunchPointer(
  parent: string,
  root: string,
  commit: string,
  directory: string,
): Promise<void> {
  const exact = await ensureExactOutputDirectory(parent);
  if (exact !== parent || path.dirname(directory) !== exact)
    throw new Error("native_launch_identity");
  const old = await readNativeLaunchPointer(exact, root, commit);
  if (old) {
    if (old !== directory) throw new Error("native_launch_identity");
    return;
  }
  await writeFile(
    path.join(exact, "native-launch.json"),
    JSON.stringify({
      schemaVersion: 1,
      workspaceRoot: root,
      commit,
      directory,
    }),
    { flag: "wx", mode: 0o600 },
  );
}
