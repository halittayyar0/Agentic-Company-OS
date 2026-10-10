import assert from "node:assert/strict";
import { record } from "./github-security";

/** GitHub step metadata has second precision; log timestamps have fractions. */
export function selectStepCommand(
  log: string,
  job: unknown,
  stepName: string,
  command: string,
) {
  const steps = record(job).steps;
  assert.ok(Array.isArray(steps), "Missing job steps");
  const matches = steps.map(record).filter((step) => step.name === stepName);
  assert.equal(matches.length, 1, "A unique original step is required");
  const step = matches[0]!;
  assert.equal(step.status, "completed", "Step is not complete");
  assert.equal(step.conclusion, "success", "Step did not succeed");
  assert.equal(typeof step.started_at, "string");
  assert.equal(typeof step.completed_at, "string");
  const startedAt = Date.parse(String(step.started_at));
  const completedAt = Date.parse(String(step.completed_at));
  assert.ok(
    Number.isFinite(startedAt) &&
      Number.isFinite(completedAt) &&
      completedAt >= startedAt,
    "Invalid step window",
  );
  const records = log
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
    .split(/\r?\n/u)
    .map((raw) => {
      const match = /^(\S+Z) (.*)$/u.exec(raw);
      return {
        line: match?.[2] ?? raw,
        timestamp: match ? Date.parse(match[1]!) : NaN,
      };
    });
  const commands = records.flatMap((row, index) =>
    row.line === `##[group]Run ${command}` ? [index] : [],
  );
  assert.equal(commands.length, 1, "A unique original command is required");
  const first = commands[0]!;
  const inWindow = (timestamp: number) =>
    timestamp >= startedAt && timestamp < completedAt + 1000;
  assert.ok(inWindow(records[first]!.timestamp), "Command is outside its step");
  let last = records.findIndex(
    (row, index) =>
      index > first &&
      (row.line.startsWith("##[group]Run ") ||
        row.line === "Post job cleanup."),
  );
  if (last < 0) last = records.length;
  return { records, selected: records.slice(first, last), step, inWindow };
}
