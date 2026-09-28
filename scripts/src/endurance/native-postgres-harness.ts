import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  probeRuntimeTopology,
  waitForRuntimeTopology,
  waitForRuntimeWorkerReplacement,
  type RuntimeTopologyProbe,
} from "./runtime-probe";
import {
  executeBoundedCommand,
  ProcessSupervisor,
  type ManagedProcessSnapshot,
  type ManagedProcessSpec,
} from "./process-supervisor";
import {
  durableEnduranceEventsSql,
  makeContinuousTasksDueSql,
  parseDurableEnduranceEvents,
  parsePositiveIdRows,
  type DurableEnduranceEvent,
} from "./postgres-harness";
import type { NativePostgresEnduranceRuntimeAttestation } from "./report-schema";
import {
  hashExactDirectoryTree,
  requireNode24Version,
  sha256ExactFile,
} from "./native-runtime-provenance";

export interface PortablePostgresBinaries {
  binDirectory: string;
  postgres: string;
  initdb: string;
  pgCtl: string;
  pgIsReady: string;
  psql: string;
}

export interface NativeCommandExecution {
  command: string;
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  ignoreInheritedStdio?: boolean;
  timeoutMs: number;
}

export interface NativeCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type NativeCommandExecutor = (
  execution: NativeCommandExecution,
) => Promise<NativeCommandResult>;

export interface NativeProcessSupervisor {
  start(spec: ManagedProcessSpec): ManagedProcessSnapshot;
  snapshot(name: string): ManagedProcessSnapshot | undefined;
  snapshots(): ManagedProcessSnapshot[];
  logs(name: string): { stdout: string; stderr: string };
  waitUntilReady(
    probe: () => boolean | Promise<boolean>,
    options: { timeoutMs: number; intervalMs?: number; label: string },
  ): Promise<void>;
  kill(name: string): Promise<void>;
  stopAll(): Promise<void>;
}

export interface NativeRuntimeEnvironmentInput {
  baseEnvironment?: NodeJS.ProcessEnv;
  databaseUrl: string;
  apiPort: number;
  operatorToken: string;
  runtimeControlKey: string;
  runId: string;
  runDirectory: string;
  seed: number;
  expectedAgents: number;
  staticUiDirectory: string;
}

export interface NativeRuntimeEnvironments {
  api: NodeJS.ProcessEnv;
  worker1: NodeJS.ProcessEnv;
  worker2: NodeJS.ProcessEnv;
}

export interface NativePostgresEnduranceHarnessOptions {
  runId: string;
  workspaceRoot: string;
  postgresRoot: string;
  runDirectory: string;
  apiPort: number;
  databasePort: number;
  operatorToken: string;
  runtimeControlKey: string;
  seed: number;
  expectedAgents?: number;
  nodeExecutable?: string;
  startupTimeoutMs?: number;
  commandTimeoutMs?: number;
  cleanupTimeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
  binaries?: PortablePostgresBinaries;
  supervisor?: NativeProcessSupervisor;
  execute?: NativeCommandExecutor;
  createStateDirectory?: () => Promise<string>;
  waitForApiReady?: (input: {
    baseUrl: string;
    operatorToken: string;
    timeoutMs: number;
  }) => Promise<void>;
  waitForTopology?: (input: {
    baseUrl: string;
    operatorToken: string;
    timeoutMs: number;
  }) => Promise<void>;
  probeTopology?: (input: {
    baseUrl: string;
    operatorToken: string;
  }) => Promise<RuntimeTopologyProbe>;
  waitForWorkerReplacement?: (input: {
    baseUrl: string;
    operatorToken: string;
    timeoutMs: number;
    previousWorkerIds: readonly string[];
  }) => Promise<RuntimeTopologyProbe>;
}

const SAFE_RUN_ID = /^[a-z0-9][a-z0-9-]{0,39}$/u;
const WORKERS = new Set(["worker-1", "worker-2"] as const);
const STATE_OWNER_FILE = ".native-run-owner";
const PASSWORD_FILE = "postgres-password.txt";
const POSTGRES_BINARY_ORDER = [
  ["postgres", "postgres"],
  ["initdb", "initdb"],
  ["pg_ctl", "pgCtl"],
  ["pg_isready", "pgIsReady"],
  ["psql", "psql"],
] as const;

function supportedPostgres17Version(value: string): boolean {
  return /^PostgreSQL 17\.[0-9]+(?:[^\s]*)?$/u.test(value);
}

