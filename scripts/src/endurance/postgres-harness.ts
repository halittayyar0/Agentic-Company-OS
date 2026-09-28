import path from "node:path";

import {
  readWallClockSourceIdentity,
  type WallClockSourceIdentity,
} from "./build-attestation";
import { executeBoundedCommand } from "./process-supervisor";
import type { DockerEnduranceRuntimeAttestation } from "./report-schema";

export interface CommandExecution {
  command: string;
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface CommandExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CommandExecutor = (
  execution: CommandExecution,
) => Promise<CommandExecutionResult>;

export interface PostgresEnduranceHarnessOptions {
  runId: string;
  workspaceRoot: string;
  execute?: CommandExecutor;
  environment?: NodeJS.ProcessEnv;
  commandTimeoutMs?: number;
  cleanupTimeoutMs?: number;
  resolveSourceIdentity?: () => Promise<WallClockSourceIdentity>;
}

export interface DurableEnduranceEvent {
  id: string;
  eventType: "operations_changed" | "error";
  kind: string;
  state: string | null;
  taskId: number | null;
  attemptId: string | null;
  attemptNumber: number | null;
  occurredAt: string;
  providerFailureKinds: string[];
}

const SAFE_RUN_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const WORKER_SERVICES = new Set(["worker-1", "worker-2"] as const);
const SHA256 = /^[a-f0-9]{64}$/u;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/u;
const CONTAINER_ID = /^[a-f0-9]{64}$/u;
const SAFE_IMAGE_REFERENCE =
  /^(?=.{1,255}$)[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+)?(?:@sha256:[a-f0-9]{64})?$/u;
export const PINNED_POSTGRES_17_IMAGE =
  "postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0";
const SOURCE_TREE_LABEL = "com.agentic-company-os.source-tree-sha256";
const SOURCE_COMMIT_LABEL = "org.opencontainers.image.revision";

function exactImageReference(value: string | undefined, label: string): string {
  const reference = value?.trim() ?? "";
  if (!SAFE_IMAGE_REFERENCE.test(reference)) {
    throw new Error(`${label} must be an exact safe Docker image reference`);
  }
  return reference;
}

function exactImageId(value: unknown, label: string): string {
  if (typeof value !== "string" || !IMAGE_ID.test(value)) {
    throw new Error(`${label} returned an invalid Docker image ID`);
  }
  return value;
}

function parseJsonString(value: string, label: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
  if (typeof parsed !== "string") {
    throw new Error(`${label} returned a non-string JSON value`);
  }
  return parsed;
}

function parseDurableEnduranceEvent(
  value: unknown,
  index: number,
): DurableEnduranceEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Durable endurance event ${index} is not an object`);
  }
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !/^[1-9][0-9]*$/u.test(item.id)) {
    throw new Error(`Durable endurance event ${index} has an invalid id`);
  }
  if (item.eventType !== "operations_changed" && item.eventType !== "error") {
    throw new Error(`Durable endurance event ${index} has an invalid type`);
  }
  if (typeof item.kind !== "string" || !item.kind) {
    throw new Error(`Durable endurance event ${index} has no kind`);
  }
  if (item.state !== null && typeof item.state !== "string") {
    throw new Error(`Durable endurance event ${index} has an invalid state`);
  }
  if (
    item.taskId !== null &&
    (!Number.isSafeInteger(item.taskId) || Number(item.taskId) < 1)
  ) {
    throw new Error(`Durable endurance event ${index} has an invalid taskId`);
  }
  if (item.attemptId !== null && typeof item.attemptId !== "string") {
    throw new Error(
      `Durable endurance event ${index} has an invalid attemptId`,
    );
  }
  if (
    item.attemptNumber !== null &&
    (!Number.isSafeInteger(item.attemptNumber) ||
      Number(item.attemptNumber) < 1)
  ) {
    throw new Error(
      `Durable endurance event ${index} has an invalid attemptNumber`,
    );
  }
  if (!Array.isArray(item.providerFailureKinds)) {
    throw new Error(
      `Durable endurance event ${index} has invalid provider failures`,
    );
  }
  const providerFailureKinds = item.providerFailureKinds.map((kind) => {
    if (typeof kind !== "string" || !kind) {
      throw new Error(
        `Durable endurance event ${index} has an invalid provider failure`,
      );
    }
    return kind;
  });
  if (typeof item.occurredAt !== "string") {
    throw new Error(`Durable endurance event ${index} has no timestamp`);
  }
  const occurredAt = new Date(item.occurredAt);
  if (
    Number.isNaN(occurredAt.getTime()) ||
    occurredAt.toISOString() !== item.occurredAt
  ) {
    throw new Error(
      `Durable endurance event ${index} has an invalid timestamp`,
    );
  }
  return {
    id: item.id,
    eventType: item.eventType,
    kind: item.kind,
    state: item.state,
    taskId: item.taskId === null ? null : Number(item.taskId),
    attemptId: item.attemptId,
    attemptNumber:
      item.attemptNumber === null ? null : Number(item.attemptNumber),
    occurredAt: item.occurredAt,
    providerFailureKinds,
  };
}

export function durableEnduranceEventsSql(since: Date): string {
  if (!(since instanceof Date) || Number.isNaN(since.getTime())) {
    throw new TypeError("since must be a valid date");
  }
  const sinceIso = since.toISOString();
  return `SELECT json_build_object(
  'id', activity_events.id::text,
  'eventType', activity_events.type,
  'kind', CASE WHEN activity_events.type = 'operations_changed' THEN activity_events.detail->>'kind' ELSE activity_events.detail->>'runtimeEvent' END,
  'state', activity_events.detail->>'state',
  'taskId', activity_events.task_id,
  'attemptId', activity_events.detail->>'attemptId',
  'attemptNumber', (
    SELECT task_attempts.attempt_number
    FROM task_attempts
    WHERE task_attempts.id = activity_events.detail->>'attemptId'
  ),
  'occurredAt', to_char(activity_events.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'providerFailureKinds', jsonb_path_query_array(COALESCE(activity_events.detail, '{}'::jsonb), '$.modelAttempts[*].kind')
)::text
FROM activity_events
WHERE activity_events.created_at >= TIMESTAMPTZ '${sinceIso}'
  AND (
    (activity_events.type = 'operations_changed' AND activity_events.detail->>'kind' IN (
      'runtime_state_changed',
      'attempt_state_changed',
      'receipt_state_changed',
      'invocation_state_changed',
      'recovery_recorded',
      'runtime_control_changed'
    ))
    OR (activity_events.type = 'error' AND jsonb_typeof(activity_events.detail->'modelAttempts') = 'array')
  )
ORDER BY activity_events.id
LIMIT 1001`;
}

export function parseDurableEnduranceEvents(
  stdout: string,
): DurableEnduranceEvent[] {
  const events = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`Durable endurance event ${index} is invalid JSON`);
      }
      return parseDurableEnduranceEvent(value, index);
    });
  if (events.length > 1_000) {
    throw new Error("Durable endurance fault evidence exceeded its safe bound");
  }
  return events;
}

function positiveIds(values: readonly number[], label: string): number[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(
      `${label} must contain at least one positive safe integer`,
    );
  }
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${label} must contain only positive safe integers`);
    }
  }
  return [...new Set(values)].sort((left, right) => left - right);
}

