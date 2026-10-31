import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createPackagePhaseRecorder,
  collectPackageAttempt,
  projectPackageAttempt,
} from "./package-diagnostics.mjs";

test("private package phases remain available after a failed child without exporting paths or prose", async () => {
  const parent = await realpath(tmpdir()),
    root = await mkdtemp(path.join(parent, "acos-package-phases-unit-"));
  try {
    const evidence = path.join(root, "private.json"),
      record = createPackagePhaseRecorder(evidence);
    await record("archive_extract");
    await record("inventory");
    await assert.rejects(record("C:\\synthetic-secret-path"));
    const trace = await readFile(evidence + ".phase.jsonl", "utf8");
    const rows = trace.trimEnd().split("\n").map(JSON.parse);
    assert.deepEqual(
      rows.map((r) => [r.sequence, r.phase]),
      [
        [0, "archive_extract"],
        [1, "inventory"],
      ],
    );
    const attempt = await collectPackageAttempt(
      "fresh",
      evidence,
      new Error(
        "private error: ERR_MODULE_NOT_FOUND C:\\synthetic-secret-path",
      ),
    );
    assert.equal(attempt.phase, "inventory");
    assert.equal(attempt.evidenceFound, false);
    assert.equal(attempt.traceAccepted, true);
    assert.equal(attempt.commandFailure.codeHint, "ERR_MODULE_NOT_FOUND");
    assert.equal(attempt.cleanupVerified, null);
    assert.equal(
      JSON.stringify(attempt).includes("synthetic-secret-path"),
      false,
    );
  } finally {
    const owned = await realpath(root);
    assert.equal(path.dirname(owned), parent);
    assert.ok(path.basename(owned).startsWith("acos-package-phases-unit-"));
    await rm(owned, { recursive: true });
  }
});

test("package failure projection refuses raw errors, model prose, unsafe phases and unknown setup fields", () => {
  const proof = {
    preparationPhase: "task_observe",
    accepted: false,
    cleanupVerified: true,
    error: "package_acceptance_failed",
    nodeDnsSecurityRegression: true,
    lastInstallationState: {
      phase: "failed",
      step: "start_native",
      completedSteps: ["check_environment", "C:\\synthetic-private"],
      error: "synthetic-private-secret",
    },
    failureProjection: {
      name: "AssertionError",
      code: "ERR_ASSERTION",
      actual: 7,
      expected: "synthetic-private-secret",
      operator: "strictEqual",
      message: "synthetic-private-secret",
    },
    firstTask: { status: "failed", resultSummary: "synthetic-private-secret" },
    taskObservation: {
      attempts: 4,
      transientFailures: 1,
      lastFailure: {
        kind: "http",
        status: 503,
        elapsedMs: 100,
        retryAfterMs: 1000,
        secret: "synthetic-private-secret",
      },
    },
    privateFixture: { owned: "C:\\synthetic-private" },
  };
  const result = projectPackageAttempt(
    "fresh",
    proof,
    "",
    new Error("synthetic-private-secret"),
  );
  assert.equal(result.phase, "task_observe");
  assert.equal(result.cleanupVerified, true);
  assert.equal(result.failure.actual, 7);
  assert.equal(result.failure.expected, null);
  assert.deepEqual(result.installation, {
    phase: "failed",
    step: "start_native",
    completedSteps: ["check_environment"],
    error: "setup_failed",
  });
  assert.equal(result.firstTaskStatus, "failed");
  assert.equal(result.taskObservation.lastFailure.status, 503);
  assert.equal(JSON.stringify(result).includes("synthetic-private"), false);
  assert.equal(
    projectPackageAttempt(
      "baseline",
      { preparationPhase: "synthetic-private-secret" },
      "",
    ).phase,
    "unknown",
  );
  assert.equal(
    projectPackageAttempt("fresh", null, "{bad private trace").traceAccepted,
    false,
  );
});
