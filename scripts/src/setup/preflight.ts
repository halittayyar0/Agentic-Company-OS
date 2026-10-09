import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type PreflightIssue =
  | "native_source_required"
  | "unsupported_platform"
  | "unsupported_architecture"
  | "node_24_required"
  | "docker_unavailable"
  | "docker_engine_unavailable"
  | "docker_linux_engine_required"
  | "compose_v2_required";

export interface InstallCapabilities {
  platform: string;
  architecture: string;
  nodeVersion: string;
  postgresClientVersion: string | null;
  composeVersion: string | null;
  native: { ready: boolean; issues: PreflightIssue[] };
  container: { ready: boolean; issues: PreflightIssue[] };
  phone?: { ready: boolean };
  coding?: { ready: boolean; issues: string[]; apparmor: boolean };
}

export function codingComposeSupported(version: string | null): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(version ?? "");
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return major === 2 && (minor > 24 || (minor === 24 && patch >= 4));
}

export async function runSetupProbe(
  command: string,
  args: string[],
): Promise<string> {
  const { stdout } = await promisify(execFile)(command, args, {
    timeout: 20000,
    maxBuffer: 65536,
    windowsHide: true,
    encoding: "utf8",
  });
  return stdout.trim();
}

export async function detectInstallCapabilities(
  dependencies: {
    platform?: string;
    arch?: string;
    nodeVersion?: string;
    run?: typeof runSetupProbe;
  } = {},
): Promise<InstallCapabilities> {
  const platform = dependencies.platform ?? process.platform;
  const architecture = dependencies.arch ?? process.arch;
  const nodeVersion = dependencies.nodeVersion ?? process.version;
  const run = dependencies.run ?? runSetupProbe;
  const common: PreflightIssue[] = [];
  if (!["win32", "linux", "darwin"].includes(platform))
    common.push("unsupported_platform");
  if (!["x64", "arm64"].includes(architecture))
    common.push("unsupported_architecture");
  const nativeIssues = [...common];
  const containerIssues = [...common];
  if (!/^v24\.\d+\.\d+$/u.test(nodeVersion))
    nativeIssues.push("node_24_required");
  const [postgres, docker, compose, engine, phone, engineDetails] =
    await Promise.allSettled([
      run("psql", ["--version"]),
      run("docker", ["--version"]),
      run("docker", ["compose", "version", "--short"]),
      run("docker", ["info", "--format", "{{.OSType}}"]),
      run("tailscale", ["status", "--json"]),
      run("docker", ["info", "--format", "{{json .}}"]),
    ]);
  const composeVersion =
    compose.status === "fulfilled" &&
    /^v?2\.\d+\.\d+(?:[-+][\w.-]+)?$/u.test(compose.value.trim())
      ? compose.value.trim()
      : null;
  if (docker.status === "rejected") {
    containerIssues.push("docker_unavailable");
  } else {
    if (engine.status === "rejected")
      containerIssues.push("docker_engine_unavailable");
    else if (engine.value.trim() !== "linux")
      containerIssues.push("docker_linux_engine_required");
    if (!composeVersion) containerIssues.push("compose_v2_required");
  }
  const codingIssues: string[] = [];
  let apparmor = false;
  if (containerIssues.length) codingIssues.push("coding_linux_engine_required");
  if (!codingComposeSupported(composeVersion))
    codingIssues.push("coding_compose_version_required");
  try {
    if (engineDetails.status !== "fulfilled")
      throw new Error("engine_unavailable");
    const details = JSON.parse(engineDetails.value);
    if (
      details.OSType !== "linux" ||
      !["x86_64", "amd64"].includes(details.Architecture) ||
      !Array.isArray(details.SecurityOptions) ||
      details.SecurityOptions.some((item: unknown) => typeof item !== "string")
    )
      throw new Error("engine_identity_invalid");
    apparmor = details.SecurityOptions.some((item: string) =>
      item.startsWith("name=apparmor"),
    );
  } catch {
    codingIssues.push("coding_x64_engine_required");
  }
  if (!apparmor) codingIssues.push("coding_apparmor_required");
  return {
    platform,
    architecture,
    nodeVersion,
    postgresClientVersion:
      postgres.status === "fulfilled" &&
      /^psql \(PostgreSQL\) \d+\.\d+(?:[\s\w.()+-]*)$/u.test(
        postgres.value.trim(),
      )
        ? postgres.value.trim()
        : null,
    composeVersion,
    native: { ready: nativeIssues.length === 0, issues: nativeIssues },
    container: { ready: containerIssues.length === 0, issues: containerIssues },
    coding: {
      ready: codingIssues.length === 0,
      issues: codingIssues,
      apparmor,
    },
    phone: {
      ready: (() => {
        if (phone.status !== "fulfilled") return false;
        try {
          const status = JSON.parse(phone.value);
          return (
            status.BackendState === "Running" &&
            typeof status.Self?.DNSName === "string" &&
            status.Self.DNSName.endsWith(".ts.net.")
          );
        } catch {
          return false;
        }
      })(),
    },
  };
}
