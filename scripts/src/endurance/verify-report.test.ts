import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createSeededFaultSchedule } from "./fault-injector";
import { evaluateEnduranceInvariants } from "./invariants";
import { hashExactDirectoryTree } from "./native-runtime-provenance";
import { createEnduranceReport } from "./report-schema";
import {
  parseVerifyReportArguments,
  verifyEnduranceReport as verifyEnduranceReportImplementation,
  type VerifyEnduranceReportOptions,
} from "./verify-report";

const TEST_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const TEST_SOURCE_TREE_SHA = "a".repeat(64);
const TEST_RUNTIME_ARTIFACT_SHA = "b".repeat(64);
const TEST_NODE_EXECUTABLE_SHA = digest(readFileSync(process.execPath));
const TEST_PNPM_LOCK_SHA = digest(readFileSync(path.resolve("pnpm-lock.yaml")));
const TEST_POSTGRES_DISTRIBUTION_SHA = "6".repeat(64);
const TEST_POSTGRES_ROOT = path.resolve("test-portable-postgres");

function verifyEnduranceReport(options: VerifyEnduranceReportOptions) {
  return verifyEnduranceReportImplementation(
    {
      ...options,
      expectedCommitSha: options.expectedCommitSha ?? TEST_COMMIT,
      ...(options.expectedMode === "wall_clock"
        ? { expectedRuntime: options.expectedRuntime ?? "native-postgres" }
        : {}),
    },
    {
      verifyBuildAttestation: async (input) => {
        if (
          input.attestation.sourceTreeSha256 !== TEST_SOURCE_TREE_SHA ||
          input.attestation.runtimeArtifactSha256 !== TEST_RUNTIME_ARTIFACT_SHA
        ) {
          throw new Error(
            "Wall-clock build attestation artifact digest mismatch",
          );
        }
      },
      hashPostgresDistribution: async (directory) => ({
        rootPath: path.resolve(directory),
        sha256: TEST_POSTGRES_DISTRIBUTION_SHA,
        fileCount: 6,
        totalBytes: 42,
      }),
    },
  );
}

const browserCheckpointBytes = {
  start: Buffer.from("browser-start-checkpoint", "utf8"),
  end: Buffer.from("browser-end-checkpoint", "utf8"),
};

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

const nativePostgresBinaries = [
  { name: "postgres", sha256: "1".repeat(64) },
  { name: "initdb", sha256: "2".repeat(64) },
  { name: "pg_ctl", sha256: "3".repeat(64) },
  { name: "pg_isready", sha256: "4".repeat(64) },
  { name: "psql", sha256: "5".repeat(64) },
] as const;

function postgresToolchainDigest() {
  return digest(
    nativePostgresBinaries
      .map((binary) => `${binary.name}\0${binary.sha256}\n`)
      .join(""),
  );
}

function primaryEvidence(report: Record<string, any>) {
  const startedAtMs = new Date(String(report.startedAt)).getTime();
  const parsedCompletedAtMs = new Date(String(report.completedAt)).getTime();
  const requiredBuckets = Number(
    report.metrics.requiredHealthSampleBuckets ?? 1_440,
  );
  const completedAtMs = Number.isFinite(parsedCompletedAtMs)
    ? parsedCompletedAtMs
    : startedAtMs + requiredBuckets * 60_000;
  const irreversibleCount = Number(
    report.metrics.irreversibleReceiptSuccessCount ?? 0,
  );
  const records: Array<Record<string, unknown>> = [];
  const append = (
    kind: string,
    occurredAt: string,
    data: Record<string, unknown>,
  ) => {
    records.push({
      schemaVersion: 1,
      runId: String(report.runId),
      sequence: records.length,
      occurredAt,
      kind,
      data,
    });
  };
  let responsibilityIndex = 0;
  for (let cycleNumber = 0; cycleNumber < requiredBuckets; cycleNumber += 1) {
    const completedAt = new Date(
      Math.min(completedAtMs, startedAtMs + (cycleNumber + 1) * 60_000),
    ).toISOString();
    for (let agentId = 1; agentId <= 10; agentId += 1) {
      const taskId = 100 + agentId;
      const receiptId = `receipt-${cycleNumber}-${agentId}`;
      const attemptId = `attempt-${cycleNumber}-${agentId}`;
      const irreversible = responsibilityIndex < irreversibleCount;
      append("receipt_observed", completedAt, {
        receiptId,
        operationKey: `op:v1:${(responsibilityIndex + 1)
          .toString(16)
          .padStart(64, "0")}`,
        irreversible,
        succeeded: true,
        state: "succeeded",
        toolName: "synthetic_fixture_write",
        sideEffectClass: irreversible ? "at_most_once" : "idempotent",
        finishedAt: completedAt,
        originAttempt: {
          id: attemptId,
          taskId,
          agentId,
          cycleNumber,
          state: "succeeded",
          finishedAt: completedAt,
        },
        invocations: [
          {
            id: `invocation-${cycleNumber}-${agentId}`,
            state: "succeeded",
            effectStartedAt: completedAt,
            finishedAt: completedAt,
          },
        ],
      });
      append("responsibility_completed", completedAt, {
        receiptId,
        taskId,
        agentId,
        cycleNumber,
        completedAt,
      });
      responsibilityIndex += 1;
    }
    const minute = cycleNumber + 1;
    append("responsibility_cycle_lag", completedAt, {
      minute,
      lag: 0,
    });
    append("health_observed", completedAt, {
      minute,
      bucketAt: completedAt,
      sampledAt: completedAt,
      reportedState: "healthy",
      truthState: "healthy",
      runtimeTruthState: "live",
      healthyWorkerCount: 2,
      staleWorkerCount: 0,
      schedulerTickAgeMs: 500,
    });
  }
  for (const injection of report.injections as Array<Record<string, any>>) {
    const observedAt = String(injection.observedAt);
    const recoveredAt = String(injection.recoveredAt);
    const incidentId = String(injection.incidentId);
    const sse = injection.kind === "sse_disconnect";
    append("fault_observed", observedAt, {
      faultId: String(injection.id),
      faultKind: String(injection.kind),
      scheduledAt: String(injection.scheduledAt),
      incidentId,
      sourceKind: sse ? "sse_cursor" : "durable_event",
      sourceId: sse
        ? "sse:disconnect:41"
        : `durable:incident:${String(injection.id)}`,
    });
    if (sse) {
      append("sse_disconnected", observedAt, {
        faultId: String(injection.id),
        incidentId,
        cursor: "41",
      });
      append("sse_reconnected", recoveredAt, {
        faultId: String(injection.id),
        incidentId,
        cursor: "42",
      });
    }
    append("fault_recovered", recoveredAt, {
      faultId: String(injection.id),
      faultKind: String(injection.kind),
      scheduledAt: String(injection.scheduledAt),
      incidentId,
      sourceKind: sse ? "sse_cursor" : "durable_event",
      sourceId: sse
        ? "sse:reconnect:42"
        : `durable:recovery:${String(injection.id)}`,
    });
  }
  return records;
}

