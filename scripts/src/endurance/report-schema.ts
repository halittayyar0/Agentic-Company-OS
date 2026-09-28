import {
  evaluateEnduranceInvariants,
  type EnduranceAssertion,
  type EnduranceInvariantInput,
} from "./invariants";

export type EnduranceMode = "accelerated" | "wall_clock";

export interface FaultObservation {
  id: string;
  kind: string;
  scheduledAt: string;
  observedAt: string | null;
  recoveredAt: string | null;
  incidentId: string | null;
  pass: boolean;
}

export type EnduranceMetrics = EnduranceInvariantInput;

export type EnduranceRuntime = "docker-compose" | "native-postgres";

export interface NativeRuntimeDependencyAttestation {
  name: "@electric-sql/pglite" | "playwright-core";
  version: string;
  path: string;
  sha256: string;
  fileCount: number;
}

export interface EnduranceBuildAttestation {
  schemaVersion: 1;
  cleanTree: true;
  nodeVersion: string;
  sourceCommitSha: string;
  sourceTreeSha256: string;
  runtime: EnduranceRuntime;
  subject: "docker-build-context" | "native-runtime-artifacts";
  runtimeArtifactSha256: string;
  runtimeArtifactFileCount: number;
  nativeRuntimeDependencies?: NativeRuntimeDependencyAttestation[];
}

export interface DockerEnduranceRuntimeAttestation {
  kind: "docker";
  serviceImageIds: {
    app: string;
    worker1: string;
    worker2: string;
    database: string;
  };
  applicationImageLabels: {
    sourceCommitSha: string;
    sourceTreeSha256: string;
  };
}

export interface NativePostgresEnduranceRuntimeAttestation {
  kind: "native-postgres";
  nodeVersion: string;
  postgresVersion: string;
  postgresToolchainSha256: string;
  postgresBinaries: Array<{
    name: "postgres" | "initdb" | "pg_ctl" | "pg_isready" | "psql";
    sha256: string;
  }>;
  postgresDistribution: {
    rootPath: string;
    startSha256: string;
    endSha256: string;
    fileCount: number;
    totalBytes: number;
  };
  nodeExecutableSha256: string;
  pnpmLockSha256: string;
}

export type EnduranceRuntimeAttestation =
  DockerEnduranceRuntimeAttestation | NativePostgresEnduranceRuntimeAttestation;

export interface EnduranceProvenance {
  runner: {
    os: string;
    node: string;
    postgres: string;
    browser: string;
  };
  workflowRunId: string | null;
  configuration: Record<string, string | number | boolean>;
  /** Attached by the wall-clock CLI after preflight/build and reverified later. */
  buildAttestation?: EnduranceBuildAttestation;
  /** Exact runtime bytes/identities observed after startup. */
  runtimeAttestation?: EnduranceRuntimeAttestation;
  automatedSignOff: {
    status: "passed" | "failed";
    generatedAt: string;
  };
}

export interface EnduranceBrowserEvidence {
  startCheckpointSha256: string;
  endCheckpointSha256: string;
  /** Added by the durable evidence writer after the manifest bytes exist. */
  manifestSha256?: string;
  incidentCorrelations: number;
  sseReconnectEventIdAdvanced: boolean;
}

export type EndurancePrimaryEvidenceKind =
  | "receipt_observed"
  | "responsibility_completed"
  | "responsibility_cycle_lag"
  | "health_observed"
  | "fault_observed"
  | "fault_recovered"
  | "sse_disconnected"
  | "sse_reconnected";

export type EnduranceFaultEvidenceSourceKind =
  | "durable_event"
  | "operations_timeline"
  | "health_sample"
  | "runtime_control"
  | "sse_cursor";

export interface EndurancePrimaryEvidenceRecord {
  schemaVersion: 1;
  runId: string;
  sequence: number;
  occurredAt: string;
  kind: EndurancePrimaryEvidenceKind;
  data: Record<string, unknown>;
}

export interface EnduranceEvidence {
  /** Added by the durable evidence writer after the journal bytes exist. */
  journalSha256?: string;
  /** Hash of the bounded primary receipt/responsibility/health JSONL bytes. */
  primaryEvidenceSha256?: string;
  browser?: EnduranceBrowserEvidence;
}

export interface EnduranceReportV1 {
  schemaVersion: 1;
  runId: string;
  mode: EnduranceMode;
  seed: number;
  commitSha: string;
  startedAt: string;
  completedAt: string;
  wallClockHours: number;
  simulatedMinutes: number;
  verified24h: boolean;
  topology: {
    api: number;
    workers: number;
    agents: number;
    database: "postgres";
  };
  injections: FaultObservation[];
  metrics: EnduranceMetrics;
  assertions: EnduranceAssertion[];
  pass: boolean;
  provenance?: EnduranceProvenance;
  evidence?: EnduranceEvidence;
}

export type EnduranceReport = EnduranceReportV1;

export interface EnduranceJournalEvent {
  schemaVersion: 1;
  runId: string;
  sequence: number;
  occurredAt: string;
  kind: string;
  data: Record<string, unknown>;
}

export type CreateEnduranceReportInput = Omit<
  EnduranceReportV1,
  "schemaVersion" | "verified24h" | "assertions" | "pass"
>;

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a finite non-negative number`);
  }
  return value;
}

function requireIso(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}

export function createEnduranceReport(
  input: CreateEnduranceReportInput,
): EnduranceReportV1 {
  if (!input.runId.trim()) throw new TypeError("runId is required");
  if (!input.commitSha.trim()) throw new TypeError("commitSha is required");
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) {
    throw new TypeError("seed must be a non-negative safe integer");
  }
  requireIso(input.startedAt, "startedAt");
  requireIso(input.completedAt, "completedAt");
  finiteNonNegative(input.wallClockHours, "wallClockHours");
  finiteNonNegative(input.simulatedMinutes, "simulatedMinutes");
  const invariants = evaluateEnduranceInvariants(input.metrics);
  const verified24h =
    input.mode === "wall_clock" &&
    input.wallClockHours >= 24 &&
    invariants.pass;

  return {
    schemaVersion: 1,
    ...input,
    verified24h,
    assertions: invariants.assertions,
    pass: invariants.pass,
  };
}

export function serializeEnduranceJournalEvent(
  event: EnduranceJournalEvent,
): string {
  if (event.schemaVersion !== 1) {
    throw new TypeError("Unsupported endurance journal schema version");
  }
  if (!event.runId.trim()) throw new TypeError("Journal runId is required");
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 0) {
    throw new TypeError("Journal sequence must be a non-negative safe integer");
  }
  requireIso(event.occurredAt, "Journal occurredAt");
  return `${JSON.stringify(event)}\n`;
}

export function serializeEnduranceReport(report: EnduranceReport): string {
  if (report.schemaVersion !== 1) {
    throw new TypeError("Unsupported endurance report schema version");
  }
  return `${JSON.stringify(report, null, 2)}\n`;
}
