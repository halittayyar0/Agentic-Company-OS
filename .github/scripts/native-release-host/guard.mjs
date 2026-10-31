import assert from "node:assert/strict";

const sha40 = (value) =>
  assert.match(
    value ?? "",
    /^[a-f0-9]{40}$/u,
    "immutable_source_identity_required",
  );
const positive = (value) =>
  assert.ok(
    Number.isSafeInteger(value) && value > 0,
    "positive_integer_identity_required",
  );

export function assertReleaseConfiguration(value) {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    "release_configuration_required",
  );
  assert.deepEqual(
    Object.keys(value).sort(),
    [
      "schema",
      "repo",
      "repositoryId",
      "applicationCommit",
      "applicationTree",
      "nativeRunId",
      "nativeArtifactId",
      "nativeArtifactDigest",
      "nativeArtifactBytes",
    ].sort(),
    "closed_release_configuration_required",
  );
  assert.equal(value.schema, "native-release-host-inputs@1");
  assert.match(
    value.repo ?? "",
    /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/u,
  );
  sha40(value.applicationCommit);
  sha40(value.applicationTree);
  for (const key of [
    "repositoryId",
    "nativeRunId",
    "nativeArtifactId",
    "nativeArtifactBytes",
  ])
    positive(value[key]);
  assert.ok(
    value.nativeArtifactBytes <= 256 * 1024 * 1024,
    "bounded_native_artifact_required",
  );
  assert.match(
    value.nativeArtifactDigest ?? "",
    /^[a-f0-9]{64}$/u,
    "native_artifact_digest_required",
  );
  return value;
}

export function assertExternalWorkflowContext(value) {
  assert.equal(
    value.eventName,
    "workflow_dispatch",
    "explicit_external_workflow_dispatch_required",
  );
  assert.equal(
    value.runAttempt,
    1,
    "original_external_workflow_attempt_required",
  );
  positive(value.runId);
  assert.match(
    value.ref ?? "",
    /^refs\/heads\/codex\/[a-z0-9][a-z0-9/-]*$/u,
    "external_driver_branch_required",
  );
  return {
    eventName: "workflow_dispatch",
    runId: value.runId,
    runAttempt: 1,
    ref: value.ref,
  };
}

export function assertSourceIdentity(expected, observed) {
  for (const key of [
    "applicationCommit",
    "applicationTree",
    "driverCommit",
    "driverTree",
  ]) {
    sha40(expected[key]);
    sha40(observed[key]);
    assert.equal(
      observed[key],
      expected[key],
      "application_or_driver_source_changed",
    );
  }
  assert.notEqual(
    expected.applicationCommit,
    expected.driverCommit,
    "external_driver_must_not_be_relabeled_as_application_source",
  );
  assert.equal(
    observed.applicationClean,
    true,
    "clean_application_checkout_required",
  );
  assert.equal(
    observed.driverClean,
    true,
    "clean_external_driver_checkout_required",
  );
}

export function assertNativeMainProducer(run, expected) {
  sha40(expected.applicationCommit);
  positive(expected.nativeRunId);
  positive(expected.repositoryId);
  assert.match(
    expected.repo ?? "",
    /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/u,
  );
  assert.equal(run.event, "push", "native_producer_main_push_required");
  assert.equal(run.head_branch, "main", "native_producer_main_branch_required");
  assert.equal(
    run.head_sha,
    expected.applicationCommit,
    "native_producer_source_mismatch",
  );
  assert.equal(run.id, expected.nativeRunId, "native_producer_run_mismatch");
  assert.equal(run.run_attempt, 1, "original_native_producer_attempt_required");
  assert.equal(run.status, "completed", "completed_native_producer_required");
  assert.equal(
    run.conclusion,
    "success",
    "successful_native_producer_required",
  );
  assert.equal(
    run.path,
    ".github/workflows/native-packages.yml",
    "native_producer_workflow_mismatch",
  );
  assert.equal(
    run.repository?.full_name,
    expected.repo,
    "native_producer_repository_mismatch",
  );
  assert.equal(
    run.repository?.id,
    expected.repositoryId,
    "native_producer_repository_id_mismatch",
  );
  assert.equal(
    run.repository?.private,
    false,
    "standard_public_runner_scope_required",
  );
  assert.equal(
    run.head_repository?.full_name,
    expected.repo,
    "native_producer_head_repository_mismatch",
  );
  assert.equal(
    run.head_repository?.id,
    expected.repositoryId,
    "native_producer_head_repository_id_mismatch",
  );
  return { runId: run.id, applicationCommit: run.head_sha, attempt: 1 };
}

function taskMap(rows) {
  assert.ok(Array.isArray(rows), "task_snapshot_array_required");
  const map = new Map();
  for (const row of rows) {
    assert.ok(
      row && typeof row === "object" && !Array.isArray(row),
      "task_snapshot_row_required",
    );
    positive(row.id);
    assert.equal(map.has(row.id), false, "duplicate_task_identity");
    map.set(row.id, row);
  }
  return map;
}

export function verifyNewTaskSet(before, after, createdId) {
  positive(createdId);
  const initial = taskMap(before),
    final = taskMap(after);
  assert.ok(
    initial.size <= 1,
    "only_empty_or_one_controlled_baseline_fixture_supported",
  );
  assert.equal(
    initial.has(createdId),
    false,
    "new_task_must_have_new_identity",
  );
  assert.equal(
    final.size,
    initial.size + 1,
    "exact_global_task_cardinality_required",
  );
  assert.deepEqual(
    [...final.keys()].sort((a, b) => a - b),
    [...initial.keys(), createdId].sort((a, b) => a - b),
    "exact_global_task_identity_set_required",
  );
  for (const [id, old] of initial) {
    assert.equal(
      old.status,
      "completed",
      "stopped_completed_baseline_required",
    );
    // GET/tasks projects DB rows plus persisted usage; exclude no fields.
    assert.deepEqual(final.get(id), old, "retained_task_changed");
  }
  assert.equal(
    final.get(createdId)?.status,
    "completed",
    "new_task_completion_required",
  );
  return {
    before: initial.size,
    after: final.size,
    newTasks: 1,
    retainedIds: [...initial.keys()].sort((a, b) => a - b),
  };
}