function validWallClockReport() {
  const startedAt = "2026-09-01T00:00:00.000Z";
  const schedule = createSeededFaultSchedule({
    seed: 240_901,
    durationMs: 24 * 60 * 60 * 1_000,
  });
  return {
    ...createEnduranceReport({
      runId: "wall-clock-test",
      mode: "wall_clock",
      seed: 240_901,
      commitSha: TEST_COMMIT,
      startedAt,
      completedAt: "2026-09-02T00:00:01.000Z",
      wallClockHours: 24.0002,
      simulatedMinutes: 1_440,
      topology: { api: 1, workers: 2, agents: 10, database: "postgres" },
      injections: schedule.map((fault, index) => {
        const scheduledAt = new Date(
          new Date(startedAt).getTime() + fault.atMs,
        );
        return {
          id: fault.id,
          kind: fault.kind,
          scheduledAt: scheduledAt.toISOString(),
          observedAt: new Date(scheduledAt.getTime() + 1_000).toISOString(),
          recoveredAt: new Date(scheduledAt.getTime() + 2_000).toISOString(),
          incidentId: `incident-${index + 1}`,
          pass: true,
        };
      }),
      metrics: {
        expectedResponsibilities: 14_400,
        completedResponsibilities: 14_400,
        maxResponsibilityCycleLag: 0,
        irreversibleReceiptSuccessCount: 12,
        duplicateIrreversibleReceiptKeys: [],
        staleOwnerCommits: 0,
        recoveryDurationsMs: schedule.map(() => 1_000),
        missingIncidentIds: [],
        healthTruthMismatches: [],
        sseReconnectObserved: true,
        healthSampleBuckets: 1_440,
        requiredHealthSampleBuckets: 1_440,
      },
    }),
    provenance: {
      runner: {
        os: "test-os",
        node: process.version,
        postgres: "PostgreSQL 17.6",
        browser: "chromium-test",
      },
      workflowRunId: "workflow-1",
      configuration: {
        runtime: "native-postgres",
        durationHours: 24,
        workers: 2,
        agents: 10,
        database: "postgres",
        seed: 240_901,
        faultProfile: "standard",
      },
      automatedSignOff: {
        status: "passed",
        generatedAt: "2026-09-02T00:00:01.000Z",
      },
      buildAttestation: {
        schemaVersion: 1,
        cleanTree: true,
        nodeVersion: process.version,
        sourceCommitSha: TEST_COMMIT,
        sourceTreeSha256: TEST_SOURCE_TREE_SHA,
        runtime: "native-postgres",
        subject: "native-runtime-artifacts",
        runtimeArtifactSha256: TEST_RUNTIME_ARTIFACT_SHA,
        runtimeArtifactFileCount: 7,
        nativeRuntimeDependencies: [
          {
            name: "@electric-sql/pglite",
            version: "0.5.8",
            path: "artifacts/api-server/dist/node_modules/@electric-sql/pglite",
            sha256: "7".repeat(64),
            fileCount: 4,
          },
          {
            name: "playwright-core",
            version: "1.62.1",
            path: "artifacts/api-server/dist/node_modules/playwright-core",
            sha256: "8".repeat(64),
            fileCount: 4,
          },
        ],
      },
      runtimeAttestation: {
        kind: "native-postgres",
        nodeVersion: process.version,
        postgresVersion: "PostgreSQL 17.6",
        postgresToolchainSha256: postgresToolchainDigest(),
        postgresBinaries: nativePostgresBinaries,
        postgresDistribution: {
          rootPath: TEST_POSTGRES_ROOT,
          startSha256: TEST_POSTGRES_DISTRIBUTION_SHA,
          endSha256: TEST_POSTGRES_DISTRIBUTION_SHA,
          fileCount: 6,
          totalBytes: 42,
        },
        nodeExecutableSha256: TEST_NODE_EXECUTABLE_SHA,
        pnpmLockSha256: TEST_PNPM_LOCK_SHA,
      },
    },
    evidence: {
      browser: {
        startCheckpointSha256: digest(browserCheckpointBytes.start),
        endCheckpointSha256: digest(browserCheckpointBytes.end),
        incidentCorrelations: 1,
        sseReconnectEventIdAdvanced: true,
      },
    },
  };
}

function journal(
  input: {
    runId?: string;
    seed?: number;
    durationHours?: number;
    completedAt?: string;
    faultProfile?: "standard" | "compressed-all";
  } = {},
) {
  const runId = input.runId ?? "wall-clock-test";
  const seed = input.seed ?? 240_901;
  const durationHours = input.durationHours ?? 24;
  const faultProfile = input.faultProfile ?? "standard";
  const startedAt = "2026-09-01T00:00:00.000Z";
  const schedule = createSeededFaultSchedule({
    seed,
    durationMs: Math.round(durationHours * 60 * 60 * 1_000),
    profile: faultProfile,
  });
  return [
    {
      schemaVersion: 1,
      runId,
      sequence: 0,
      occurredAt: startedAt,
      kind: "run_started",
      data: {
        mode: "wall_clock",
        durationHours,
        seed,
        projectId: 1,
        faultProfile,
      },
    },
    ...schedule.map((fault, index) => ({
      schemaVersion: 1,
      runId,
      sequence: index + 1,
      occurredAt: startedAt,
      kind: "fault_scheduled",
      data: {
        faultId: fault.id,
        faultKind: fault.kind,
        scheduledAt: new Date(
          new Date(startedAt).getTime() + fault.atMs,
        ).toISOString(),
      },
    })),
    ...schedule.map((fault, index) => ({
      schemaVersion: 1,
      runId,
      sequence: schedule.length + index + 1,
      occurredAt: new Date(
        new Date(startedAt).getTime() + fault.atMs + 3_000,
      ).toISOString(),
      kind: "fault_observed",
      data: {
        faultId: fault.id,
        faultKind: fault.kind,
        target: `target-${index + 1}`,
      },
    })),
    {
      schemaVersion: 1,
      runId,
      sequence: schedule.length * 2 + 1,
      occurredAt: input.completedAt ?? "2026-09-02T00:00:01.000Z",
      kind: "run_completed",
      data: { pass: true },
    },
  ];
}

function browserSamples(report: Record<string, unknown>) {
  const parsedStartedAt = new Date(String(report.startedAt)).getTime();
  const parsedCompletedAt = new Date(String(report.completedAt)).getTime();
  const startedAt = Number.isFinite(parsedStartedAt) ? parsedStartedAt : 0;
  const completedAt = Number.isFinite(parsedCompletedAt)
    ? parsedCompletedAt
    : startedAt;
  const metrics = report.metrics as {
    requiredHealthSampleBuckets?: unknown;
  };
  const sampleCount = Number(metrics.requiredHealthSampleBuckets ?? 1_440) + 1;
  const injections = Array.isArray(report.injections) ? report.injections : [];
  const sseRecoveryMs = new Date(
    String(
      injections.find(
        (item) =>
          item &&
          typeof item === "object" &&
          (item as Record<string, unknown>).kind === "sse_disconnect",
      ) &&
        (
          injections.find(
            (item) =>
              item &&
              typeof item === "object" &&
              (item as Record<string, unknown>).kind === "sse_disconnect",
          ) as Record<string, unknown>
        ).recoveredAt,
    ),
  ).getTime();
  const samples = Array.from({ length: sampleCount }, (_, index) => ({
    index,
    capturedAt: new Date(
      Math.round(
        startedAt +
          ((completedAt - startedAt) * index) / Math.max(1, sampleCount - 1),
      ),
    ).toISOString(),
    runtimeLabel: "Canlı",
    incidentVisible: index === Math.min(1, sampleCount - 1),
    reconnectCursorAdvanced: false,
    pageErrors: [],
    mismatch: null,
  }));
  const reconnectIndex = samples.findIndex(
    (sample) => new Date(sample.capturedAt).getTime() >= sseRecoveryMs,
  );
  samples[Math.max(0, reconnectIndex)].reconnectCursorAdvanced = true;
  return samples;
}

async function writeBoundReportAndManifest(
  reportPath: string,
  report: Record<string, any>,
  manifest: Record<string, unknown>,
): Promise<void> {
  const manifestBytes = `${JSON.stringify(manifest)}\n`;
  if (report.evidence?.browser) {
    report.evidence.browser.manifestSha256 = digest(manifestBytes);
  }
  const reportBytes = `${JSON.stringify(report, null, 2)}\n`;
  await Promise.all([
    writeFile(reportPath, reportBytes, "utf8"),
    writeFile(`${reportPath}.sha256`, `${digest(reportBytes)}\n`, "utf8"),
    writeFile(`${reportPath}.browser-manifest.json`, manifestBytes, "utf8"),
  ]);
}

async function writeBoundPrimaryEvidence(
  reportPath: string,
  records: Array<Record<string, any>>,
): Promise<void> {
  const primaryBytes = `${records.map((item) => JSON.stringify(item)).join("\n")}\n`;
  await writeFile(`${reportPath}.primary-evidence.jsonl`, primaryBytes, "utf8");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  report.evidence.primaryEvidenceSha256 = digest(primaryBytes);
  const reportBytes = `${JSON.stringify(report, null, 2)}\n`;
  await Promise.all([
    writeFile(reportPath, reportBytes, "utf8"),
    writeFile(`${reportPath}.sha256`, `${digest(reportBytes)}\n`, "utf8"),
  ]);
}

