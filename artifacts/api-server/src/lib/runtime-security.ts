import fs from "node:fs";
import path from "node:path";
import { readRuntimeOperationsConfig } from "./runtime-operations-config";
import {
  parseSyntheticFaultPlan,
  parseSyntheticSeed,
  type SyntheticFaultPlan,
} from "./testing/synthetic-fault-plan";

export interface SyntheticRuntimeConfiguration {
  enabled: true;
  mode: "accelerated" | "soak";
  runId: string;
  seed: number;
  faultPlan: SyntheticFaultPlan;
  /** Exact active project roster size, including the coordinator. */
  expectedAgents: number;
  runDirectory: string | null;
  controlFile: string | null;
}

export const ENDURANCE_RUNTIME_ATTESTATION_PATH =
  "/app/.agentic-endurance-runtime";

export interface SyntheticRuntimeSecurityOptions {
  /** Test seam only. Production callers intentionally do not supply this. */
  productionAttestation?: () => boolean;
}

export function hasProductionEnduranceAttestation(): boolean {
  if (process.platform === "win32") return false;
  try {
    const metadata = fs.lstatSync(ENDURANCE_RUNTIME_ATTESTATION_PATH);
    return (
      metadata.isFile() &&
      !metadata.isSymbolicLink() &&
      metadata.uid === 0 &&
      metadata.gid === 0 &&
      (metadata.mode & 0o777) === 0o444
    );
  } catch {
    return false;
  }
}

export function isLoopbackBindHost(host: string): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(host.toLowerCase());
}

