import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./test-fixtures";
import { verifyRequiredProducers } from "./producers";

test("producer proof binds all ten original Actions gates and four Mac dependencies", async () => {
  const f = fixture();
  const proof = await verifyRequiredProducers(f.api, f.readLog, f.report);
  assert.equal(proof.length, 14);
});
test("main producer proof retains original PR provenance and binds the squash jobs", async () => {
  const f = fixture("main");
  const proof = await verifyRequiredProducers(f.api, f.readLog, f.report);
  assert.equal(proof.length, 28);
});
for (const [name, mutate] of [
  [
    "CodeQL from workflow_dispatch",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(30)!.event = "workflow_dispatch";
    },
  ],
  [
    "Gitleaks from a scheduled run",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(40)!.event = "schedule";
    },
  ],
  [
    "coding helper from another workflow",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(50)!.path = ".github/workflows/ci.yml";
    },
  ],
  [
    "a restarted helper workflow",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(50)!.run_attempt = 2;
    },
  ],
  [
    "a job from another commit",
    (f: ReturnType<typeof fixture>) => {
      f.jobs[10]!.head_sha = "f".repeat(40);
    },
  ],
  [
    "a failed original producer",
    (f: ReturnType<typeof fixture>) => {
      f.jobs[10]!.conclusion = "failure";
    },
  ],
  [
    "a producer from another repository",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(40)!.repository.full_name = "other/repo";
    },
  ],
  [
    "a producer from another fork",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(40)!.head_repository.full_name = "other/fork";
    },
  ],
  [
    "a run linked to another PR",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(40)!.pull_requests = [
        {
          number: 48,
          head: { sha: f.report.head },
          base: { sha: f.report.base, ref: "main" },
        },
      ];
    },
  ],
  [
    "a run linked to another PR base",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(40)!.pull_requests = [
        {
          number: 47,
          head: { sha: f.report.head },
          base: { sha: "f".repeat(40), ref: "main" },
        },
      ];
    },
  ],
  [
    "a reused merge checkout",
    (f: ReturnType<typeof fixture>) => {
      f.logs.set(
        11,
        f.logs.get(11)!.replaceAll(f.report.testedMerge, "f".repeat(40)),
      );
    },
  ],
  [
    "a failed Mac dependency",
    (f: ReturnType<typeof fixture>) => {
      f.jobs[4]!.conclusion = "failure";
    },
  ],
  [
    "an omitted Mac dependency",
    (f: ReturnType<typeof fixture>) => {
      f.jobs.splice(4, 1);
    },
  ],
  [
    "a duplicate original job",
    (f: ReturnType<typeof fixture>) => {
      f.jobs.push({ ...f.jobs[10]!, id: 81 });
    },
  ],
  [
    "a replaced required job identity",
    (f: ReturnType<typeof fixture>) => {
      f.jobs[10]!.id = 82;
    },
  ],
  [
    "CI gates split across runs",
    (f: ReturnType<typeof fixture>) => {
      f.jobs[8]!.run_id = 90;
      f.runs.set(90, { ...f.runs.get(10)!, id: 90 });
    },
  ],
  [
    "a skipped original checkout",
    (f: ReturnType<typeof fixture>) => {
      f.jobs[10]!.steps[0]!.conclusion = "skipped";
    },
  ],
  [
    "a missing required producer",
    (f: ReturnType<typeof fixture>) => {
      f.report.gates = f.report.gates.filter(
        (gate) => gate.name !== "Gitleaks history scan",
      );
    },
  ],
  [
    "a Mac dependency checking out another PR",
    (f: ReturnType<typeof fixture>) => {
      f.logs.set(
        5,
        f.logs.get(5)!.replaceAll("pull/47/merge", "pull/48/merge"),
      );
    },
  ],
] as const)
  test(`producer proof rejects ${name}`, async () => {
    const f = fixture();
    mutate(f);
    await assert.rejects(verifyRequiredProducers(f.api, f.readLog, f.report));
  });
test("main producer proof rejects a squash checkout of the old PR merge", async () => {
  const f = fixture("main");
  f.logs.set(
    111,
    f.logs.get(111)!.replaceAll(f.report.main, f.report.testedMerge),
  );
  await assert.rejects(verifyRequiredProducers(f.api, f.readLog, f.report));
});
