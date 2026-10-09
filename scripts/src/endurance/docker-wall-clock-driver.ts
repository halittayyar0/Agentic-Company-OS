import os from "node:os";
import path from "node:path";
import {
  createEnduranceSpendConfiguration,
  type EnduranceSpendConfiguration,
} from "./spend-configuration";

import {
  createPlaywrightOperationsSession,
  disposeBrowserMonitorSession,
  type BrowserMonitorSession,
} from "./browser-monitor";
import {
  createEnduranceFaultControlWriter,
  type EnduranceFaultControlEntry,
  type EnduranceFaultOutcome,
} from "./fault-control-writer";
import {
  createSeededFaultSchedule,
  type InjectedFaultKind,
  type FaultScheduleProfile,
  type ScheduledInjectedFault,
} from "./fault-injector";
import {
  PostgresEnduranceHarness,
  type DurableEnduranceEvent,
} from "./postgres-harness";
import { waitForRuntimeTopology } from "./runtime-probe";
import type {
  EnduranceFaultEvidenceSourceKind,
  EnduranceRuntimeAttestation,
  EnduranceRuntimeRecoveryEvidence,
} from "./report-schema";
import type { SoakEvidenceObserver } from "./soak-observer";
import {
  normalizeResponsibilityGapSnapshot,
  type ResponsibilityGapSnapshot,
} from "./responsibility-diagnostics";
import type {
  IncompleteResponsibilityDiagnostic,
  WallClockCaptureContext,
  WallClockRuntimeDriver,
} from "./run-wall-clock-soak";

const SAFE_ATTEMPT_STATES = new Set([
  "claimed",
  "running",
  "succeeded",
  "retrying",
  "blocked",
  "lost",
]);

export interface DockerWallClockHarness {
  start(): Promise<void>;
  stop(): Promise<void>;
  killWorker(worker: "worker-1" | "worker-2"): Promise<void>;
  restartWorker(worker: "worker-1" | "worker-2"): Promise<void>;
  pauseDatabase(): Promise<void>;
  resumeDatabase(): Promise<void>;
  listRunningServices(): Promise<string[]>;
  postgresVersion(): Promise<string>;
  runtimeAttestation(): Promise<EnduranceRuntimeAttestation>;
  readDurableEnduranceEvents?(since: Date): Promise<DurableEnduranceEvent[]>;
  makeContinuousTasksDue?(
    projectId: number,
    taskIds: readonly number[],
  ): Promise<readonly number[]>;
  state(): { running: boolean; projectName: string; runId: string };
}

export interface DockerWallClockDriverOptions {
  runId: string;
  seed: number;
  durationHours: number;
  faultProfile?: FaultScheduleProfile;
  commandedFaultHealthWindowsOnly?: boolean;
  workspaceRoot: string;
  controlDirectory: string;
  baseUrl: string;
  operatorToken: string;
  harness?: DockerWallClockHarness;
  fetchImpl?: typeof fetch;
  topologyTimeoutMs?: number;
  requestTimeoutMs?: number;
  faultEvidenceTimeoutMs?: number;
  browserSessionFactory?: (input: {
    baseUrl: string;
    projectId: number;
    operatorToken: string;
    signal?: AbortSignal;
    cleanupTimeoutMs?: number;
    isExpectedDatabaseOutage?: () => boolean;
  }) => Promise<BrowserMonitorSession>;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => Date;
  environment?: NodeJS.ProcessEnv;
}

interface OperationsAttemptEvidence {
  id: string;
  taskId: number;
  agentId: number;
  attemptNumber: number;
  cycleNumber: number;
  state: string;
  finishedAt: string | null;
}

interface OperationsInvocationEvidence {
  id: string;
  attemptId: string | null;
  state: string;
  effectStartedAt: string | null;
  finishedAt: string | null;
}

interface OperationsReceiptEvidence {
  id: string;
  operationKey: string;
  originAttemptId: string | null;
  state: string;
  toolName: string;
  sideEffectClass: string;
  reservedAt: string;
  finishedAt: string | null;
  invocations: OperationsInvocationEvidence[];
}

interface OperationsIncidentEvidence {
  id: string;
  kind: string;
  occurredAt: string;
}

interface OperationsHealthEvidence {
  bucketAt: string;
  sampledAt: string | null;
  runtimeTruthState: string | null;
  healthyWorkerCount: number;
  staleWorkerCount: number;
  schedulerTickAgeMs: number | null;
}

interface ProjectOperationsEvidence {
  generatedAt: string;
  cursor: string;
  runtime: {
    state: string;
    databaseBackend: string;
    durable: boolean;
    healthyWorkerCount: number;
    staleWorkerCount: number;
    schedulerTickAgeMs: number | null;
  };
  members: Array<{ agentId: number }>;
  attempts: OperationsAttemptEvidence[];
  receipts: OperationsReceiptEvidence[];
  incidents: OperationsIncidentEvidence[];
  milestones: OperationsIncidentEvidence[];
  fleetHealthSamples: OperationsHealthEvidence[];
  truncation: { attempts: boolean; receipts: boolean };
}

interface EmergencyControlEvidence {
  version: number;
  updatedAt: string;
}

interface DurableFaultEvidence {
  id: string;
  kind: string;
  occurredAt: string;
  taskId: number | null;
}

interface FaultRecoveryEvidence {
  recoveredAt: string;
  sourceKind: EnduranceFaultEvidenceSourceKind;
  sourceId: string;
  runtimeEvidence?: EnduranceRuntimeRecoveryEvidence;
}

const EXPECTED_SERVICES = new Set(["app", "db", "worker-1", "worker-2"]);
const IRREVERSIBLE_SIDE_EFFECTS = new Set([
  "at_most_once",
  "approval_at_most_once",
]);
const MAX_RESPONSIBILITY_CYCLE_LAG = 2;
const HEALTH_RECOVERY_GRACE_MS = 5_000;
const DATABASE_HEALTH_RECOVERY_GRACE_MS = 120_000;
const HEALTH_DISRUPTIVE_FAULTS = new Set<InjectedFaultKind>([
  "worker_loss",
  "database_unavailable",
  "emergency_stop",
]);

export function isScheduledDisruptiveHealthWindow(
  schedule: readonly ScheduledInjectedFault[],
  elapsedMs: number,
): boolean {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return false;
  return schedule.some(
    (fault) =>
      HEALTH_DISRUPTIVE_FAULTS.has(fault.kind) &&
      elapsedMs >= fault.atMs &&
      elapsedMs <=
        fault.atMs +
          fault.durationMs +
          // After a database outage the minute sampler persists conservative
          // missing buckets on its next tick. Admit that bounded recovery here;
          // the independent verifier still requires actual durable recovery and
          // rejects degraded samples after that recovery's five-second window.
          (fault.kind === "database_unavailable"
            ? DATABASE_HEALTH_RECOVERY_GRACE_MS
            : HEALTH_RECOVERY_GRACE_MS),
  );
}

const INCIDENT_KINDS: Readonly<
  Record<Exclude<InjectedFaultKind, "sse_disconnect">, ReadonlySet<string>>
> = {
  provider_timeout: new Set(["attempt_state_changed"]),
  provider_rate_limit: new Set(["attempt_state_changed"]),
  provider_malformed_output: new Set(["attempt_state_changed"]),
  worker_loss: new Set(["attempt_state_changed", "runtime_state_changed"]),
  database_unavailable: new Set(["runtime_state_changed"]),
  emergency_stop: new Set(["runtime_control_changed"]),
};

const PROVIDER_RECOVERY_KINDS = new Set([
  "attempt_state_changed",
  "receipt_state_changed",
  "invocation_state_changed",
]);

const PROVIDER_FAILURE_KINDS: Readonly<
  Record<
    "provider_timeout" | "provider_rate_limit" | "provider_malformed_output",
    string
  >
> = {
  provider_timeout: "timeout",
  provider_rate_limit: "rate_limit",
  provider_malformed_output: "tool_compatibility",
};

export function createDockerWallClockEnvironment(input: {
  runId: string;
  seed: number;
  workspaceRoot: string;
  controlDirectory: string;
  secretDirectory?: string;
  environment?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const controlDirectory = path.resolve(input.controlDirectory);
  const secretDirectory = input.secretDirectory
    ? path.resolve(input.secretDirectory)
    : null;
  const secretPath = (environmentName: string, fileName: string): string => {
    if (secretDirectory) return path.join(secretDirectory, fileName);
    const configured = input.environment?.[environmentName]?.trim();
    return configured
      ? path.resolve(configured)
      : path.join(workspaceRoot, ".secrets", fileName);
  };
  return {
    ...input.environment,
    ...createEnduranceSpendConfiguration(input.environment ?? process.env)
      .environment,
    // Generated bind files belong to this process, not necessarily image UID 1000.
    AGENTIC_SECRET_GID: String(process.getgid?.() ?? 1000),
    ENDURANCE_RUN_ID: input.runId,
    ENDURANCE_SEED: String(input.seed),
    ENDURANCE_EXPECTED_AGENTS: "10",
    ENDURANCE_CONTROL_DIR_HOST: controlDirectory,
    ENDURANCE_DATABASE_URL_SECRET_FILE: secretPath(
      "ENDURANCE_DATABASE_URL_SECRET_FILE",
      "database_url",
    ),
    ENDURANCE_OPERATOR_TOKEN_SECRET_FILE: secretPath(
      "ENDURANCE_OPERATOR_TOKEN_SECRET_FILE",
      "operator_auth_token",
    ),
    ENDURANCE_RUNTIME_CONTROL_KEY_SECRET_FILE: secretPath(
      "ENDURANCE_RUNTIME_CONTROL_KEY_SECRET_FILE",
      "runtime_control_key",
    ),
    ENDURANCE_POSTGRES_PASSWORD_SECRET_FILE: secretPath(
      "ENDURANCE_POSTGRES_PASSWORD_SECRET_FILE",
      "postgres_password",
    ),
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : stringValue(value, label);
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new TypeError(`${label} must be an integer of at least ${minimum}`);
  }
  return Number(value);
}

function iso(value: unknown, label: string): string {
  const text = stringValue(value, label);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) {
    throw new TypeError(`${label} must be a canonical ISO timestamp`);
  }
  return text;
}

