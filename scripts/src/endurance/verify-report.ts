import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifyWallClockBuildAttestation } from "./build-attestation";
import { createSeededFaultSchedule } from "./fault-injector";
import {
  validateAndRecomputePrimaryEvidence,
  type ExpectedPrimaryFaultEvidence,
} from "./primary-evidence";
import {
  hashExactDirectoryTree,
  requireNode24Version,
  sha256ExactFile,
} from "./native-runtime-provenance";
import {
  evaluateEnduranceInvariants,
  type EnduranceInvariantInput,
} from "./invariants";
import type {
  EnduranceJournalEvent,
  EnduranceMode,
  EnduranceReport,
  EnduranceBuildAttestation,
  EnduranceRuntime,
  EnduranceRuntimeAttestation,
} from "./report-schema";
import { writeExactOutputBundle } from "./safe-output";

interface BrowserEvidence {
  startCheckpointSha256: string;
  endCheckpointSha256: string;
  manifestSha256: string;
  incidentCorrelations: number;
  sseReconnectEventIdAdvanced: boolean;
}

export type VerifiableEnduranceReport = EnduranceReport & {
  provenance?: {
    runner?: {
      os?: string;
      node?: string;
      postgres?: string;
      browser?: string;
    };
    workflowRunId?: string | null;
    configuration?: Record<string, string | number | boolean>;
    buildAttestation?: EnduranceBuildAttestation;
    runtimeAttestation?: EnduranceRuntimeAttestation;
    automatedSignOff?: {
      status?: "passed" | "failed";
      generatedAt?: string;
    };
  };
  evidence?: {
    journalSha256?: string;
    primaryEvidenceSha256?: string;
    browser?: BrowserEvidence;
  };
};

export interface VerifyEnduranceReportOptions {
  reportPath: string;
  expectedMode: EnduranceMode;
  expectedCommitSha?: string;
  expectedRuntime?: EnduranceRuntime;
  workspaceRoot?: string;
  allowUnverifiedDuration?: boolean;
}

export interface VerifyEnduranceReportDependencies {
  verifyBuildAttestation?: typeof verifyWallClockBuildAttestation;
  hashPostgresDistribution?: typeof hashExactDirectoryTree;
}

export interface VerifyEnduranceReportResult {
  pass: true;
  report: VerifiableEnduranceReport;
  journalEvents: number;
  browserCheckpoints: number;
  browserSamples: number;
  sha256: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function canonicalIso(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} is required`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}

function numberArray(value: unknown, label: string): number[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "number" || !Number.isFinite(item))
  ) {
    throw new TypeError(`${label} must be a finite number array`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TypeError(`${label} must be a string array`);
  }
  return value;
}

function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pathIdentity(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32"
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

function journalPathFor(reportPath: string): string {
  return reportPath.endsWith(".json")
    ? `${reportPath.slice(0, -".json".length)}.jsonl`
    : `${reportPath}.jsonl`;
}

function browserManifestPathFor(reportPath: string): string {
  return `${reportPath}.browser-manifest.json`;
}

function primaryEvidencePathFor(reportPath: string): string {
  return `${reportPath}.primary-evidence.jsonl`;
}

async function readBoundPrimaryEvidence(
  reportPath: string,
  report: VerifiableEnduranceReport,
): Promise<Buffer> {
  const target = path.resolve(primaryEvidencePathFor(reportPath));
  const metadata = await lstat(target).catch(() => null);
  if (
    !metadata?.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > 64 * 1024 * 1024
  ) {
    throw new Error("Wall-clock primary evidence is missing or unsafe");
  }
  const actual = await realpath(target);
  if (pathIdentity(actual) !== pathIdentity(target)) {
    throw new Error("Wall-clock primary evidence path was redirected");
  }
  const bytes = await readFile(actual);
  const expected = report.evidence?.primaryEvidenceSha256;
  if (
    typeof expected !== "string" ||
    !/^[a-f0-9]{64}$/u.test(expected) ||
    sha256(bytes) !== expected
  ) {
    throw new Error(
      "Wall-clock primary evidence SHA-256 does not match report evidence",
    );
  }
  return bytes;
}

const workspaceRootFromModule = path.resolve(
  fileURLToPath(new URL("../../..", import.meta.url)),
);

export async function writeReportIntegritySidecar(
  reportPath: string,
): Promise<string> {
  const resolvedReportPath = path.resolve(reportPath);
  const bytes = await readFile(resolvedReportPath);
  const digest = sha256(bytes);
  await writeExactOutputBundle({
    outputDirectory: path.dirname(resolvedReportPath),
    overwrite: true,
    files: [{ path: `${resolvedReportPath}.sha256`, bytes: `${digest}\n` }],
  });
  return digest;
}

function validateJournal(
  text: string,
  expectedRunId: string,
  expectedCompletedAt: string,
): EnduranceJournalEvent[] {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) throw new Error("Endurance journal is empty");
  const events = lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Endurance journal line ${index + 1} is invalid JSON`);
    }
    const event = record(parsed, `journal event ${index}`);
    if (event.schemaVersion !== 1) {
      throw new Error(`Unsupported journal schemaVersion at sequence ${index}`);
    }
    if (event.runId !== expectedRunId) {
      throw new Error(`Journal runId mismatch at sequence ${index}`);
    }
    if (event.sequence !== index) {
      throw new Error(
        `Invalid journal sequence: expected ${index}, received ${String(event.sequence)}`,
      );
    }
    canonicalIso(event.occurredAt, `journal occurredAt at sequence ${index}`);
    if (typeof event.kind !== "string" || !event.kind) {
      throw new Error(`Journal kind is missing at sequence ${index}`);
    }
    record(event.data, `journal data at sequence ${index}`);
    return event as unknown as EnduranceJournalEvent;
  });
  if (events.at(-1)?.kind !== "run_completed") {
    throw new Error(
      "Endurance journal is truncated: final run_completed is missing",
    );
  }
  if (events.at(-1)?.occurredAt !== expectedCompletedAt) {
    throw new Error(
      "Endurance journal completion timestamp does not match report",
    );
  }
  return events;
}

interface WallClockJournalContract {
  requestedDurationHours: number;
  requiredHealthSampleBuckets: number;
  faultProfile: "standard" | "compressed-all";
  expectedFaults: ExpectedPrimaryFaultEvidence[];
}

