import assert from "node:assert/strict";
import {
  writeFile,
  appendFile,
  readFile,
  lstat,
  realpath,
} from "node:fs/promises";
import path from "node:path";

const phases = new Set([
  "archive_extract",
  "inventory",
  "node_version",
  "node_dns_security",
  "launcher_check",
  "setup_start",
  "capabilities",
  "plan",
  "install",
  "installation_state",
  "connection",
  "agents",
  "owner_model",
  "task_create",
  "task_observe",
  "task_contract",
  "private_database",
  "copy_security",
  "backup",
  "restart",
  "final_inventory",
  "complete",
]);
const steps = [
  "check_environment",
  "prepare_private_config",
  "connect_postgres",
  "start_native",
  "apply_preferences",
  "verify_runtime",
];
const statuses = [
  "pending",
  "running",
  "completed",
  "failed",
  "blocked",
  "cancelled",
  "paused",
];
const codes = [
  "ERR_MODULE_NOT_FOUND",
  "MODULE_NOT_FOUND",
  "ERR_UNKNOWN_FILE_EXTENSION",
  "ERR_DLOPEN_FAILED",
  "ERR_ACCESS_DENIED",
  "ERR_ASSERTION",
  "ERR_PACKAGE_PATH_NOT_EXPORTED",
  "EACCES",
  "EPERM",
  "ENOENT",
  "ENOTDIR",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "EADDRINUSE",
];
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const numeric = (value) => (Number.isSafeInteger(value) ? value : null);
const boolean = (value) => (typeof value === "boolean" ? value : null);
const scalar = (value) => (typeof value === "boolean" ? value : numeric(value));
export function projectPackageFailure(value) {
  const error = object(value);
  return {
    name: [
      "AssertionError",
      "Error",
      "TypeError",
      "RangeError",
      "SyntaxError",
    ].includes(error.name)
      ? error.name
      : null,
    codeHint:
      codes.find(
        (code) =>
          error.code === code ||
          error.codeHint === code ||
          (typeof error.message === "string" &&
            new RegExp(
              "(?:^|[^A-Z0-9_])" + code + "(?:$|[^A-Z0-9_])",
              "u",
            ).test(error.message)),
      ) ?? null,
    errno: numeric(error.errno),
    operator: [
      "strictEqual",
      "deepStrictEqual",
      "match",
      "doesNotMatch",
      "fail",
      "ifError",
      "ok",
      "rejects",
    ].includes(error.operator)
      ? error.operator
      : null,
    actual: scalar(error.actual),
    expected: scalar(error.expected),
  };
}
export function createPackagePhaseRecorder(evidence) {
  assert.ok(path.isAbsolute(evidence));
  const file = evidence + ".phase.jsonl",
    started = performance.now();
  let sequence = 0;
  return async (phase) => {
    assert.ok(
      phases.has(phase) && sequence < 64,
      "known_bounded_package_phase_required",
    );
    const line =
      JSON.stringify({
        sequence,
        phase,
        elapsedMs: Math.floor(performance.now() - started),
      }) + "\n";
    if (sequence === 0)
      await writeFile(file, line, { flag: "wx", mode: 0o600 });
    else {
      const meta = await lstat(file);
      assert.ok(meta.isFile() && !meta.isSymbolicLink() && meta.size <= 65536);
      assert.equal(await realpath(file), path.resolve(file));
      await appendFile(file, line);
    }
    sequence++;
  };
}
export function projectPackageAttempt(name, input, trace = "", commandError) {
  assert.ok(["fresh", "baseline"].includes(name));
  const proof = object(input),
    state = object(proof.lastInstallationState),
    observation = object(proof.taskObservation),
    failure = object(observation.lastFailure);
  let records = [],
    traceAccepted = false;
  try {
    assert.ok(
      typeof trace === "string" &&
        trace.length > 0 &&
        Buffer.byteLength(trace) <= 65536 &&
        trace.endsWith("\n"),
    );
    records = trace.trimEnd().split("\n").map(JSON.parse);
    assert.ok(records.length <= 64);
    for (const [i, row] of records.entries())
      assert.ok(
        row.sequence === i &&
          phases.has(row.phase) &&
          numeric(row.elapsedMs) !== null &&
          row.elapsedMs >= 0,
      );
    traceAccepted = true;
  } catch {
    records = [];
  }
  return {
    name,
    evidenceFound:
      input !== null && typeof input === "object" && !Array.isArray(input),
    traceAccepted,
    phase: phases.has(proof.preparationPhase)
      ? proof.preparationPhase
      : (records.at(-1)?.phase ?? "unknown"),
    phaseElapsedMs: records.at(-1)?.elapsedMs ?? null,
    accepted: boolean(proof.accepted),
    cleanupVerified: boolean(proof.cleanupVerified),
    error:
      proof.error === "package_acceptance_failed"
        ? "package_acceptance_failed"
        : null,
    cleanupError:
      proof.cleanupError === "owned_package_process_shutdown_failed"
        ? "owned_package_process_shutdown_failed"
        : null,
    nodeDnsSecurityRegression: boolean(proof.nodeDnsSecurityRegression),
    postgresCopySecurityRegression: boolean(
      proof.postgresCopySecurityRegression,
    ),
    installation: {
      phase: ["idle", "planned", "installing", "complete", "failed"].includes(
        state.phase,
      )
        ? state.phase
        : "unknown",
      step: steps.includes(state.step) ? state.step : null,
      completedSteps: steps.filter(
        (step) =>
          Array.isArray(state.completedSteps) &&
          state.completedSteps.includes(step),
      ),
      error: state.error == null ? null : "setup_failed",
    },
    firstTaskStatus: statuses.includes(object(proof.firstTask).status)
      ? proof.firstTask.status
      : null,
    taskObservation: {
      attempts: numeric(observation.attempts),
      transientFailures: numeric(observation.transientFailures),
      lastFailure: observation.lastFailure
        ? {
            kind: ["http", "timeout", "network"].includes(failure.kind)
              ? failure.kind
              : null,
            status: numeric(failure.status),
            elapsedMs: numeric(failure.elapsedMs),
            retryAfterMs: numeric(failure.retryAfterMs),
          }
        : null,
    },
    failure: projectPackageFailure(proof.failureProjection),
    cleanupFailure: projectPackageFailure(proof.cleanupFailure),
    commandFailure: projectPackageFailure(commandError),
  };
}
async function privateFile(file, limit) {
  const meta = await lstat(file);
  assert.ok(meta.isFile() && !meta.isSymbolicLink() && meta.size <= limit);
  assert.equal(await realpath(file), path.resolve(file));
  return readFile(file, "utf8");
}
/**
 * @param {string} name
 * @param {string} evidence
 * @param {unknown} [commandError]
 */
export async function collectPackageAttempt(
  name,
  evidence,
  commandError = undefined,
) {
  let proof = null,
    trace = "";
  try {
    proof = JSON.parse(await privateFile(evidence, 1048576));
  } catch {}
  try {
    trace = await privateFile(evidence + ".phase.jsonl", 65536);
  } catch {}
  return projectPackageAttempt(name, proof, trace, commandError);
}
