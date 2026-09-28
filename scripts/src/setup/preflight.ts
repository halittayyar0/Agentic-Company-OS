import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type PreflightIssue =
  | "unsupported_platform"
  | "unsupported_architecture"
  | "node_24_required"
  | "docker_unavailable"
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
}

export async function runSetupProbe(
  command: string,
  args: string[],
): Promise<string> {
  const { stdout } = await promisify(execFile)(command, args, {
    timeout: 8000,
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
  const [postgres, compose, engine, phone] = await Promise.allSettled([
    run("psql", ["--version"]),
    run("docker", ["compose", "version", "--short"]),
    run("docker", ["info", "--format", "{{.OSType}}"]),
    run("tailscale", ["status", "--json"]),
  ]);
  const composeVersion =
    compose.status === "fulfilled" &&
    /^v?2\.\d+\.\d+(?:[-+][\w.-]+)?$/u.test(compose.value.trim())
      ? compose.value.trim()
      : null;
  if (engine.status === "rejected" || compose.status === "rejected") {
    containerIssues.push("docker_unavailable");
  } else {
    if (engine.value.trim() !== "linux")
      containerIssues.push("docker_linux_engine_required");
    if (!composeVersion) containerIssues.push("compose_v2_required");
  }
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