export function makeContinuousTasksDueSql(
  projectId: number,
  taskIds: readonly number[],
): string {
  if (!Number.isSafeInteger(projectId) || projectId < 1) {
    throw new TypeError("projectId must be a positive safe integer");
  }
  const ids = positiveIds(taskIds, "taskIds");
  return `UPDATE tasks
SET next_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
WHERE autonomy_mode = 'continuous'
  AND status = 'in_progress'
  AND lease_owner IS NULL
  AND (id = ${projectId} OR parent_task_id = ${projectId})
  AND id IN (${ids.join(", ")})
RETURNING id`;
}

export function parsePositiveIdRows(stdout: string, label: string): number[] {
  const values = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => Number(line));
  return positiveIds(values, label);
}

export const executeCommand: CommandExecutor = (execution) =>
  executeBoundedCommand({
    ...execution,
    maxBufferBytes: 10 * 1024 * 1024,
  });

export class PostgresEnduranceHarness {
  readonly runId: string;
  readonly projectName: string;
  readonly workspaceRoot: string;
  private readonly execute: CommandExecutor;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly commandTimeoutMs: number;
  private readonly cleanupTimeoutMs: number;
  private readonly resolveSourceIdentity: () => Promise<WallClockSourceIdentity>;
  private readonly prebuiltRuntimeImage: boolean;
  private readonly runtimeImage: string;
  private readonly databaseImage: string;
  private running = false;
  private composeTouched = false;