function normalizedForTargetComparison(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function validateNativeStateDirectoryTarget(
  stateDirectory: string,
  runId: string,
): string {
  if (!SAFE_RUN_ID.test(runId)) {
    throw new TypeError("runId must be a safe native state identity");
  }
  const resolved = path.resolve(stateDirectory);
  if (
    normalizedForTargetComparison(path.dirname(resolved)) !==
    normalizedForTargetComparison(tmpdir())
  ) {
    throw new Error(
      "Native state directory must be a direct child of the process temp root",
    );
  }
  if (!path.basename(resolved).startsWith(`agentic-native-${runId}-`)) {
    throw new Error(
      "Native state directory must use the exact run-prefixed basename",
    );
  }
  return resolved;
}

function executableName(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

async function existsRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await lstat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function findNamedFile(
  directory: string,
  targetName: string,
): Promise<string[]> {
  const matches: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      matches.push(...(await findNamedFile(entryPath, targetName)));
    } else if (entry.isFile() && entry.name.toLowerCase() === targetName) {
      matches.push(entryPath);
    }
  }
  return matches;
}

export async function findPortablePostgresBinaries(
  postgresRoot: string,
): Promise<PortablePostgresBinaries> {
  if (!postgresRoot.trim()) throw new TypeError("postgresRoot is required");
  const root = path.resolve(postgresRoot);
  const metadata = await lstat(root).catch(() => null);
  if (!metadata?.isDirectory()) {
    throw new Error("Portable PostgreSQL root is not a directory");
  }
  const postgresName = executableName("postgres").toLowerCase();
  const candidates = (await findNamedFile(root, postgresName)).sort();
  if (candidates.length === 0) {
    throw new Error(`postgres executable is missing below ${root}`);
  }
  for (const postgres of candidates) {
    const binDirectory = path.dirname(postgres);
    const candidate: PortablePostgresBinaries = {
      binDirectory,
      postgres,
      initdb: path.join(binDirectory, executableName("initdb")),
      pgCtl: path.join(binDirectory, executableName("pg_ctl")),
      pgIsReady: path.join(binDirectory, executableName("pg_isready")),
      psql: path.join(binDirectory, executableName("psql")),
    };
    const missing = (
      await Promise.all(
        (["initdb", "pgCtl", "pgIsReady", "psql"] as const).map(
          async (key) => ({
            key,
            present: await existsRegularFile(candidate[key]),
          }),
        ),
      )
    ).filter((item) => !item.present);
    if (missing.length === 0) return candidate;
    if (candidates.length === 1) {
      throw new Error(
        `${missing.map((item) => item.key.replace("pgCtl", "pg_ctl").replace("pgIsReady", "pg_isready")).join(", ")} executable is missing beside postgres`,
      );
    }
  }
  throw new Error("No complete portable PostgreSQL toolchain was found");
}

function reserveOneLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Loopback port reservation returned no TCP address"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

export async function reserveLoopbackPorts(count: number): Promise<number[]> {
  if (!Number.isSafeInteger(count) || count < 1 || count > 16) {
    throw new TypeError("port count must be an integer from 1 to 16");
  }
  const ports = new Set<number>();
  while (ports.size < count) ports.add(await reserveOneLoopbackPort());
  return [...ports];
}

function assertSecret(value: string, label: string): void {
  if (value.length < 32 || value.length > 4_096 || value !== value.trim()) {
    throw new TypeError(`${label} must contain 32 to 4096 trimmed characters`);
  }
}

function withoutInheritedSecrets(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    DATABASE_URL_FILE: undefined,
    OPERATOR_AUTH_TOKEN_FILE: undefined,
    RUNTIME_CONTROL_KEY_FILE: undefined,
    OPENROUTER_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    AI_INTEGRATIONS_OPENAI_API_KEY: undefined,
  };
}

