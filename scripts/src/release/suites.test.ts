import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyCandidateSuites } from "./suites";
import { fixture, stages } from "./test-fixtures";

const report = fixture().report;
test("suite proof covers all four source and three UI stages from original bound jobs", async () => {
  const f = fixture();
  const result = await verifyCandidateSuites(
    f.api,
    f.readLog,
    report,
    f.expectations,
  );
  assert.deepEqual(
    result.stages.map((stage) => stage.key),
    stages,
  );
  assert.ok(
    result.stages.every((stage) => /^[a-f0-9]{64}$/u.test(stage.logSha256)),
  );
  assert.equal(result.producers.length, 14);
});
for (const [name, mutate] of [
  [
    "a CodeQL producer outside the original PR workflow",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(30)!.event = "workflow_dispatch";
    },
  ],
  [
    "a source suite that checked out another PR merge",
    (f: ReturnType<typeof fixture>) => {
      f.logs.set(
        1,
        f.logs.get(1)!.replaceAll(f.report.testedMerge, "f".repeat(40)),
      );
    },
  ],
  [
    "wrong workflow commit",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(10)!.head_sha = "b".repeat(40);
    },
  ],
  [
    "wrong workflow event",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(10)!.event = "workflow_dispatch";
    },
  ],
  [
    "restarted workflow",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(10)!.run_attempt = 2;
    },
  ],
  [
    "wrong job commit",
    (f: ReturnType<typeof fixture>) => {
      f.jobs[0]!.head_sha = "b".repeat(40);
    },
  ],
  [
    "failed source step",
    (f: ReturnType<typeof fixture>) => {
      f.jobs[0]!.steps.find((step) => step.name === "Test")!.conclusion =
        "failure";
    },
  ],
  [
    "retried Linux UI",
    (f: ReturnType<typeof fixture>) => {
      f.logs.set(1, f.logs.get(1)! + "\n2026-10-10T00:00:44Z (retry #1)");
    },
  ],
  [
    "missing Mac architecture",
    (f: ReturnType<typeof fixture>) => {
      f.jobs.splice(5, 1);
    },
  ],
  [
    "an omitted expected stage",
    (f: ReturnType<typeof fixture>) => {
      delete f.expectations.windows;
    },
  ],
  [
    "lowered but inconsistent source expectation",
    (f: ReturnType<typeof fixture>) => {
      f.expectations.linux!.source!.tests = 1;
    },
  ],
] as const) {
  test(`suite proof rejects ${name}`, async () => {
    const f = fixture();
    mutate(f);
    await assert.rejects(
      verifyCandidateSuites(f.api, f.readLog, report, f.expectations),
    );
  });
}
