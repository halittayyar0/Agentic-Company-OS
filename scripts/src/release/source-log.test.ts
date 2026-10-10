import assert from "node:assert/strict";
import { test } from "node:test";
import { verifySourceTestLog } from "./source-log";

const step = {
  name: "Test",
  status: "completed",
  conclusion: "success",
  started_at: "2026-10-10T03:00:00Z",
  completed_at: "2026-10-10T03:01:00Z",
};
const job = { steps: [step] };
const expected = {
  tests: 3,
  passed: 2,
  skippedCases: ["﹣ Linux only (1ms) # Windows"],
};
const lines = [
  "2026-10-10T03:00:00.100Z ##[group]Run pnpm test",
  "2026-10-10T03:00:00.101Z pnpm test",
  "2026-10-10T03:00:00.102Z ##[endgroup]",
  "2026-10-10T03:00:58.000Z ✔ first test (1ms)",
  "2026-10-10T03:00:58.001Z ✔ second test (1ms)",
  "2026-10-10T03:00:58.002Z ﹣ Linux only (1ms) # Windows",
  "2026-10-10T03:01:00.050Z ℹ tests 3",
  "2026-10-10T03:01:00.051Z ℹ pass 2",
  "2026-10-10T03:01:00.052Z ℹ fail 0",
  "2026-10-10T03:01:00.053Z ℹ cancelled 0",
  "2026-10-10T03:01:00.054Z ℹ skipped 1",
];
const sourceLog = lines.join("\n");
const extraSummary = (i: number) =>
  [
    `2026-10-10T03:02:0${i}.000Z ##[group]Run pnpm test:postgres`,
    `2026-10-10T03:02:0${i}.100Z ℹ tests 1`,
  ].join("\n");

test("source result remains bound to its step when eight PostgreSQL summaries follow", () => {
  const log = [
    sourceLog,
    ...Array.from({ length: 8 }, (_, i) => extraSummary(i)),
  ].join("\n");
  assert.deepEqual(verifySourceTestLog(log, job, "Test", expected), {
    tests: 3,
    passed: 2,
    failed: 0,
    cancelled: 0,
    skipped: 1,
    skippedCases: ["Linux only # Windows"],
    step: {
      name: "Test",
      startedAt: step.started_at,
      completedAt: step.completed_at,
    },
    allSummaryTests: 9,
  });
});
test("ANSI and CRLF output preserves the verified source result", () => {
  assert.ok(
    verifySourceTestLog(
      sourceLog.replace(/ℹ/gu, "\x1b[34mℹ\x1b[0m").replace(/\n/gu, "\r\n"),
      job,
      "Test",
      expected,
    ),
  );
});
for (const [name, log] of [
  ["missing command", lines.slice(1).join("\n")],
  ["duplicate command", sourceLog + "\n" + lines[0]],
  [
    "command outside the step",
    sourceLog.replace("03:00:00.100Z", "02:59:00.100Z"),
  ],
  [
    "summary outside the step",
    sourceLog.replace("03:01:00.050Z", "03:02:00.050Z"),
  ],
  [
    "missing summary",
    lines.filter((line) => !line.includes("ℹ tests")).join("\n"),
  ],
  ["duplicate summary", sourceLog + "\n" + lines[6]],
  ["a failed test", sourceLog.replace("ℹ fail 0", "ℹ fail 1")],
  ["a cancelled test", sourceLog.replace("ℹ cancelled 0", "ℹ cancelled 1")],
  ["fewer tests", sourceLog.replace("ℹ tests 3", "ℹ tests 2")],
  [
    "different skipped case",
    sourceLog.replace("Linux only", "unexpectedly skipped"),
  ],
  [
    "missing summary timestamp",
    sourceLog.replace("2026-10-10T03:01:00.050Z ", ""),
  ],
] as const) {
  test(`source proof rejects ${name}`, () => {
    assert.throws(() => verifySourceTestLog(log, job, "Test", expected));
  });
}
for (const [name, steps] of [
  ["missing step", []],
  ["duplicate step", [step, step]],
  ["failed step", [{ ...step, conclusion: "failure" }]],
  ["invalid window", [{ ...step, completed_at: "2026-10-10T02:00:00Z" }]],
] as const) {
  test(`source proof rejects ${name}`, () => {
    assert.throws(() =>
      verifySourceTestLog(sourceLog, { steps }, "Test", expected),
    );
  });
}