export function createNativeRuntimeEnvironments(
  input: NativeRuntimeEnvironmentInput,
): NativeRuntimeEnvironments {
  assertSecret(input.operatorToken, "operatorToken");
  assertSecret(input.runtimeControlKey, "runtimeControlKey");
  if (!Number.isSafeInteger(input.apiPort) || input.apiPort < 1) {
    throw new TypeError("apiPort must be a positive integer");
  }
  if (!Number.isSafeInteger(input.expectedAgents) || input.expectedAgents < 2) {
    throw new TypeError("expectedAgents must be an integer of at least two");
  }
  const runDirectory = path.resolve(input.runDirectory);
  const common: NodeJS.ProcessEnv = {
    ...withoutInheritedSecrets(input.baseEnvironment ?? process.env),
    NODE_ENV: "development",
    DATABASE_URL: input.databaseUrl,
    HOST: "127.0.0.1",
    TRUSTED_HOSTS: "127.0.0.1,localhost",
    ALLOW_REMOTE_ACCESS: "false",
    ALLOW_AGENT_PROCESS_EXEC: "false",
    ALLOW_AGENT_SUDO: "false",
    ALLOW_FOUNDER_SHELL: "false",
    RUNTIME_CONTROL_KEY: input.runtimeControlKey,
    SYNTHETIC_RUNTIME_ENABLED: "true",
    ENDURANCE_MODE: "soak",
    ENDURANCE_RUN_ID: input.runId,
    ENDURANCE_RUN_DIR: runDirectory,
    ENDURANCE_EXPECTED_AGENTS: String(input.expectedAgents),
    SYNTHETIC_RUNTIME_SEED: String(input.seed),
    SYNTHETIC_RUNTIME_FAULT_PLAN: undefined,
    SYNTHETIC_RUNTIME_CONTROL_FILE: path.join(
      runDirectory,
      "fault-control.json",
    ),
    AGENT_SANDBOX_ROOT: path.join(runDirectory, "sandboxes"),
    AGENT_BROWSER_HEADLESS: "true",
    SCHEDULER_TICK_MS: "1000",
    TASK_LEASE_MS: "30000",
    TASK_HEARTBEAT_MS: "5000",
    RUNTIME_HEARTBEAT_MS: "1000",
    WORKER_STALE_AFTER_MS: "5000",
    RECOVERY_TARGET_MS: "60000",
    OPS_SAMPLE_MS: "10000",
    EMERGENCY_STOP_MONITOR_MS: "1000",
    SHUTDOWN_GRACE_MS: "5000",
    LOG_LEVEL: "info",
  };
  const controlUrl = `http://127.0.0.1:${input.apiPort}/api/internal/runtime-control`;
  const worker: NodeJS.ProcessEnv = {
    ...common,
    RUNTIME_ROLE: "worker",
    SCHEDULER_ENABLED: "true",
    SERVE_STATIC_UI: "false",
    STATIC_UI_DIR: undefined,
    PORT: undefined,
    OPERATOR_AUTH_TOKEN: undefined,
    RUNTIME_CONTROL_API_URL: controlUrl,
  };
  return {
    api: {
      ...common,
      RUNTIME_ROLE: "api",
      SCHEDULER_ENABLED: "false",
      SERVE_STATIC_UI: "true",
      STATIC_UI_DIR: path.resolve(input.staticUiDirectory),
      PORT: String(input.apiPort),
      OPERATOR_AUTH_TOKEN: input.operatorToken,
      RUNTIME_CONTROL_API_URL: undefined,
    },
    worker1: { ...worker, RUNTIME_INSTANCE_NAME: "worker-1" },
    worker2: { ...worker, RUNTIME_INSTANCE_NAME: "worker-2" },
  };
}

export const executeNativeCommand: NativeCommandExecutor = (execution) =>
  executeBoundedCommand({
    ...execution,
    maxBufferBytes: 16 * 1024 * 1024,
  });

