import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const inspectedSource =
  "586478a9bbb1e80961a698c01800c0db3b22e57dc75f5597bad5f4dac9860af4";

/** Instrument a private TEST driver; never modify the application or package. */
export function derivePrivatePackageDriver(text) {
  let source = text.replaceAll("\r\n", "\n");
  assert.equal(
    hash(source),
    inspectedSource,
    "inspected_native_driver_source_required",
  );
  const changes = [];
  const replace = (before, after, label) => {
    assert.equal(
      source.split(before).length - 1,
      1,
      "unique_driver_instrumentation_anchor_required:" + label,
    );
    source = source.replace(before, after);
    changes.push(label);
  };
  for (const [before, after] of [
    [
      "../endurance/process-supervisor",
      "../../scripts/src/endurance/process-supervisor",
    ],
    [
      "../endurance/native-postgres-harness",
      "../../scripts/src/endurance/native-postgres-harness",
    ],
    [
      "../testing/controlled-arithmetic-peer",
      "../../scripts/src/testing/controlled-arithmetic-peer",
    ],
    ["./native-distribution", "../../scripts/src/setup/native-distribution"],
    ["./backup-restore-proof", "../../scripts/src/setup/backup-restore-proof"],
    ["./native-package-proof", "../../scripts/src/setup/native-package-proof"],
  ])
    replace(
      'from "' + before + '"',
      'from "' + after + '"',
      "relocate_import:" + before,
    );
  replace(
    'new URL("../../..", import.meta.url)',
    'new URL("../..", import.meta.url)',
    "retain_actual_application_root",
  );
  replace(
    'import assert from "node:assert/strict";',
    [
      'import assert from "node:assert/strict";',
      'import { observeOwnedFirstTask } from "../../scripts/src/testing/real-local-first-task-observer";',
      'import { createPackagePhaseRecorder, projectPackageFailure } from "./package-diagnostics.mjs";',
    ].join("\n"),
    "use_application_get_only_observer",
  );
  replace(
    'const live = options.has("--local-endpoint");',
    [
      'const live = options.has("--local-endpoint");',
      'assert.equal(live, true, "external_fresh_proof_requires_owned_local_endpoint");',
    ].join("\n"),
    "explicit_genuine_fresh_case",
  );
  const oldPolling = [
    "  let finished: Record<string, unknown> = {};",
    "  const taskDeadline = Date.now() + (live ? 20 * 60_000 : 90_000);",
    "  do {",
    "    finished = await request(`/tasks/${task.id}`);",
    "    if (",
    '      ["completed", "failed", "blocked", "cancelled"].includes(',
    "        String(finished.status),",
    "      )",
    "    )",
    "      break;",
    "    await delay(live ? 3000 : 500);",
    "  } while (Date.now() < taskDeadline);",
  ].join("\n");
  const newPolling = [
    "  const taskObservation = { attempts: 0, transientFailures: 0, lastFailure: null, lastTaskAt: null };",
    "  proof.taskObservation = taskObservation;",
    "  const finished = await observeOwnedFirstTask<Record<string, unknown> & { status: string }>({",
    '    baseUrl: new URL(appUrl).origin + "/",',
    "    operatorToken,",
    "    taskId: task.id,",
    "    deadline: Date.now() + 15 * 60_000,",
    "    summary: taskObservation,",
    "  });",
  ].join("\n");
  replace(
    oldPolling,
    newPolling,
    "observe_same_task_with_original_15minute_bound",
  );
  replace(
    "  proof.firstTask = Object.fromEntries(",
    [
      "  proof.createdTaskId = task.id;",
      "  proof.completionAuthority = finished.completionAuthority;",
      "  proof.firstTask = Object.fromEntries(",
    ].join("\n"),
    "retain_actual_created_task_identity_privately",
  );
  replace(
    "  const brief = live",
    [
      '  proof.tasksBefore = await request<unknown[]>("/tasks");',
      "  assert.equal((proof.tasksBefore as unknown[]).length, 0);",
      "  proof.agentIdsBefore = agents.map(agent => agent.id).sort((a,b) => a-b);",
      "  const brief = live",
    ].join("\n"),
    "retain_global_before_task_and_agent_identities",
  );
  replace(
    "  if (peer) {",
    [
      '  proof.tasksAfter = await request<unknown[]>("/tasks");',
      '  proof.agentIdsAfter = (await request<Array<{id:number}>>("/agents")).map(agent => agent.id).sort((a,b) => a-b);',
      "  assert.deepEqual(proof.agentIdsAfter, proof.agentIdsBefore);",
      "  if (peer) {",
    ].join("\n"),
    "retain_complete_durable_after_task_snapshot",
  );
  replace(
    "  proof.finishedAt = new Date().toISOString();",
    [
      "  proof.privateFixture = { owned, packageRoot, parent, instance, appUrl };",
      "  proof.finishedAt = new Date().toISOString();",
    ].join("\n"),
    "private_fixture_handoff_for_actual_viewport_readback",
  );
  replace(
    "  console.log(JSON.stringify(proof));",
    "  console.log(JSON.stringify({ accepted: proof.accepted, cleanupVerified: proof.cleanupVerified, error: proof.error }));",
    "no_model_prose_or_private_paths_in_stdout",
  );
  replace(
    "let child: ChildProcess | undefined;",
    "const recordPackagePhase = createPackagePhaseRecorder(evidencePath);\nlet child: ChildProcess | undefined;",
    "private_append_only_phase_recorder",
  );
  for (const [anchor, phase] of [
    [
      "  await executeBoundedCommand({\n    command:\n      process.env.PYTHON ??",
      "archive_extract",
    ],
    [
      "  const manifest = await readNativeDistribution(packageRoot);",
      "inventory",
    ],
    [
      '  assert.equal(\n    (await run(node(), ["--version"])).stdout.trim(),',
      "node_version",
    ],
    [
      '  await run(node(), [path.join(source, "scripts/test-runtime-security.mjs")]);',
      "node_dns_security",
    ],
    [
      "  // Use the shipped launcher for its read-only check with no developer tools on PATH.",
      "launcher_check",
    ],
    ["  const launched = await startPackage();", "setup_start"],
    ["  const capabilities = await setup<", "capabilities"],
    ["  const plan = await setup<", "plan"],
    ['  await setup("install", "POST", {', "install"],
    ["  let state: Record<string, unknown> = {};", "installation_state"],
    ["  appUrl = String(state.url);", "connection"],
    ["  const agents =\n", "agents"],
    ['  await request(`/agents/${owner.id}`, "PATCH", {', "owner_model"],
    [
      '  const task = await request<{ id: number }>("/tasks", "POST", {',
      "task_create",
    ],
    [
      "  const taskObservation = { attempts: 0, transientFailures: 0, lastFailure: null, lastTaskAt: null };",
      "task_observe",
    ],
    ['  assert.equal(finished.status, "completed");', "task_contract"],
    ["  const connectionArgs = [", "private_database"],
    [
      '  const copyRegression = path.join(owned, "runtime-copy-security.sql");',
      "copy_security",
    ],
    ["  proof.backup = await proveDatabaseBackup({", "backup"],
    ["  const resumed = await startPackage();", "restart"],
    [
      "  // Relocation and launched infrastructure must leave packaged bytes unchanged.",
      "final_inventory",
    ],
    ["  proof.cleanupVerified = true;\n  proof.accepted = true;", "complete"],
  ])
    replace(
      anchor,
      '  proof.preparationPhase = "' +
        phase +
        '";\n  await recordPackagePhase("' +
        phase +
        '");\n' +
        anchor,
      "record_private_phase:" + phase,
    );
  replace(
    '  proof.error = "package_acceptance_failed";',
    '  proof.error = "package_acceptance_failed";\n  proof.failureProjection = projectPackageFailure(error);',
    "closed_original_failure_without_prose",
  );
  replace(
    "  } catch {\n    proof.accepted = false;\n    proof.cleanupVerified = false;",
    "  } catch (cleanupError) {\n    proof.cleanupFailure = projectPackageFailure(cleanupError);\n    proof.accepted = false;\n    proof.cleanupVerified = false;",
    "closed_cleanup_failure_without_prose",
  );
  return {
    source,
    inputSha256: inspectedSource,
    outputSha256: hash(source),
    changes,
  };
}

