import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyUiTestLog } from "./ui-log";
const step = {
  name: "UI",
  status: "completed",
  conclusion: "success",
  started_at: "2026-10-10T04:00:00Z",
  completed_at: "2026-10-10T04:01:00Z",
};
const job = { steps: [step] };
const command = "pnpm exec playwright test --config playwright.config.ts";
const log = [
  `2026-10-10T04:00:00.100Z ##[group]Run ${command}`,
  "2026-10-10T04:00:00.101Z ##[endgroup]",
  "2026-10-10T04:00:02.000Z Running 29 tests using 1 worker",
  "2026-10-10T04:00:59.000Z   29 passed (57s)",
].join("\n");
test("UI proof accepts a single clean run scoped to its original step", () => {
  assert.deepEqual(verifyUiTestLog(log, job, "UI", command, 29, 1), {
    tests: 29,
    passed: 29,
    workers: 1,
    retries: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
  });
});
for (const [name, changed] of [
  ["retried UI", log + "\n2026-10-10T04:00:30Z [1/29] (retry #1)"],
  ["flaky UI", log + "\n2026-10-10T04:00:58Z   1 flaky"],
  ["failed UI", log + "\n2026-10-10T04:00:58Z   1 failed"],
  ["skipped UI", log + "\n2026-10-10T04:00:58Z   1 skipped"],
  ["interrupted UI", log + "\n2026-10-10T04:00:58Z   1 interrupted"],
  ["unrun UI", log + "\n2026-10-10T04:00:58Z   1 did not run"],
  ["missing start count", log.replace("Running 29", "Running 28")],
  ["wrong pass count", log.replace("29 passed", "28 passed")],
  ["wrong workers", log.replace("1 worker", "2 workers")],
  ["out-of-step summary", log.replace("04:00:59.000Z", "04:02:59.000Z")],
  ["a duplicate run", log + "\n" + log],
] as const) {
  test(`UI proof rejects ${name}`, () => {
    assert.throws(() => verifyUiTestLog(changed, job, "UI", command, 29, 1));
  });
}