const FAULT_EVIDENCE_TIMEOUT_MS = 120_000;
const FAULT_EVIDENCE_POLL_TOLERANCE_MS = 5_000;

function validateWallClockJournalContract(
  events: EnduranceJournalEvent[],
  report: VerifiableEnduranceReport,
): WallClockJournalContract {
  const runStartedEvents = events.filter(
    (event) => event.kind === "run_started",
  );
  if (runStartedEvents.length !== 1 || events[0] !== runStartedEvents[0]) {
    throw new Error(
      "Wall-clock journal must begin with exactly one run_started event",
    );
  }
  const runStarted = runStartedEvents[0];
  if (runStarted.occurredAt !== report.startedAt) {
    throw new Error(
      "Wall-clock journal run_started timestamp does not match report",
    );
  }
  const data = record(runStarted.data, "wall-clock journal run_started data");
  if (data.mode !== "wall_clock") {
    throw new Error("Wall-clock journal run_started mode is invalid");
  }
  if (data.seed !== report.seed) {
    throw new Error("Wall-clock journal seed does not match report");
  }
  const faultProfile = data.faultProfile;
  if (faultProfile !== "standard" && faultProfile !== "compressed-all") {
    throw new Error("Wall-clock journal fault profile is invalid");
  }
  const requestedDurationHours = data.durationHours;
  if (
    typeof requestedDurationHours !== "number" ||
    !Number.isFinite(requestedDurationHours) ||
    requestedDurationHours < 1 / 60
  ) {
    throw new Error("Wall-clock journal requested duration is invalid");
  }
  if (
    report.verified24h === true &&
    (requestedDurationHours < 24 || faultProfile !== "standard")
  ) {
    throw new Error(
      "Wall-clock verified24h requires a 24-hour standard fault profile",
    );
  }
  if (
    typeof report.wallClockHours !== "number" ||
    report.wallClockHours + 0.001 < requestedDurationHours
  ) {
    throw new Error(
      "Wall-clock report ended before its journal-requested duration",
    );
  }
  const shouldBeVerified24h =
    faultProfile === "standard" &&
    requestedDurationHours >= 24 &&
    report.wallClockHours >= 24;
  if (report.verified24h !== shouldBeVerified24h) {
    throw new Error(
      "Wall-clock verified24h must match the standard 24-hour journal contract",
    );
  }
  const requiredHealthSampleBuckets = Math.max(
    1,
    Math.floor(requestedDurationHours * 60),
  );
  if (
    report.metrics.requiredHealthSampleBuckets !== requiredHealthSampleBuckets
  ) {
    throw new Error(
      "Wall-clock report health sample contract does not match journal-requested duration",
    );
  }
  const expectedResponsibilities = requiredHealthSampleBuckets * 10;
  if (
    report.metrics.expectedResponsibilities !== expectedResponsibilities ||
    report.metrics.completedResponsibilities !== expectedResponsibilities
  ) {
    throw new Error(
      "Wall-clock expected responsibilities do not match the minute-bucket responsibility contract",
    );
  }
  const expectedSchedule = createSeededFaultSchedule({
    seed: report.seed,
    durationMs: Math.round(requestedDurationHours * 60 * 60 * 1_000),
    profile: faultProfile,
  });
  const scheduledEvents = events.filter(
    (event) => event.kind === "fault_scheduled",
  );
  if (scheduledEvents.length !== expectedSchedule.length) {
    throw new Error(
      "Wall-clock journal fault schedule count does not match the deterministic plan",
    );
  }
  if (
    !Array.isArray(report.injections) ||
    report.injections.length !== expectedSchedule.length
  ) {
    throw new Error(
      "Wall-clock report injection count does not match the deterministic plan",
    );
  }
  const observedEvents = events.filter(
    (event) => event.kind === "fault_observed",
  );
  if (observedEvents.length !== expectedSchedule.length) {
    throw new Error(
      "Wall-clock journal fault_observed count does not match the deterministic plan",
    );
  }
  const observationsById = new Map<string, (typeof observedEvents)[number]>();
  for (const event of observedEvents) {
    const data = record(event.data, "wall-clock fault_observed");
    if (
      typeof data.faultId !== "string" ||
      observationsById.has(data.faultId)
    ) {
      throw new Error(
        "Wall-clock fault_observed identity is missing or duplicated",
      );
    }
    observationsById.set(data.faultId, event);
  }
  const startedAtMs = new Date(report.startedAt).getTime();
  const completedAtMs = new Date(report.completedAt).getTime();
  const incidentIds = new Set<string>();
  const recoveryDurationsMs: number[] = [];
  expectedSchedule.forEach((expected, index) => {
    const expectedScheduledAt = new Date(
      startedAtMs + expected.atMs,
    ).toISOString();
    const journalEvent = scheduledEvents[index];
    const journalData = record(
      journalEvent.data,
      `wall-clock scheduled fault ${index}`,
    );
    if (
      journalEvent.occurredAt !== report.startedAt ||
      journalData.faultId !== expected.id ||
      journalData.faultKind !== expected.kind ||
      journalData.scheduledAt !== expectedScheduledAt
    ) {
      throw new Error(
        `Wall-clock journal fault schedule mismatch at index ${index}`,
      );
    }
    const injection = record(
      report.injections[index],
      `wall-clock report injection ${index}`,
    );
    if (
      injection.id !== expected.id ||
      injection.kind !== expected.kind ||
      injection.scheduledAt !== expectedScheduledAt
    ) {
      throw new Error(
        `Wall-clock report injection schedule mismatch at index ${index}`,
      );
    }
    const observedAt = canonicalIso(
      injection.observedAt,
      `wall-clock report injection ${index} observedAt`,
    );
    const recoveredAt = canonicalIso(
      injection.recoveredAt,
      `wall-clock report injection ${index} recoveredAt`,
    );
    const observedAtMs = new Date(observedAt).getTime();
    const recoveredAtMs = new Date(recoveredAt).getTime();
    const scheduledAtMs = new Date(expectedScheduledAt).getTime();
    const observationDeadlineMs =
      scheduledAtMs + expected.durationMs + FAULT_EVIDENCE_TIMEOUT_MS;
    const recoveryDeadlineMs =
      observationDeadlineMs + FAULT_EVIDENCE_POLL_TOLERANCE_MS;
    if (
      injection.pass !== true ||
      observedAtMs < scheduledAtMs ||
      observedAtMs > observationDeadlineMs ||
      recoveredAtMs < observedAtMs ||
      recoveredAtMs > recoveryDeadlineMs ||
      recoveredAtMs > completedAtMs
    ) {
      throw new Error(
        `Wall-clock report injection observation exceeded its fault evidence window at index ${index}`,
      );
    }
    if (
      typeof injection.incidentId !== "string" ||
      !injection.incidentId.trim() ||
      Buffer.byteLength(injection.incidentId, "utf8") > 200 ||
      incidentIds.has(injection.incidentId)
    ) {
      throw new Error(
        `Wall-clock report injection incident is invalid at index ${index}`,
      );
    }
    incidentIds.add(injection.incidentId);
    recoveryDurationsMs.push(recoveredAtMs - observedAtMs);

    // Concurrent faults finish independently; identity, not completion position,
    // binds each observation to its deterministic schedule entry.
    const observedEvent = observationsById.get(expected.id);
    if (!observedEvent)
      throw new Error("Wall-clock fault_observed identity is missing");
    const observedData = record(
      observedEvent.data,
      `wall-clock fault_observed ${index}`,
    );
    const journalObservedAtMs = new Date(
      canonicalIso(
        observedEvent.occurredAt,
        `wall-clock fault_observed ${index} occurredAt`,
      ),
    ).getTime();
    if (
      observedData.faultId !== expected.id ||
      observedData.faultKind !== expected.kind ||
      typeof observedData.target !== "string" ||
      !observedData.target.trim() ||
      Buffer.byteLength(observedData.target, "utf8") > 200 ||
      journalObservedAtMs < recoveredAtMs ||
      journalObservedAtMs > recoveryDeadlineMs ||
      journalObservedAtMs > completedAtMs
    ) {
      throw new Error(
        `Wall-clock fault_observed evidence mismatch or exceeded its evidence window at index ${index}`,
      );
    }
  });
  if (
    JSON.stringify(
      numberArray(report.metrics.recoveryDurationsMs, "recovery durations"),
    ) !== JSON.stringify(recoveryDurationsMs)
  ) {
    throw new Error(
      "Wall-clock recovery durations do not match ordered injection timestamps",
    );
  }
  return {
    requestedDurationHours,
    requiredHealthSampleBuckets,
    faultProfile,
    expectedFaults: expectedSchedule.map((fault) => ({
      id: fault.id,
      kind: fault.kind,
      scheduledAt: new Date(startedAtMs + fault.atMs).toISOString(),
      durationMs: fault.durationMs,
    })),
  };
}