async function writeFixture(
  directory: string,
  report: Record<string, unknown>,
  journalRecords?: ReturnType<typeof journal>,
): Promise<string> {
  const reportPath = path.join(directory, "report.json");
  const records =
    journalRecords ??
    (report.mode === "wall_clock"
      ? journal()
      : [
          {
            schemaVersion: 1,
            runId: String(report.runId),
            sequence: 0,
            occurredAt: String(report.completedAt),
            kind: "run_completed",
            data: { pass: true },
          },
        ]);
  const journalBytes = `${records.map((item) => JSON.stringify(item)).join("\n")}\n`;
  const evidence = (report.evidence ?? {}) as Record<string, unknown>;
  evidence.journalSha256 = digest(journalBytes);
  const primaryRecords =
    report.mode === "wall_clock" ? primaryEvidence(report) : [];
  const primaryBytes = `${primaryRecords
    .map((item) => JSON.stringify(item))
    .join("\n")}${primaryRecords.length > 0 ? "\n" : ""}`;
  if (report.mode === "wall_clock") {
    evidence.primaryEvidenceSha256 = digest(primaryBytes);
  }
  report.evidence = evidence;
  await Promise.all([
    writeFile(path.join(directory, "report.jsonl"), journalBytes, "utf8"),
    ...(report.mode === "wall_clock"
      ? [
          writeFile(
            path.join(directory, "report.json.primary-evidence.jsonl"),
            primaryBytes,
            "utf8",
          ),
        ]
      : []),
  ]);
  if (report.mode === "wall_clock") {
    const runId = String(report.runId);
    const relativeDirectory = `report.json.browser/${runId}`;
    const browserDirectory = path.join(directory, relativeDirectory);
    await mkdir(browserDirectory, { recursive: true });
    const checkpoints = [
      {
        kind: "start",
        path: `${relativeDirectory}/${runId}-000-start.png`,
        sha256: digest(browserCheckpointBytes.start),
        capturedAt: String(report.startedAt),
      },
      {
        kind: "end",
        path: `${relativeDirectory}/${runId}-001-end.png`,
        sha256: digest(browserCheckpointBytes.end),
        capturedAt: String(report.completedAt),
      },
    ];
    const manifest = {
      schemaVersion: 1,
      runId,
      reportFile: path.basename(reportPath),
      checkpoints,
      samples: browserSamples(report),
    };
    await Promise.all([
      writeFile(
        path.join(browserDirectory, `${runId}-000-start.png`),
        browserCheckpointBytes.start,
      ),
      writeFile(
        path.join(browserDirectory, `${runId}-001-end.png`),
        browserCheckpointBytes.end,
      ),
    ]);
    await writeBoundReportAndManifest(reportPath, report, manifest);
  } else {
    const bytes = `${JSON.stringify(report, null, 2)}\n`;
    await Promise.all([
      writeFile(reportPath, bytes, "utf8"),
      writeFile(`${reportPath}.sha256`, `${digest(bytes)}\n`, "utf8"),
    ]);
  }
  return reportPath;
}