function cursor(value: unknown): string {
  const text = stringValue(value, "operations cursor");
  if (!/^(?:0|[1-9][0-9]*)$/u.test(text)) {
    throw new TypeError("operations cursor must be a canonical decimal");
  }
  return text;
}

function loopbackBaseUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)
  ) {
    throw new TypeError(
      "Docker wall-clock driver requires a loopback HTTP API",
    );
  }
  if (url.username || url.password) {
    throw new TypeError(
      "Docker wall-clock driver URL cannot contain credentials",
    );
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return Promise.reject(
      new TypeError("sleep milliseconds must be non-negative"),
    );
  }
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason);
    };
    // Polling is outstanding work. Unref would let the CLI exit successfully
    // between requests before it writes its mandatory evidence report.
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseAttempt(
  value: unknown,
  index: number,
): OperationsAttemptEvidence {
  const item = record(value, `operations attempt ${index}`);
  return {
    id: stringValue(item.id, `operations attempt ${index} id`),
    taskId: integer(item.taskId, `operations attempt ${index} taskId`, 1),
    agentId: integer(item.agentId, `operations attempt ${index} agentId`, 1),
    attemptNumber: integer(
      item.attemptNumber,
      `operations attempt ${index} attemptNumber`,
      1,
    ),
    cycleNumber: integer(
      item.cycleNumber,
      `operations attempt ${index} cycleNumber`,
    ),
    state: stringValue(item.state, `operations attempt ${index} state`),
    finishedAt: nullableString(
      item.finishedAt,
      `operations attempt ${index} finishedAt`,
    ),
  };
}

function parseReceipt(
  value: unknown,
  index: number,
): OperationsReceiptEvidence {
  const item = record(value, `operations receipt ${index}`);
  if (!Array.isArray(item.invocations)) {
    throw new TypeError(
      `operations receipt ${index} invocations must be an array`,
    );
  }
  return {
    id: stringValue(item.id, `operations receipt ${index} id`),
    operationKey: (() => {
      const key = stringValue(
        item.operationKey,
        `operations receipt ${index} normalized operation key`,
      );
      if (!/^op:v1:[0-9a-f]{64}$/u.test(key)) {
        throw new TypeError(
          `operations receipt ${index} must contain a normalized operation key`,
        );
      }
      return key;
    })(),
    originAttemptId: nullableString(
      item.originAttemptId,
      `operations receipt ${index} originAttemptId`,
    ),
    state: stringValue(item.state, `operations receipt ${index} state`),
    toolName: stringValue(
      item.toolName,
      `operations receipt ${index} toolName`,
    ),
    sideEffectClass: stringValue(
      item.sideEffectClass,
      `operations receipt ${index} sideEffectClass`,
    ),
    reservedAt: iso(item.reservedAt, `operations receipt ${index} reservedAt`),
    finishedAt: nullableString(
      item.finishedAt,
      `operations receipt ${index} finishedAt`,
    ),
    invocations: item.invocations.map((invocation, invocationIndex) => {
      const parsed = record(
        invocation,
        `operations receipt ${index} invocation ${invocationIndex}`,
      );
      return {
        id: stringValue(
          parsed.id,
          `operations receipt ${index} invocation ${invocationIndex} id`,
        ),
        attemptId: nullableString(
          parsed.attemptId,
          `operations receipt ${index} invocation ${invocationIndex} attemptId`,
        ),
        state: stringValue(
          parsed.state,
          `operations receipt ${index} invocation ${invocationIndex} state`,
        ),
        effectStartedAt:
          parsed.effectStartedAt === null
            ? null
            : iso(
                parsed.effectStartedAt,
                `operations receipt ${index} invocation ${invocationIndex} effectStartedAt`,
              ),
        finishedAt: nullableString(
          parsed.finishedAt,
          `operations receipt ${index} invocation ${invocationIndex} finishedAt`,
        ),
      };
    }),
  };
}

function assertIrreversibleReceiptInvocationEvidence(
  receipt: OperationsReceiptEvidence,
): void {
  if (
    receipt.state !== "succeeded" ||
    !IRREVERSIBLE_SIDE_EFFECTS.has(receipt.sideEffectClass)
  ) {
    return;
  }
  const succeeded = receipt.invocations.filter(
    (invocation) => invocation.state === "succeeded",
  );
  if (succeeded.length !== 1) {
    throw new Error(
      `Irreversible receipt ${receipt.id} must have exactly one succeeded invocation`,
    );
  }
  const winner = succeeded[0]!;
  if (!winner.effectStartedAt || !winner.finishedAt) {
    throw new Error(
      `Irreversible receipt ${receipt.id} succeeded without a complete effect boundary`,
    );
  }
  for (const invocation of receipt.invocations) {
    if (invocation.id === winner.id) continue;
    if (
      invocation.state !== "failed" ||
      invocation.effectStartedAt !== null ||
      invocation.finishedAt === null
    ) {
      throw new Error(
        `Irreversible receipt ${receipt.id} contains a non-terminal or effect-crossing replay invocation`,
      );
    }
  }
}

function parseProjectOperations(value: unknown): ProjectOperationsEvidence {
  const body = record(value, "project operations response");
  const runtime = record(body.runtime, "project operations runtime");
  const truncation = record(body.truncation, "project operations truncation");
  for (const field of [
    "members",
    "attempts",
    "receipts",
    "incidents",
    "milestones",
    "fleetHealthSamples",
  ] as const) {
    if (!Array.isArray(body[field])) {
      throw new TypeError(`project operations ${field} must be an array`);
    }
  }
  return {
    generatedAt: iso(body.generatedAt, "project operations generatedAt"),
    cursor: cursor(body.cursor),
    runtime: {
      state: stringValue(runtime.state, "project operations runtime state"),
      databaseBackend: stringValue(
        runtime.databaseBackend,
        "project operations database backend",
      ),
      durable: runtime.durable === true,
      healthyWorkerCount: integer(
        runtime.healthyWorkerCount,
        "runtime healthy worker count",
      ),
      staleWorkerCount: integer(
        runtime.staleWorkerCount,
        "runtime stale worker count",
      ),
      schedulerTickAgeMs:
        runtime.schedulerTickAgeMs === null
          ? null
          : integer(runtime.schedulerTickAgeMs, "runtime scheduler tick age"),
    },
    members: (body.members as unknown[]).map((member, index) => ({
      agentId: integer(
        record(member, `operations member ${index}`).agentId,
        `operations member ${index} agentId`,
        1,
      ),
    })),
    attempts: (body.attempts as unknown[]).map(parseAttempt),
    receipts: (body.receipts as unknown[]).map(parseReceipt),
    incidents: (body.incidents as unknown[]).map((incident, index) => {
      const item = record(incident, `operations incident ${index}`);
      return {
        id: stringValue(item.id, `operations incident ${index} id`),
        kind: stringValue(item.kind, `operations incident ${index} kind`),
        occurredAt: iso(
          item.occurredAt,
          `operations incident ${index} occurredAt`,
        ),
      };
    }),
    milestones: (body.milestones as unknown[]).map((milestone, index) => {
      const item = record(milestone, `operations milestone ${index}`);
      return {
        id: stringValue(item.id, `operations milestone ${index} id`),
        kind: stringValue(item.kind, `operations milestone ${index} kind`),
        occurredAt: iso(
          item.occurredAt,
          `operations milestone ${index} occurredAt`,
        ),
      };
    }),
    fleetHealthSamples: (body.fleetHealthSamples as unknown[]).map(
      (sample, index) => {
        const item = record(sample, `operations health sample ${index}`);
        return {
          bucketAt: iso(
            item.bucketAt,
            `operations health sample ${index} bucketAt`,
          ),
          sampledAt:
            item.sampledAt === null
              ? null
              : iso(
                  item.sampledAt,
                  `operations health sample ${index} sampledAt`,
                ),
          runtimeTruthState:
            item.runtimeTruthState === null
              ? null
              : stringValue(
                  item.runtimeTruthState,
                  `operations health sample ${index} runtimeTruthState`,
                ),
          healthyWorkerCount: integer(
            item.healthyWorkerCount,
            `operations health sample ${index} healthyWorkerCount`,
          ),
          staleWorkerCount: integer(
            item.staleWorkerCount,
            `operations health sample ${index} staleWorkerCount`,
          ),
          schedulerTickAgeMs:
            item.schedulerTickAgeMs === null
              ? null
              : integer(
                  item.schedulerTickAgeMs,
                  `operations health sample ${index} schedulerTickAgeMs`,
                ),
        };
      },
    ),
    truncation: {
      attempts: truncation.attempts === true,
      receipts: truncation.receipts === true,
    },
  };
}