function validateBrowserEvidence(report: Record<string, unknown>): void {
  const evidence = record(report.evidence, "wall-clock browser evidence");
  const browser = record(evidence.browser, "wall-clock browser evidence");
  for (const field of [
    "startCheckpointSha256",
    "endCheckpointSha256",
    "manifestSha256",
  ] as const) {
    if (
      typeof browser[field] !== "string" ||
      !/^[a-f0-9]{64}$/.test(browser[field])
    ) {
      throw new Error(`Wall-clock browser evidence ${field} is invalid`);
    }
  }
  if (
    !Number.isSafeInteger(browser.incidentCorrelations) ||
    Number(browser.incidentCorrelations) < 1
  ) {
    throw new Error("Wall-clock browser evidence has no incident correlation");
  }
  if (browser.sseReconnectEventIdAdvanced !== true) {
    throw new Error(
      "Wall-clock browser evidence did not prove SSE cursor advance",
    );
  }
}

function validateJournalDigest(
  report: VerifiableEnduranceReport,
  journalBytes: Buffer,
): void {
  const digest = report.evidence?.journalSha256;
  if (
    typeof digest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(digest) ||
    digest !== sha256(journalBytes)
  ) {
    throw new Error("Endurance journal SHA-256 does not match report evidence");
  }
}