test("verifier accepts only a complete wall-clock evidence bundle", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const reportPath = await writeFixture(directory, validWallClockReport());
    const result = await verifyEnduranceReport({
      reportPath,
      expectedMode: "wall_clock",
      expectedCommitSha: TEST_COMMIT,
    });
    assert.equal(result.pass, true);
    assert.equal(result.report.verified24h, true);
    assert.equal(result.journalEvents, 26);
    assert.equal(result.browserSamples, 1_441);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verifier never grants verified24h to the compressed-all smoke profile", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const report = validWallClockReport() as any;
    const startedAtMs = new Date(report.startedAt).getTime();
    const schedule = createSeededFaultSchedule({
      seed: report.seed,
      durationMs: 24 * 60 * 60 * 1_000,
      profile: "compressed-all",
    });
    report.injections = schedule.map((fault, index) => {
      const scheduledAt = new Date(startedAtMs + fault.atMs);
      return {
        id: fault.id,
        kind: fault.kind,
        scheduledAt: scheduledAt.toISOString(),
        observedAt: new Date(scheduledAt.getTime() + 1_000).toISOString(),
        recoveredAt: new Date(scheduledAt.getTime() + 2_000).toISOString(),
        incidentId: `compressed-incident-${index + 1}`,
        pass: true,
      };
    });
    report.metrics.recoveryDurationsMs = schedule.map(() => 1_000);
    report.provenance.configuration.faultProfile = "compressed-all";
    const evaluated = evaluateEnduranceInvariants(report.metrics);
    report.assertions = evaluated.assertions;
    report.pass = evaluated.pass;
    report.verified24h = true;
    const reportPath = await writeFixture(
      directory,
      report,
      journal({ faultProfile: "compressed-all" }),
    );

    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /compressed-all.*verified24h|verified24h.*standard/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("wall-clock verification requires explicit commit and runtime expectations", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const reportPath = await writeFixture(directory, validWallClockReport());
    await assert.rejects(
      verifyEnduranceReportImplementation({
        reportPath,
        expectedMode: "wall_clock",
        expectedRuntime: "native-postgres",
      }),
      /expect-commit|expected commit/iu,
    );
    await assert.rejects(
      verifyEnduranceReportImplementation({
        reportPath,
        expectedMode: "wall_clock",
        expectedCommitSha: TEST_COMMIT,
      }),
      /expect-runtime|expected runtime/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verify-report CLI requires commit and wall-clock runtime expectations", () => {
  assert.throws(
    () =>
      parseVerifyReportArguments([
        "report.json",
        "--expect-mode",
        "wall_clock",
        "--expect-runtime",
        "native-postgres",
      ]),
    /expect-commit/iu,
  );
  assert.throws(
    () =>
      parseVerifyReportArguments([
        "report.json",
        "--expect-mode",
        "wall_clock",
        "--expect-commit",
        TEST_COMMIT,
      ]),
    /expect-runtime/iu,
  );
  assert.deepEqual(
    parseVerifyReportArguments([
      "report.json",
      "--expect-mode",
      "wall_clock",
      "--expect-commit",
      TEST_COMMIT,
      "--expect-runtime",
      "docker-compose",
    ]),
    {
      reportPath: "report.json",
      expectedMode: "wall_clock",
      expectedCommitSha: TEST_COMMIT,
      expectedRuntime: "docker-compose",
      allowUnverifiedDuration: false,
    },
  );
});

test("verifier rejects a build attestation whose artifact digest was forged", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const report = validWallClockReport() as any;
    report.provenance.buildAttestation.runtimeArtifactSha256 = "c".repeat(64);
    const reportPath = await writeFixture(directory, report);
    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /attestation.*artifact.*digest/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const scenario of [
  {
    name: "schema mismatch",
    mutate: (report: any) => {
      report.schemaVersion = 2;
    },
    expected: /schemaVersion/,
  },
  {
    name: "accelerated run labeled verified",
    mutate: (report: any) => {
      report.mode = "accelerated";
      report.verified24h = true;
    },
    expected: /verified24h/,
  },
  {
    name: "duration below 24 hours",
    mutate: (report: any) => {
      report.wallClockHours = 23.99;
      report.verified24h = false;
    },
    expected: /24 wall-clock hours/,
  },
  {
    name: "wrong commit",
    mutate: (report: any) => {
      report.commitSha = "wrong";
    },
    expected: /commit SHA/,
  },
  {
    name: "missing topology",
    mutate: (report: any) => {
      delete report.topology;
    },
    expected: /topology/,
  },
  {
    name: "non-exact topology",
    mutate: (report: any) => {
      report.topology.api = 2;
      report.topology.workers = 3;
    },
    expected: /topology.*one API.*two workers/iu,
  },
  {
    name: "failed assertion",
    mutate: (report: any) => {
      report.assertions[0].pass = false;
      report.pass = false;
      report.verified24h = false;
    },
    expected: /failed assertion/,
  },
  {
    name: "duplicate irreversible receipt",
    mutate: (report: any) => {
      report.metrics.duplicateIrreversibleReceiptKeys = ["effect-1"];
    },
    expected: /duplicate irreversible/,
  },
  {
    name: "stale owner commit",
    mutate: (report: any) => {
      report.metrics.staleOwnerCommits = 1;
    },
    expected: /stale owner/,
  },
  {
    name: "recovery beyond target",
    mutate: (report: any) => {
      report.metrics.recoveryDurationsMs = [120_001];
    },
    expected: /recovery target/,
  },
  {
    name: "missing UI evidence",
    mutate: (report: any) => {
      delete report.evidence;
    },
    expected: /browser evidence/,
  },
  {
    name: "missing completion timestamp",
    mutate: (report: any) => {
      report.completedAt = "";
    },
    expected: /completedAt/,
  },
  {
    name: "sign-off timestamp detached from completion",
    mutate: (report: any) => {
      report.provenance.automatedSignOff.generatedAt =
        "2026-09-02T00:00:02.000Z";
    },
    expected: /sign-off timestamp does not match report completion/,
  },
  {
    name: "missing runtime provenance",
    mutate: (report: any) => {
      delete report.provenance.configuration.runtime;
    },
    expected: /runtime provenance|provenance configuration/,
  },
  {
    name: "configuration seed detached from journal",
    mutate: (report: any) => {
      report.provenance.configuration.seed = 17;
    },
    expected: /configuration.*seed|provenance.*configuration/iu,
  },
  {
    name: "configuration duration detached from journal",
    mutate: (report: any) => {
      report.provenance.configuration.durationHours = 23;
    },
    expected: /configuration.*duration|provenance.*configuration/iu,
  },
  {
    name: "configuration database detached from topology",
    mutate: (report: any) => {
      report.provenance.configuration.database = "sqlite";
    },
    expected: /configuration.*database|provenance.*configuration/iu,
  },
  {
    name: "configuration fault profile detached from journal",
    mutate: (report: any) => {
      report.provenance.configuration.faultProfile = "compressed-all";
    },
    expected: /configuration.*fault profile|provenance.*configuration/iu,
  },
  {
    name: "missing runtime attestation",
    mutate: (report: any) => {
      delete report.provenance.runtimeAttestation;
    },
    expected: /runtime attestation/iu,
  },
  {
    name: "missing native runtime dependency attestation",
    mutate: (report: any) => {
      delete report.provenance.buildAttestation.nativeRuntimeDependencies;
    },
    expected: /native runtime dependency attestation/iu,
  },
  {
    name: "native PostgreSQL major version drift",
    mutate: (report: any) => {
      report.provenance.runner.postgres = "PostgreSQL 16.10";
      report.provenance.runtimeAttestation.postgresVersion = "PostgreSQL 16.10";
    },
    expected: /PostgreSQL 17|runtime attestation.*version/iu,
  },
  {
    name: "native PostgreSQL toolchain digest drift",
    mutate: (report: any) => {
      report.provenance.runtimeAttestation.postgresToolchainSha256 = "8".repeat(
        64,
      );
    },
    expected: /toolchain.*digest|runtime attestation.*digest/iu,
  },
  {
    name: "native Node major version drift",
    mutate: (report: any) => {
      report.provenance.runner.node = "v23.11.0";
      report.provenance.buildAttestation.nodeVersion = "v23.11.0";
      report.provenance.runtimeAttestation.nodeVersion = "v23.11.0";
    },
    expected: /Node(?:\.js)? 24/iu,
  },
  {
    name: "native PostgreSQL distribution changed during the run",
    mutate: (report: any) => {
      report.provenance.runtimeAttestation.postgresDistribution.endSha256 =
        "9".repeat(64);
    },
    expected: /PostgreSQL distribution.*start.*end|distribution.*changed/iu,
  },
  {
    name: "native Node executable digest drift",
    mutate: (report: any) => {
      report.provenance.runtimeAttestation.nodeExecutableSha256 = "8".repeat(
        64,
      );
    },
    expected: /Node executable.*digest|runtime attestation.*Node/iu,
  },
  {
    name: "native pnpm lockfile digest drift",
    mutate: (report: any) => {
      report.provenance.runtimeAttestation.pnpmLockSha256 = "8".repeat(64);
    },
    expected: /pnpm lockfile.*digest|runtime attestation.*lock/iu,
  },
] as const) {
  test(`verifier rejects ${scenario.name}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
    try {
      const report = structuredClone(validWallClockReport()) as any;
      scenario.mutate(report);
      const reportPath = await writeFixture(directory, report);
      await assert.rejects(
        verifyEnduranceReport({
          reportPath,
          expectedMode:
            scenario.name === "accelerated run labeled verified"
              ? "accelerated"
              : "wall_clock",
          expectedCommitSha: TEST_COMMIT,
        }),
        scenario.expected,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("verifier independently rehashes the complete portable PostgreSQL distribution", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-pg-verify-"));
  const postgresRoot = path.join(directory, "portable-postgres");
  const catalog = path.join(postgresRoot, "share", "postgres.bki");
  await Promise.all([
    mkdir(path.join(postgresRoot, "bin"), { recursive: true }),
    mkdir(path.dirname(catalog), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(postgresRoot, "bin", "postgres.exe"), "postgres-v17"),
    writeFile(catalog, "catalog-v1"),
  ]);
  try {
    const distribution = await hashExactDirectoryTree(
      postgresRoot,
      "Test PostgreSQL distribution",
    );
    const report = validWallClockReport() as any;
    report.provenance.runtimeAttestation.postgresDistribution = {
      rootPath: distribution.rootPath,
      startSha256: distribution.sha256,
      endSha256: distribution.sha256,
      fileCount: distribution.fileCount,
      totalBytes: distribution.totalBytes,
    };
    const reportPath = await writeFixture(directory, report);
    const dependencies = {
      verifyBuildAttestation: async () => undefined,
    };
    const options = {
      reportPath,
      expectedMode: "wall_clock" as const,
      expectedCommitSha: TEST_COMMIT,
      expectedRuntime: "native-postgres" as const,
      workspaceRoot: process.cwd(),
    };
    const result = await verifyEnduranceReportImplementation(
      options,
      dependencies,
    );
    assert.equal(result.pass, true);

    await writeFile(catalog, "catalog-tampered");
    await assert.rejects(
      verifyEnduranceReportImplementation(options, dependencies),
      /PostgreSQL distribution.*digest|distribution.*changed/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function validDockerWallClockReport() {
  const report = validWallClockReport() as any;
  const applicationImageId = `sha256:${"9".repeat(64)}`;
  report.provenance.configuration.runtime = "docker-compose";
  report.provenance.buildAttestation.runtime = "docker-compose";
  report.provenance.buildAttestation.subject = "docker-build-context";
  delete report.provenance.buildAttestation.nativeRuntimeDependencies;
  report.provenance.runtimeAttestation = {
    kind: "docker",
    serviceImageIds: {
      app: applicationImageId,
      worker1: applicationImageId,
      worker2: applicationImageId,
      database: `sha256:${"8".repeat(64)}`,
    },
    applicationImageLabels: {
      sourceCommitSha: TEST_COMMIT,
      sourceTreeSha256: TEST_SOURCE_TREE_SHA,
    },
  };
  return report;
}

test("verifier accepts Docker runtime evidence only when exact service image IDs and OCI source labels are bound", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const reportPath = await writeFixture(
      directory,
      validDockerWallClockReport(),
    );
    const result = await verifyEnduranceReport({
      reportPath,
      expectedMode: "wall_clock",
      expectedRuntime: "docker-compose",
    });
    assert.equal(result.pass, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const scenario of [
  {
    name: "Docker worker image identity drift",
    mutate: (report: any) => {
      report.provenance.runtimeAttestation.serviceImageIds.worker2 = `sha256:${"7".repeat(64)}`;
    },
    expected: /Docker service image IDs/iu,
  },
  {
    name: "Docker OCI source label drift",
    mutate: (report: any) => {
      report.provenance.runtimeAttestation.applicationImageLabels.sourceTreeSha256 =
        "7".repeat(64);
    },
    expected: /Docker image labels/iu,
  },
] as const) {
  test(`verifier rejects ${scenario.name}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
    try {
      const report = validDockerWallClockReport();
      scenario.mutate(report);
      const reportPath = await writeFixture(directory, report);
      await assert.rejects(
        verifyEnduranceReport({
          reportPath,
          expectedMode: "wall_clock",
          expectedRuntime: "docker-compose",
        }),
        scenario.expected,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("verifier rejects a truncated journal and a mismatched sidecar", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const reportPath = await writeFixture(directory, validWallClockReport(), [
      journal().at(-1)!,
    ]);
    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /journal sequence/,
    );

    await writeFixture(directory, validWallClockReport());
    await writeFile(`${reportPath}.sha256`, `${"0".repeat(64)}\n`, "utf8");
    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /SHA-256/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verifier rejects structurally valid journal bytes that no longer match the report", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const reportPath = await writeFixture(directory, validWallClockReport());
    const journalPath = path.join(directory, "report.jsonl");
    const records = (await readFile(journalPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    records.at(-1).data = { pass: false };
    await writeFile(
      journalPath,
      `${records.map((item) => JSON.stringify(item)).join("\n")}\n`,
      "utf8",
    );

    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /journal SHA-256/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verifier requires hash-bound primary endurance evidence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const reportPath = await writeFixture(directory, validWallClockReport());
    await rm(`${reportPath}.primary-evidence.jsonl`);
    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /primary evidence/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const scenario of [
  {
    name: "duplicate agent-cycle responsibility primary evidence",
    mutate: (records: any[]) => {
      const responsibilities = records.filter(
        (item) => item.kind === "responsibility_completed",
      );
      responsibilities[1].data = structuredClone(responsibilities[0].data);
    },
    expected: /primary evidence.*duplicate|duplicate.*agent-cycle/iu,
  },
  {
    name: "duplicate irreversible operation key primary evidence",
    mutate: (records: any[]) => {
      const receipts = records.filter(
        (item) => item.kind === "receipt_observed" && item.data.irreversible,
      );
      receipts[1].data.operationKey = receipts[0].data.operationKey;
    },
    expected: /primary evidence.*duplicate.*receipt|duplicate.*operation/iu,
  },
  {
    name: "non-canonical operation key primary evidence",
    mutate: (records: any[]) => {
      records.find(
        (item) => item.kind === "receipt_observed",
      ).data.operationKey = "operation-not-canonical";
    },
    expected: /operation key.*canonical|canonical.*operation key/iu,
  },
  {
    name: "stale-owner commit primary evidence",
    mutate: (records: any[]) => {
      const receipt = records.find((item) => item.kind === "receipt_observed");
      receipt.data.originAttempt.state = "lost";
      receipt.data.originAttempt.finishedAt = new Date(
        new Date(receipt.data.finishedAt).getTime() - 1_000,
      ).toISOString();
    },
    expected: /primary evidence.*stale owner|stale owner.*primary evidence/iu,
  },
  {
    name: "cycle-lag primary evidence",
    mutate: (records: any[]) => {
      records.find(
        (item) => item.kind === "responsibility_cycle_lag",
      ).data.lag = 3;
    },
    expected: /primary evidence.*cycle lag|cycle lag.*primary evidence/iu,
  },
  {
    name: "raw health fields that contradict the claimed healthy truth",
    mutate: (records: any[]) => {
      records.find(
        (item) => item.kind === "health_observed",
      ).data.healthyWorkerCount = 1;
    },
    expected: /primary evidence.*health|health.*primary evidence/iu,
  },
  {
    name: "a third healthy scheduler worker hidden behind healthy truth",
    mutate: (records: any[]) => {
      records.find(
        (item) => item.kind === "health_observed",
      ).data.healthyWorkerCount = 3;
    },
    expected: /exactly two.*worker|worker.*exactly two/iu,
  },
] as const) {
  test(`verifier rejects ${scenario.name} even after all outer hashes are rebound`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
    try {
      const reportPath = await writeFixture(directory, validWallClockReport());
      const primaryPath = `${reportPath}.primary-evidence.jsonl`;
      const primaryRecords = (await readFile(primaryPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      scenario.mutate(primaryRecords);
      const primaryBytes = `${primaryRecords
        .map((item) => JSON.stringify(item))
        .join("\n")}\n`;
      await writeFile(primaryPath, primaryBytes, "utf8");
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      report.evidence.primaryEvidenceSha256 = digest(primaryBytes);
      const reportBytes = `${JSON.stringify(report, null, 2)}\n`;
      await Promise.all([
        writeFile(reportPath, reportBytes, "utf8"),
        writeFile(`${reportPath}.sha256`, `${digest(reportBytes)}\n`, "utf8"),
      ]);
      await assert.rejects(
        verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
        scenario.expected,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("verifier independently recomputes responsibility cycle lag from ordered agent-cycle evidence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const reportPath = await writeFixture(directory, validWallClockReport());
    const primaryPath = `${reportPath}.primary-evidence.jsonl`;
    const primaryRecords = (await readFile(primaryPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    primaryRecords.find(
      (item) => item.kind === "responsibility_cycle_lag",
    ).data.lag = 2;
    const primaryBytes = `${primaryRecords
      .map((item) => JSON.stringify(item))
      .join("\n")}\n`;
    await writeFile(primaryPath, primaryBytes, "utf8");

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    report.metrics.maxResponsibilityCycleLag = 2;
    const evaluated = evaluateEnduranceInvariants(report.metrics);
    report.assertions = evaluated.assertions;
    report.pass = evaluated.pass;
    report.evidence.primaryEvidenceSha256 = digest(primaryBytes);
    const reportBytes = `${JSON.stringify(report, null, 2)}\n`;
    await Promise.all([
      writeFile(reportPath, reportBytes, "utf8"),
      writeFile(`${reportPath}.sha256`, `${digest(reportBytes)}\n`, "utf8"),
    ]);

    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /primary evidence.*cycle lag|cycle lag.*primary evidence/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verifier rejects a future agent cycle observed before its missing predecessor", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const reportPath = await writeFixture(directory, validWallClockReport());
    const primaryRecords = (
      await readFile(`${reportPath}.primary-evidence.jsonl`, "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const findIndex = (kind: string, cycleNumber: number) =>
      primaryRecords.findIndex(
        (item) =>
          item.kind === kind &&
          (kind === "receipt_observed"
            ? item.data.originAttempt?.agentId === 1 &&
              item.data.originAttempt?.cycleNumber === cycleNumber
            : item.data.agentId === 1 && item.data.cycleNumber === cycleNumber),
      );
    const cycleZero = [
      findIndex("receipt_observed", 0),
      findIndex("responsibility_completed", 0),
    ];
    const cycleOne = [
      findIndex("receipt_observed", 1),
      findIndex("responsibility_completed", 1),
    ];
    assert.equal(
      [...cycleZero, ...cycleOne].every((index) => index >= 0),
      true,
    );
    const zeroPair = cycleZero.map((index) => primaryRecords[index]);
    const onePair = cycleOne.map((index) => primaryRecords[index]);
    [primaryRecords[cycleZero[0]], primaryRecords[cycleZero[1]]] = onePair;
    [primaryRecords[cycleOne[0]], primaryRecords[cycleOne[1]]] = zeroPair;
    const retimePair = (pair: any[], timestamp: string) => {
      const receipt = pair.find((item) => item.kind === "receipt_observed");
      const responsibility = pair.find(
        (item) => item.kind === "responsibility_completed",
      );
      receipt.occurredAt = timestamp;
      receipt.data.finishedAt = timestamp;
      receipt.data.originAttempt.finishedAt = timestamp;
      receipt.data.invocations[0].effectStartedAt = timestamp;
      receipt.data.invocations[0].finishedAt = timestamp;
      responsibility.occurredAt = timestamp;
      responsibility.data.completedAt = timestamp;
    };
    retimePair(onePair, "2026-09-01T00:01:00.000Z");
    retimePair(zeroPair, "2026-09-01T00:02:00.000Z");
    primaryRecords.forEach((item, index) => {
      item.sequence = index;
    });
    await writeBoundPrimaryEvidence(reportPath, primaryRecords);

    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /contiguous|predecessor|agent cycle|cycle order/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verifier rejects an unreferenced successful irreversible receipt even when aggregates are rebound", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const reportPath = await writeFixture(directory, validWallClockReport());
    const primaryPath = `${reportPath}.primary-evidence.jsonl`;
    const primaryRecords = (await readFile(primaryPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const occurredAt = "2026-09-02T00:00:01.000Z";
    primaryRecords.push({
      schemaVersion: 1,
      runId: "wall-clock-test",
      sequence: primaryRecords.length,
      occurredAt,
      kind: "receipt_observed",
      data: {
        receiptId: "receipt-unreferenced-irreversible",
        operationKey: `op:v1:${"f".repeat(64)}`,
        irreversible: true,
        succeeded: true,
        state: "succeeded",
        toolName: "irreversible_fixture_write",
        sideEffectClass: "at_most_once",
        finishedAt: occurredAt,
        originAttempt: {
          id: "attempt-unreferenced-irreversible",
          taskId: 101,
          agentId: 1,
          cycleNumber: 0,
          state: "succeeded",
          finishedAt: occurredAt,
        },
        invocations: [
          {
            id: "invocation-unreferenced-irreversible",
            state: "succeeded",
            effectStartedAt: occurredAt,
            finishedAt: occurredAt,
          },
        ],
      },
    });
    const primaryBytes = `${primaryRecords
      .map((item) => JSON.stringify(item))
      .join("\n")}\n`;
    await writeFile(primaryPath, primaryBytes, "utf8");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    report.metrics.irreversibleReceiptSuccessCount += 1;
    const evaluated = evaluateEnduranceInvariants(report.metrics);
    report.assertions = evaluated.assertions;
    report.pass = evaluated.pass;
    report.evidence.primaryEvidenceSha256 = digest(primaryBytes);
    const reportBytes = `${JSON.stringify(report, null, 2)}\n`;
    await Promise.all([
      writeFile(reportPath, reportBytes, "utf8"),
      writeFile(`${reportPath}.sha256`, `${digest(reportBytes)}\n`, "utf8"),
    ]);

    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /irreversible.*responsibility|unreferenced.*irreversible/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const scenario of [
  {
    name: "out-of-order receipt and responsibility primary evidence",
    mutate: (records: any[]) => {
      const receiptIndex = records.findIndex(
        (item) => item.kind === "receipt_observed",
      );
      const responsibilityIndex = records.findIndex(
        (item) => item.kind === "responsibility_completed",
      );
      [records[receiptIndex], records[responsibilityIndex]] = [
        records[responsibilityIndex],
        records[receiptIndex],
      ];
      records.forEach((item, index) => {
        item.sequence = index;
      });
    },
    expected: /responsibility.*bound|out.of.order|ordered/iu,
  },
  {
    name: "extra health primary evidence",
    mutate: (records: any[]) => {
      const last = [...records]
        .reverse()
        .find((item: any) => item.kind === "health_observed");
      const occurredAt = "2026-09-02T00:00:01.000Z";
      records.push({
        ...structuredClone(last),
        sequence: records.length,
        occurredAt,
        data: {
          ...structuredClone(last.data),
          minute: Number(last.data.minute) + 1,
          bucketAt: "2026-09-02T00:00:00.000Z",
          sampledAt: occurredAt,
        },
      });
    },
    expected:
      /health.*coverage|extra.*health|health.*out.of.order|health.*cadence/iu,
  },
  {
    name: "extra lag primary evidence",
    mutate: (records: any[]) => {
      const lag = [...records]
        .reverse()
        .find((item: any) => item.kind === "responsibility_cycle_lag");
      records.push({
        ...structuredClone(lag),
        sequence: records.length,
      });
    },
    expected: /cycle lag.*duplicate|cycle lag.*out.of.order|extra.*lag/iu,
  },
  {
    name: "extra SSE primary evidence",
    mutate: (records: any[]) => {
      const reconnect = records.find((item) => item.kind === "sse_reconnected");
      records.push({
        ...structuredClone(reconnect),
        sequence: records.length,
      });
    },
    expected: /extra.*SSE|SSE.*extra/iu,
  },
  {
    name: "missing primary fault recovery evidence",
    mutate: (records: any[]) => {
      const recoveryIndex = records.findIndex(
        (item) => item.kind === "fault_recovered",
      );
      records.splice(recoveryIndex, 1);
      records.forEach((item, index) => {
        item.sequence = index;
      });
    },
    expected: /fault recovery.*missing|missing.*fault recovery|fault pair/iu,
  },
  {
    name: "fault evidence with no durable source identity",
    mutate: (records: any[]) => {
      records.find((item) => item.kind === "fault_observed").data.sourceId = "";
    },
    expected: /fault.*source|source.*fault|durable source/iu,
  },
  {
    name: "extra duplicate primary fault evidence pair",
    mutate: (records: any[]) => {
      const observed = structuredClone(
        records.find((item) => item.kind === "fault_observed"),
      );
      const recovered = structuredClone(
        records.find(
          (item) =>
            item.kind === "fault_recovered" &&
            item.data.faultId === observed.data.faultId,
        ),
      );
      records.push(observed, recovered);
      records.forEach((item, index) => {
        item.sequence = index;
      });
    },
    expected:
      /extra.*fault|duplicate.*fault|fault.*schedule|fault.*source identity/iu,
  },
  {
    name: "SSE cursor rows correlated to a non-SSE fault",
    mutate: (records: any[]) => {
      const wrongFault = records.find(
        (item) =>
          item.kind === "fault_observed" &&
          item.data.faultKind !== "sse_disconnect",
      );
      for (const item of records.filter(
        (record) =>
          record.kind === "sse_disconnected" ||
          record.kind === "sse_reconnected",
      )) {
        item.data.faultId = wrongFault.data.faultId;
        item.data.incidentId = wrongFault.data.incidentId;
      }
    },
    expected: /SSE.*fault|SSE.*correlation|cursor.*scheduled/iu,
  },
  {
    name: "extra unrelated receipt primary evidence",
    mutate: (records: any[]) => {
      const occurredAt = "2026-09-02T00:00:01.000Z";
      records.push({
        schemaVersion: 1,
        runId: "wall-clock-test",
        sequence: records.length,
        occurredAt,
        kind: "receipt_observed",
        data: {
          receiptId: "receipt-unrelated-extra",
          operationKey: `op:v1:${"e".repeat(64)}`,
          irreversible: false,
          succeeded: true,
          state: "succeeded",
          toolName: "unrelated_tool",
          sideEffectClass: "idempotent",
          finishedAt: occurredAt,
          originAttempt: null,
          invocations: [
            {
              id: "invocation-unrelated-extra",
              state: "succeeded",
              effectStartedAt: occurredAt,
              finishedAt: occurredAt,
            },
          ],
        },
      });
    },
    expected: /extra.*unrelated receipt|unrelated receipt/iu,
  },
] as const) {
  test(`verifier rejects ${scenario.name} after semantic records are renumbered and rebound`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
    try {
      const reportPath = await writeFixture(directory, validWallClockReport());
      const primaryRecords = (
        await readFile(`${reportPath}.primary-evidence.jsonl`, "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      scenario.mutate(primaryRecords);
      await writeBoundPrimaryEvidence(reportPath, primaryRecords);
      await assert.rejects(
        verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
        scenario.expected,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

for (const scenario of [
  { name: "fresh healthy runtime", patch: {}, accepted: true },
  { name: "degraded runtime", patch: { state: "degraded" }, accepted: false },
  {
    name: "one healthy worker",
    patch: { healthyWorkerCount: 1 },
    accepted: false,
  },
  {
    name: "stale scheduler",
    patch: { schedulerTickAgeMs: 5_001 },
    accepted: false,
  },
  {
    name: "missing scheduler tick",
    patch: { schedulerTickAgeMs: null },
    accepted: false,
  },
  {
    name: "ephemeral database",
    patch: { databaseBackend: "pglite" },
    accepted: false,
  },
  { name: "non-durable runtime", patch: { durable: false }, accepted: false },
  {
    name: "mismatched observation time",
    patch: { generatedAt: "2026-09-01T00:00:00.000Z" },
    accepted: false,
  },
  {
    name: "mismatched source cursor",
    patch: { cursor: "999" },
    accepted: false,
  },
]) {
  test(`database recovery verification: ${scenario.name}`, async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "agentic-db-recovery-verify-"),
    );
    try {
      const reportPath = await writeFixture(directory, validWallClockReport());
      const records = (
        await readFile(`${reportPath}.primary-evidence.jsonl`, "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const recovery = records.find(
        (event) =>
          event.kind === "fault_recovered" &&
          event.data.faultKind === "database_unavailable",
      );
      assert.ok(recovery);
      recovery.data.sourceKind = "runtime_snapshot";
      recovery.data.sourceId = `operations-runtime:123:${recovery.occurredAt}`;
      recovery.data.runtimeEvidence = {
        generatedAt: recovery.occurredAt,
        cursor: "123",
        state: "live",
        databaseBackend: "postgresql",
        durable: true,
        healthyWorkerCount: 2,
        staleWorkerCount: 0,
        schedulerTickAgeMs: 1_000,
        ...scenario.patch,
      };
      await writeBoundPrimaryEvidence(reportPath, records);
      if (scenario.accepted) {
        await verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" });
      } else {
        await assert.rejects(
          verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
          /runtime recovery/iu,
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("verifier requires the browser manifest and rejects modified checkpoint bytes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const reportPath = await writeFixture(directory, validWallClockReport());
    const manifestPath = `${reportPath}.browser-manifest.json`;
    const manifestBytes = await readFile(manifestPath);
    await rm(manifestPath);
    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /browser manifest/iu,
    );

    await writeFile(manifestPath, manifestBytes);
    await writeFile(
      path.join(
        directory,
        "report.json.browser",
        "wall-clock-test",
        "wall-clock-test-001-end.png",
      ),
      "tampered",
      "utf8",
    );
    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /checkpoint SHA-256/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const scenario of [
  {
    name: "missing semantic samples",
    mutate: (manifest: any) => {
      delete manifest.samples;
    },
    expected: /browser manifest samples/iu,
  },
  {
    name: "truncated semantic samples",
    mutate: (manifest: any) => {
      manifest.samples.pop();
    },
    expected: /browser sample count/iu,
  },
  {
    name: "tampered semantic sample",
    mutate: (manifest: any) => {
      manifest.samples[0].pageErrors = ["hidden page error"];
    },
    expected: /browser sample.*page error/iu,
  },
  {
    name: "browser reconnect evidence detached from the SSE recovery window",
    mutate: (manifest: any) => {
      for (const sample of manifest.samples) {
        sample.reconnectCursorAdvanced = false;
      }
      manifest.samples.at(-1).reconnectCursorAdvanced = true;
    },
    expected: /browser SSE reconnect.*recovery window/iu,
  },
  {
    name: "browser samples collapsed into one timestamp",
    mutate: (manifest: any) => {
      for (const sample of manifest.samples) {
        sample.capturedAt = "2026-09-01T00:00:00.000Z";
      }
    },
    expected: /browser sample.*cadence|browser sample.*span/iu,
  },
  {
    name: "browser samples with a ten-minute blind gap",
    mutate: (manifest: any) => {
      const startedAt = new Date(manifest.samples[0].capturedAt).getTime();
      const completedAt = new Date(
        manifest.samples.at(-1).capturedAt,
      ).getTime();
      const blindGapMs = 10 * 60_000;
      for (let index = 1; index < manifest.samples.length; index += 1) {
        manifest.samples[index].capturedAt = new Date(
          Math.round(
            startedAt +
              blindGapMs +
              ((completedAt - startedAt - blindGapMs) * (index - 1)) /
                Math.max(1, manifest.samples.length - 2),
          ),
        ).toISOString();
      }
    },
    expected: /browser sample.*cadence.*long|browser sample.*gap/iu,
  },
  {
    name: "browser samples with one-hundred-second edge blind windows",
    mutate: (manifest: any) => {
      const startedAt = new Date(manifest.samples[0].capturedAt).getTime();
      const completedAt = new Date(
        manifest.samples.at(-1).capturedAt,
      ).getTime();
      const firstAt = startedAt + 100_000;
      const lastAt = completedAt - 100_000;
      for (let index = 0; index < manifest.samples.length; index += 1) {
        manifest.samples[index].capturedAt = new Date(
          Math.round(
            firstAt +
              ((lastAt - firstAt) * index) /
                Math.max(1, manifest.samples.length - 1),
          ),
        ).toISOString();
      }
    },
    expected:
      /browser sample.*span|browser sample.*blind|browser sample.*edge/iu,
  },
] as const) {
  test(`verifier rejects ${scenario.name}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
    try {
      const report = validWallClockReport() as any;
      const reportPath = await writeFixture(directory, report);
      const manifest = JSON.parse(
        await readFile(`${reportPath}.browser-manifest.json`, "utf8"),
      );
      scenario.mutate(manifest);
      await writeBoundReportAndManifest(reportPath, report, manifest);
      await assert.rejects(
        verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
        scenario.expected,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("verifier rejects a browser evidence parent redirected through a symlink", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  const externalDirectory = await mkdtemp(
    path.join(tmpdir(), "agentic-os-browser-external-"),
  );
  try {
    const reportPath = await writeFixture(directory, validWallClockReport());
    const browserParent = path.join(directory, "report.json.browser");
    const redirectedParent = path.join(
      externalDirectory,
      "report.json.browser",
    );
    await rename(browserParent, redirectedParent);
    try {
      await symlink(
        redirectedParent,
        browserParent,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["EPERM", "EACCES", "ENOTSUP"].includes(String(error.code))
      ) {
        context.skip(`symlink creation is unavailable: ${String(error.code)}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /browser evidence root/iu,
    );
  } finally {
    await Promise.all([
      rm(directory, { recursive: true, force: true }),
      rm(externalDirectory, { recursive: true, force: true }),
    ]);
  }
});

test("accelerated evidence is accepted but can never count as verified24h", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const accelerated = validWallClockReport() as any;
    accelerated.mode = "accelerated";
    accelerated.wallClockHours = 0;
    accelerated.verified24h = false;
    delete accelerated.evidence;
    const reportPath = await writeFixture(directory, accelerated);
    const result = await verifyEnduranceReport({
      reportPath,
      expectedMode: "accelerated",
      expectedCommitSha: TEST_COMMIT,
    });
    assert.equal(result.pass, true);
    assert.equal(result.report.verified24h, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("explicit short wall-clock smoke verifies its proportional bucket contract without claiming 24h", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const report = validWallClockReport() as any;
    report.completedAt = "2026-09-01T00:05:00.000Z";
    report.wallClockHours = 5 / 60;
    report.verified24h = false;
    report.metrics.expectedResponsibilities = 50;
    report.metrics.completedResponsibilities = 50;
    report.metrics.healthSampleBuckets = 5;
    report.metrics.requiredHealthSampleBuckets = 5;
    const evaluated = evaluateEnduranceInvariants(report.metrics);
    report.assertions = evaluated.assertions;
    report.pass = evaluated.pass;
    report.provenance.automatedSignOff.generatedAt = report.completedAt;
    const shortJournal = journal({
      durationHours: 5 / 60,
      completedAt: report.completedAt,
    });
    report.injections = shortJournal
      .filter((event) => event.kind === "fault_scheduled")
      .map((event, index) => {
        const data = event.data as {
          faultId: string;
          faultKind: string;
          scheduledAt: string;
        };
        return {
          id: data.faultId,
          kind: data.faultKind,
          scheduledAt: data.scheduledAt,
          observedAt: new Date(
            new Date(data.scheduledAt).getTime() + 1_000,
          ).toISOString(),
          recoveredAt: new Date(
            new Date(data.scheduledAt).getTime() + 2_000,
          ).toISOString(),
          incidentId: `incident-short-${index + 1}`,
          pass: true,
        };
      });
    report.metrics.recoveryDurationsMs = report.injections.map(() => 1_000);
    report.provenance.configuration.durationHours = 5 / 60;
    const shortEvaluated = evaluateEnduranceInvariants(report.metrics);
    report.assertions = shortEvaluated.assertions;
    report.pass = shortEvaluated.pass;
    const reportPath = await writeFixture(directory, report, shortJournal);
    const result = await verifyEnduranceReport({
      reportPath,
      expectedMode: "wall_clock",
      allowUnverifiedDuration: true,
    });
    assert.equal(result.pass, true);
    assert.equal(result.report.verified24h, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verifier derives the browser sample contract from requested duration, not mutable report metrics", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const report = validWallClockReport() as any;
    report.metrics.requiredHealthSampleBuckets = 1;
    const evaluated = evaluateEnduranceInvariants(report.metrics);
    report.assertions = evaluated.assertions;
    report.pass = evaluated.pass;
    const reportPath = await writeFixture(directory, report);

    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /browser sample count|requested duration/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const scenario of [
  {
    name: "a missing scheduled fault",
    mutate: (report: any, records: ReturnType<typeof journal>) => {
      const faultIndex = records.findIndex(
        (event) => event.kind === "fault_scheduled",
      );
      records.splice(faultIndex, 1);
      records.forEach((event, index) => {
        event.sequence = index;
      });
    },
  },
  {
    name: "an extra duplicate scheduled fault",
    mutate: (_report: any, records: ReturnType<typeof journal>) => {
      const faultIndex = records.findIndex(
        (event) => event.kind === "fault_scheduled",
      );
      records.splice(faultIndex + 1, 0, structuredClone(records[faultIndex]));
      records.forEach((event, index) => {
        event.sequence = index;
      });
    },
  },
  {
    name: "reordered scheduled faults",
    mutate: (_report: any, records: ReturnType<typeof journal>) => {
      const faultIndexes = records
        .map((event, index) => (event.kind === "fault_scheduled" ? index : -1))
        .filter((index) => index >= 0);
      [records[faultIndexes[0]], records[faultIndexes[1]]] = [
        records[faultIndexes[1]],
        records[faultIndexes[0]],
      ];
      records.forEach((event, index) => {
        event.sequence = index;
      });
    },
  },
  {
    name: "a report injection with the wrong identity",
    mutate: (report: any) => {
      report.injections[0].id = "substituted-fault";
    },
  },
  {
    name: "reordered report injections",
    mutate: (report: any) => {
      [report.injections[0], report.injections[1]] = [
        report.injections[1],
        report.injections[0],
      ];
    },
  },
] as const) {
  test(`verifier rejects ${scenario.name}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
    try {
      const report = validWallClockReport() as any;
      const records = journal();
      scenario.mutate(report, records);
      const reportPath = await writeFixture(directory, report, records);
      await assert.rejects(
        verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
        /fault schedule|scheduled fault|injection/iu,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

for (const scenario of [
  {
    name: "an injection without a passing observation",
    mutate: (report: any) => {
      report.injections[0].pass = false;
    },
    expected: /injection.*pass|injection.*observation/iu,
  },
  {
    name: "an injection without a durable incident",
    mutate: (report: any) => {
      report.injections[0].incidentId = null;
    },
    expected: /injection.*incident/iu,
  },
  {
    name: "zero responsibilities disguised as complete",
    mutate: (report: any) => {
      report.metrics.expectedResponsibilities = 0;
      report.metrics.completedResponsibilities = 0;
      const evaluated = evaluateEnduranceInvariants(report.metrics);
      report.assertions = evaluated.assertions;
      report.pass = evaluated.pass;
    },
    expected: /expected responsibilities|responsibility contract/iu,
  },
  {
    name: "self-authored assertions that disagree with metrics",
    mutate: (report: any) => {
      report.assertions[0].actual = "forged";
    },
    expected: /assertions.*metrics|assertion.*recomputed/iu,
  },
  {
    name: "a forged zero irreversible receipt success count",
    mutate: (report: any) => {
      report.metrics.irreversibleReceiptSuccessCount = 0;
    },
    expected: /assertions.*metrics|assertion.*recomputed/iu,
  },
  {
    name: "an out-of-contract responsibility cycle lag",
    mutate: (report: any) => {
      report.metrics.maxResponsibilityCycleLag = 3;
    },
    expected: /assertions.*metrics|assertion.*recomputed/iu,
  },
] as const) {
  test(`verifier rejects ${scenario.name}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
    try {
      const report = validWallClockReport() as any;
      scenario.mutate(report);
      const reportPath = await writeFixture(directory, report);
      await assert.rejects(
        verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
        scenario.expected,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("verifier rejects a deterministic fault without its observed journal event", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const records = journal();
    const observedIndex = records.findIndex(
      (event) => event.kind === "fault_observed",
    );
    records.splice(observedIndex, 1);
    records.forEach((event, index) => {
      event.sequence = index;
    });
    const reportPath = await writeFixture(
      directory,
      validWallClockReport(),
      records,
    );
    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /fault observed|fault_observed/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verifier rejects fault evidence produced hours after its deterministic window", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const report = validWallClockReport() as any;
    const records = journal();
    report.injections[0].observedAt = "2026-09-01T23:59:55.000Z";
    report.injections[0].recoveredAt = "2026-09-01T23:59:56.000Z";
    const observed = records.find(
      (event) =>
        event.kind === "fault_observed" &&
        (event.data as { faultId?: unknown }).faultId ===
          report.injections[0].id,
    );
    assert.ok(observed);
    observed.occurredAt = "2026-09-01T23:59:57.000Z";
    const reportPath = await writeFixture(directory, report, records);
    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /fault.*evidence window|observation.*window|recovery.*window/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verifier rejects a journal fault observation outside its evidence window", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const report = validWallClockReport() as any;
    const records = journal();
    const observed = records.find(
      (event) =>
        event.kind === "fault_observed" &&
        (event.data as { faultId?: unknown }).faultId ===
          report.injections[0].id,
    );
    assert.ok(observed);
    observed.occurredAt = "2026-09-01T23:59:57.000Z";
    const reportPath = await writeFixture(directory, report, records);
    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /fault_observed.*window|fault.*evidence window/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verifier binds recoveryDurationsMs exactly to ordered injection timestamps", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const report = validWallClockReport() as any;
    report.metrics.recoveryDurationsMs = report.injections.map(
      (_injection: unknown, index: number) => (index === 0 ? 2_000 : 1_000),
    );
    const recomputed = evaluateEnduranceInvariants(report.metrics);
    report.assertions = recomputed.assertions;
    report.pass = recomputed.pass;
    const reportPath = await writeFixture(directory, report);
    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /recovery durations.*injection|injection.*recovery durations/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verifier binds report injection timestamps to independent primary fault rows", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const reportPath = await writeFixture(directory, validWallClockReport());
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const scheduledAtMs = new Date(report.injections[0].scheduledAt).getTime();
    report.injections[0].observedAt = new Date(
      scheduledAtMs + 2_000,
    ).toISOString();
    report.injections[0].recoveredAt = new Date(
      scheduledAtMs + 3_000,
    ).toISOString();
    const reportBytes = `${JSON.stringify(report, null, 2)}\n`;
    await Promise.all([
      writeFile(reportPath, reportBytes, "utf8"),
      writeFile(`${reportPath}.sha256`, `${digest(reportBytes)}\n`, "utf8"),
    ]);

    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /primary fault.*schedule|primary fault observation/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verifier permits degraded health only through the five-second recovery polling tolerance", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const reportPath = await writeFixture(directory, validWallClockReport());
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const primaryRecords = (
      await readFile(`${reportPath}.primary-evidence.jsonl`, "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const disruptive = new Set([
      "worker_loss",
      "database_unavailable",
      "emergency_stop",
    ]);
    const target = report.injections
      .filter((injection: any) => disruptive.has(injection.kind))
      .map((injection: any) => ({
        injection,
        health: primaryRecords.find((record) => {
          if (record.kind !== "health_observed") return false;
          const delta =
            new Date(record.data.sampledAt).getTime() -
            new Date(injection.recoveredAt).getTime();
          return delta > 5_000 && delta <= 120_000;
        }),
      }))
      .find((item: any) => item.health);
    assert.ok(target?.health);
    Object.assign(target.health.data, {
      reportedState: "degraded",
      truthState: "degraded",
      runtimeTruthState: "degraded",
      healthyWorkerCount: 1,
    });
    await writeBoundPrimaryEvidence(reportPath, primaryRecords);

    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /primary evidence.*health|health truth.*primary/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verifier accepts independently completed fault pairs while retaining schedule order", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const records = journal();
    const positions = records.flatMap((event, index) =>
      event.kind === "fault_observed" ? [index] : [],
    );
    [records[positions[0]], records[positions[1]]] = [
      records[positions[1]],
      records[positions[0]],
    ];
    records.forEach((event, index) => {
      event.sequence = index;
    });
    const reportPath = await writeFixture(
      directory,
      validWallClockReport(),
      records,
    );
    const primaryPath = `${reportPath}.primary-evidence.jsonl`;
    const primaryRecords = (await readFile(primaryPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    for (const kind of ["fault_observed", "fault_recovered"]) {
      const indices = primaryRecords.flatMap((event, index) =>
        event.kind === kind ? [index] : [],
      );
      [primaryRecords[indices[0]], primaryRecords[indices[1]]] = [
        primaryRecords[indices[1]],
        primaryRecords[indices[0]],
      ];
    }
    primaryRecords.forEach((event, index) => {
      event.sequence = index;
    });
    await writeBoundPrimaryEvidence(reportPath, primaryRecords);
    await verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verifier rejects duplicated observation identity even with unchanged row count", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-verify-"));
  try {
    const records = journal();
    const observations = records.filter(
      (event) => event.kind === "fault_observed",
    );
    observations[1].data = structuredClone(observations[0].data);
    const reportPath = await writeFixture(
      directory,
      validWallClockReport(),
      records,
    );
    await assert.rejects(
      verifyEnduranceReport({ reportPath, expectedMode: "wall_clock" }),
      /fault_observed.*duplicated/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const delayMs of [120000, 121000]) {
  test(`completed-minute health evidence validates the sampler age ${delayMs}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agentic-health-age-"));
    try {
      const reportPath = await writeFixture(directory, validWallClockReport());
      const records = (
        await readFile(`${reportPath}.primary-evidence.jsonl`, "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      for (const row of records.filter((row) => row.kind === "health_observed"))
        row.data.bucketAt = new Date(
          new Date(row.data.sampledAt).getTime() - delayMs,
        ).toISOString();
      await writeBoundPrimaryEvidence(reportPath, records);
      const verification = verifyEnduranceReport({
        reportPath,
        expectedMode: "wall_clock",
      });
      if (delayMs === 120000) await verification;
      else await assert.rejects(verification, /health sample time/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