async function defaultWaitForApiReady(input: {
  baseUrl: string;
  operatorToken: string;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  let lastError: unknown;
  do {
    try {
      const response = await fetch(new URL("/api/readyz", input.baseUrl), {
        headers: { authorization: `Bearer ${input.operatorToken}` },
        signal: AbortSignal.timeout(5_000),
      });
      const body = (await response.json()) as { status?: unknown };
      if (response.ok && body.status === "ready") return;
      lastError = new Error(`/api/readyz returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`Native API did not become ready${detail}`);
}

function defaultWaitForTopology(input: {
  baseUrl: string;
  operatorToken: string;
  timeoutMs: number;
}): Promise<void> {
  return waitForRuntimeTopology(
    {
      baseUrl: input.baseUrl,
      operatorToken: input.operatorToken,
      requestTimeoutMs: 5_000,
    },
    { timeoutMs: input.timeoutMs, intervalMs: 250 },
  ).then(() => undefined);
}

function randomSecret(): string {
  return randomBytes(48).toString("base64url");
}

export function createNativeRuntimeSecrets(): {
  operatorToken: string;
  runtimeControlKey: string;
} {
  return {
    operatorToken: randomSecret(),
    runtimeControlKey: randomSecret(),
  };
}

export class NativePostgresEnduranceHarness {
  readonly runId: string;
  readonly projectName: string;
  readonly workspaceRoot: string;
  readonly runDirectory: string;
  readonly apiPort: number;
  readonly databasePort: number;

  private readonly postgresRoot: string;
  private readonly operatorToken: string;
  private readonly runtimeControlKey: string;
  private readonly seed: number;
  private readonly expectedAgents: number;
  private readonly nodeExecutable: string;
  private readonly startupTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private readonly cleanupTimeoutMs: number;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly suppliedBinaries?: PortablePostgresBinaries;
  private readonly supervisor: NativeProcessSupervisor;
  private readonly execute: NativeCommandExecutor;
  private readonly createStateDirectory: () => Promise<string>;
  private readonly waitForApiReady: NonNullable<
    NativePostgresEnduranceHarnessOptions["waitForApiReady"]
  >;
  private readonly waitForTopology: NonNullable<
    NativePostgresEnduranceHarnessOptions["waitForTopology"]
  >;
  private readonly probeTopology: NonNullable<
    NativePostgresEnduranceHarnessOptions["probeTopology"]
  >;
  private readonly waitForWorkerReplacement: NonNullable<
    NativePostgresEnduranceHarnessOptions["waitForWorkerReplacement"]
  >;
  private readonly generations = new Map<string, number>();
  private readonly processSpecs = new Map<string, ManagedProcessSpec>();
  private readonly workerReplacementBaselines = new Map<
    "worker-1" | "worker-2",
    string[]
  >();

  private binaries: PortablePostgresBinaries | null = null;
  private stateDirectory: string | null = null;
  private dataDirectory: string | null = null;
  private databaseUrl: string | null = null;
  private databasePassword: string | null = null;
  private touched = false;
  private databaseRunning = false;
  private running = false;
  private runtimeAttestationValue: NativePostgresEnduranceRuntimeAttestation | null =
    null;

  constructor(options: NativePostgresEnduranceHarnessOptions) {
    if (!SAFE_RUN_ID.test(options.runId)) {
      throw new TypeError(
        "runId must use lowercase letters, digits, and hyphens with no path segments",
      );
    }
    if (!options.workspaceRoot.trim()) {
      throw new TypeError("workspaceRoot is required");
    }
    if (!options.postgresRoot.trim()) {
      throw new TypeError("postgresRoot is required");
    }
    assertSecret(options.operatorToken, "operatorToken");
    assertSecret(options.runtimeControlKey, "runtimeControlKey");
    for (const [label, value] of [
      ["apiPort", options.apiPort],
      ["databasePort", options.databasePort],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
        throw new TypeError(`${label} must be an integer from 1 to 65535`);
      }
    }
    if (options.apiPort === options.databasePort) {
      throw new TypeError("apiPort and databasePort must be distinct");
    }
    this.runId = options.runId;
    this.projectName = `agentic-os-native-${options.runId}`;
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.postgresRoot = path.resolve(options.postgresRoot);
    this.runDirectory = path.resolve(options.runDirectory);
    this.apiPort = options.apiPort;
    this.databasePort = options.databasePort;
    this.operatorToken = options.operatorToken;
    this.runtimeControlKey = options.runtimeControlKey;
    this.seed = options.seed;
    this.expectedAgents = options.expectedAgents ?? 10;
    this.nodeExecutable = options.nodeExecutable ?? process.execPath;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 180_000;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 180_000;
    this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? 60_000;
    for (const [label, value] of [
      ["startupTimeoutMs", this.startupTimeoutMs],
      ["commandTimeoutMs", this.commandTimeoutMs],
      ["cleanupTimeoutMs", this.cleanupTimeoutMs],
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new TypeError(`${label} must be positive`);
      }
    }
    this.environment = { ...process.env, ...options.environment };
    this.suppliedBinaries = options.binaries;
    this.supervisor =
      options.supervisor ??
      new ProcessSupervisor({
        runId: options.runId,
        gracefulStopMs: 10_000,
        logLimitBytes: 100 * 1024 * 1024,
      });
    this.execute = options.execute ?? executeNativeCommand;
    this.createStateDirectory =
      options.createStateDirectory ??
      (() => mkdtemp(path.join(tmpdir(), `agentic-native-${this.runId}-`)));
    this.waitForApiReady = options.waitForApiReady ?? defaultWaitForApiReady;
    this.waitForTopology = options.waitForTopology ?? defaultWaitForTopology;
    this.probeTopology =
      options.probeTopology ??
      ((input) =>
        probeRuntimeTopology({
          baseUrl: input.baseUrl,
          operatorToken: input.operatorToken,
          requestTimeoutMs: 5_000,
        }));
    this.waitForWorkerReplacement =
      options.waitForWorkerReplacement ??
      ((input) =>
        waitForRuntimeWorkerReplacement(
          {
            baseUrl: input.baseUrl,
            operatorToken: input.operatorToken,
            requestTimeoutMs: 5_000,
          },
          {
            previousWorkerIds: input.previousWorkerIds,
            timeoutMs: input.timeoutMs,
            intervalMs: 250,
          },
        ));
  }

  private baseUrl(): string {
    return `http://127.0.0.1:${this.apiPort}/`;
  }

  private requireBinaries(): PortablePostgresBinaries {
    if (!this.binaries) throw new Error("PostgreSQL binaries are not ready");
    return this.binaries;
  }

  private async ensureBinaries(): Promise<PortablePostgresBinaries> {
    this.binaries ??=
      this.suppliedBinaries ??
      (await findPortablePostgresBinaries(this.postgresRoot));
    return this.binaries;
  }

  private async probePostgresVersion(): Promise<string> {
    const binaries = await this.ensureBinaries();
    const result = await this.runCommand(binaries.postgres, ["--version"]);
    const match = result.stdout.trim().match(/PostgreSQL\)\s+([^\s]+)/u);
    if (!match) throw new Error("PostgreSQL version probe returned no version");
    const version = `PostgreSQL ${match[1]}`;
    if (!supportedPostgres17Version(version)) {
      throw new Error(`PostgreSQL 17.x is required; received ${version}`);
    }
    return version;
  }

  private async probeNodeVersion(): Promise<string> {
    const result = await this.runCommand(this.nodeExecutable, ["--version"]);
    return requireNode24Version(result.stdout, "Native endurance runtime");
  }

  private async createRuntimeAttestation(): Promise<NativePostgresEnduranceRuntimeAttestation> {
    const binaries = await this.ensureBinaries();
    const binDirectory = path.resolve(binaries.binDirectory);
    const binaryHashes: NativePostgresEnduranceRuntimeAttestation["postgresBinaries"] =
      [];
    for (const [name, key] of POSTGRES_BINARY_ORDER) {
      const binaryPath = path.resolve(binaries[key]);
      if (
        normalizedForTargetComparison(path.dirname(binaryPath)) !==
        normalizedForTargetComparison(binDirectory)
      ) {
        throw new Error(`${name} must be beside the selected postgres binary`);
      }
      binaryHashes.push({
        name,
        sha256: await sha256ExactFile(binaryPath, `PostgreSQL ${name}`),
      });
    }
    const postgresDistribution = await hashExactDirectoryTree(
      this.postgresRoot,
      "Portable PostgreSQL distribution",
    );
    const nodeVersion = await this.probeNodeVersion();
    const postgresVersion = await this.probePostgresVersion();
    const postgresToolchainSha256 = createHash("sha256")
      .update(
        binaryHashes
          .map((binary) => `${binary.name}\0${binary.sha256}\n`)
          .join(""),
      )
      .digest("hex");
    return {
      kind: "native-postgres",
      nodeVersion,
      postgresVersion,
      postgresToolchainSha256,
      postgresBinaries: binaryHashes,
      postgresDistribution: {
        rootPath: postgresDistribution.rootPath,
        startSha256: postgresDistribution.sha256,
        endSha256: postgresDistribution.sha256,
        fileCount: postgresDistribution.fileCount,
        totalBytes: postgresDistribution.totalBytes,
      },
      nodeExecutableSha256: await sha256ExactFile(
        this.nodeExecutable,
        "Native Node executable",
      ),
      pnpmLockSha256: await sha256ExactFile(
        path.join(this.workspaceRoot, "pnpm-lock.yaml"),
        "Native pnpm lockfile",
      ),
    };
  }

  private requireDataDirectory(): string {
    if (!this.dataDirectory) throw new Error("PostgreSQL data is not ready");
    return this.dataDirectory;
  }

  private commandEnvironment(): NodeJS.ProcessEnv {
    const binaries = this.requireBinaries();
    return {
      ...this.environment,
      PATH: `${binaries.binDirectory}${path.delimiter}${this.environment.PATH ?? ""}`,
      PGPASSWORD: undefined,
    };
  }

  private runCommand(
    command: string,
    args: string[],
    options: { ignoreInheritedStdio?: boolean; timeoutMs?: number } = {},
  ): Promise<NativeCommandResult> {
    return this.execute({
      command,
      args,
      cwd: this.workspaceRoot,
      environment: this.commandEnvironment(),
      ignoreInheritedStdio: options.ignoreInheritedStdio,
      timeoutMs: options.timeoutMs ?? this.commandTimeoutMs,
    });
  }

  private runPsql(query: string): Promise<NativeCommandResult> {
    const password = this.databasePassword;
    if (!password) throw new Error("PostgreSQL credentials are not ready");
    return this.execute({
      command: this.requireBinaries().psql,
      args: [
        "--no-psqlrc",
        "--no-password",
        "--set",
        "ON_ERROR_STOP=1",
        "--host",
        "127.0.0.1",
        "--port",
        String(this.databasePort),
        "--username",
        "agentic_endurance",
        "--dbname",
        "postgres",
        "--tuples-only",
        "--no-align",
        "--command",
        query,
      ],
      cwd: this.workspaceRoot,
      environment: {
        ...this.commandEnvironment(),
        PGPASSWORD: password,
      },
      timeoutMs: this.commandTimeoutMs,
    });
  }

  private async startDatabase(): Promise<void> {
    const binaries = this.requireBinaries();
    const logFile = path.join(this.runDirectory, "logs", "postgres.log");
    // pg_ctl can fail after PostgreSQL has crossed its process-start boundary.
    // Retain cleanup authority until a matching stop is confirmed.
    this.databaseRunning = true;
    await this.runCommand(
      binaries.pgCtl,
      [
        "-D",
        this.requireDataDirectory(),
        "-l",
        logFile,
        "-w",
        "-t",
        "60",
        "start",
        "-o",
        `-h 127.0.0.1 -p ${this.databasePort} -c listen_addresses=127.0.0.1 -c fsync=on -c synchronous_commit=on`,
      ],
      { ignoreInheritedStdio: true },
    );
  }

  private async stopDatabase(): Promise<void> {
    if (!this.databaseRunning || !this.binaries || !this.dataDirectory) return;
    await this.runCommand(
      this.binaries.pgCtl,
      ["-D", this.dataDirectory, "-w", "-t", "60", "stop", "-m", "fast"],
      {
        ignoreInheritedStdio: true,
        timeoutMs: this.cleanupTimeoutMs,
      },
    );
    this.databaseRunning = false;
  }

  private processSpec(
    name: "app" | "worker-1" | "worker-2",
    environment: NodeJS.ProcessEnv,
  ): ManagedProcessSpec {
    const apiDirectory = path.join(
      this.workspaceRoot,
      "artifacts",
      "api-server",
    );
    return {
      name,
      command: this.nodeExecutable,
      args: [name === "app" ? "start.mjs" : "start-worker.mjs"],
      cwd: apiDirectory,
      env: environment,
    };
  }

  private startProcess(spec: ManagedProcessSpec): ManagedProcessSnapshot {
    this.processSpecs.set(spec.name, spec);
    if (!this.generations.has(spec.name)) this.generations.set(spec.name, 0);
    return this.supervisor.start(spec);
  }

  private redactLogs(value: string): string {
    let redacted = value;
    for (const secret of [
      this.operatorToken,
      this.runtimeControlKey,
      this.databaseUrl,
      this.databasePassword,
    ]) {
      if (secret) redacted = redacted.replaceAll(secret, "[redacted]");
    }
    return redacted.replace(
      /postgres(?:ql)?:\/\/[^\s"']+/giu,
      "postgresql://[redacted]",
    );
  }

  private async persistProcessLogs(name: string): Promise<void> {
    if (!this.supervisor.snapshot(name)) return;
    const generation = this.generations.get(name) ?? 0;
    const logs = this.supervisor.logs(name);
    const target = path.join(
      this.runDirectory,
      "logs",
      `${name}-generation-${generation}.log`,
    );
    await writeFile(
      target,
      this.redactLogs(`[stdout]\n${logs.stdout}\n[stderr]\n${logs.stderr}\n`),
      { encoding: "utf8", mode: 0o600 },
    );
  }

  private async removeOwnedStateDirectory(): Promise<void> {
    const stateDirectory = this.stateDirectory;
    if (!stateDirectory) return;
    validateNativeStateDirectoryTarget(stateDirectory, this.runId);
    const metadata = await lstat(stateDirectory).catch(() => null);
    if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("Refusing to remove a non-directory native state target");
    }
    const owner = await readFile(
      path.join(stateDirectory, STATE_OWNER_FILE),
      "utf8",
    ).catch(() => null);
    if (owner !== this.runId) {
      throw new Error("Refusing to remove an unowned native state directory");
    }
    await rm(stateDirectory, { recursive: true, force: true });
    this.stateDirectory = null;
    this.dataDirectory = null;
  }

  async start(): Promise<void> {
    if (this.running || this.touched) {
      throw new Error("Native endurance topology is already started");
    }
    this.touched = true;
    try {
      this.binaries =
        this.suppliedBinaries ??
        (await findPortablePostgresBinaries(this.postgresRoot));
      this.runtimeAttestationValue = await this.createRuntimeAttestation();
      await mkdir(path.join(this.runDirectory, "logs"), { recursive: true });
      await mkdir(path.join(this.runDirectory, "sandboxes"), {
        recursive: true,
      });
      this.stateDirectory = validateNativeStateDirectoryTarget(
        await this.createStateDirectory(),
        this.runId,
      );
      await mkdir(this.stateDirectory, { recursive: true });
      const stateMetadata = await lstat(this.stateDirectory);
      if (!stateMetadata.isDirectory() || stateMetadata.isSymbolicLink()) {
        throw new Error("Native state target must be a real local directory");
      }
      await writeFile(
        path.join(this.stateDirectory, STATE_OWNER_FILE),
        this.runId,
        { encoding: "utf8", mode: 0o600 },
      );
      this.dataDirectory = path.join(this.stateDirectory, "postgres-data");
      const passwordFile = path.join(this.stateDirectory, PASSWORD_FILE);
      const databasePassword = randomSecret();
      this.databasePassword = databasePassword;
      await writeFile(passwordFile, databasePassword, {
        encoding: "utf8",
        mode: 0o600,
      });
      try {
        await this.runCommand(this.binaries.initdb, [
          "-D",
          this.dataDirectory,
          "-U",
          "agentic_endurance",
          "--pwfile",
          passwordFile,
          "--auth-host=scram-sha-256",
          "--auth-local=trust",
          "--encoding=UTF8",
          "--no-locale",
        ]);
      } finally {
        await rm(passwordFile, { force: true });
      }
      this.databaseUrl = `postgresql://agentic_endurance:${encodeURIComponent(databasePassword)}@127.0.0.1:${this.databasePort}/postgres`;
      await this.startDatabase();

      const environments = createNativeRuntimeEnvironments({
        baseEnvironment: this.environment,
        databaseUrl: this.databaseUrl,
        apiPort: this.apiPort,
        operatorToken: this.operatorToken,
        runtimeControlKey: this.runtimeControlKey,
        runId: this.runId,
        runDirectory: this.runDirectory,
        seed: this.seed,
        expectedAgents: this.expectedAgents,
        staticUiDirectory: path.join(
          this.workspaceRoot,
          "artifacts",
          "agentic-company-os",
          "dist",
          "public",
        ),
      });
      this.startProcess(this.processSpec("app", environments.api));
      await this.waitForApiReady({
        baseUrl: this.baseUrl(),
        operatorToken: this.operatorToken,
        timeoutMs: this.startupTimeoutMs,
      });
      this.startProcess(this.processSpec("worker-1", environments.worker1));
      this.startProcess(this.processSpec("worker-2", environments.worker2));
      await this.waitForTopology({
        baseUrl: this.baseUrl(),
        operatorToken: this.operatorToken,
        timeoutMs: this.startupTimeoutMs,
      });
      this.running = true;
    } catch (error) {
      try {
        await this.stop();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Native endurance startup and cleanup failed",
        );
      }
      throw error;
    }
  }

  private assertRunning(): void {
    if (!this.running)
      throw new Error("Native endurance topology is not running");
  }

  async killWorker(worker: "worker-1" | "worker-2"): Promise<void> {
    if (!WORKERS.has(worker)) {
      throw new TypeError("worker must be worker-1 or worker-2");
    }
    this.assertRunning();
    const topology = await this.probeTopology({
      baseUrl: this.baseUrl(),
      operatorToken: this.operatorToken,
    });
    this.workerReplacementBaselines.set(worker, [...topology.healthyWorkerIds]);
    await this.supervisor.kill(worker);
    await this.persistProcessLogs(worker);
  }

  async restartWorker(worker: "worker-1" | "worker-2"): Promise<void> {
    if (!WORKERS.has(worker)) {
      throw new TypeError("worker must be worker-1 or worker-2");
    }
    this.assertRunning();
    if (this.supervisor.snapshot(worker)?.running) {
      throw new Error(`${worker} is still running`);
    }
    const spec = this.processSpecs.get(worker);
    if (!spec) throw new Error(`${worker} has no restart specification`);
    const previousWorkerIds = this.workerReplacementBaselines.get(worker);
    if (!previousWorkerIds) {
      throw new Error(`${worker} has no pre-kill runtime identity baseline`);
    }
    this.generations.set(worker, (this.generations.get(worker) ?? 0) + 1);
    this.supervisor.start(spec);
    await this.supervisor.waitUntilReady(
      () => {
        const snapshot = this.supervisor.snapshot(worker);
        if (!snapshot?.running) return false;
        return this.supervisor.logs(worker).stdout.includes("Worker ready");
      },
      {
        timeoutMs: this.startupTimeoutMs,
        intervalMs: 100,
        label: `${worker} process`,
      },
    );
    await this.waitForWorkerReplacement({
      baseUrl: this.baseUrl(),
      operatorToken: this.operatorToken,
      timeoutMs: this.startupTimeoutMs,
      previousWorkerIds,
    });
    this.workerReplacementBaselines.delete(worker);
  }

  async pauseDatabase(): Promise<void> {
    this.assertRunning();
    await this.stopDatabase();
  }

  async resumeDatabase(): Promise<void> {
    this.assertRunning();
    if (this.databaseRunning) throw new Error("PostgreSQL is already running");
    await this.startDatabase();
    await this.waitForTopology({
      baseUrl: this.baseUrl(),
      operatorToken: this.operatorToken,
      timeoutMs: this.startupTimeoutMs,
    });
  }

  private async postgresReady(): Promise<boolean> {
    if (!this.databaseRunning || !this.binaries) return false;
    try {
      await this.runCommand(this.binaries.pgIsReady, [
        "-h",
        "127.0.0.1",
        "-p",
        String(this.databasePort),
        "-U",
        "agentic_endurance",
        "-d",
        "postgres",
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async listRunningServices(): Promise<string[]> {
    this.assertRunning();
    const services = ["app", "worker-1", "worker-2"].filter(
      (name) => this.supervisor.snapshot(name)?.running === true,
    );
    if (await this.postgresReady()) services.push("db");
    return services.sort();
  }

  async postgresVersion(): Promise<string> {
    return (
      this.runtimeAttestationValue?.postgresVersion ??
      (await this.probePostgresVersion())
    );
  }

  async runtimeAttestation(): Promise<NativePostgresEnduranceRuntimeAttestation> {
    this.runtimeAttestationValue ??= await this.createRuntimeAttestation();
    const currentDistribution = await hashExactDirectoryTree(
      this.postgresRoot,
      "Portable PostgreSQL distribution",
    );
    const started = this.runtimeAttestationValue.postgresDistribution;
    if (
      normalizedForTargetComparison(started.rootPath) !==
        normalizedForTargetComparison(currentDistribution.rootPath) ||
      started.startSha256 !== currentDistribution.sha256 ||
      started.fileCount !== currentDistribution.fileCount ||
      started.totalBytes !== currentDistribution.totalBytes
    ) {
      throw new Error(
        "Portable PostgreSQL distribution changed between runtime start and end attestation",
      );
    }
    return structuredClone({
      ...this.runtimeAttestationValue,
      postgresDistribution: {
        ...started,
        endSha256: currentDistribution.sha256,
      },
    });
  }

  async readDurableEnduranceEvents(
    since: Date,
  ): Promise<DurableEnduranceEvent[]> {
    this.assertRunning();
    const result = await this.runPsql(durableEnduranceEventsSql(since));
    return parseDurableEnduranceEvents(result.stdout);
  }

  async makeContinuousTasksDue(
    projectId: number,
    taskIds: readonly number[],
  ): Promise<number[]> {
    this.assertRunning();
    const result = await this.runPsql(
      makeContinuousTasksDueSql(projectId, taskIds),
    );
    return parsePositiveIdRows(result.stdout, "made-due task ids");
  }

  async stop(): Promise<void> {
    if (!this.touched) return;
    const failures: unknown[] = [];
    let processesStopped = false;
    try {
      await this.supervisor.stopAll();
      processesStopped = true;
    } catch (error) {
      failures.push(error);
    }
    for (const name of this.processSpecs.keys()) {
      try {
        await this.persistProcessLogs(name);
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await this.stopDatabase();
    } catch (error) {
      failures.push(error);
    }
    if (processesStopped && !this.databaseRunning) {
      try {
        await this.removeOwnedStateDirectory();
      } catch (error) {
        failures.push(error);
      }
    }
    if (processesStopped && !this.databaseRunning) this.running = false;
    if (!this.databaseRunning) {
      this.databaseUrl = null;
      this.databasePassword = null;
    }
    if (failures.length === 0 && this.stateDirectory === null) {
      this.touched = false;
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Native endurance cleanup failed");
    }
  }

  state(): { running: boolean; projectName: string; runId: string } {
    return {
      running: this.running,
      projectName: this.projectName,
      runId: this.runId,
    };
  }

  diagnostics(): {
    runDirectory: string;
    logDirectory: string;
    apiPort: number;
    databasePort: number;
    processes: ManagedProcessSnapshot[];
  } {
    return {
      runDirectory: this.runDirectory,
      logDirectory: path.join(this.runDirectory, "logs"),
      apiPort: this.apiPort,
      databasePort: this.databasePort,
      processes: this.supervisor.snapshots(),
    };
  }
}