  constructor(options: PostgresEnduranceHarnessOptions) {
    if (!SAFE_RUN_ID.test(options.runId)) {
      throw new TypeError(
        "runId must use lowercase letters, digits, and hyphens with no path segments",
      );
    }
    if (!options.workspaceRoot.trim()) {
      throw new TypeError("workspaceRoot is required");
    }
    this.runId = options.runId;
    this.projectName = `agentic-os-soak-${options.runId}`;
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.execute = options.execute ?? executeCommand;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 240_000;
    this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? 60_000;
    for (const [label, value] of [
      ["commandTimeoutMs", this.commandTimeoutMs],
      ["cleanupTimeoutMs", this.cleanupTimeoutMs],
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new TypeError(`${label} must be positive`);
      }
    }
    const prebuiltRuntimeImageValue =
      options.environment?.ENDURANCE_PREBUILT_IMAGE?.trim();
    if (
      prebuiltRuntimeImageValue &&
      prebuiltRuntimeImageValue !== "true" &&
      prebuiltRuntimeImageValue !== "false"
    ) {
      throw new TypeError("ENDURANCE_PREBUILT_IMAGE must be true or false");
    }
    this.prebuiltRuntimeImage = prebuiltRuntimeImageValue === "true";
    if (
      this.prebuiltRuntimeImage &&
      !options.environment?.ENDURANCE_RUNTIME_IMAGE?.trim()
    ) {
      throw new TypeError(
        "A prebuilt endurance run requires ENDURANCE_RUNTIME_IMAGE",
      );
    }
    this.runtimeImage = exactImageReference(
      options.environment?.ENDURANCE_RUNTIME_IMAGE ??
        "agentic-company-os:endurance-local",
      "ENDURANCE_RUNTIME_IMAGE",
    );
    this.databaseImage = exactImageReference(
      options.environment?.AGENTIC_POSTGRES_IMAGE ?? PINNED_POSTGRES_17_IMAGE,
      "AGENTIC_POSTGRES_IMAGE",
    );
    if (!this.databaseImage.includes("@sha256:")) {
      throw new TypeError("AGENTIC_POSTGRES_IMAGE must be digest-pinned");
    }
    this.environment = {
      ...process.env,
      ...options.environment,
      ENDURANCE_RUN_ID: this.runId,
      COMPOSE_PROJECT_NAME: this.projectName,
      ENDURANCE_RUNTIME_IMAGE: this.runtimeImage,
      AGENTIC_POSTGRES_IMAGE: this.databaseImage,
    };
    this.resolveSourceIdentity =
      options.resolveSourceIdentity ??
      (() =>
        readWallClockSourceIdentity({ workspaceRoot: this.workspaceRoot }));
  }

  private baseArguments(): string[] {
    return [
      "compose",
      "--project-name",
      this.projectName,
      "--file",
      path.join(this.workspaceRoot, "compose.yaml"),
      "--file",
      path.join(this.workspaceRoot, "compose.soak.yaml"),
    ];
  }

  private run(
    args: string[],
    timeoutMs = this.commandTimeoutMs,
  ): Promise<CommandExecutionResult> {
    return this.execute({
      command: "docker",
      args: [...this.baseArguments(), ...args],
      cwd: this.workspaceRoot,
      environment: { ...this.environment },
      timeoutMs,
    });
  }

  private runDocker(
    args: string[],
    timeoutMs = this.commandTimeoutMs,
  ): Promise<CommandExecutionResult> {
    return this.execute({
      command: "docker",
      args,
      cwd: this.workspaceRoot,
      environment: { ...this.environment },
      timeoutMs,
    });
  }

  private async ensureSourceIdentity(): Promise<WallClockSourceIdentity> {
    const configuredCommit =
      this.environment.ENDURANCE_SOURCE_COMMIT_SHA?.trim();
    const configuredTree =
      this.environment.ENDURANCE_SOURCE_TREE_SHA256?.trim();
    if (configuredCommit || configuredTree) {
      if (
        !configuredCommit ||
        !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(configuredCommit) ||
        !configuredTree ||
        !SHA256.test(configuredTree)
      ) {
        throw new Error("Configured endurance source identity is invalid");
      }
      return {
        sourceCommitSha: configuredCommit,
        sourceTreeSha256: configuredTree,
      };
    }
    const identity = await this.resolveSourceIdentity();
    if (
      !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(identity.sourceCommitSha) ||
      !SHA256.test(identity.sourceTreeSha256)
    ) {
      throw new Error("Resolved endurance source identity is invalid");
    }
    this.environment.ENDURANCE_SOURCE_COMMIT_SHA = identity.sourceCommitSha;
    this.environment.ENDURANCE_SOURCE_TREE_SHA256 = identity.sourceTreeSha256;
    return identity;
  }