/** Published old runtime is solely an upgrade input, never current CVE proof. */
export function deriveControlledBaselineDriver(text) {
  const fresh = derivePrivatePackageDriver(text);
  let source = fresh.source;
  const changes = [...fresh.changes];
  const replace = (before, after, label) => {
    assert.equal(
      source.split(before).length - 1,
      1,
      "unique_baseline_anchor_required:" + label,
    );
    source = source.replace(before, after);
    changes.push(label);
  };
  replace(
    'assert.equal(live, true, "external_fresh_proof_requires_owned_local_endpoint");',
    'assert.equal(live, false, "baseline_requires_controlled_simulated_peer_only");',
    "old_baseline_controlled_only",
  );
  replace(
    "    deadline: Date.now() + 15 * 60_000,",
    "    deadline: Date.now() + 90_000,",
    "retain_original_controlled_baseline_deadline",
  );
  replace(
    "  proof.commit = manifest.commit;",
    [
      '  assert.equal(manifest.commit, "ea9c571be0f81f4590453086e6675ff654ab1458");',
      '  assert.equal(manifest.nodeVersion, "24.21.0");',
      '  assert.equal(manifest.postgresVersion, "17.10");',
      '  assert.equal(proof.archiveSha256, "6d8f6ab631f527d5cfc1e7c63c5584e3e6b4f89d7c38dc900cd291378193c80a");',
      "  proof.commit = manifest.commit;",
      "  proof.oldRuntimeUpgradeInputOnly = true;",
    ].join("\n"),
    "actual_published_baseline_bytes_only",
  );
  replace(
    '  await run(node(), [path.join(source, "scripts/test-runtime-security.mjs")]);\n  proof.nodeDnsSecurityRegression = true;',
    "  proof.nodeDnsSecurityRegression = false;",
    "no_current_node_security_claim_for_old_input",
  );
  replace(
    '  const copyRegression = path.join(owned, "runtime-copy-security.sql");',
    '  if (live) {\n  const copyRegression = path.join(owned, "runtime-copy-security.sql");',
    "exclude_old_postgres_from_current_security_probe",
  );
  replace(
    "  proof.postgresCopySecurityRegression = true;",
    "  proof.postgresCopySecurityRegression = true;\n  } else { proof.postgresCopySecurityRegression = false; }",
    "no_current_postgres_security_claim_for_old_input",
  );
  return {
    source,
    inputSha256: inspectedSource,
    outputSha256: hash(source),
    changes,
  };
}
