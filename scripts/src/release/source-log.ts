import assert from "node:assert/strict";
import { selectStepCommand } from "./step-log";

export interface SourceLogExpectation {
  tests: number;
  passed: number;
  skippedCases: readonly string[];
}
export function verifySourceTestLog(
  log: string,
  job: unknown,
  sourceStepName: string,
  expected: SourceLogExpectation,
) {
  const { records, selected, step, inWindow } = selectStepCommand(
    log,
    job,
    sourceStepName,
    "pnpm test",
  );
  const summary = (label: string) => {
    const rows = selected.filter((row) => row.line.startsWith(`ℹ ${label} `));
    assert.equal(
      rows.length,
      1,
      `Missing or duplicate source ${label} summary`,
    );
    assert.ok(
      inWindow(rows[0]!.timestamp),
      "Source summary is outside its step",
    );
    const digits = rows[0]!.line.slice(`ℹ ${label} `.length);
    assert.match(digits, /^\d+$/u, "Invalid source summary count");
    const value = Number(digits);
    assert.ok(Number.isSafeInteger(value), "Invalid source count");
    return value;
  };
  const counts = {
    tests: summary("tests"),
    passed: summary("pass"),
    failed: summary("fail"),
    cancelled: summary("cancelled"),
    skipped: summary("skipped"),
  };
  assert.ok(
    Number.isSafeInteger(expected.tests) && expected.tests > 0,
    "Expected source count is required",
  );
  assert.ok(
    Number.isSafeInteger(expected.passed) && expected.passed > 0,
    "Expected pass count is required",
  );
  assert.equal(
    expected.tests,
    expected.passed + expected.skippedCases.length,
    "Inconsistent source expectations",
  );
  assert.deepEqual(
    counts,
    {
      tests: expected.tests,
      passed: expected.passed,
      failed: 0,
      cancelled: 0,
      skipped: expected.skippedCases.length,
    },
    "Source test counts do not match the reviewed expectation",
  );
  // Durations vary on each runner; retain the exact test name and skip reason.
  const skipName = (line: string) =>
    line.replace(/^﹣ /u, "").replace(/ \([\d.]+m?s\)(?= #|$)/u, "");
  const skippedCases = selected
    .filter((row) => row.line.startsWith("﹣ "))
    .map((row) => skipName(row.line))
    .sort();
  assert.deepEqual(
    skippedCases,
    expected.skippedCases.map(skipName).sort(),
    "Skipped source cases changed",
  );
  assert.equal(
    records.filter((row) => row.line.startsWith("﹣ ")).length,
    counts.skipped,
    "Unexpected skips outside the source step",
  );
  return {
    ...counts,
    skippedCases,
    step: {
      name: sourceStepName,
      startedAt: step.started_at,
      completedAt: step.completed_at,
    },
    allSummaryTests: records.filter((row) => row.line.startsWith("ℹ tests "))
      .length,
  };
}
