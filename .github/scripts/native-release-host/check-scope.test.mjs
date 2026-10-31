import test from "node:test";
import assert from "node:assert/strict";
import { classifyMainCheckFailures } from "./guard.mjs";

// Closed projection of the actual original main-N maintenance failure observed
// via GitHub REST; this is not an application-test producer or acceptance.
const repo = "halittayyar0/Agentic-Company-OS",
  sha = "5bf1403a9d1134c2d0ee4bb0676eede6022f6e78";
const expected = { repo, applicationCommit: sha, repositoryId: 1392532090 };
const check = {
  id: 124639813454,
  name: "Dependabot",
  head_sha: sha,
  status: "completed",
  conclusion: "failure",
  app: { id: 15368 },
  details_url:
    "https://github.com/" + repo + "/actions/runs/41236001265/job/124639813454",
};
const originalJob = {
  id: check.id,
  run_id: 41236001265,
  run_attempt: 1,
  head_sha: sha,
  name: "Dependabot",
  status: "completed",
  conclusion: "failure",
  check_run_url:
    "https://api.github.com/repos/" + repo + "/check-runs/" + check.id,
};
const producer = {
  id: 41236001265,
  event: "dynamic",
  path: "dynamic/dependabot/dependabot-updates",
  head_branch: "main",
  head_sha: sha,
  run_attempt: 1,
  status: "completed",
  conclusion: "failure",
  repository: { id: 1392532090, full_name: repo },
  originalJobs: [originalJob],
};

test("actual dynamic dependency-maintenance failure stays failed and cannot stand in for an application result", () => {
  const result = classifyMainCheckFailures(
    [check],
    new Map([[producer.id, producer]]),
    expected,
  );
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(result.maintenance, [
    {
      checkId: check.id,
      producerRunId: producer.id,
      status: "completed",
      conclusion: "failure",
      scope: "automated_dependency_maintenance",
    },
  ]);
  assert.equal(check.conclusion, "failure");
  assert.equal(producer.conclusion, "failure");
});

test("real application failures and unbound lookalikes always block; names or shared Actions app alone cannot waive a gate", () => {
  for (const patch of [
    { event: "push", path: ".github/workflows/ci.yml" },
    { head_sha: "b".repeat(40) },
    { run_attempt: 2 },
    { repository: { id: 1, full_name: repo } },
    { path: "dynamic/other" },
    { id: 1 },
  ]) {
    assert.deepEqual(
      classifyMainCheckFailures(
        [check],
        new Map([[producer.id, { ...producer, ...patch }]]),
        expected,
      ).blocking,
      [check.id],
    );
  }
  for (const patch of [
    { name: "Format, audit, test, typecheck, and build" },
    { app: { id: 1 } },
    { details_url: check.details_url + "?unbound=1" },
    { id: 1 },
    { head_sha: "b".repeat(40) },
  ]) {
    const changed = { ...check, ...patch };
    assert.deepEqual(
      classifyMainCheckFailures(
        [changed],
        new Map([[producer.id, producer]]),
        expected,
      ).blocking,
      [changed.id],
    );
  }
  assert.deepEqual(
    classifyMainCheckFailures([check], new Map(), expected).blocking,
    [check.id],
  );
});

test("a made-up check URL cannot borrow an actual dynamic run without original job membership", () => {
  const fake = {
    ...check,
    id: 999999,
    details_url:
      "https://github.com/" + repo + "/actions/runs/41236001265/job/999999",
  };
  assert.deepEqual(
    classifyMainCheckFailures(
      [fake],
      new Map([[producer.id, producer]]),
      expected,
    ).blocking,
    [fake.id],
  );
  for (const patch of [
    { originalJobs: [] },
    { originalJobs: undefined },
    { originalJobs: [originalJob, originalJob] },
    ...[
      "id",
      "run_id",
      "run_attempt",
      "head_sha",
      "name",
      "status",
      "conclusion",
      "check_run_url",
    ].map((key) => ({ originalJobs: [{ ...originalJob, [key]: "unbound" }] })),
  ]) {
    assert.deepEqual(
      classifyMainCheckFailures(
        [check],
        new Map([[producer.id, { ...producer, ...patch }]]),
        expected,
      ).blocking,
      [check.id],
    );
  }
});
