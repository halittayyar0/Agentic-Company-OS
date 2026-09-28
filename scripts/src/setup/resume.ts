import path from "node:path";
import { constants } from "node:fs";
import { open, lstat } from "node:fs/promises";
import { ensureExactOutputDirectory } from "../endurance/safe-output";
import { detectInstallCapabilities } from "./preflight";
import { planInstallation } from "./plan";
import type { InstallationResources } from "./resources";
async function readBoundedRegularFile(
  file: string,
  limit: number,
  _options: { rejectSymlinks: true },
) {
  const handle = await open(
    file,
    constants.O_RDONLY |
      (process.platform === "win32"
        ? 0
        : constants.O_NOFOLLOW | constants.O_NONBLOCK),
  );
  try {
    const stat = await handle.stat(),
      leaf = await lstat(file);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > limit ||
      leaf.isSymbolicLink() ||
      stat.ino !== leaf.ino ||
      stat.dev !== leaf.dev
    )
      throw new Error("Invalid private installation file");
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        size,
        buffer.length - size,
        size,
      );
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > limit) throw new Error("Installation file too large");
    return buffer.subarray(0, size).toString("utf8");
  } finally {
    await handle.close();
  }
}

export async function readInstallation(
  directory: string,
  workspaceRoot: string,
  detect = detectInstallCapabilities,
) {
  const exact = await ensureExactOutputDirectory(path.resolve(directory));
  const saved = JSON.parse(
    await readBoundedRegularFile(path.join(exact, "installation.json"), 64000, {
      rejectSymlinks: true,
    }),
  ) as {
    schemaVersion?: unknown;
    plan?: { id?: unknown; settings?: unknown; createdAt?: unknown };
    phase?: unknown;
    workspaceRoot?: unknown;
    runtimeOptions?: { ollamaUrl?: unknown };
  };
  if (
    saved.schemaVersion !== 1 ||
    !saved.plan ||
    typeof saved.plan.id !== "string" ||
    !/^instance-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(
      path.basename(exact),
    ) ||
    path.basename(exact) !== `instance-${saved.plan.id}`
  )
    throw new Error("Invalid installation identity");
  const relative = path.relative(workspaceRoot, exact);
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
    throw new Error("Installation data must be outside the checkout");
  if (
    saved.workspaceRoot !== undefined &&
    path.relative(String(saved.workspaceRoot), workspaceRoot) !== ""
  )
    throw new Error("Resume must use the installation's original checkout");
  const normalized = planInstallation(saved.plan.settings, await detect());
  const plan = {
    ...normalized,
    id: saved.plan.id,
    createdAt:
      typeof saved.plan.createdAt === "string"
        ? saved.plan.createdAt
        : normalized.createdAt,
  };
  const names = [
    "database_url",
    "operator_auth_token",
    "runtime_control_key",
    ...(plan.settings.mode === "container" ? ["postgres_password"] : []),
    ...(["openai", "openrouter"].includes(plan.settings.provider)
      ? ["provider_key"]
      : []),
  ];
  const secrets = await ensureExactOutputDirectory(path.join(exact, "secrets")),
    secretFiles: Record<string, string> = {};
  for (const name of names) {
    const file = path.join(secrets, name);
    const value = await readBoundedRegularFile(file, 4096, {
      rejectSymlinks: true,
    });
    if (!value || /[\r\n\0]/u.test(value))
      throw new Error("Invalid installation credential file");
    secretFiles[name] = file;
  }
  const credentials =
    typeof saved.runtimeOptions?.ollamaUrl === "string"
      ? { ollamaUrl: saved.runtimeOptions.ollamaUrl }
      : {};
  if (plan.settings.provider === "ollama" && credentials.ollamaUrl) {
    const url = new URL(credentials.ollamaUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid model endpoint");
  }
  return {
    plan,
    credentials,
    resources: { directory: exact, secretFiles } as InstallationResources,
    complete: saved.phase === "complete",
  };
}