function providerOutcome(kind: InjectedFaultKind): EnduranceFaultOutcome {
  switch (kind) {
    case "provider_timeout":
      return "timeout";
    case "provider_rate_limit":
      return "rate_limit";
    case "provider_malformed_output":
      return "malformed";
    default:
      throw new TypeError(`Unsupported provider fault: ${kind}`);
  }
}

function isProviderFault(
  kind: InjectedFaultKind,
): kind is
  "provider_timeout" | "provider_rate_limit" | "provider_malformed_output" {
  return (
    kind === "provider_timeout" ||
    kind === "provider_rate_limit" ||
    kind === "provider_malformed_output"
  );
}

export function hasHealthyRuntimeTruth(
  sample: Pick<
    OperationsHealthEvidence,
    "runtimeTruthState" | "healthyWorkerCount" | "staleWorkerCount"
  >,
): boolean {
  // Operations runtime truth already incorporates scheduler-tick freshness.
  // Stale rows remain useful replacement telemetry, but do not veto a fresh
  // fleet with the two required healthy scheduler workers.
  return sample.runtimeTruthState === "live" && sample.healthyWorkerCount === 2;
}

import { DatabaseReadGate } from "./database-read-gate";

export class DockerWallClockDriver implements WallClockRuntimeDriver {
  private readonly databaseReadGate = new DatabaseReadGate();
  private databasePaused = false;
  private databaseFailureDrainUntil = 0;
  private readonly runId: string;
  private readonly seed: number;
  private readonly durationHours: number;
  private readonly faultProfile: FaultScheduleProfile;
  private readonly baseUrl: URL;
  private readonly operatorToken: string;
  private readonly harness: DockerWallClockHarness;
  private readonly spend: EnduranceSpendConfiguration;
  private readonly fetchImpl: typeof fetch;
  private readonly topologyTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly faultEvidenceTimeoutMs: number;
  private readonly browserSessionFactory: NonNullable<
    DockerWallClockDriverOptions["browserSessionFactory"]
  >;
  private readonly sleepImpl: NonNullable<
    DockerWallClockDriverOptions["sleep"]
  >;
  private readonly nowImpl: () => Date;
  private readonly faultWriter: ReturnType<
    typeof createEnduranceFaultControlWriter
  >;
  private readonly requiredHealthBuckets: number;
  private readonly faultSchedule: readonly ScheduledInjectedFault[];
  private readonly commandedFaultHealthWindowsOnly: boolean;
  private readonly commandedFaultHealthWindows: Array<{
    kind: "worker_loss" | "database_unavailable";
    target: string;
    startedAtMs: number;
    recoveredAtMs: number | null;
  }> = [];
  private readonly memberAgentIds = new Set<number>();
  private readonly attemptsById = new Map<string, OperationsAttemptEvidence>();
  private readonly taskByAgentId = new Map<number, number>();
  private readonly completedResponsibilityCyclesByAgent = new Map<
    number,
    number
  >();
  private readonly responsibilityCoverage = new Set<string>();
  private readonly persistedHealthBuckets = new Set<string>();
  private readonly seenStaleCommits = new Set<string>();
  private readonly assignedIncidentIds = new Set<string>();
  private readonly providerTargetsByFaultId = new Map<
    string,
    ReadonlyMap<number, number>
  >();
  private projectId: number | null = null;
  private harnessStarted = false;
  private runStarted = false;
  private activeProviderFaultId: string | null = null;
  private activeBrowserSession: BrowserMonitorSession | null = null;
  private browserVersion = "Chromium (not started)";
  private postgres = "PostgreSQL (not probed)";
  private lastEvidenceAt: string | null = null;
  private runStartedAt: string | null = null;
  private sseDisconnectedCursor: string | null = null;
  private sseReconnectedCursor: string | null = null;
  private emergencyStopActive = false;
  private emergencyStopIncident: EmergencyControlEvidence | null = null;
  private emergencyStopRecovery: EmergencyControlEvidence | null = null;

  constructor(options: DockerWallClockDriverOptions) {
    this.spend = createEnduranceSpendConfiguration(
      options.environment ?? process.env,
    );
    this.runId = options.runId;
    this.seed = options.seed;
    this.durationHours = options.durationHours;
    this.faultProfile = options.faultProfile ?? "standard";
    this.baseUrl = loopbackBaseUrl(options.baseUrl);
    if (!options.operatorToken.trim()) {
      throw new TypeError("operatorToken is required");
    }
    if (
      !Number.isFinite(options.durationHours) ||
      options.durationHours < 1 / 60
    ) {
      throw new TypeError("durationHours must be at least one minute");
    }
    this.operatorToken = options.operatorToken;
    this.requiredHealthBuckets = Math.max(
      1,
      Math.floor(options.durationHours * 60),
    );
    this.faultSchedule = createSeededFaultSchedule({
      seed: options.seed,
      durationMs: Math.round(options.durationHours * 60 * 60 * 1_000),
      profile: this.faultProfile,
    });
    this.commandedFaultHealthWindowsOnly =
      options.commandedFaultHealthWindowsOnly ?? false;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.topologyTimeoutMs = options.topologyTimeoutMs ?? 180_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.faultEvidenceTimeoutMs = options.faultEvidenceTimeoutMs ?? 120_000;
    if (
      !Number.isFinite(this.faultEvidenceTimeoutMs) ||
      this.faultEvidenceTimeoutMs < 1_000
    ) {
      throw new TypeError("faultEvidenceTimeoutMs must be at least one second");
    }
    this.browserSessionFactory =
      options.browserSessionFactory ?? createPlaywrightOperationsSession;
    this.sleepImpl = options.sleep ?? abortableDelay;
    this.nowImpl = options.now ?? (() => new Date());
    const controlDirectory = path.resolve(options.controlDirectory);
    this.faultWriter = createEnduranceFaultControlWriter({
      runId: options.runId,
      seed: options.seed,
      runDirectory: controlDirectory,
      controlFile: path.join(controlDirectory, "fault-control.json"),
      fileMode: 0o640,
    });
    this.harness =
      options.harness ??
      new PostgresEnduranceHarness({
        runId: options.runId,
        workspaceRoot: options.workspaceRoot,
        environment: createDockerWallClockEnvironment({
          runId: options.runId,
          seed: options.seed,
          workspaceRoot: options.workspaceRoot,
          controlDirectory,
          environment: { ...options.environment, ...this.spend.environment },
        }),
      });
  }

