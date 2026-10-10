import assert from "node:assert/strict";
import { selectStepCommand } from "./step-log";

export function verifyUiTestLog(
  log: string,
  job: unknown,
  step: string,
  command: string,
  tests: number,
  workers: number,
) {
  assert.ok(
    Number.isSafeInteger(tests) && tests > 0,
    "Expected UI test count is required",
  );
  assert.ok(
    Number.isSafeInteger(workers) && workers > 0,
    "Expected UI workers are required",
  );
  const { records, selected, inWindow } = selectStepCommand(
    log,
    job,
    step,
    command,
  );
  const lines = records.map((row) => row.line).join("\n");
  assert.doesNotMatch(
    lines,
    /\(retry #\d+\)|^\s*\d+ (?:failed|flaky|skipped|interrupted|did not run|timed out)\b/mu,
    "UI was retried or not entirely clean",
  );
  const starts = selected.filter((row) =>
    /^Running \d+ tests? using \d+ workers?$/u.test(row.line),
  );
  assert.equal(starts.length, 1, "Missing or duplicate UI start summary");
  assert.equal(
    starts[0]!.line,
    `Running ${tests} tests using ${workers} worker${workers === 1 ? "" : "s"}`,
    "UI test or worker count changed",
  );
  assert.ok(inWindow(starts[0]!.timestamp), "UI start is outside its step");
  const summaries = selected.filter((row) =>
    /^\s*\d+ passed \([^)]+\)$/u.test(row.line),
  );
  assert.equal(summaries.length, 1, "Missing or duplicate UI pass summary");
  assert.ok(
    summaries[0]!.line.trim().startsWith(`${tests} passed (`),
    "UI pass count changed",
  );
  assert.ok(
    inWindow(summaries[0]!.timestamp),
    "UI summary is outside its step",
  );
  return {
    tests,
    passed: tests,
    workers,
    retries: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
  };
}
