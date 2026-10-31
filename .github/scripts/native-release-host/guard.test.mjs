import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertReleaseConfiguration,
  assertExternalWorkflowContext,
  assertSourceIdentity,
  assertNativeMainProducer,
  verifyNewTaskSet,
} from "./guard.mjs";

const actualPrRun = JSON.parse(
  await readFile(
    new URL("./actual-pr-native-run.json", import.meta.url),
    "utf8",
  ),
);
const app = actualPrRun.head_sha,
  tree = "0e31628ce3ccee84e744da5f298851695c55ed7d",
  driver = "9".repeat(40);
const driverTree = "8".repeat(40);
const identity = {
  applicationCommit: app,
  applicationTree: tree,
  driverCommit: driver,
  driverTree,
};
const observed = {
  applicationCommit: app,
  applicationTree: tree,
  driverCommit: driver,
  driverTree,
  applicationClean: true,
  driverClean: true,
};
const expected = {
  repo: "halittayyar0/Agentic-Company-OS",
  repositoryId: 1392532090,
  applicationCommit: app,
  nativeRunId: actualPrRun.id,
};

test("external driver requires its own explicit original dispatch and cannot masquerade as main", () => {
  const external = {
    eventName: "workflow_dispatch",
    runAttempt: 1,
    runId: 123,
    ref: "refs/heads/codex/native-release-proof-runner",
  };
  assert.doesNotThrow(() => assertExternalWorkflowContext(external));
  for (const patch of [
    { eventName: "push" },
    { runAttempt: 2 },
    { runId: 0 },
    { ref: "refs/heads/main" },
    { ref: "refs/pull/92/merge" },
  ])
    assert.throws(() =>
      assertExternalWorkflowContext({ ...external, ...patch }),
    );
});

test("release preparation refuses unresolved real main inputs and unexpected configuration fields", async () => {
  const configuration = JSON.parse(
    await readFile(new URL("./config.json", import.meta.url), "utf8"),
  );
  const unresolved = {
    ...configuration,
    applicationCommit: null,
    nativeRunId: null,
    nativeArtifactId: null,
    nativeArtifactDigest: null,
    nativeArtifactBytes: null,
  };
  assert.throws(() => assertReleaseConfiguration(unresolved));
  const unit = {
    ...unresolved,
    applicationCommit: app,
    applicationTree: tree,
    nativeRunId: 1,
    nativeArtifactId: 2,
    nativeArtifactDigest: "b".repeat(64),
    nativeArtifactBytes: 100,
  };
  assert.doesNotThrow(() => assertReleaseConfiguration(unit));
  for (const patch of [
    { applicationCommit: null },
    { nativeRunId: 0 },
    { nativeArtifactDigest: "unknown" },
    { nativeArtifactBytes: 512 * 1024 * 1024 },
    { unexpected: "unreviewed" },
  ])
    assert.throws(() => assertReleaseConfiguration({ ...unit, ...patch }));
});

test("external driver retains distinct application identity and refuses unknown or changed source", () => {
  assert.doesNotThrow(() => assertSourceIdentity(identity, observed));
  for (const patch of [
    { applicationCommit: null },
    { applicationTree: "a".repeat(40) },
    { driverCommit: app },
    { applicationCommit: "x".repeat(40) },
  ])
    assert.throws(() =>
      assertSourceIdentity({ ...identity, ...patch }, observed),
    );
  assert.throws(() =>
    assertSourceIdentity(identity, { ...observed, applicationCommit: driver }),
  );
  assert.throws(() =>
    assertSourceIdentity(identity, { ...observed, applicationClean: false }),
  );
});

test("final source snapshot must detect a changed driver tree or dirty driver checkout", () => {
  assert.throws(() =>
    assertSourceIdentity(identity, { ...observed, driverTree: "7".repeat(40) }),
  );
  assert.throws(() =>
    assertSourceIdentity(identity, { ...observed, driverClean: false }),
  );
});