export function readBooleanEnvironment(
  name: string,
  fallback: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be exactly "true" or "false".`);
}

export function readIntegerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}

function assertStrictBooleans(): void {
  for (const name of [
    "ALLOW_REMOTE_ACCESS",
    "ALLOW_AGENT_PROCESS_EXEC",
    "ALLOW_AGENT_SUDO",
    "ALLOW_FOUNDER_SHELL",
    "SCHEDULER_ENABLED",
    "AGENT_BROWSER_HEADLESS",
    "AGENT_BROWSER_ALLOW_PRIVATE_NETWORKS",
    "AGENT_BROWSER_ALLOW_WEBSOCKETS",
    "SERVE_STATIC_UI",
    "SYNTHETIC_RUNTIME_ENABLED",
  ]) {
    readBooleanEnvironment(name, false);
  }
}

function normalizedPathForComparison(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function validateSyntheticControlPaths(input: {
  runDirectory: string | undefined;
  controlFile: string | undefined;
  required: boolean;
}): { runDirectory: string | null; controlFile: string | null } {
  if (!input.runDirectory && !input.controlFile && !input.required) {
    return { runDirectory: null, controlFile: null };
  }
  if (!input.runDirectory) {
    throw new Error("ENDURANCE_RUN_DIR is required for soak fault control.");
  }
  if (!input.controlFile) {
    throw new Error(
      "SYNTHETIC_RUNTIME_CONTROL_FILE is required for soak fault control.",
    );
  }
  if (
    !path.isAbsolute(input.runDirectory) ||
    !path.isAbsolute(input.controlFile)
  ) {
    throw new Error(
      "Synthetic fault control paths must be absolute local paths.",
    );
  }
  if (
    process.platform === "win32" &&
    (input.runDirectory.startsWith("\\\\") ||
      input.controlFile.startsWith("\\\\"))
  ) {
    throw new Error(
      "Synthetic fault control paths cannot use a network share.",
    );
  }
  if (
    normalizedPathForComparison(input.runDirectory) !==
    normalizedPathForComparison(path.dirname(input.controlFile))
  ) {
    throw new Error(
      "SYNTHETIC_RUNTIME_CONTROL_FILE must be directly inside ENDURANCE_RUN_DIR.",
    );
  }
  return {
    runDirectory: path.resolve(input.runDirectory),
    controlFile: path.resolve(input.controlFile),
  };
}

export function readSyntheticRuntimeConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  options: SyntheticRuntimeSecurityOptions = {},
): SyntheticRuntimeConfiguration | null {
  const enabled = readBooleanEnvironment(
    "SYNTHETIC_RUNTIME_ENABLED",
    false,
    env,
  );
  const syntheticOnlyValues = [
    env.SYNTHETIC_RUNTIME_SEED,
    env.SYNTHETIC_RUNTIME_FAULT_PLAN,
    env.SYNTHETIC_RUNTIME_CONTROL_FILE,
  ];
  if (!enabled) {
    if (
      syntheticOnlyValues.some((value) => value !== undefined && value !== "")
    ) {
      throw new Error(
        "Synthetic runtime settings require SYNTHETIC_RUNTIME_ENABLED=true.",
      );
    }
    return null;
  }
  const production = env.NODE_ENV === "production";
  if (
    production &&
    !(options.productionAttestation ?? hasProductionEnduranceAttestation)()
  ) {
    throw new Error(
      "Synthetic runtime is forbidden in production without the dedicated endurance image attestation.",
    );
  }
  const mode = env.ENDURANCE_MODE;
  if (mode !== "accelerated" && mode !== "soak") {
    throw new Error('ENDURANCE_MODE must be exactly "accelerated" or "soak".');
  }
  if (production && mode !== "soak") {
    throw new Error(
      'The attested production endurance image permits only ENDURANCE_MODE="soak".',
    );
  }
  const runId = env.ENDURANCE_RUN_ID;
  if (!runId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(runId)) {
    throw new Error(
      "ENDURANCE_RUN_ID must be a bounded filesystem-safe run identity.",
    );
  }
  const seed = parseSyntheticSeed(env.SYNTHETIC_RUNTIME_SEED);
  const faultPlan = parseSyntheticFaultPlan(
    env.SYNTHETIC_RUNTIME_FAULT_PLAN,
    seed,
  );
  const expectedAgents = readIntegerEnvironment(
    "ENDURANCE_EXPECTED_AGENTS",
    10,
    2,
    10_000,
    env,
  );
  const paths = validateSyntheticControlPaths({
    runDirectory: env.ENDURANCE_RUN_DIR,
    controlFile: env.SYNTHETIC_RUNTIME_CONTROL_FILE,
    required: mode === "soak",
  });
  return Object.freeze({
    enabled: true as const,
    mode,
    runId,
    seed,
    faultPlan,
    expectedAgents,
    ...paths,
  });
}

function assertOrigins(): void {
  for (const value of (process.env.CORS_ALLOWED_ORIGINS ?? "").split(",")) {
    const origin = value.trim();
    if (!origin) continue;
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(
        `CORS_ALLOWED_ORIGINS contains an invalid URL: "${origin}".`,
      );
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(
        `CORS_ALLOWED_ORIGINS must contain exact HTTP(S) origins without paths or credentials: "${origin}".`,
      );
    }
    if (
      process.env.NODE_ENV === "production" &&
      parsed.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "::1", "[::1]"].includes(
        parsed.hostname.toLowerCase(),
      )
    ) {
      throw new Error(
        `CORS_ALLOWED_ORIGINS must use HTTPS for non-loopback production origins: "${origin}".`,
      );
    }
  }
}

function assertTrustedHosts(): void {
  for (const value of (process.env.TRUSTED_HOSTS ?? "").split(",")) {
    const host = value.trim();
    if (!host) continue;
    if (
      host === "*" ||
      host.includes("/") ||
      host.includes("://") ||
      /[\s?#]/.test(host)
    ) {
      throw new Error(
        `TRUSTED_HOSTS must contain exact hostnames without schemes, paths, ports, or wildcards: "${host}".`,
      );
    }
  }
}

function assertDatabaseUrl(): void {
  const value = process.env.DATABASE_URL;
  if (!value) return;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(
      "DATABASE_URL must use the postgres: or postgresql: scheme.",
    );
  }
}

export function assertRuntimeConfiguration(input: { host: string }): void {
  const operationsConfig = readRuntimeOperationsConfig();
  assertStrictBooleans();
  assertOrigins();
  assertTrustedHosts();
  assertDatabaseUrl();

  for (const [name, fallback, minimum, maximum] of [
    [
      "OPERATOR_SESSION_TTL_MS",
      12 * 60 * 60_000,
      5 * 60_000,
      7 * 24 * 60 * 60_000,
    ],
    ["API_RATE_LIMIT_MAX", 300, 10, 100_000],
    ["API_RATE_LIMIT_WINDOW_MS", 60_000, 1_000, 60 * 60_000],
    ["AUTH_RATE_LIMIT_MAX", 10, 1, 1_000],
    ["AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60_000, 10_000, 24 * 60 * 60_000],
    ["SHUTDOWN_GRACE_MS", 20_000, 1_000, 5 * 60_000],
    ["DATABASE_POOL_MAX", 10, 1, 100],
    ["DATABASE_CONNECT_TIMEOUT_MS", 10_000, 1_000, 120_000],
    ["DATABASE_IDLE_TIMEOUT_MS", 30_000, 1_000, 10 * 60_000],
    ["DATABASE_STATEMENT_TIMEOUT_MS", 60_000, 1_000, 30 * 60_000],
    ["MAX_BROWSER_SESSIONS", 4, 1, 64],
    ["BROWSER_SESSION_IDLE_MS", 15 * 60_000, 60_000, 24 * 60 * 60_000],
    ["BROWSER_CONTROL_LEASE_MS", 30_000, 5_000, 5 * 60_000],
    // Zero intentionally disables the optional lifetime step circuit breaker;
    // this must match scheduler semantics and the documented production env.
    ["MAX_TASK_STEPS", 0, 0, 10_000],
    ["MAX_TASK_TOKENS", 100_000, 1_000, 100_000_000],
    ["MAX_CONSECUTIVE_TASK_FAILURES", 5, 1, 1_000],
    ["LLM_REQUEST_TIMEOUT_MS", 120_000, 5_000, 600_000],
    ["MAX_ACTIVE_AGENTS", 64, 1, 10_000],
    ["MAX_OUTSTANDING_TASKS", 500, 1, 100_000],
    ["MAX_OUTSTANDING_APPROVALS", 200, 1, 100_000],
    ["MAX_MESSAGES_PER_AGENT", 5_000, 1, 1_000_000],
    ["MAX_AGENT_TOOL_ROUNDS", 8, 4, 16],
    ["COMPANY_CHAT_MAX_RESPONSE_ATTEMPTS", 6, 1, 32],
    ["COMPANY_CHAT_RESPONSE_CONCURRENCY", 1, 1, 8],
    ["COMPANY_CHAT_RESPONSE_MAX_TOKENS", 400, 100, 600],
    ["COMPANY_CHAT_RESPONSE_TOKEN_BUDGET", 2_400, 100, 19_200],
    ["PROJECT_MEETING_MAX_RESPONDERS_PER_START", 8, 1, 32],
    ["PROJECT_MEETING_MAX_CONCURRENT_STARTS", 2, 1, 16],
    ["EMERGENCY_STOP_MONITOR_MS", 20_000, 1_000, 5 * 60_000],
  ] as const) {
    readIntegerEnvironment(name, fallback, minimum, maximum);
  }

  const reportedCost = process.env.MAX_TASK_REPORTED_COST_USD;
  if (
    reportedCost !== undefined &&
    reportedCost !== "" &&
    (!Number.isFinite(Number(reportedCost)) || Number(reportedCost) <= 0)
  ) {
    throw new Error("MAX_TASK_REPORTED_COST_USD must be a positive number.");
  }

  const channel = process.env.AGENT_BROWSER_CHANNEL;
  if (channel && !["chrome", "msedge", "chromium"].includes(channel)) {
    throw new Error(
      "AGENT_BROWSER_CHANNEL must be chrome, msedge, or chromium.",
    );
  }
  const logLevel = process.env.LOG_LEVEL;
  if (
    logLevel &&
    !["silent", "fatal", "error", "warn", "info", "debug", "trace"].includes(
      logLevel,
    )
  ) {
    throw new Error("LOG_LEVEL is invalid.");
  }
  const nodeEnvironment = process.env.NODE_ENV;
  if (
    nodeEnvironment &&
    !["development", "test", "production"].includes(nodeEnvironment)
  ) {
    throw new Error("NODE_ENV must be development, test, or production.");
  }
  readSyntheticRuntimeConfiguration();
  const executable = process.env.AGENT_BROWSER_EXECUTABLE_PATH;
  if (executable) {
    if (!path.isAbsolute(executable) || !fs.existsSync(executable)) {
      throw new Error(
        "AGENT_BROWSER_EXECUTABLE_PATH must be an existing absolute path.",
      );
    }
  }
  const sandboxRoot = process.env.AGENT_SANDBOX_ROOT;
  if (sandboxRoot && !path.isAbsolute(sandboxRoot)) {
    throw new Error("AGENT_SANDBOX_ROOT must be an absolute path.");
  }
  if (readBooleanEnvironment("SERVE_STATIC_UI", false)) {
    const staticUiDirectory = process.env.STATIC_UI_DIR;
    if (!staticUiDirectory || !path.isAbsolute(staticUiDirectory)) {
      throw new Error(
        "STATIC_UI_DIR must be an absolute path when SERVE_STATIC_UI=true.",
      );
    }
  }

  const production = process.env.NODE_ENV === "production";
  const loopback = isLoopbackBindHost(input.host);
  const remoteEnabled = readBooleanEnvironment("ALLOW_REMOTE_ACCESS", false);
  const operatorFacing = operationsConfig.role !== "worker";
  const token = process.env.OPERATOR_AUTH_TOKEN;
  if (
    token &&
    (token.length < 32 || token.length > 4096 || token !== token.trim())
  ) {
    throw new Error(
      "OPERATOR_AUTH_TOKEN must contain 32 to 4096 characters and no leading or trailing whitespace.",
    );
  }
  if (operatorFacing && (production || !loopback) && !token) {
    throw new Error(
      "OPERATOR_AUTH_TOKEN with at least 32 characters is required in production or remote mode.",
    );
  }
  if ((production || !loopback) && !process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required in production or remote mode; embedded PGlite is development-only.",
    );
  }
  if (operationsConfig.role !== "combined" && !process.env.DATABASE_URL) {
    throw new Error(
      "The api and worker split runtime roles require DATABASE_URL so every process shares one PostgreSQL control plane.",
    );
  }
  const runtimeControlKey = process.env.RUNTIME_CONTROL_KEY;
  if (
    runtimeControlKey &&
    (runtimeControlKey.length < 32 ||
      runtimeControlKey.length > 4096 ||
      runtimeControlKey !== runtimeControlKey.trim())
  ) {
    throw new Error(
      "RUNTIME_CONTROL_KEY must contain 32 to 4096 characters and no leading or trailing whitespace.",
    );
  }
  if (
    (operationsConfig.role !== "combined" || process.env.DATABASE_URL) &&
    !runtimeControlKey
  ) {
    throw new Error(
      "Durable PostgreSQL installations and split runtime roles require RUNTIME_CONTROL_KEY for authenticated encrypted control and operator receipts.",
    );
  }
  if (operationsConfig.role === "worker") {
    const rawControlUrl = process.env.RUNTIME_CONTROL_API_URL?.trim();
    let controlUrl: URL | null = null;
    try {
      controlUrl = rawControlUrl ? new URL(rawControlUrl) : null;
    } catch {
      controlUrl = null;
    }
    const privateHttpHost =
      controlUrl?.hostname === "app" ||
      controlUrl?.hostname === "localhost" ||
      controlUrl?.hostname === "127.0.0.1" ||
      controlUrl?.hostname === "::1" ||
      /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u.test(
        controlUrl?.hostname ?? "",
      );
    if (
      !controlUrl ||
      (controlUrl.protocol !== "https:" &&
        !(controlUrl.protocol === "http:" && privateHttpHost)) ||
      controlUrl.username ||
      controlUrl.password ||
      controlUrl.search ||
      controlUrl.hash ||
      controlUrl.pathname.replace(/\/$/u, "") !==
        "/api/internal/runtime-control"
    ) {
      throw new Error(
        "RUNTIME_CONTROL_API_URL must be the exact internal runtime-control URL over HTTPS or private HTTP.",
      );
    }
  }
  if (!loopback && !production) {
    throw new Error(
      "Remote mode requires NODE_ENV=production for secure sessions.",
    );
  }
  if (!loopback && !remoteEnabled) {
    throw new Error(
      "Refusing non-loopback exposure without ALLOW_REMOTE_ACCESS=true.",
    );
  }
  if (!loopback && !process.env.CORS_ALLOWED_ORIGINS?.trim()) {
    throw new Error("CORS_ALLOWED_ORIGINS is required in remote mode.");
  }
  if (!loopback && !process.env.TRUSTED_HOSTS?.trim()) {
    throw new Error("TRUSTED_HOSTS is required in remote mode.");
  }
}

/**
 * CEO host authority remains local-only even though the ordinary operator API
 * supports single-operator authentication. Authentication does not make host
 * shell access safe on a shared or remotely reachable control plane.
 */
export function assertAgentSudoLocalOnly(input: {
  host: string;
  agentSudoEnabled: boolean;
  remoteAccessEnabled: boolean;
}): void {
  if (!input.agentSudoEnabled) return;
  if (!isLoopbackBindHost(input.host) || input.remoteAccessEnabled) {
    throw new Error(
      "Refusing to enable agent sudo on a remote-capable API; bind to loopback and keep ALLOW_REMOTE_ACCESS disabled.",
    );
  }
}
