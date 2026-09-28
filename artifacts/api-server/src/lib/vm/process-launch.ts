import { lstat } from "node:fs/promises";
import path from "node:path";

/** .cmd shims cannot be spawned with shell:false on Windows. Resolve the
 * installed package's JS launcher instead; never invoke a command shell. */
export async function resolveProcessLaunch(
  name: string,
  args: string[],
  options: { platform?: NodeJS.Platform; searchDirectories?: string[] } = {},
): Promise<{ command: string; args: string[] }> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" || !["npm", "npx", "pnpm"].includes(name))
    return {
      command:
        platform === "win32" && ["python", "python3"].includes(name)
          ? "python.exe"
          : name,
      args,
    };
  const directories = options.searchDirectories ?? [
    path.dirname(process.execPath),
    ...(process.env.PATH ?? "")
      .split(path.delimiter)
      .map((item) => item.replace(/^"|"$/g, "")),
  ];
  const candidates =
    name === "pnpm"
      ? ["node_modules/corepack/dist/pnpm.js", "node_modules/pnpm/bin/pnpm.cjs"]
      : [`node_modules/npm/bin/${name}-cli.js`];
  for (const directory of [...new Set(directories)]) {
    if (!path.isAbsolute(directory)) continue;
    for (const relative of candidates) {
      const candidate = path.join(directory, relative);
      const stat = await lstat(candidate).catch(() => null);
      if (stat?.isFile())
        return { command: process.execPath, args: [candidate, ...args] };
    }
  }
  throw new Error("PACKAGE_MANAGER_UNAVAILABLE");
}