  private async requestJson(
    pathname: string,
    init: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timer.unref?.();
    try {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${this.operatorToken}`);
      if (init.body !== undefined)
        headers.set("content-type", "application/json");
      const response = await this.fetchImpl(new URL(pathname, this.baseUrl), {
        ...init,
        headers,
        signal: init.signal
          ? AbortSignal.any([controller.signal, init.signal])
          : controller.signal,
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error(`${pathname} returned invalid JSON`);
      }
      if (!response.ok) {
        throw new Error(`${pathname} returned HTTP ${response.status}`);
      }
      return record(body, `${pathname} response`);
    } finally {
      clearTimeout(timer);
    }
  }

  private requireProjectId(): number {
    if (this.projectId === null) {
      throw new Error("Endurance project has not been created");
    }
    return this.projectId;
  }

  private emergencyControlEvidence(
    value: Record<string, unknown>,
    enabled: boolean,
  ): EmergencyControlEvidence {
    if (value.emergencyStopEnabled !== enabled) {
      throw new Error(
        `Persisted emergency-stop state did not become ${enabled ? "enabled" : "disabled"}`,
      );
    }
    return {
      version: integer(value.version, "emergency-stop version", 1),
      updatedAt: iso(value.updatedAt, "emergency-stop updatedAt"),
    };
  }

  private async verifyEmergencyControlState(
    transition: Record<string, unknown>,
    enabled: boolean,
  ): Promise<EmergencyControlEvidence> {
    const written = this.emergencyControlEvidence(transition, enabled);
    const reread = this.emergencyControlEvidence(
      await this.requestJson("/api/ops/control"),
      enabled,
    );
    if (
      reread.version !== written.version ||
      reread.updatedAt !== written.updatedAt
    ) {
      throw new Error(
        "Emergency-stop durable reread did not match its transition",
      );
    }
    return reread;
  }

  private async readProjectOperations(
    signal?: AbortSignal,
  ): Promise<ProjectOperationsEvidence> {
    const windowHours = Math.min(
      168,
      Math.max(1, Math.ceil(this.durationHours) + 1),
    );
    return this.databaseReadGate.read(async () => {
      signal?.throwIfAborted();
      return parseProjectOperations(
        await this.requestJson(
          `/api/tasks/${this.requireProjectId()}/operations?windowHours=${windowHours}`,
          { signal },
        ),
      );
    });
  }

  async inspectResponsibilityGaps(
    signal?: AbortSignal,
  ): Promise<ResponsibilityGapSnapshot> {
    if (!this.runStarted || this.memberAgentIds.size !== 10)
      throw new Error(
        "Endurance responsibilities are not ready for inspection",
      );
    const snapshot = await this.readProjectOperations(signal);
    // Current reads supplement cached observations without advancing accepted
    // horizon coverage. A later success cannot repair the finalized report.
    const attempts = new Map(this.attemptsById);
    for (const attempt of snapshot.attempts) attempts.set(attempt.id, attempt);
    const gaps = [];
    for (const agentId of [...this.memberAgentIds].sort((a, b) => a - b)) {
      const ownedAttempts = [...attempts.values()].filter(
        (attempt) => attempt.agentId === agentId,
      );
      const taskIds = new Set(ownedAttempts.map((attempt) => attempt.taskId));
      const taskId =
        this.taskByAgentId.get(agentId) ??
        (taskIds.size === 1 ? [...taskIds][0] : null);
      let firstMissing: number | null = null,
        completed = 0;
      for (let cycle = 0; cycle < this.requiredHealthBuckets; cycle++) {
        if (
          taskId !== null &&
          this.responsibilityCoverage.has(`${taskId}:${agentId}:${cycle}`)
        )
          completed++;
        else firstMissing ??= cycle;
      }
      if (firstMissing === null) continue;
      const cycleAttempts = ownedAttempts
        .filter(
          (attempt) =>
            attempt.taskId === taskId && attempt.cycleNumber === firstMissing,
        )
        .sort((a, b) => b.attemptNumber - a.attemptNumber);
      const latest = cycleAttempts[0];
      const ids = new Set(cycleAttempts.map((attempt) => attempt.id));
      const receipts = snapshot.receipts.filter(
        (receipt) =>
          receipt.originAttemptId !== null && ids.has(receipt.originAttemptId),
      );
      gaps.push({
        agentId,
        cycleNumber: firstMissing,
        observedCompletedCycles: completed,
        taskId,
        attemptState:
          latest?.state ??
          (snapshot.truncation.attempts || taskId === null
            ? "unknown"
            : "not_started"),
        attemptNumber: latest?.attemptNumber ?? null,
        receiptStates: [...new Set(receipts.map((receipt) => receipt.state))],
        invocationStates: [
          ...new Set(
            receipts.flatMap((receipt) =>
              receipt.invocations.map((invocation) => invocation.state),
            ),
          ),
        ],
      });
    }
    const details = await Promise.all(
      gaps.map(async (gap) => {
        let task: Record<string, unknown> | null = null;
        if (gap.taskId !== null) {
          try {
            signal?.throwIfAborted();
            const current = await this.requestJson(`/api/tasks/${gap.taskId}`, {
              signal,
            });
            if (
              current.id === gap.taskId &&
              current.ownerAgentId === gap.agentId
            )
              task = {
                status: current.status,
                cycleCount: current.cycleCount,
                nextAttemptAt: current.nextAttemptAt,
                blockedReason: current.blockedReason,
              };
          } catch {
            // An unavailable task is unknown; never copy server error text.
          }
        }
        return { ...gap, task };
      }),
    );
    signal?.throwIfAborted();
    return normalizeResponsibilityGapSnapshot(
      {
        sampledAt: this.now().toISOString(),
        expectedCycles: this.requiredHealthBuckets,
        attemptsTruncated: snapshot.truncation.attempts,
        receiptsTruncated: snapshot.truncation.receipts,
        gaps: details,
      },
      this.requiredHealthBuckets,
    );
  }

  async inspectIncompleteResponsibilities(): Promise<
    IncompleteResponsibilityDiagnostic[]
  > {
    if (!this.runStarted || this.memberAgentIds.size !== 10) {
      throw new Error(
        "Endurance responsibilities are not ready for inspection",
      );
    }
    const snapshot = await this.readProjectOperations();
    if (snapshot.truncation.attempts) {
      throw new Error("Endurance attempt evidence was truncated");
    }
    return [...this.memberAgentIds]
      .sort((left, right) => left - right)
      .filter(
        (agentId) =>
          (this.completedResponsibilityCyclesByAgent.get(agentId) ?? 0) < 1,
      )
      .map((agentId) => {
        const latest = snapshot.attempts
          .filter(
            (attempt) =>
              attempt.agentId === agentId && attempt.cycleNumber === 0,
          )
          .sort((left, right) => right.attemptNumber - left.attemptNumber)[0];
        return {
          agentId,
          attemptState: latest
            ? SAFE_ATTEMPT_STATES.has(latest.state)
              ? (latest.state as IncompleteResponsibilityDiagnostic["attemptState"])
              : "unknown"
            : "not_started",
          attemptNumber: latest?.attemptNumber ?? null,
        };
      });
  }

  async start(): Promise<{
    projectId: number;
    expectedResponsibilities: number;
  }> {
    if (this.runStarted || this.harnessStarted) {
      throw new Error("Docker wall-clock driver is already started");
    }
    await this.faultWriter.clear();
    // The harness may cross its external process boundary before start()
    // rejects. Claim cleanup authority first so any partial start remains
    // retryable through this driver.
    this.harnessStarted = true;
    try {
      await this.harness.start();
      await waitForRuntimeTopology(
        {
          baseUrl: this.baseUrl.href,
          operatorToken: this.operatorToken,
          fetchImpl: this.fetchImpl,
          requestTimeoutMs: this.requestTimeoutMs,
        },
        { timeoutMs: this.topologyTimeoutMs, intervalMs: 250 },
      );
      this.postgres = await this.harness.postgresVersion();
      const created = await this.requestJson("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: `Wall-clock endurance ${this.runId}`,
          brief:
            "Run deterministic, receipt-backed responsibilities continuously for endurance verification.",
          autonomyMode: "continuous",
          cadenceSeconds: 60,
          priority: "normal",
        }),
      });
      this.projectId = integer(created.id, "created endurance project id", 1);
      const snapshot = await this.readProjectOperations();
      const memberAgentIds = new Set(
        snapshot.members.map((member) => member.agentId),
      );
      if (snapshot.members.length !== 10 || memberAgentIds.size !== 10) {
        throw new Error(
          `Endurance project requires exactly 10 unique active members, found ${memberAgentIds.size}`,
        );
      }
      for (const agentId of memberAgentIds) this.memberAgentIds.add(agentId);
      // The coordinator starts its deterministic schedule immediately after
      // this method returns, so anchor health-window correlation at the latest
      // possible durable initialization boundary.
      this.runStartedAt = this.nowImpl().toISOString();
      this.runStarted = true;
      return {
        projectId: this.projectId,
        expectedResponsibilities:
          this.requiredHealthBuckets * this.memberAgentIds.size,
      };
    } catch (error) {
      try {
        await this.harness.stop();
        this.harnessStarted = false;
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Docker wall-clock startup and cleanup failed",
        );
      }
      throw error;
    }
  }

  private assertReceiptContinuity(snapshot: ProjectOperationsEvidence): void {
    if (!snapshot.truncation.receipts) return;
    if (!this.lastEvidenceAt) {
      throw new Error(
        "Operations receipt evidence was truncated before the first capture",
      );
    }
    const oldest = snapshot.receipts.reduce<string | null>(
      (current, receipt) => {
        if (!current || receipt.reservedAt < current) return receipt.reservedAt;
        return current;
      },
      null,
    );
    if (!oldest || oldest > this.lastEvidenceAt) {
      throw new Error(
        "Operations receipt evidence advanced beyond the bounded read-model window",
      );
    }
  }

  private async ingestMinuteEvidence(
    observer: SoakEvidenceObserver,
    snapshot: ProjectOperationsEvidence,
    minute: number,
  ): Promise<void> {
    this.assertReceiptContinuity(snapshot);
    if (!this.runStartedAt || this.memberAgentIds.size !== 10) {
      throw new Error("Endurance coverage roster is not initialized");
    }
    for (const attempt of snapshot.attempts) {
      const prior = this.attemptsById.get(attempt.id);
      if (
        prior &&
        (prior.taskId !== attempt.taskId ||
          prior.agentId !== attempt.agentId ||
          prior.cycleNumber !== attempt.cycleNumber)
      ) {
        throw new Error(
          `Operations attempt ${attempt.id} changed its durable task/agent/cycle identity`,
        );
      }
      this.attemptsById.set(attempt.id, attempt);
    }
    // The API returns newest-first. Several completed cycles can arrive in one
    // snapshot after a provider/database fault. Emit their durable chronology
    // so the primary verifier can still reject a genuinely missing predecessor.
    for (const receipt of [...snapshot.receipts].sort(
      (left, right) =>
        (left.finishedAt ?? left.reservedAt).localeCompare(
          right.finishedAt ?? right.reservedAt,
        ) || left.id.localeCompare(right.id),
    )) {
      // Parallel API reads may expose a just-created receipt before its owner
      // enters the attempt query. Defer only rows newer than this snapshot;
      // a historical missing/mismatched owner must still fail below.
      if (
        receipt.state === "succeeded" &&
        receipt.finishedAt &&
        new Date(receipt.finishedAt).getTime() >
          new Date(snapshot.generatedAt).getTime()
      )
        continue;
      assertIrreversibleReceiptInvocationEvidence(receipt);
      const receiptAttempt = receipt.originAttemptId
        ? this.attemptsById.get(receipt.originAttemptId)
        : undefined;
      const winningInvocation = receipt.invocations.find(
        (invocation) => invocation.state === "succeeded",
      );
      const winningAttempt = winningInvocation?.attemptId
        ? this.attemptsById.get(winningInvocation.attemptId)
        : undefined;
      if (
        receipt.state === "succeeded" &&
        receipt.originAttemptId &&
        (!winningInvocation?.attemptId ||
          !winningAttempt ||
          !receiptAttempt ||
          winningAttempt.taskId !== receiptAttempt.taskId ||
          winningAttempt.agentId !== receiptAttempt.agentId ||
          winningAttempt.cycleNumber !== receiptAttempt.cycleNumber)
      ) {
        throw new Error(
          `Succeeded receipt ${receipt.id} has no matching physical invocation owner`,
        );
      }
      const winnerFinalized =
        !receipt.originAttemptId ||
        Boolean(
          winningAttempt?.finishedAt &&
          new Date(winningAttempt.finishedAt).getTime() <=
            new Date(snapshot.generatedAt).getTime() &&
          ["succeeded", "retrying", "blocked", "lost"].includes(
            winningAttempt.state,
          ),
        );
      const irreversible = IRREVERSIBLE_SIDE_EFFECTS.has(
        receipt.sideEffectClass,
      );
      // Receipt completion and attempt completion are separate commits. Freeze
      // logical origin and physical winner only after both are durable. A read
      // model can include rows committed after its initial generatedAt; wait
      // for the next snapshot instead of freezing future-dated evidence.
      // In particular,
      // a running attempt may later become lost; retaining its running snapshot
      // would hide that state from the independent stale-owner verifier.
      const originFinalized =
        !receipt.originAttemptId ||
        Boolean(
          receiptAttempt?.finishedAt &&
          new Date(receiptAttempt.finishedAt).getTime() <=
            new Date(snapshot.generatedAt).getTime() &&
          ["succeeded", "retrying", "blocked", "lost"].includes(
            receiptAttempt.state,
          ),
        );
      const completionObserved = Boolean(
        receipt.finishedAt &&
        new Date(receipt.finishedAt).getTime() <=
          new Date(snapshot.generatedAt).getTime(),
      );
      const primaryRelevant =
        receipt.state === "succeeded" &&
        originFinalized &&
        winnerFinalized &&
        completionObserved &&
        (receipt.toolName === "synthetic_fixture_write" ||
          irreversible ||
          winningAttempt?.state === "lost");
      observer.observeReceipt({
        receiptId: receipt.id,
        key: receipt.operationKey,
        irreversible,
        succeeded: receipt.state === "succeeded",
        ...(receipt.finishedAt && primaryRelevant
          ? {
              observedAt: snapshot.generatedAt,
              state: receipt.state,
              toolName: receipt.toolName,
              sideEffectClass: receipt.sideEffectClass,
              finishedAt: receipt.finishedAt,
              originAttempt: receiptAttempt
                ? {
                    id: receiptAttempt.id,
                    taskId: receiptAttempt.taskId,
                    agentId: receiptAttempt.agentId,
                    cycleNumber: receiptAttempt.cycleNumber,
                    state: receiptAttempt.state,
                    finishedAt: receiptAttempt.finishedAt,
                  }
                : null,
              winningAttempt: winningAttempt
                ? {
                    id: winningAttempt.id,
                    taskId: winningAttempt.taskId,
                    agentId: winningAttempt.agentId,
                    cycleNumber: winningAttempt.cycleNumber,
                    state: winningAttempt.state,
                    finishedAt: winningAttempt.finishedAt,
                  }
                : null,
              invocations: receipt.invocations,
            }
          : {}),
      });
      if (
        receipt.toolName === "synthetic_fixture_write" &&
        receipt.state === "succeeded"
      ) {
        if (!receipt.originAttemptId) {
          throw new Error(
            `Synthetic receipt ${receipt.id} has no durable origin attempt`,
          );
        }
        const attempt = this.attemptsById.get(receipt.originAttemptId);
        if (!attempt) {
          throw new Error(
            `Synthetic receipt ${receipt.id} references unavailable attempt ${receipt.originAttemptId}`,
          );
        }
        if (!this.memberAgentIds.has(attempt.agentId)) {
          throw new Error(
            `Synthetic receipt ${receipt.id} belongs to agent ${attempt.agentId} outside the exact endurance roster`,
          );
        }
        const stableTaskId = this.taskByAgentId.get(attempt.agentId);
        if (stableTaskId !== undefined && stableTaskId !== attempt.taskId) {
          throw new Error(
            `Endurance agent ${attempt.agentId} changed responsibility task from ${stableTaskId} to ${attempt.taskId}`,
          );
        }
        this.taskByAgentId.set(attempt.agentId, attempt.taskId);
        if (
          originFinalized &&
          winnerFinalized &&
          completionObserved &&
          attempt.cycleNumber < this.requiredHealthBuckets
        ) {
          const coverageKey = `${attempt.taskId}:${attempt.agentId}:${attempt.cycleNumber}`;
          if (!this.responsibilityCoverage.has(coverageKey)) {
            this.responsibilityCoverage.add(coverageKey);
            this.completedResponsibilityCyclesByAgent.set(
              attempt.agentId,
              Math.max(
                this.completedResponsibilityCyclesByAgent.get(
                  attempt.agentId,
                ) ?? 0,
                attempt.cycleNumber + 1,
              ),
            );
            if (!receipt.finishedAt) {
              throw new Error(
                `Completed responsibility receipt ${receipt.id} has no completion timestamp`,
              );
            }
            observer.observeResponsibility({
              receiptId: receipt.id,
              taskId: attempt.taskId,
              agentId: attempt.agentId,
              cycleNumber: attempt.cycleNumber,
              completedAt: receipt.finishedAt,
              observedAt: snapshot.generatedAt,
            });
          }
        }
      }
      if (
        receipt.state === "succeeded" &&
        completionObserved &&
        winningAttempt?.state === "lost" &&
        receipt.finishedAt &&
        winningAttempt.finishedAt &&
        new Date(receipt.finishedAt).getTime() >
          new Date(winningAttempt.finishedAt).getTime() &&
        !this.seenStaleCommits.has(receipt.id)
      ) {
        this.seenStaleCommits.add(receipt.id);
        observer.observeStaleOwnerCommit();
      }
    }
    const maxResponsibilityCycleLag = Math.max(
      ...[...this.memberAgentIds].map((agentId) =>
        Math.max(
          0,
          minute -
            (this.completedResponsibilityCyclesByAgent.get(agentId) ?? 0),
        ),
      ),
    );
    observer.observeResponsibilityCycleLag(maxResponsibilityCycleLag, {
      minute,
      observedAt: snapshot.generatedAt,
    });
    if (maxResponsibilityCycleLag > MAX_RESPONSIBILITY_CYCLE_LAG) {
      throw new Error(
        `Responsibility cycle lag ${maxResponsibilityCycleLag} exceeds the ${MAX_RESPONSIBILITY_CYCLE_LAG}-cycle recovery bound`,
      );
    }
    const runStartedMs = new Date(this.runStartedAt).getTime();
    const firstHealthBucketMs = Math.floor(runStartedMs / 60_000) * 60_000;
    const healthCoverageEndMs =
      firstHealthBucketMs + this.requiredHealthBuckets * 60_000;
    for (const sample of [...snapshot.fleetHealthSamples].sort((left, right) =>
      left.bucketAt.localeCompare(right.bucketAt),
    )) {
      const sampledAtMs = sample.sampledAt
        ? new Date(sample.sampledAt).getTime()
        : null;
      if (
        sampledAtMs === null ||
        sampledAtMs < runStartedMs ||
        this.persistedHealthBuckets.has(sample.bucketAt)
      ) {
        continue;
      }
      const inExpectedFaultWindow = this.commandedFaultHealthWindowsOnly
        ? this.commandedFaultHealthWindows.some(
            (window) =>
              window.recoveredAtMs !== null &&
              sampledAtMs >= window.startedAtMs &&
              sampledAtMs <=
                window.recoveredAtMs +
                  (window.kind === "database_unavailable"
                    ? DATABASE_HEALTH_RECOVERY_GRACE_MS
                    : HEALTH_RECOVERY_GRACE_MS),
          )
        : isScheduledDisruptiveHealthWindow(
            this.faultSchedule,
            sampledAtMs - runStartedMs,
          );
      if (!hasHealthyRuntimeTruth(sample) && !inExpectedFaultWindow) {
        throw new Error(
          `Unplanned degraded runtime truth at ${sample.sampledAt ?? sample.bucketAt}`,
        );
      }
      const bucketAtMs = new Date(sample.bucketAt).getTime();
      // A previous sampler bucket may arrive after this run starts. Credit
      // only the planned minute buckets, while still rejecting unplanned
      // degradation above. Missing buckets retain their original minute.
      if (
        bucketAtMs < firstHealthBucketMs ||
        bucketAtMs >= healthCoverageEndMs
      ) {
        continue;
      }
      this.persistedHealthBuckets.add(sample.bucketAt);
      observer.observeHealth({
        minute: (bucketAtMs - firstHealthBucketMs) / 60_000 + 1,
        reportedState:
          sample.runtimeTruthState === "live"
            ? "healthy"
            : (sample.runtimeTruthState ?? "unknown"),
        truthState: hasHealthyRuntimeTruth(sample) ? "healthy" : "degraded",
        bucketAt: sample.bucketAt,
        sampledAt: sample.sampledAt!,
        runtimeTruthState: sample.runtimeTruthState,
        healthyWorkerCount: sample.healthyWorkerCount,
        staleWorkerCount: sample.staleWorkerCount,
        schedulerTickAgeMs: sample.schedulerTickAgeMs,
      });
    }
    this.lastEvidenceAt = snapshot.generatedAt;
  }

  private async assertHealthyTopology(
    snapshot: ProjectOperationsEvidence,
  ): Promise<void> {
    // A worker's first heartbeat can precede its first scheduler tick. A
    // durable recovery event does not make an older degraded snapshot healthy.
    // Poll fresh evidence within the existing recovery budget before accepting.
    const healthPolls = Math.ceil(this.faultEvidenceTimeoutMs / 1_000);
    for (
      let poll = 0;
      snapshot.runtime.state !== "live" && poll < healthPolls;
      poll += 1
    ) {
      if (
        snapshot.runtime.databaseBackend !== "postgresql" ||
        !snapshot.runtime.durable
      )
        break;
      await this.sleepImpl(1_000);
      snapshot = await this.readProjectOperations();
    }
    if (
      snapshot.runtime.state !== "live" ||
      snapshot.runtime.databaseBackend !== "postgresql" ||
      !snapshot.runtime.durable
    ) {
      throw new Error("Post-fault Operations runtime is not durably healthy");
    }
    const running = new Set(await this.harness.listRunningServices());
    if (
      running.size !== EXPECTED_SERVICES.size ||
      [...EXPECTED_SERVICES].some((service) => !running.has(service))
    ) {
      throw new Error("Post-fault Docker topology is not exactly healthy");
    }
    await waitForRuntimeTopology(
      {
        baseUrl: this.baseUrl.href,
        operatorToken: this.operatorToken,
        fetchImpl: this.fetchImpl,
        requestTimeoutMs: this.requestTimeoutMs,
      },
      { timeoutMs: this.topologyTimeoutMs, intervalMs: 250 },
    );
  }

  private recoveryTimestamp(
    snapshot: ProjectOperationsEvidence,
    kind: InjectedFaultKind,
    after: string,
  ): FaultRecoveryEvidence | null {
    const afterMs = new Date(after).getTime();
    const evidence: FaultRecoveryEvidence[] = [];
    const add = (
      value: string | null,
      sourceKind: EnduranceFaultEvidenceSourceKind,
      sourceId: string,
    ): void => {
      if (value && new Date(value).getTime() > afterMs) {
        evidence.push({ recoveredAt: value, sourceKind, sourceId });
      }
    };
    const timeline = [...snapshot.incidents, ...snapshot.milestones];
    switch (kind) {
      case "provider_timeout":
      case "provider_rate_limit":
      case "provider_malformed_output":
        for (const item of timeline) {
          if (PROVIDER_RECOVERY_KINDS.has(item.kind)) {
            add(item.occurredAt, "operations_timeline", item.id);
          }
        }
        for (const attempt of snapshot.attempts) {
          if (attempt.state === "succeeded") {
            add(attempt.finishedAt, "durable_event", attempt.id);
          }
        }
        // The API returns newest-first. Several completed cycles can arrive in one
        // snapshot after a provider/database fault. Emit their durable chronology
        // so the primary verifier can still reject a genuinely missing predecessor.
        for (const receipt of [...snapshot.receipts].sort(
          (left, right) =>
            (left.finishedAt ?? left.reservedAt).localeCompare(
              right.finishedAt ?? right.reservedAt,
            ) || left.id.localeCompare(right.id),
        )) {
          if (receipt.state === "succeeded") {
            add(receipt.finishedAt, "durable_event", receipt.id);
          }
        }
        break;
      case "worker_loss":
        for (const item of timeline) {
          if (
            item.kind === "recovery_recorded" ||
            item.kind === "runtime_state_changed"
          ) {
            add(item.occurredAt, "operations_timeline", item.id);
          }
        }
        for (const attempt of snapshot.attempts) {
          if (attempt.state === "succeeded") {
            add(attempt.finishedAt, "durable_event", attempt.id);
          }
        }
        break;
      case "database_unavailable":
        // Minute buckets preserve the outage even after the fleet recovers.
        // Persist the fresh SQL-backed read model as primary recovery evidence;
        // never overwrite an offline bucket or wait for its next aggregation.
        if (
          new Date(snapshot.generatedAt).getTime() > afterMs &&
          snapshot.runtime.state === "live" &&
          snapshot.runtime.databaseBackend === "postgresql" &&
          snapshot.runtime.durable &&
          snapshot.runtime.healthyWorkerCount === 2 &&
          snapshot.runtime.schedulerTickAgeMs !== null &&
          snapshot.runtime.schedulerTickAgeMs <= 5_000
        ) {
          evidence.push({
            recoveredAt: snapshot.generatedAt,
            sourceKind: "runtime_snapshot",
            sourceId: `operations-runtime:${snapshot.cursor}:${snapshot.generatedAt}`,
            runtimeEvidence: {
              generatedAt: snapshot.generatedAt,
              cursor: snapshot.cursor,
              ...snapshot.runtime,
            },
          });
        }
        for (const sample of snapshot.fleetHealthSamples) {
          if (hasHealthyRuntimeTruth(sample)) {
            add(
              sample.sampledAt,
              "health_sample",
              `${sample.bucketAt}:${sample.sampledAt}`,
            );
          }
        }
        break;
      case "emergency_stop":
        for (const item of timeline) {
          if (item.kind === "runtime_control_changed") {
            add(item.occurredAt, "operations_timeline", item.id);
          }
        }
        break;
      case "sse_disconnect":
        for (const item of timeline) {
          add(item.occurredAt, "operations_timeline", item.id);
        }
        for (const attempt of snapshot.attempts) {
          if (attempt.state === "succeeded") {
            add(attempt.finishedAt, "durable_event", attempt.id);
          }
        }
        // The API returns newest-first. Several completed cycles can arrive in one
        // snapshot after a provider/database fault. Emit their durable chronology
        // so the primary verifier can still reject a genuinely missing predecessor.
        for (const receipt of [...snapshot.receipts].sort(
          (left, right) =>
            (left.finishedAt ?? left.reservedAt).localeCompare(
              right.finishedAt ?? right.reservedAt,
            ) || left.id.localeCompare(right.id),
        )) {
          if (receipt.state === "succeeded") {
            add(receipt.finishedAt, "durable_event", receipt.id);
          }
        }
        break;
      default: {
        const exhaustive: never = kind;
        throw new TypeError(`Unsupported recovery kind: ${String(exhaustive)}`);
      }
    }
    return (
      evidence.sort(
        (left, right) =>
          left.recoveredAt.localeCompare(right.recoveredAt) ||
          left.sourceId.localeCompare(right.sourceId),
      )[0] ?? null
    );
  }

  private durableFaultIncident(
    events: DurableEnduranceEvent[],
    kind: InjectedFaultKind,
    scheduledMs: number,
    expectedProviderTargets?: ReadonlyMap<number, number>,
  ): DurableFaultEvidence | null {
    const candidates = events.filter(
      (event) =>
        !this.assignedIncidentIds.has(`postgres:${event.id}`) &&
        new Date(event.occurredAt).getTime() >= scheduledMs - 5_000,
    );
    let event: DurableEnduranceEvent | undefined;
    if (
      kind === "provider_timeout" ||
      kind === "provider_rate_limit" ||
      kind === "provider_malformed_output"
    ) {
      const expectedFailure = PROVIDER_FAILURE_KINDS[kind];
      event = candidates.find((candidate) => {
        if (
          candidate.eventType !== "error" ||
          candidate.taskId === null ||
          candidate.attemptId === null ||
          candidate.attemptNumber === null ||
          !candidate.providerFailureKinds.includes(expectedFailure)
        ) {
          return false;
        }
        return (
          expectedProviderTargets?.get(candidate.taskId) ===
          candidate.attemptNumber
        );
      });
    } else if (kind === "worker_loss") {
      event = candidates.find(
        (candidate) =>
          candidate.eventType === "operations_changed" &&
          ((candidate.kind === "attempt_state_changed" &&
            candidate.state === "lost" &&
            candidate.taskId !== null) ||
            (candidate.kind === "runtime_state_changed" &&
              (candidate.state === "stale" || candidate.state === "stopped"))),
      );
    }
    return event
      ? {
          id: `postgres:${event.id}`,
          kind:
            event.eventType === "error"
              ? `${kind}:${event.providerFailureKinds.join(",")}`
              : event.kind,
          occurredAt: event.occurredAt,
          taskId: event.taskId,
        }
      : null;
  }

  private durableRecoveryTimestamp(
    events: DurableEnduranceEvent[],
    kind: InjectedFaultKind,
    incident: DurableFaultEvidence,
  ): FaultRecoveryEvidence | null {
    if (
      kind !== "worker_loss" &&
      kind !== "provider_timeout" &&
      kind !== "provider_rate_limit" &&
      kind !== "provider_malformed_output"
    ) {
      return null;
    }
    const incidentMs = new Date(incident.occurredAt).getTime();
    const recovery = events
      .filter(
        (event) =>
          event.eventType === "operations_changed" &&
          event.taskId === incident.taskId &&
          new Date(event.occurredAt).getTime() > incidentMs &&
          ((event.kind === "attempt_state_changed" &&
            event.state === "succeeded") ||
            (kind === "worker_loss" &&
              (event.kind === "recovery_recorded" ||
                (event.kind === "runtime_state_changed" &&
                  event.state === "healthy")))),
      )
      .sort(
        (left, right) =>
          left.occurredAt.localeCompare(right.occurredAt) ||
          left.id.localeCompare(right.id),
      )[0];
    return recovery
      ? {
          recoveredAt: recovery.occurredAt,
          sourceKind: "durable_event",
          sourceId: `postgres:${recovery.id}`,
        }
      : null;
  }

  private async observeFaultEvidence(
    observer: SoakEvidenceObserver,
    initialSnapshot: ProjectOperationsEvidence,
    context: Extract<WallClockCaptureContext, { kind: "post_fault" }>,
  ): Promise<void> {
    const scheduledMs = new Date(context.scheduledAt).getTime();
    const providerFault = isProviderFault(context.fault.kind);
    const expectedProviderTargets = providerFault
      ? this.providerTargetsByFaultId.get(context.fault.id)
      : undefined;
    if (
      providerFault &&
      (!this.harness.readDurableEnduranceEvents || !expectedProviderTargets)
    ) {
      throw new Error(
        `Fault ${context.fault.id} requires exact durable provider evidence and target identity`,
      );
    }
    if (context.fault.kind === "emergency_stop") {
      const incident = this.emergencyStopIncident;
      const recovery = this.emergencyStopRecovery;
      if (
        !incident ||
        new Date(incident.updatedAt).getTime() < scheduledMs - 5_000
      ) {
        throw new Error(
          `Fault ${context.fault.id} produced no matching durable Operations incident evidence`,
        );
      }
      if (
        !recovery ||
        recovery.version <= incident.version ||
        new Date(recovery.updatedAt).getTime() <
          new Date(incident.updatedAt).getTime()
      ) {
        throw new Error(
          `Fault ${context.fault.id} produced no durable recovery evidence`,
        );
      }
      await this.assertHealthyTopology(initialSnapshot);
      observer.observeIncident({
        faultId: context.fault.id,
        incidentId: `operations-control:${incident.version}:runtime_control_changed`,
        observedAt: incident.updatedAt,
        sourceKind: "runtime_control",
        sourceId: `operations-control:${incident.version}`,
      });
      observer.observeRecovery({
        faultId: context.fault.id,
        recoveredAt: recovery.updatedAt,
        sourceKind: "runtime_control",
        sourceId: `operations-control:${recovery.version}`,
      });
      return;
    }
    const pollCount = Math.ceil(this.faultEvidenceTimeoutMs / 1_000);
    let snapshot = initialSnapshot;
    const durableSince = new Date(scheduledMs - 5_000);
    let durableEvents = this.harness.readDurableEnduranceEvents
      ? await this.databaseReadGate.read(() =>
          this.harness.readDurableEnduranceEvents!(durableSince),
        )
      : null;
    let missingEvidence = `Fault ${context.fault.id} produced no matching durable Operations incident evidence`;

    for (let poll = 0; poll <= pollCount; poll += 1) {
      if (context.fault.kind === "sse_disconnect") {
        if (!this.sseDisconnectedCursor || !this.sseReconnectedCursor) {
          throw new Error("SSE fault completed without cursor evidence");
        }
        const recovery = this.recoveryTimestamp(
          snapshot,
          context.fault.kind,
          context.scheduledAt,
        );
        if (recovery) {
          await this.assertHealthyTopology(snapshot);
          const incidentId = `sse-cursor:${this.sseDisconnectedCursor}:${this.sseReconnectedCursor}`;
          observer.observeIncident({
            faultId: context.fault.id,
            incidentId,
            observedAt: context.scheduledAt,
            sourceKind: "sse_cursor",
            sourceId: `sse:disconnect:${this.sseDisconnectedCursor}`,
          });
          observer.observeSseDisconnect(
            this.sseDisconnectedCursor,
            context.scheduledAt,
            { faultId: context.fault.id, incidentId },
          );
          observer.observeSseReconnect(
            this.sseReconnectedCursor,
            recovery.recoveredAt,
            { faultId: context.fault.id, incidentId },
          );
          observer.observeRecovery({
            faultId: context.fault.id,
            recoveredAt: recovery.recoveredAt,
            sourceKind: "sse_cursor",
            sourceId: `sse:reconnect:${this.sseReconnectedCursor}`,
          });
          return;
        }
        missingEvidence = `Fault ${context.fault.id} produced no durable recovery evidence`;
      } else {
        const timeline = [...snapshot.incidents, ...snapshot.milestones]
          .filter(
            (item) =>
              !this.assignedIncidentIds.has(item.id) &&
              new Date(item.occurredAt).getTime() >= scheduledMs - 5_000,
          )
          .sort((left, right) =>
            left.occurredAt.localeCompare(right.occurredAt),
          );
        const matchingKinds = INCIDENT_KINDS[context.fault.kind];
        const exactIncident = durableEvents
          ? this.durableFaultIncident(
              durableEvents,
              context.fault.kind,
              scheduledMs,
              expectedProviderTargets,
            )
          : null;
        const exactCorrelationRequired =
          providerFault ||
          (durableEvents !== null && context.fault.kind === "worker_loss");
        const timelineIncident = exactCorrelationRequired
          ? undefined
          : timeline.find((item) => matchingKinds.has(item.kind));
        const health =
          context.fault.kind === "database_unavailable"
            ? snapshot.fleetHealthSamples
                .filter(
                  (sample) =>
                    !hasHealthyRuntimeTruth(sample) &&
                    new Date(sample.sampledAt ?? sample.bucketAt).getTime() >=
                      scheduledMs - 5_000,
                )
                .sort((left, right) =>
                  left.bucketAt.localeCompare(right.bucketAt),
                )[0]
            : undefined;
        // Other activity is not proof that this incident cannot arrive. A
        // delayed provider timeout may outlive the injection window. Retain
        // exact target/kind matching and wait only within the existing budget.
        if (exactIncident || timelineIncident || health) {
          const observedAt = exactIncident
            ? exactIncident.occurredAt
            : timelineIncident
              ? timelineIncident.occurredAt
              : (health!.sampledAt ?? health!.bucketAt);
          const recovery = exactIncident
            ? this.durableRecoveryTimestamp(
                durableEvents ?? [],
                context.fault.kind,
                exactIncident,
              )
            : this.recoveryTimestamp(snapshot, context.fault.kind, observedAt);
          if (recovery) {
            await this.assertHealthyTopology(snapshot);
            if (exactIncident) {
              this.assignedIncidentIds.add(exactIncident.id);
            } else if (timelineIncident) {
              this.assignedIncidentIds.add(timelineIncident.id);
            }
            const incidentId = exactIncident
              ? `operations:${exactIncident.id}:${exactIncident.kind}`
              : timelineIncident
                ? `operations:${timelineIncident.id}:${timelineIncident.kind}`
                : `operations-health:${health!.bucketAt}`;
            observer.observeIncident({
              faultId: context.fault.id,
              incidentId,
              observedAt,
              sourceKind: exactIncident
                ? "durable_event"
                : timelineIncident
                  ? "operations_timeline"
                  : "health_sample",
              sourceId: exactIncident
                ? exactIncident.id
                : timelineIncident
                  ? timelineIncident.id
                  : `${health!.bucketAt}:${health!.sampledAt ?? health!.bucketAt}`,
            });
            observer.observeRecovery({
              faultId: context.fault.id,
              recoveredAt: recovery.recoveredAt,
              sourceKind: recovery.sourceKind,
              sourceId: recovery.sourceId,
              runtimeEvidence: recovery.runtimeEvidence,
            });
            return;
          }
          missingEvidence = `Fault ${context.fault.id} produced no durable recovery evidence`;
        }
      }
      if (poll < pollCount) {
        await this.sleepImpl(1_000);
        [snapshot, durableEvents] = await Promise.all([
          this.readProjectOperations(),
          this.harness.readDurableEnduranceEvents
            ? this.databaseReadGate.read(() =>
                this.harness.readDurableEnduranceEvents!(durableSince),
              )
            : Promise.resolve(null),
        ]);
      }
    }
    throw new Error(missingEvidence);
  }

  async captureEvidence(
    observer: SoakEvidenceObserver,
    context: WallClockCaptureContext,
  ): Promise<void> {
    const snapshot = await this.readProjectOperations();
    if (context.kind === "minute") {
      await this.ingestMinuteEvidence(observer, snapshot, context.minute);
    } else {
      await this.observeFaultEvidence(observer, snapshot, context);
    }
  }

  async createBrowserSession(
    signal?: AbortSignal,
    cleanupTimeoutMs?: number,
  ): Promise<BrowserMonitorSession> {
    const session = await this.browserSessionFactory({
      baseUrl: this.baseUrl.href,
      projectId: this.requireProjectId(),
      operatorToken: this.operatorToken,
      signal,
      cleanupTimeoutMs,
      isExpectedDatabaseOutage: () =>
        this.databasePaused ||
        this.nowImpl().getTime() < this.databaseFailureDrainUntil,
    });
    this.activeBrowserSession = session;
    if (session.browserVersion) this.browserVersion = session.browserVersion;
    return {
      browserVersion: session.browserVersion,
      setOffline: session.setOffline?.bind(session),
      sample: () => session.sample(),
      screenshot: (target) => session.screenshot(target),
      close: async () => {
        await session.close();
        if (this.activeBrowserSession === session) {
          this.activeBrowserSession = null;
        }
      },
      ...(session.forceClose
        ? {
            forceClose: async () => {
              await session.forceClose?.();
              if (this.activeBrowserSession === session) {
                this.activeBrowserSession = null;
              }
            },
          }
        : {}),
    };
  }

  spendConfiguration() {
    return { ...this.spend.provenance };
  }

  async provenance() {
    const runtimeAttestation = await this.harness.runtimeAttestation();
    return {
      runner: {
        os: `${os.platform()} ${os.release()} ${os.arch()}`,
        node: process.version,
        postgres: this.postgres,
        browser: this.browserVersion,
      },
      workflowRunId: process.env.GITHUB_RUN_ID?.trim() || null,
      configuration: {
        ...this.spend.provenance,
        runtime: "docker-compose",
        workers: 2,
        agents: 10,
        database: "postgres",
        durationHours: this.durationHours,
        seed: this.seed,
        faultProfile: this.faultProfile,
      },
      runtimeAttestation,
    };
  }

  async stop(options: { keepData: boolean }): Promise<void> {
    const failures: string[] = [];
    if (this.activeProviderFaultId) {
      try {
        await this.faultWriter.clear();
        this.activeProviderFaultId = null;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (this.emergencyStopActive && this.projectId !== null) {
      try {
        await this.disableEmergencyStop();
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (this.sseDisconnectedCursor && !this.sseReconnectedCursor) {
      try {
        await this.activeBrowserSession?.setOffline?.(false);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    const browserSession = this.activeBrowserSession;
    if (browserSession) {
      try {
        await disposeBrowserMonitorSession(
          browserSession,
          this.requestTimeoutMs,
          "Docker driver browser close",
        );
        if (this.activeBrowserSession === browserSession) {
          this.activeBrowserSession = null;
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (this.harnessStarted && !options.keepData) {
      try {
        await this.harness.stop();
        this.harnessStarted = false;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    this.runStarted = false;
    if (failures.length > 0) {
      throw new Error(
        `Docker wall-clock cleanup failed: ${failures.join("; ")}`,
      );
    }
  }

  now(): Date {
    return this.nowImpl();
  }

  async listActiveWorkers(): Promise<readonly ("worker-1" | "worker-2")[]> {
    const running = new Set(await this.harness.listRunningServices());
    return (["worker-1", "worker-2"] as const).filter((worker) =>
      running.has(worker),
    );
  }

  async killWorker(worker: "worker-1" | "worker-2"): Promise<void> {
    const startedAtMs = this.nowImpl().getTime();
    await this.harness.killWorker(worker);
    if (this.commandedFaultHealthWindowsOnly) {
      this.commandedFaultHealthWindows.push({
        kind: "worker_loss",
        target: worker,
        startedAtMs,
        recoveredAtMs: null,
      });
    }
  }

  async restartWorker(worker: "worker-1" | "worker-2"): Promise<void> {
    await this.harness.restartWorker(worker);
    const openWindow = this.commandedFaultHealthWindows.find(
      (window) =>
        window.kind === "worker_loss" &&
        window.target === worker &&
        window.recoveredAtMs === null,
    );
    if (openWindow) openWindow.recoveredAtMs = this.nowImpl().getTime();
  }

  async setProviderFault(
    kind: InjectedFaultKind,
    faultId: string,
  ): Promise<void> {
    if (this.activeProviderFaultId) {
      throw new Error("A provider fault is already active");
    }
    if (!faultId.trim()) throw new TypeError("faultId is required");
    if (this.providerTargetsByFaultId.has(faultId)) {
      throw new Error("Provider fault identity has already been used");
    }
    const outcome = providerOutcome(kind);
    const snapshot = await this.readProjectOperations();
    const latestByTask = new Map<number, OperationsAttemptEvidence>();
    for (const attempt of snapshot.attempts) {
      const current = latestByTask.get(attempt.taskId);
      if (!current || attempt.attemptNumber > current.attemptNumber) {
        latestByTask.set(attempt.taskId, attempt);
      }
    }
    const entries: EnduranceFaultControlEntry[] = [...latestByTask.values()]
      .sort((left, right) => left.taskId - right.taskId)
      .map((attempt) => ({
        taskId: attempt.taskId,
        attemptNumber: attempt.attemptNumber + 1,
        step: attempt.cycleNumber + (attempt.state === "succeeded" ? 1 : 0),
        outcome,
        ...(outcome === "timeout" ? { delayMs: 5_000 } : {}),
      }));
    if (entries.length === 0) {
      throw new Error(
        "No durable task identity is available for provider fault injection",
      );
    }
    const expectedTargets = new Map(
      entries.map((entry) => [entry.taskId, entry.attemptNumber] as const),
    );
    try {
      await this.faultWriter.set(entries);
      if (!this.harness.makeContinuousTasksDue) {
        throw new Error(
          "Provider injection requires durable exact task wake support",
        );
      }
      const madeDue = await this.harness.makeContinuousTasksDue(
        this.requireProjectId(),
        [...expectedTargets.keys()],
      );
      if (
        madeDue.length === 0 ||
        madeDue.some((taskId) => !expectedTargets.has(taskId))
      ) {
        throw new Error("Provider injection made no exact target task due");
      }
      this.providerTargetsByFaultId.set(faultId, expectedTargets);
      this.activeProviderFaultId = faultId;
    } catch (error) {
      try {
        await this.faultWriter.clear();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Provider fault setup failed and its control cleanup also failed",
        );
      }
      throw error;
    }
  }

  async clearProviderFault(faultId: string): Promise<void> {
    if (this.activeProviderFaultId === null) return;
    if (this.activeProviderFaultId !== faultId) {
      throw new Error(
        "Provider fault identity does not match the active fault",
      );
    }
    await this.faultWriter.clear();
    this.activeProviderFaultId = null;
  }

  pauseDatabase(): Promise<void> {
    const startedAtMs = this.nowImpl().getTime();
    return this.databaseReadGate.pause(async () => {
      this.databasePaused = true;
      try {
        await this.harness.pauseDatabase();
        if (this.commandedFaultHealthWindowsOnly) {
          this.commandedFaultHealthWindows.push({
            kind: "database_unavailable",
            target: "db",
            startedAtMs,
            recoveredAtMs: null,
          });
        }
      } catch (error) {
        this.databasePaused = false;
        throw error;
      }
    });
  }

  async resumeDatabase(): Promise<void> {
    await this.databaseReadGate.resume(() => this.harness.resumeDatabase());
    const openWindow = this.commandedFaultHealthWindows.find(
      (window) =>
        window.kind === "database_unavailable" && window.recoveredAtMs === null,
    );
    if (openWindow) openWindow.recoveredAtMs = this.nowImpl().getTime();
    this.databasePaused = false;
    // Responses already in flight may arrive just after the database resumes.
    this.databaseFailureDrainUntil =
      this.nowImpl().getTime() + Math.min(this.requestTimeoutMs, 30_000);
  }

  async disconnectObserverStream(): Promise<void> {
    if (!this.activeBrowserSession?.setOffline) {
      throw new Error("Browser session does not support offline SSE injection");
    }
    if (this.sseDisconnectedCursor && !this.sseReconnectedCursor) {
      throw new Error("Observer stream is already disconnected");
    }
    const snapshot = await this.readProjectOperations();
    this.sseDisconnectedCursor = snapshot.cursor;
    this.sseReconnectedCursor = null;
    await this.activeBrowserSession.setOffline(true);
  }

  async reconnectObserverStream(): Promise<void> {
    if (!this.activeBrowserSession?.setOffline || !this.sseDisconnectedCursor) {
      throw new Error("Observer stream is not disconnected");
    }
    await this.activeBrowserSession.setOffline(false);
    const deadline = Date.now() + 30_000;
    do {
      const snapshot = await this.readProjectOperations();
      this.sseReconnectedCursor = snapshot.cursor;
      if (BigInt(snapshot.cursor) > BigInt(this.sseDisconnectedCursor)) return;
      await this.sleepImpl(1_000);
    } while (Date.now() < deadline);
  }

  async enableEmergencyStop(): Promise<void> {
    const transition = await this.requestJson("/api/ops/control", {
      method: "PUT",
      body: JSON.stringify({
        emergencyStopEnabled: true,
        reason: "Endurance fault injection",
      }),
    });
    this.emergencyStopIncident = await this.verifyEmergencyControlState(
      transition,
      true,
    );
    this.emergencyStopRecovery = null;
    this.emergencyStopActive = true;
  }

  async disableEmergencyStop(): Promise<void> {
    const transition = await this.requestJson("/api/ops/control", {
      method: "PUT",
      body: JSON.stringify({ emergencyStopEnabled: false, reason: null }),
    });
    const recovered = await this.verifyEmergencyControlState(transition, false);
    if (
      this.emergencyStopIncident &&
      (recovered.version <= this.emergencyStopIncident.version ||
        new Date(recovered.updatedAt).getTime() <
          new Date(this.emergencyStopIncident.updatedAt).getTime())
    ) {
      throw new Error("Emergency-stop recovery did not advance durable state");
    }
    this.emergencyStopRecovery = recovered;
    this.emergencyStopActive = false;
  }

  sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    return this.sleepImpl(milliseconds, signal);
  }
}
