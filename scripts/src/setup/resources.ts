import { randomBytes } from "node:crypto";
import { mkdir, open, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { ensureExactOutputDirectory } from "../endurance/safe-output";
import { validateInstallationInput, type InstallationPlan } from "./plan";
import type { InstallationCredentials } from "./session";
import { runSetupProbe } from "./preflight";

export interface InstallationResources {
  directory: string;
  secretFiles: {
    database_url: string;
    operator_auth_token: string;
    runtime_control_key: string;
    postgres_password?: string;
    provider_key?: string;
  };
}

export function windowsOwnerSid(identity: string): string {
  // Entra accounts use authority 12, unlike local/domain accounts (authority 5).
  // Require one complete whoami CSV row rather than matching an arbitrary SID
  // embedded elsewhere in command output.
  const sid = identity
    .trim()
    .match(/^"(?:[^"\r\n]|"")*","(S-1-\d+(?:-\d+){1,15})"$/u)?.[1];
  if (!sid) throw new Error("Cannot establish installation owner");
  return sid;
}

function nativeDatabaseUrl(value: string | undefined): string {
  if (!value || value.length > 4096 || /[\r\n\0]/u.test(value))
    throw new Error("database_url_required");
  const parsed = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.pathname.length < 2 ||
    parsed.hash
  )
    throw new Error("database_url_invalid");
  return value;
}

export async function assertInstallPortAvailable(port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("port_invalid");
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error("port_unavailable")));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () =>
      server.close((error) =>
        error ? reject(new Error("port_unavailable")) : resolve(),
      ),
    );
  });
}

export async function createInstallationResources(
  parent: string,
  plan: InstallationPlan,
  credentials: InstallationCredentials,
): Promise<InstallationResources> {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(plan.id))
    throw new Error("Invalid installation identity");
  const settings = validateInstallationInput(plan.settings);
  const databasePassword = randomBytes(32).toString("base64url");
  const databaseUrl =
    settings.mode === "native"
      ? nativeDatabaseUrl(credentials.databaseUrl)
      : `postgresql://agentic:${databasePassword}@db:5432/agentic_os`;
  if (settings.mode === "container" && credentials.databaseUrl)
    throw new Error("Container installation provisions its own database");
  const providerKey = credentials.providerKey;
  if (settings.provider === "openai" || settings.provider === "openrouter") {
    if (!providerKey || providerKey.length > 512 || /[\s\0]/u.test(providerKey))
      throw new Error("provider_key_required");
  } else if (providerKey) throw new Error("Unexpected provider credential");
  if (settings.provider === "ollama") {
    const url = new URL(credentials.ollamaUrl ?? "http://127.0.0.1:11434/v1");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("ollama_url_invalid");
  }
  const exactParent = await ensureExactOutputDirectory(parent);
  const directory = path.join(exactParent, `instance-${plan.id}`);
  // Exclusive creation prevents a second setup from overwriting credentials or
  // attaching to an unrelated installation. Recovery reads this same identity.
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error("Installation already exists; resume it explicitly");
    throw error;
  }
  await ensureExactOutputDirectory(directory);
  if (process.platform === "win32") {
    // POSIX mode bits do not protect Windows files. Remove inherited grants
    // before writing secrets and grant only this account and LocalSystem.
    const identity = await runSetupProbe("whoami.exe", [
      "/user",
      "/fo",
      "csv",
      "/nh",
    ]);
    const sid = windowsOwnerSid(identity);
    await runSetupProbe("icacls.exe", [
      directory,
      "/inheritance:r",
      "/grant:r",
      `*${sid}:(OI)(CI)F`,
      "*S-1-5-18:(OI)(CI)F",
    ]);
  }
  const secrets = path.join(directory, "secrets");
  await mkdir(secrets, { mode: 0o700 });
  const values: Record<string, string> = {
    database_url: databaseUrl,
    operator_auth_token: randomBytes(32).toString("base64url"),
    runtime_control_key: randomBytes(32).toString("base64url"),
  };
  if (settings.mode === "container")
    values.postgres_password = databasePassword;
  if (providerKey) values.provider_key = providerKey;
  const secretFiles: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    const file = path.join(secrets, name);
    const mode = settings.mode === "container" ? 0o640 : 0o600;
    const handle = await open(file, "wx", mode);
    try {
      await handle.writeFile(value);
      if (process.platform !== "win32") await handle.chmod(mode);
    } finally {
      await handle.close();
    }
    secretFiles[name] = file;
  }
  await writeFile(
    path.join(directory, "installation.json"),
    JSON.stringify(
      { schemaVersion: 1, plan, phase: "prepared", secretFiles },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  return {
    directory,
    secretFiles: secretFiles as unknown as InstallationResources["secretFiles"],
  };
}