test("actual successful PR native producer cannot stand in for a released main producer", () => {
  assert.equal(actualPrRun.status, "completed");
  assert.equal(actualPrRun.conclusion, "success");
  assert.equal(actualPrRun.event, "pull_request");
  assert.throws(
    () => assertNativeMainProducer(actualPrRun, expected),
    /native_producer_main_push_required/,
  );
});

test("main-producer admission binds repository, source, original attempt and workflow", () => {
  const simulatedMain = { ...actualPrRun, event: "push", head_branch: "main" };
  assert.doesNotThrow(() => assertNativeMainProducer(simulatedMain, expected));
  for (const patch of [
    { run_attempt: 2 },
    { head_sha: driver },
    { head_branch: "codex/elsewhere" },
    { conclusion: "failure" },
    { status: "in_progress" },
    { path: ".github/workflows/ci.yml" },
    { id: actualPrRun.id + 1 },
    { repository: { ...actualPrRun.repository, private: true } },
    { head_repository: { ...actualPrRun.head_repository, id: 1 } },
  ])
    assert.throws(() =>
      assertNativeMainProducer({ ...simulatedMain, ...patch }, expected),
    );
});

const old = {
  id: 1,
  status: "completed",
  resultSummary: "Controlled baseline:391",
  tokensUsed: 100,
  completionAuthority: "agent",
  modelFallbackCount: 0,
  lastModelId: "ollama:controlled",
};
const created = {
  id: 2,
  status: "completed",
  resultSummary: "73",
  tokensUsed: 8281,
  completionAuthority: "agent",
  modelFallbackCount: 0,
  lastModelId: "ollama:qwen3.5:2b-q4_K_M",
};

test("fresh and upgraded task sets retain real global counts and exactly one new task", () => {
  assert.deepEqual(verifyNewTaskSet([], [{ ...created, id: 1 }], 1), {
    before: 0,
    after: 1,
    newTasks: 1,
    retainedIds: [],
  });
  assert.deepEqual(verifyNewTaskSet([old], [created, { ...old }], 2), {
    before: 1,
    after: 2,
    newTasks: 1,
    retainedIds: [1],
  });
});

test("upgrade task proof rejects lost or changed retained work, extra work and reused IDs", () => {
  for (const after of [
    [created],
    [old, created, { ...created, id: 3 }],
    [{ ...old, tokensUsed: 0 }, created],
    [{ ...old, resultSummary: "changed" }, created],
    [{ ...old, status: "in_progress" }, created],
    [old, old, created],
  ])
    assert.throws(() => verifyNewTaskSet([old], after, 2));
  assert.throws(() => verifyNewTaskSet([old], [old], 1));
  assert.throws(() =>
    verifyNewTaskSet([{ ...old, status: "in_progress" }], [old, created], 2),
  );
  assert.throws(() => verifyNewTaskSet([old, old], [old, created], 2));
});

test("every retained task field survives, including title, brief, owner and nested completion policy", () => {
  const retained = {
    ...old,
    title: "Saved baseline",
    brief: "Keep the original user request",
    ownerAgentId: 1,
    executionModelId: "ollama:acos-fixture:latest",
    completionRequirements: [{ kind: "tool_succeeded", tool: "calculate" }],
    createdAt: "2026-10-31T00:00:00Z",
  };
  assert.doesNotThrow(() =>
    verifyNewTaskSet([retained], [structuredClone(retained), created], 2),
  );
  for (const patch of [
    { title: "changed" },
    { brief: "changed" },
    { ownerAgentId: 99 },
    { executionModelId: "different" },
    { completionRequirements: [] },
    { createdAt: "2026-10-31T01:00:00Z" },
    { unexpected: "new unreviewed field" },
  ])
    assert.throws(() =>
      verifyNewTaskSet(
        [retained],
        [{ ...structuredClone(retained), ...patch }, created],
        2,
      ),
    );
});