  private async inspectImageReference(reference: string): Promise<string> {
    const result = await this.runDocker([
      "image",
      "inspect",
      "--format",
      "{{json .Id}}",
      reference,
    ]);
    return exactImageId(
      parseJsonString(result.stdout.trim(), `Docker image ${reference}`),
      `Docker image ${reference}`,
    );
  }

  private async inspectService(service: string): Promise<{
    imageId: string;
    labels: Record<string, string>;
  }> {
    const containerResult = await this.run(["ps", "--quiet", service]);
    const containerIds = containerResult.stdout
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter(Boolean);
    if (containerIds.length !== 1 || !CONTAINER_ID.test(containerIds[0])) {
      throw new Error(
        `Compose service ${service} did not resolve to one exact container`,
      );
    }
    const inspectResult = await this.runDocker([
      "inspect",
      "--type",
      "container",
      "--format",
      "{{json .Image}}\t{{json .Config.Labels}}",
      containerIds[0],
    ]);
    const [imageJson, labelsJson, ...extra] = inspectResult.stdout
      .trim()
      .split("\t");
    if (!imageJson || !labelsJson || extra.length > 0) {
      throw new Error(`Compose service ${service} inspection is malformed`);
    }
    const imageId = exactImageId(
      parseJsonString(imageJson, `Compose service ${service}`),
      `Compose service ${service}`,
    );
    let parsedLabels: unknown;
    try {
      parsedLabels = JSON.parse(labelsJson);
    } catch {
      throw new Error(`Compose service ${service} labels are invalid JSON`);
    }
    if (
      !parsedLabels ||
      typeof parsedLabels !== "object" ||
      Array.isArray(parsedLabels)
    ) {
      throw new Error(`Compose service ${service} labels are invalid`);
    }
    const labels: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsedLabels)) {
      if (typeof value !== "string") {
        throw new Error(`Compose service ${service} has a non-string label`);
      }
      labels[key] = value;
    }
    return { imageId, labels };
  }

  async start(): Promise<void> {
    if (this.running) throw new Error("Endurance topology is already running");
    if (this.composeTouched) {
      throw new Error("Endurance topology startup is already in progress");
    }
    this.composeTouched = true;
    try {
      await this.ensureSourceIdentity();
      if (!this.prebuiltRuntimeImage) {
        await this.run(["build", "app", "worker-1", "worker-2"]);
      }
      // Workers report readiness through durable heartbeats, without HTTP healthchecks.
      // The driver waits for the complete API/worker topology after startup.
      await this.run(["up", "--detach", "--no-build"]);
      this.running = true;
    } catch (error) {
      let startupError = error;
      try {
        const logs = await this.run(
          ["logs", "--no-color", "--tail", "40"],
          10_000,
        );
        const codes = [
          ...new Set(
            `${logs.stdout}\n${logs.stderr}`.match(
              /\b(?:EACCES|EPERM|ENOENT|EROFS|ENOSPC|ECONNREFUSED|ETIMEDOUT)\b/gu,
            ) ?? [],
          ),
        ];
        startupError = new Error(
          `Container startup error codes: ${codes.join(", ") || "unclassified"}; ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      } catch {
        // Diagnostics must not prevent exact-project cleanup.
      }
      try {
        await this.run(
          ["down", "--volumes", "--remove-orphans", "--timeout", "30"],
          this.cleanupTimeoutMs,
        );
        this.running = false;
        this.composeTouched = false;
      } catch (cleanupError) {
        throw new AggregateError(
          [startupError, cleanupError],
          "Endurance topology startup and cleanup failed",
        );
      }
      throw startupError;
    }
  }

  async killWorker(worker: "worker-1" | "worker-2"): Promise<void> {
    if (!WORKER_SERVICES.has(worker)) {
      throw new TypeError("worker must be worker-1 or worker-2");
    }
    if (!this.running) throw new Error("Endurance topology is not running");
    await this.run(["kill", "--signal", "SIGKILL", worker]);
  }

  async restartWorker(worker: "worker-1" | "worker-2"): Promise<void> {
    if (!WORKER_SERVICES.has(worker)) {
      throw new TypeError("worker must be worker-1 or worker-2");
    }
    if (!this.running) throw new Error("Endurance topology is not running");
    await this.run(["up", "--detach", "--no-build", "--no-deps", worker]);
  }

  async pauseDatabase(): Promise<void> {
    if (!this.running) throw new Error("Endurance topology is not running");
    await this.run(["pause", "db"]);
  }

  async resumeDatabase(): Promise<void> {
    if (!this.running) throw new Error("Endurance topology is not running");
    await this.run(["unpause", "db"]);
  }

  async listRunningServices(): Promise<string[]> {
    if (!this.running) throw new Error("Endurance topology is not running");
    const result = await this.run([
      "ps",
      "--services",
      "--filter",
      "status=running",
    ]);
    return [
      ...new Set(result.stdout.split(/\r?\n/u).map((item) => item.trim())),
    ]
      .filter(Boolean)
      .sort();
  }

  async postgresVersion(): Promise<string> {
    if (!this.running) throw new Error("Endurance topology is not running");
    const result = await this.run([
      "exec",
      "--no-TTY",
      "db",
      "postgres",
      "--version",
    ]);
    const match = result.stdout.trim().match(/PostgreSQL\)\s+([^\s]+)/u);
    if (!match) throw new Error("PostgreSQL version probe returned no version");
    const version = `PostgreSQL ${match[1]}`;
    if (!/^PostgreSQL 17\.[0-9]+(?:[^\s]*)?$/u.test(version)) {
      throw new Error(`PostgreSQL 17.x is required; received ${version}`);
    }
    return version;
  }

  async runtimeAttestation(): Promise<DockerEnduranceRuntimeAttestation> {
    if (!this.running) throw new Error("Endurance topology is not running");
    const identity = await this.ensureSourceIdentity();
    const [
      expectedApplicationImageId,
      expectedDatabaseImageId,
      app,
      worker1,
      worker2,
      database,
    ] = await Promise.all([
      this.inspectImageReference(this.runtimeImage),
      this.inspectImageReference(this.databaseImage),
      this.inspectService("app"),
      this.inspectService("worker-1"),
      this.inspectService("worker-2"),
      this.inspectService("db"),
    ]);
    for (const [service, observed] of [
      ["app", app],
      ["worker-1", worker1],
      ["worker-2", worker2],
    ] as const) {
      if (observed.imageId !== expectedApplicationImageId) {
        throw new Error(
          `${service} did not run the exact requested endurance image`,
        );
      }
      if (
        observed.labels[SOURCE_COMMIT_LABEL] !== identity.sourceCommitSha ||
        observed.labels[SOURCE_TREE_LABEL] !== identity.sourceTreeSha256
      ) {
        throw new Error(`${service} OCI source identity labels are invalid`);
      }
    }
    if (database.imageId !== expectedDatabaseImageId) {
      throw new Error(
        "db did not run the exact digest-pinned PostgreSQL image",
      );
    }
    return {
      kind: "docker",
      serviceImageIds: {
        app: app.imageId,
        worker1: worker1.imageId,
        worker2: worker2.imageId,
        database: database.imageId,
      },
      applicationImageLabels: identity,
    };
  }

  async readDurableEnduranceEvents(
    since: Date,
  ): Promise<DurableEnduranceEvent[]> {
    if (!this.running) throw new Error("Endurance topology is not running");
    const query = durableEnduranceEventsSql(since);
    const result = await this.run([
      "exec",
      "--no-TTY",
      "db",
      "psql",
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--username",
      "agentic",
      "--dbname",
      "agentic_os",
      "--tuples-only",
      "--no-align",
      "--command",
      query,
    ]);
    return parseDurableEnduranceEvents(result.stdout);
  }

  async makeContinuousTasksDue(
    projectId: number,
    taskIds: readonly number[],
  ): Promise<number[]> {
    if (!this.running) throw new Error("Endurance topology is not running");
    const query = makeContinuousTasksDueSql(projectId, taskIds);
    const result = await this.run([
      "exec",
      "--no-TTY",
      "db",
      "psql",
      "--no-psqlrc",
      "--quiet",
      "--set",
      "ON_ERROR_STOP=1",
      "--username",
      "agentic",
      "--dbname",
      "agentic_os",
      "--tuples-only",
      "--no-align",
      "--command",
      query,
    ]);
    return parsePositiveIdRows(result.stdout, "made-due task ids");
  }

  async stop(): Promise<void> {
    if (!this.composeTouched) return;
    await this.run(
      ["down", "--volumes", "--remove-orphans", "--timeout", "30"],
      this.cleanupTimeoutMs,
    );
    this.running = false;
    this.composeTouched = false;
  }

  state(): { running: boolean; projectName: string; runId: string } {
    return {
      running: this.running,
      projectName: this.projectName,
      runId: this.runId,
    };
  }
}