async function validateBrowserManifest(
  reportPath: string,
  report: VerifiableEnduranceReport,
  expectedSamples: number,
): Promise<{ checkpoints: number; samples: number }> {
  const manifestPath = browserManifestPathFor(reportPath);
  let manifestBytes: Buffer;
  let parsed: unknown;
  try {
    manifestBytes = await readFile(manifestPath);
    parsed = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("Wall-clock browser manifest is required and must be JSON");
  }
  const browser = report.evidence?.browser;
  if (!browser || sha256(manifestBytes) !== browser.manifestSha256) {
    throw new Error(
      "Wall-clock browser manifest SHA-256 does not match report evidence",
    );
  }
  const manifest = record(parsed, "wall-clock browser manifest");
  if (manifest.schemaVersion !== 1) {
    throw new Error("Wall-clock browser manifest schemaVersion is invalid");
  }
  if (manifest.runId !== report.runId) {
    throw new Error("Wall-clock browser manifest runId does not match report");
  }
  if (manifest.reportFile !== path.basename(reportPath)) {
    throw new Error(
      "Wall-clock browser manifest is not bound to the report filename",
    );
  }
  if (!Array.isArray(manifest.checkpoints)) {
    throw new Error("Wall-clock browser manifest checkpoints are required");
  }
  const reportDirectory = path.dirname(reportPath);
  const expectedRelativePrefix = `${path.basename(reportPath)}.browser/${report.runId}/`;
  const browserParent = path.resolve(
    reportDirectory,
    `${path.basename(reportPath)}.browser`,
  );
  const browserRoot = path.resolve(browserParent, report.runId);
  let resolvedReportDirectory: string;
  let resolvedBrowserParent: string;
  let resolvedBrowserRoot: string;
  try {
    const [browserParentMetadata, browserRootMetadata] = await Promise.all([
      lstat(browserParent),
      lstat(browserRoot),
    ]);
    if (
      !browserParentMetadata.isDirectory() ||
      browserParentMetadata.isSymbolicLink() ||
      !browserRootMetadata.isDirectory() ||
      browserRootMetadata.isSymbolicLink()
    ) {
      throw new Error("redirected");
    }
    [resolvedReportDirectory, resolvedBrowserParent, resolvedBrowserRoot] =
      await Promise.all([
        realpath(reportDirectory),
        realpath(browserParent),
        realpath(browserRoot),
      ]);
  } catch {
    throw new Error(
      "Wall-clock browser evidence root is missing or redirected",
    );
  }
  if (
    pathIdentity(resolvedBrowserParent) !==
      pathIdentity(
        path.resolve(
          resolvedReportDirectory,
          `${path.basename(reportPath)}.browser`,
        ),
      ) ||
    pathIdentity(resolvedBrowserRoot) !==
      pathIdentity(
        path.resolve(
          resolvedReportDirectory,
          `${path.basename(reportPath)}.browser`,
          report.runId,
        ),
      )
  ) {
    throw new Error("Wall-clock browser evidence root escaped report storage");
  }
  const seenPaths = new Set<string>();
  const checkpoints: Array<{
    kind: "start" | "mismatch" | "end";
    path: string;
    sha256: string;
  }> = [];
  for (const [index, value] of manifest.checkpoints.entries()) {
    const checkpoint = record(value, `browser checkpoint ${index}`);
    if (
      checkpoint.kind !== "start" &&
      checkpoint.kind !== "mismatch" &&
      checkpoint.kind !== "end"
    ) {
      throw new Error(`Browser checkpoint ${index} kind is invalid`);
    }
    if (
      typeof checkpoint.path !== "string" ||
      !checkpoint.path.startsWith(expectedRelativePrefix) ||
      checkpoint.path.includes("\\") ||
      path.posix.isAbsolute(checkpoint.path) ||
      path.posix.normalize(checkpoint.path) !== checkpoint.path ||
      seenPaths.has(checkpoint.path)
    ) {
      throw new Error(`Browser checkpoint ${index} path is invalid`);
    }
    if (
      typeof checkpoint.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(checkpoint.sha256)
    ) {
      throw new Error(`Browser checkpoint ${index} SHA-256 is invalid`);
    }
    canonicalIso(
      checkpoint.capturedAt,
      `browser checkpoint ${index} capturedAt`,
    );
    const checkpointPath = path.resolve(
      reportDirectory,
      ...checkpoint.path.split("/"),
    );
    const metadata = await lstat(checkpointPath).catch(() => null);
    if (!metadata?.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Browser checkpoint ${index} is not a regular file`);
    }
    const resolvedCheckpoint = await realpath(checkpointPath);
    const relativeToBrowserRoot = path.relative(
      resolvedBrowserRoot,
      resolvedCheckpoint,
    );
    if (
      !relativeToBrowserRoot ||
      relativeToBrowserRoot.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToBrowserRoot)
    ) {
      throw new Error(`Browser checkpoint ${index} escaped its evidence root`);
    }
    if (sha256(await readFile(resolvedCheckpoint)) !== checkpoint.sha256) {
      throw new Error(`Browser checkpoint SHA-256 mismatch at index ${index}`);
    }
    seenPaths.add(checkpoint.path);
    checkpoints.push({
      kind: checkpoint.kind,
      path: checkpoint.path,
      sha256: checkpoint.sha256,
    });
  }
  const start = checkpoints.filter((item) => item.kind === "start");
  const end = checkpoints.filter((item) => item.kind === "end");
  if (
    start.length !== 1 ||
    end.length !== 1 ||
    !browser ||
    start[0].sha256 !== browser.startCheckpointSha256 ||
    end[0].sha256 !== browser.endCheckpointSha256
  ) {
    throw new Error(
      "Wall-clock browser manifest checkpoints do not match report evidence",
    );
  }
  if (!Array.isArray(manifest.samples)) {
    throw new Error("Wall-clock browser manifest samples are required");
  }
  if (manifest.samples.length !== expectedSamples) {
    throw new Error(
      `Wall-clock browser sample count must be exactly ${expectedSamples}`,
    );
  }
  const startedAt = new Date(report.startedAt).getTime();
  const completedAt = new Date(report.completedAt).getTime();
  const sseInjections = report.injections.filter(
    (injection) => injection.kind === "sse_disconnect",
  );
  if (
    sseInjections.length !== 1 ||
    !sseInjections[0].observedAt ||
    !sseInjections[0].recoveredAt
  ) {
    throw new Error(
      "Browser reconnect evidence requires one exact scheduled SSE fault",
    );
  }
  const sseObservedAt = new Date(sseInjections[0].observedAt).getTime();
  const sseReconnectDeadline =
    new Date(sseInjections[0].recoveredAt).getTime() + 90_000;
  let previousCapturedAt = startedAt;
  let firstCapturedAt = 0;
  let lastCapturedAt = 0;
  let incidentCorrelations = 0;
  let reconnectObserved = false;
  let reconnectObservedInSseWindow = false;
  for (const [index, value] of manifest.samples.entries()) {
    const sample = record(value, `browser sample ${index}`);
    if (sample.index !== index) {
      throw new Error(`Browser sample index mismatch at ${index}`);
    }
    const capturedAt = canonicalIso(
      sample.capturedAt,
      `browser sample ${index} capturedAt`,
    );
    const capturedAtMs = new Date(capturedAt).getTime();
    if (
      capturedAtMs < startedAt ||
      capturedAtMs > completedAt ||
      capturedAtMs < previousCapturedAt
    ) {
      throw new Error(`Browser sample ${index} timestamp is out of order`);
    }
    if (index === 0) {
      firstCapturedAt = capturedAtMs;
    } else if (capturedAtMs - previousCapturedAt < 55_000) {
      throw new Error(`Browser sample ${index} cadence is too short`);
    } else if (capturedAtMs - previousCapturedAt > 90_000) {
      throw new Error(`Browser sample ${index} cadence is too long`);
    }
    previousCapturedAt = capturedAtMs;
    lastCapturedAt = capturedAtMs;
    if (
      typeof sample.runtimeLabel !== "string" ||
      !sample.runtimeLabel.trim() ||
      Buffer.byteLength(sample.runtimeLabel, "utf8") > 500
    ) {
      throw new Error(`Browser sample ${index} runtimeLabel is invalid`);
    }
    if (
      typeof sample.incidentVisible !== "boolean" ||
      typeof sample.reconnectCursorAdvanced !== "boolean"
    ) {
      throw new Error(`Browser sample ${index} semantic flags are invalid`);
    }
    const pageErrors = stringArray(
      sample.pageErrors,
      `browser sample ${index} page errors`,
    );
    if (pageErrors.length > 0) {
      throw new Error(`Browser sample ${index} contains a page error`);
    }
    if (sample.mismatch !== null) {
      throw new Error(`Browser sample ${index} contains a semantic mismatch`);
    }
    if (sample.incidentVisible) incidentCorrelations += 1;
    if (sample.reconnectCursorAdvanced) {
      reconnectObserved = true;
      if (
        capturedAtMs >= sseObservedAt &&
        capturedAtMs <= sseReconnectDeadline
      ) {
        reconnectObservedInSseWindow = true;
      }
    }
  }
  if (incidentCorrelations !== browser.incidentCorrelations) {
    throw new Error(
      "Browser sample incident aggregate does not match report evidence",
    );
  }
  if (reconnectObserved !== browser.sseReconnectEventIdAdvanced) {
    throw new Error(
      "Browser sample reconnect aggregate does not match report evidence",
    );
  }
  if (
    firstCapturedAt - startedAt > 90_000 ||
    completedAt - lastCapturedAt > 90_000
  ) {
    throw new Error("Browser sample sequence does not span the wall-clock run");
  }
  if (!reconnectObservedInSseWindow) {
    throw new Error(
      "Browser SSE reconnect evidence is not bound to the scheduled recovery window",
    );
  }
  return { checkpoints: checkpoints.length, samples: manifest.samples.length };
}

function validatedBuildAttestation(
  report: Record<string, unknown>,
  expectedRuntime: EnduranceRuntime,
): EnduranceBuildAttestation {
  const provenance = record(report.provenance, "wall-clock provenance");
  const build = record(
    provenance.buildAttestation,
    "wall-clock build attestation",
  );
  for (const field of ["sourceTreeSha256", "runtimeArtifactSha256"] as const) {
    if (
      typeof build[field] !== "string" ||
      !/^[a-f0-9]{64}$/u.test(build[field])
    ) {
      throw new Error(`Wall-clock build attestation ${field} is invalid`);
    }
  }
  if (
    build.schemaVersion !== 1 ||
    build.cleanTree !== true ||
    build.sourceCommitSha !== report.commitSha ||
    build.runtime !== expectedRuntime ||
    !Number.isSafeInteger(build.runtimeArtifactFileCount) ||
    Number(build.runtimeArtifactFileCount) < 1
  ) {
    throw new Error("Wall-clock build attestation contract is invalid");
  }
  requireNode24Version(
    String(build.nodeVersion ?? ""),
    "Wall-clock build attestation",
  );
  const expectedSubject =
    expectedRuntime === "native-postgres"
      ? "native-runtime-artifacts"
      : "docker-build-context";
  if (build.subject !== expectedSubject) {
    throw new Error("Wall-clock build attestation subject is invalid");
  }
  const dependencies = build.nativeRuntimeDependencies;
  if (expectedRuntime === "native-postgres") {
    const expectedDependencies = [
      {
        name: "@electric-sql/pglite",
        path: "artifacts/api-server/dist/node_modules/@electric-sql/pglite",
      },
      {
        name: "playwright-core",
        path: "artifacts/api-server/dist/node_modules/playwright-core",
      },
    ] as const;
    if (
      !Array.isArray(dependencies) ||
      dependencies.length !== expectedDependencies.length ||
      dependencies.some((value, index) => {
        const dependency = record(
          value,
          `Native runtime dependency attestation ${index}`,
        );
        const expected = expectedDependencies[index];
        return (
          dependency.name !== expected.name ||
          dependency.path !== expected.path ||
          typeof dependency.version !== "string" ||
          !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(dependency.version) ||
          typeof dependency.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/u.test(dependency.sha256) ||
          !Number.isSafeInteger(dependency.fileCount) ||
          Number(dependency.fileCount) < 1
        );
      })
    ) {
      throw new Error(
        "Wall-clock native runtime dependency attestation is invalid",
      );
    }
  } else if (dependencies !== undefined) {
    throw new Error(
      "Wall-clock Docker build attestation must not contain native dependencies",
    );
  }
  return build as unknown as EnduranceBuildAttestation;
}

function validateProvenance(
  report: Record<string, unknown>,
  expectedCompletedAt: string,
  expectedRuntime: EnduranceRuntime,
  journalContract: WallClockJournalContract,
): void {
  const provenance = record(report.provenance, "wall-clock provenance");
  const runner = record(provenance.runner, "wall-clock provenance runner");
  for (const field of ["os", "node", "postgres", "browser"] as const) {
    if (typeof runner[field] !== "string" || !runner[field]) {
      throw new Error(`Wall-clock provenance runner.${field} is required`);
    }
  }
  const runnerNodeVersion = requireNode24Version(
    String(runner.node),
    "Wall-clock provenance runner",
  );
  const configuration = record(
    provenance.configuration,
    "wall-clock provenance configuration",
  );
  const expectedConfiguration: Record<string, string | number> = {
    runtime: expectedRuntime,
    workers: 2,
    agents: 10,
    database: "postgres",
    durationHours: journalContract.requestedDurationHours,
    seed: Number(report.seed),
    faultProfile: journalContract.faultProfile,
  };
  const actualKeys = Object.keys(configuration).sort();
  const expectedKeys = Object.keys(expectedConfiguration).sort();
  if (
    JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys) ||
    expectedKeys.some(
      (key) => configuration[key] !== expectedConfiguration[key],
    )
  ) {
    throw new Error(
      "Wall-clock provenance configuration does not exactly match the journal contract",
    );
  }
  const build = validatedBuildAttestation(report, expectedRuntime);
  if (build.nodeVersion !== runnerNodeVersion) {
    throw new Error(
      "Wall-clock build and runner Node.js versions do not match",
    );
  }
  const runtime = record(
    provenance.runtimeAttestation,
    "wall-clock runtime attestation",
  );
  if (
    !/^PostgreSQL 17\.[0-9]+(?:\.[0-9]+)?(?:\s.*)?$/u.test(
      String(runner.postgres),
    )
  ) {
    throw new Error("Wall-clock runtime attestation requires PostgreSQL 17.x");
  }
  if (expectedRuntime === "docker-compose") {
    if (runtime.kind !== "docker") {
      throw new Error("Wall-clock Docker runtime attestation is missing");
    }
    const images = record(
      runtime.serviceImageIds,
      "wall-clock Docker service image IDs",
    );
    const expectedImageKeys = ["app", "database", "worker1", "worker2"];
    if (
      JSON.stringify(Object.keys(images).sort()) !==
        JSON.stringify(expectedImageKeys) ||
      expectedImageKeys.some(
        (key) =>
          typeof images[key] !== "string" ||
          !/^sha256:[a-f0-9]{64}$/u.test(String(images[key])),
      ) ||
      images.app !== images.worker1 ||
      images.app !== images.worker2
    ) {
      throw new Error("Wall-clock Docker service image IDs are invalid");
    }
    const labels = record(
      runtime.applicationImageLabels,
      "wall-clock Docker application image labels",
    );
    if (
      JSON.stringify(Object.keys(labels).sort()) !==
        JSON.stringify(["sourceCommitSha", "sourceTreeSha256"]) ||
      labels.sourceCommitSha !== build.sourceCommitSha ||
      labels.sourceTreeSha256 !== build.sourceTreeSha256
    ) {
      throw new Error(
        "Wall-clock Docker image labels do not match build attestation",
      );
    }
  } else {
    if (runtime.kind !== "native-postgres") {
      throw new Error("Wall-clock native runtime attestation is missing");
    }
    const postgresVersion = String(runtime.postgresVersion ?? "");
    const runtimeNodeVersion = requireNode24Version(
      String(runtime.nodeVersion ?? ""),
      "Wall-clock native runtime attestation",
    );
    if (
      runtimeNodeVersion !== runnerNodeVersion ||
      runtimeNodeVersion !== build.nodeVersion
    ) {
      throw new Error(
        "Wall-clock native Node.js runtime version does not match build provenance",
      );
    }
    if (
      postgresVersion !== runner.postgres ||
      !/^PostgreSQL 17\.[0-9]+(?:\.[0-9]+)?(?:\s.*)?$/u.test(postgresVersion)
    ) {
      throw new Error(
        "Wall-clock native runtime attestation requires PostgreSQL 17.x",
      );
    }
    const distribution = record(
      runtime.postgresDistribution,
      "Wall-clock PostgreSQL distribution attestation",
    );
    const distributionKeys = [
      "endSha256",
      "fileCount",
      "rootPath",
      "startSha256",
      "totalBytes",
    ];
    if (
      JSON.stringify(Object.keys(distribution).sort()) !==
        JSON.stringify(distributionKeys) ||
      typeof distribution.rootPath !== "string" ||
      !path.isAbsolute(distribution.rootPath) ||
      typeof distribution.startSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(distribution.startSha256) ||
      typeof distribution.endSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(distribution.endSha256) ||
      distribution.startSha256 !== distribution.endSha256 ||
      !Number.isSafeInteger(distribution.fileCount) ||
      Number(distribution.fileCount) < 1 ||
      !Number.isSafeInteger(distribution.totalBytes) ||
      Number(distribution.totalBytes) < 1
    ) {
      throw new Error(
        "Wall-clock PostgreSQL distribution start/end attestation is invalid or changed",
      );
    }
    const binaries = runtime.postgresBinaries;
    const expectedNames = [
      "postgres",
      "initdb",
      "pg_ctl",
      "pg_isready",
      "psql",
    ];
    if (
      !Array.isArray(binaries) ||
      binaries.length !== expectedNames.length ||
      binaries.some((value, index) => {
        const binary = record(value, `PostgreSQL binary ${index}`);
        return (
          binary.name !== expectedNames[index] ||
          typeof binary.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/u.test(binary.sha256)
        );
      })
    ) {
      throw new Error("Wall-clock PostgreSQL binary attestation is invalid");
    }
    const toolchainManifest = (binaries as Array<Record<string, unknown>>)
      .map((binary) => `${String(binary.name)}\0${String(binary.sha256)}\n`)
      .join("");
    if (
      runtime.postgresToolchainSha256 !== sha256(toolchainManifest) ||
      typeof runtime.nodeExecutableSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(runtime.nodeExecutableSha256) ||
      typeof runtime.pnpmLockSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(runtime.pnpmLockSha256)
    ) {
      throw new Error(
        "Wall-clock native runtime attestation toolchain digest is invalid",
      );
    }
  }
  const signOff = record(
    provenance.automatedSignOff,
    "wall-clock automated sign-off",
  );
  if (signOff.status !== "passed") {
    throw new Error("Wall-clock automated sign-off has not passed");
  }
  const generatedAt = canonicalIso(
    signOff.generatedAt,
    "automated sign-off generatedAt",
  );
  if (generatedAt !== expectedCompletedAt) {
    throw new Error(
      "Wall-clock automated sign-off timestamp does not match report completion",
    );
  }
}

async function validateNativeHostRuntimeBytes(
  report: VerifiableEnduranceReport,
  workspaceRoot: string,
  hashPostgresDistribution: typeof hashExactDirectoryTree,
): Promise<void> {
  const provenance = record(report.provenance, "wall-clock provenance");
  const runtime = record(
    provenance.runtimeAttestation,
    "wall-clock runtime attestation",
  );
  if (runtime.kind !== "native-postgres") {
    throw new Error("Wall-clock native runtime attestation is missing");
  }
  const verifierNodeVersion = requireNode24Version(
    process.version,
    "Native report verifier",
  );
  if (runtime.nodeVersion !== verifierNodeVersion) {
    throw new Error(
      "Wall-clock native Node.js version does not match the verifier runtime",
    );
  }
  const host = await nativeHostRuntimeDigests(workspaceRoot);
  if (
    !host.nodeIsExactFile ||
    runtime.nodeExecutableSha256 !== host.nodeExecutableSha256
  ) {
    throw new Error(
      "Wall-clock native Node executable digest does not match the verifier runtime",
    );
  }
  if (
    !host.lockfileIsExactFile ||
    runtime.pnpmLockSha256 !== host.pnpmLockSha256
  ) {
    throw new Error(
      "Wall-clock native pnpm lockfile digest does not match the verified checkout",
    );
  }
  const distribution = record(
    runtime.postgresDistribution,
    "Wall-clock PostgreSQL distribution attestation",
  );
  const rootPath = String(distribution.rootPath ?? "");
  const currentDistribution = await hashPostgresDistribution(
    rootPath,
    "Verified portable PostgreSQL distribution",
  );
  if (
    pathIdentity(currentDistribution.rootPath) !== pathIdentity(rootPath) ||
    distribution.startSha256 !== currentDistribution.sha256 ||
    distribution.endSha256 !== currentDistribution.sha256 ||
    distribution.fileCount !== currentDistribution.fileCount ||
    distribution.totalBytes !== currentDistribution.totalBytes
  ) {
    throw new Error(
      "Wall-clock PostgreSQL distribution digest changed or does not match the verifier host",
    );
  }
}

async function nativeHostRuntimeDigests(workspaceRoot: string) {
  const [nodeExecutableSha256, pnpmLockSha256] = await Promise.all([
    sha256ExactFile(process.execPath, "Node executable"),
    sha256ExactFile(
      path.join(workspaceRoot, "pnpm-lock.yaml"),
      "pnpm lockfile",
    ),
  ]);
  return {
    nodeIsExactFile: true,
    lockfileIsExactFile: true,
    nodeExecutableSha256,
    pnpmLockSha256,
  };
}

function validateReport(
  parsed: unknown,
  options: VerifyEnduranceReportOptions,
): VerifiableEnduranceReport {
  const report = record(parsed, "endurance report");
  if (report.schemaVersion !== 1) {
    throw new Error(
      `Unsupported endurance schemaVersion: ${String(report.schemaVersion)}`,
    );
  }
  if (report.mode !== options.expectedMode) {
    throw new Error(
      `Endurance mode mismatch: expected ${options.expectedMode}, received ${String(report.mode)}`,
    );
  }
  if (typeof report.runId !== "string" || !report.runId) {
    throw new Error("Endurance runId is required");
  }
  if (!Number.isSafeInteger(report.seed) || Number(report.seed) < 0) {
    throw new Error("Endurance seed is invalid");
  }
  const startedAt = canonicalIso(report.startedAt, "startedAt");
  const completedAt = canonicalIso(report.completedAt, "completedAt");
  if (typeof report.commitSha !== "string" || !report.commitSha) {
    throw new Error("Endurance commit SHA is required");
  }
  if (report.mode === "wall_clock" && !options.expectedCommitSha) {
    throw new Error("Wall-clock verification requires an expected commit");
  }
  if (report.mode === "wall_clock" && !options.expectedRuntime) {
    throw new Error("Wall-clock verification requires an expected runtime");
  }
  if (
    options.expectedCommitSha &&
    report.commitSha !== options.expectedCommitSha
  ) {
    throw new Error(
      `Endurance commit SHA mismatch: expected ${options.expectedCommitSha}`,
    );
  }

  const topology = record(report.topology, "endurance topology");
  if (
    topology.database !== "postgres" ||
    topology.api !== 1 ||
    topology.workers !== 2 ||
    topology.agents !== 10
  ) {
    throw new Error(
      "Endurance topology requires PostgreSQL, one API, two workers, and ten agents",
    );
  }

  const metrics = record(report.metrics, "endurance metrics");
  if (metrics.expectedResponsibilities !== metrics.completedResponsibilities) {
    throw new Error("Endurance report contains lost responsibilities");
  }
  if (
    stringArray(
      metrics.duplicateIrreversibleReceiptKeys,
      "duplicate irreversible receipt keys",
    ).length > 0
  ) {
    throw new Error(
      "Endurance report contains a duplicate irreversible receipt",
    );
  }
  if (metrics.staleOwnerCommits !== 0) {
    throw new Error("Endurance report contains a stale owner commit");
  }
  if (
    numberArray(metrics.recoveryDurationsMs, "recovery durations").some(
      (duration) => duration > 120_000 || duration < 0,
    )
  ) {
    throw new Error("Endurance recovery target of 120 seconds was exceeded");
  }
  if (stringArray(metrics.missingIncidentIds, "missing incident IDs").length) {
    throw new Error(
      "Endurance report contains an injection without incident evidence",
    );
  }
  if (
    stringArray(metrics.healthTruthMismatches, "health truth mismatches").length
  ) {
    throw new Error("Endurance report contains false-green health evidence");
  }
  if (metrics.sseReconnectObserved !== true) {
    throw new Error("Endurance report did not observe SSE reconnection");
  }
  const requiredHealthBuckets =
    options.allowUnverifiedDuration === true &&
    report.mode === "wall_clock" &&
    typeof report.wallClockHours === "number"
      ? Math.max(1, Math.floor(report.wallClockHours * 60))
      : 1_440;
  if (
    typeof metrics.healthSampleBuckets !== "number" ||
    metrics.healthSampleBuckets < requiredHealthBuckets
  ) {
    throw new Error(
      `Endurance report has fewer than ${requiredHealthBuckets} health buckets`,
    );
  }

  if (!Array.isArray(report.assertions)) {
    throw new Error("Endurance assertions are missing");
  }
  const failedAssertion = report.assertions.find(
    (assertion) => !record(assertion, "endurance assertion").pass,
  );
  if (failedAssertion || report.pass !== true) {
    throw new Error("Endurance report contains a failed assertion");
  }
  const recomputed = evaluateEnduranceInvariants(
    metrics as unknown as EnduranceInvariantInput,
  );
  if (
    recomputed.pass !== report.pass ||
    JSON.stringify(recomputed.assertions) !== JSON.stringify(report.assertions)
  ) {
    throw new Error(
      "Endurance assertions do not match independently recomputed metrics",
    );
  }

  if (report.mode === "accelerated") {
    if (report.verified24h !== false) {
      throw new Error("Accelerated evidence must never set verified24h");
    }
  } else {
    if (typeof report.wallClockHours !== "number") {
      throw new Error("wallClockHours is required for wall-clock evidence");
    }
    if (
      report.wallClockHours < 24 &&
      options.allowUnverifiedDuration !== true
    ) {
      throw new Error(
        "Wall-clock verification requires at least 24 wall-clock hours",
      );
    }
    const measuredHours =
      (new Date(completedAt).getTime() - new Date(startedAt).getTime()) /
      (60 * 60 * 1_000);
    if (
      measuredHours < 0 ||
      Math.abs(measuredHours - report.wallClockHours) > 0.001
    ) {
      throw new Error("Wall-clock duration does not match report timestamps");
    }
    if (
      typeof report.verified24h !== "boolean" ||
      (report.wallClockHours < 24 && report.verified24h)
    ) {
      throw new Error(
        "Wall-clock verified24h cannot exceed its measured duration",
      );
    }
    validateBrowserEvidence(report);
  }
  return report as unknown as VerifiableEnduranceReport;
}

export async function verifyEnduranceReport(
  options: VerifyEnduranceReportOptions,
  dependencies: VerifyEnduranceReportDependencies = {},
): Promise<VerifyEnduranceReportResult> {
  const reportPath = path.resolve(options.reportPath);
  const [reportBytes, sidecar, journalBytes] = await Promise.all([
    readFile(reportPath),
    readFile(`${reportPath}.sha256`, "utf8"),
    readFile(journalPathFor(reportPath)),
  ]);
  const expectedDigest = sidecar.trim();
  const actualDigest = sha256(reportBytes);
  if (
    !/^[a-f0-9]{64}$/.test(expectedDigest) ||
    expectedDigest !== actualDigest
  ) {
    throw new Error(
      "Endurance report SHA-256 sidecar does not match report bytes",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(reportBytes.toString("utf8"));
  } catch {
    throw new Error("Endurance report is invalid JSON");
  }
  const report = validateReport(parsed, options);
  if (report.mode === "wall_clock") {
    const expectedCommitSha = options.expectedCommitSha!;
    const expectedRuntime = options.expectedRuntime!;
    await (
      dependencies.verifyBuildAttestation ?? verifyWallClockBuildAttestation
    )({
      workspaceRoot: path.resolve(
        options.workspaceRoot ?? workspaceRootFromModule,
      ),
      expectedCommitSha,
      expectedRuntime,
      attestation: validatedBuildAttestation(
        report as unknown as Record<string, unknown>,
        expectedRuntime,
      ),
    });
  }
  validateJournalDigest(report, journalBytes);
  const events = validateJournal(
    journalBytes.toString("utf8"),
    report.runId,
    report.completedAt,
  );
  let browserEvidence = { checkpoints: 0, samples: 0 };
  if (report.mode === "wall_clock") {
    const journalContract = validateWallClockJournalContract(events, report);
    validateProvenance(
      report as unknown as Record<string, unknown>,
      report.completedAt,
      options.expectedRuntime!,
      journalContract,
    );
    if (options.expectedRuntime === "native-postgres") {
      await validateNativeHostRuntimeBytes(
        report,
        path.resolve(options.workspaceRoot ?? workspaceRootFromModule),
        dependencies.hashPostgresDistribution ?? hashExactDirectoryTree,
      );
    }
    const primaryMetrics = validateAndRecomputePrimaryEvidence({
      bytes: await readBoundPrimaryEvidence(reportPath, report),
      report,
      requiredHealthSampleBuckets: journalContract.requiredHealthSampleBuckets,
      expectedFaults: journalContract.expectedFaults,
    });
    const primaryAssertions = evaluateEnduranceInvariants(primaryMetrics);
    if (
      primaryAssertions.pass !== report.pass ||
      JSON.stringify(primaryAssertions.assertions) !==
        JSON.stringify(report.assertions)
    ) {
      throw new Error(
        "Primary evidence assertions do not match the signed report",
      );
    }
    browserEvidence = await validateBrowserManifest(
      reportPath,
      report,
      journalContract.requiredHealthSampleBuckets + 1,
    );
  }
  return {
    pass: true,
    report,
    journalEvents: events.length,
    browserCheckpoints: browserEvidence.checkpoints,
    browserSamples: browserEvidence.samples,
    sha256: actualDigest,
  };
}

export function parseVerifyReportArguments(
  argv: string[],
): VerifyEnduranceReportOptions {
  const positional: string[] = [];
  let expectedMode: EnduranceMode | undefined;
  let expectedCommitSha: string | undefined;
  let expectedRuntime: EnduranceRuntime | undefined;
  let allowUnverifiedDuration = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--allow-unverified-duration") {
      allowUnverifiedDuration = true;
      continue;
    }
    if (argument === "--expect-mode") {
      const value = argv[++index];
      if (value !== "accelerated" && value !== "wall_clock") {
        throw new TypeError("--expect-mode must be accelerated or wall_clock");
      }
      expectedMode = value;
      continue;
    }
    if (argument === "--expect-commit") {
      expectedCommitSha = argv[++index];
      if (!expectedCommitSha)
        throw new TypeError("--expect-commit requires a SHA");
      continue;
    }
    if (argument === "--expect-runtime") {
      const value = argv[++index];
      if (value !== "docker-compose" && value !== "native-postgres") {
        throw new TypeError(
          "--expect-runtime must be docker-compose or native-postgres",
        );
      }
      expectedRuntime = value;
      continue;
    }
    if (argument.startsWith("--")) {
      throw new TypeError(`Unknown argument: ${argument}`);
    }
    positional.push(argument);
  }
  if (positional.length !== 1) {
    throw new TypeError("verify-report requires exactly one report path");
  }
  if (!expectedMode) throw new TypeError("--expect-mode is required");
  if (!expectedCommitSha) throw new TypeError("--expect-commit is required");
  if (expectedMode === "wall_clock" && !expectedRuntime) {
    throw new TypeError(
      "--expect-runtime is required for wall-clock verification",
    );
  }
  if (expectedMode === "accelerated" && expectedRuntime) {
    throw new TypeError(
      "--expect-runtime is only valid for wall-clock verification",
    );
  }
  return {
    reportPath: positional[0],
    expectedMode,
    expectedCommitSha,
    ...(expectedRuntime ? { expectedRuntime } : {}),
    allowUnverifiedDuration,
  };
}

async function main(): Promise<void> {
  const result = await verifyEnduranceReport(
    parseVerifyReportArguments(process.argv.slice(2)),
  );
  process.stdout.write(
    `${JSON.stringify({
      pass: result.pass,
      mode: result.report.mode,
      verified24h: result.report.verified24h,
      journalEvents: result.journalEvents,
      browserCheckpoints: result.browserCheckpoints,
      browserSamples: result.browserSamples,
      sha256: result.sha256,
    })}\n`,
  );
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`endurance:verify-report failed: ${message}\n`);
    process.exitCode = 1;
  });
}
