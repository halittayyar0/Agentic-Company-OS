import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  readFile,
  writeFile,
  appendFile,
  readdir,
  realpath,
  access,
  mkdir,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import {
  assertReleaseConfiguration,
  assertExternalWorkflowContext,
  assertSourceIdentity,
  verifyNewTaskSet,
} from "./guard.mjs";
import { verifyDriverCopy } from "./copy.mjs";
import { startOwnedReleaseModel, releaseModel } from "./runtime.mts";
import {
  PackageSession,
  hash,
  save,
  directoryDigest,
  fixtureSecrets,
  authenticatedPage,
  captureDeliveries,
  assertSafePublicText,
} from "./package-session.mts";
import { readNativeDistribution } from "../../scripts/src/setup/native-distribution";
import { inventoryNativeCluster } from "../../scripts/src/setup/native-cluster-snapshot";
import { observeOwnedFirstTask } from "../../scripts/src/testing/real-local-first-task-observer";
import { verifyRealFirstTask } from "../../scripts/src/testing/real-local-first-task-proof";
import { executeBoundedCommand } from "../../scripts/src/endurance/process-supervisor";

const execute = promisify(execFile),
  directory = path.dirname(fileURLToPath(import.meta.url));
let stage = "configuration",
  accepted = false,
  cleanupVerified = false,
  ordinaryVerified = false,
  packageDriverFailed = false;
let model: Awaited<ReturnType<typeof startOwnedReleaseModel>> | undefined;
let session: PackageSession | undefined,
  browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let context: any,
  applicationCommit: string | null = null,
  applicationTree: string | null = null,
  driverCommit: string | null = null;
let fresh: any = null,
  upgraded: any = null,
  upgrade: any = null;
const privateRoot = process.env.ACOS_PRIVATE_EXECUTION_ROOT!,
  output = process.env.ACOS_PUBLIC_OUTPUT_ROOT!;
const allSecrets: string[] = [];
const git = async (root: string, ...args: string[]) =>
  (
    await execute(process.env.ACOS_GIT_EXECUTABLE!, ["-C", root, ...args], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 1048576,
    })
  ).stdout.trim();
async function sourceIdentity() {
  const app = context.applicationRoot,
    driver = context.driverRoot;
  assertSourceIdentity(context.identity, {
    applicationCommit: await git(app, "rev-parse", "HEAD"),
    applicationTree: await git(app, "rev-parse", "HEAD^{tree}"),
    applicationClean:
      (await git(
        app,
        "status",
        "--porcelain=v1",
        "--untracked-files=normal",
      )) === "",
    driverCommit: await git(driver, "rev-parse", "HEAD"),
    driverTree: await git(driver, "rev-parse", "HEAD^{tree}"),
    driverClean:
      (await git(
        driver,
        "status",
        "--porcelain=v1",
        "--untracked-files=normal",
      )) === "",
  });
  assert.deepEqual(
    await verifyDriverCopy(
      path.join(driver, ".github/scripts/native-release-host"),
      directory,
    ),
    context.copiedDriver,
  );
  for (const [name, key] of [
    ["fresh-package-driver.mts", "fresh"],
    ["baseline-package-driver.mts", "baseline"],
    ["ordinary-native-host.ps1", "ordinaryWindows"],
  ])
    assert.equal(
      hash(await readFile(path.join(directory, name))),
      context.derivedTestDrivers[key].outputSha256,
      "derived_driver_bytes_changed",
    );
}
async function runPackageDriver(name: "fresh" | "baseline", archive: string) {
  const evidence = path.join(privateRoot, name + "-package-private.json");
  const args = [
    "--import",
    path.join(context.applicationRoot, "node_modules/tsx/dist/loader.mjs"),
    path.join(directory, name + "-package-driver.mts"),
    "--archive",
    archive,
    "--evidence",
    evidence,
  ];
  if (name === "fresh")
    args.push(
      "--local-endpoint",
      model!.relay.endpoint,
      "--local-model",
      releaseModel,
    );
  // The child writes prose and diagnostics privately. Its source has its own
  // unchanged bounded model-call/task/installer and cleanup checks.
  try {
    // Extraction 2m + two starts 8m + installation 4m + finite task15m
    // + security/backup/stop/receipt reserve11m. Baseline task stays90s.
    // The application-owned helper joins exact descendant-tree termination
    // on timeout; an interrupted child can never report accepted cleanup.
    await executeBoundedCommand({
      command: process.execPath,
      args,
      cwd: context.applicationRoot,
      environment: process.env,
      timeoutMs: (name === "fresh" ? 40 : 25) * 60000,
      maxBufferBytes: 1048576,
    });
  } catch (error) {
    packageDriverFailed = true;
    throw error;
  }
  const proof = JSON.parse(await readFile(evidence, "utf8"));
  assert.equal(proof.accepted, true);
  assert.equal(proof.cleanupVerified, true);
  const fixture = proof.privateFixture;
  assert.ok(
    fixture && fixture.instance && fixture.packageRoot && fixture.parent,
  );
  const owned = await realpath(fixture.owned);
  assert.ok(owned.startsWith(privateRoot + path.sep));
  for (const key of ["instance", "parent", "packageRoot"])
    assert.ok((await realpath(fixture[key])).startsWith(owned + path.sep));
  allSecrets.push(...(await fixtureSecrets(fixture.instance)));
  return proof;
}
async function caseReadback(
  proof: any,
  name: "fresh" | "upgraded",
  existing?: PackageSession,
) {
  const fixture = proof.privateFixture;
  session =
    existing ??
    new PackageSession(
      fixture.packageRoot,
      fixture.parent,
      privateRoot,
      fixture.instance,
    );
  assert.equal(await session.start(), null, "normal_package_restart_expected");
  await session.bindApp(fixture.appUrl);
  const id = proof.createdTaskId;
  const [tasks, agents, task] = await Promise.all([
    session.api("tasks"),
    session.api("agents"),
    session.api("tasks/" + id),
  ]);
  const sets = verifyNewTaskSet(proof.tasksBefore, tasks, id);
  assert.deepEqual(
    agents.map((a: any) => a.id).sort((a: number, b: number) => a - b),
    proof.agentIdsBefore,
  );
  assert.deepEqual(
    tasks,
    proof.tasksAfter,
    "restart_changed_durable_task_snapshot",
  );
  const arithmetic = verifyRealFirstTask({
    model: releaseModel,
    captures: await model!.relay.readCaptures(name),
    task,
    tasksAfter: sets.newTasks,
    agentsBefore: proof.agentIdsBefore.length,
    agentsAfter: agents.length,
    sourceUnchanged: true,
  });
  const ui = await authenticatedPage(session);
  browser = ui.browser;
  const images = await captureDeliveries(
    ui.page,
    session,
    id,
    name,
    output,
    allSecrets,
  );
  ui.verify();
  await browser.close();
  browser = undefined;
  await session.stop();
  session = undefined;
  return {
    accepted: true,
    arithmetic,
    globalTasks: sets,
    taskId: id,
    modelFallbackCount: task.modelFallbackCount,
    agentIdsUnchanged: true,
    normalRestart: true,
    images,
  };
}
async function baselineUpgrade(baseline: any, native: any) {
  const f = baseline.privateFixture,
    instance = f.instance;
  assert.equal(baseline.oldRuntimeUpgradeInputOnly, true);
  assert.equal(baseline.nodeDnsSecurityRegression, false);
  assert.equal(baseline.postgresCopySecurityRegression, false);
  assert.equal(baseline.firstTask.status, "completed");
  assert.match(baseline.firstTask.resultSummary, /391/u);
  const originalMetadata = await readFile(
      path.join(instance, "installation.json"),
    ),
    originalPointer = await readFile(path.join(f.parent, "native-launch.json"));
  const original = JSON.parse(originalMetadata.toString());
  assert.equal(
    original.runtimeOptions.nativeBundleCommit,
    "ea9c571be0f81f4590453086e6675ff654ab1458",
  );
  await writeFile(
    path.join(instance, "data/synthetic-upgrade-retained.md"),
    "Synthetic user workspace survives native GUI upgrade.\n",
    { flag: "wx", mode: 0o600 },
  );
  await appendFile(
    path.join(instance, "runtime.env"),
    "MAX_TASK_TOKENS=24000\nMAX_RECURRING_DAILY_TOKENS=48000\n",
  );
  const before = {
    secrets: await directoryDigest(path.join(instance, "secrets")),
    workspace: await directoryDigest(path.join(instance, "data")),
    runtime: hash(await readFile(path.join(instance, "runtime.env"))),
    database: (await inventoryNativeCluster(path.join(instance, "database")))
      .sha256,
  };
  const target = path.join(privateRoot, "Updated package Ω");
  await execute(
    process.env.PYTHON!,
    [
      path.join(context.applicationRoot, "scripts/native-package-archive.py"),
      "extract-package",
      native.archive,
      target,
    ],
    {
      cwd: context.applicationRoot,
      env: process.env,
      windowsHide: true,
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 1048576,
    },
  );
  const manifest = await readNativeDistribution(target);
  assert.equal(manifest?.commit, applicationCommit);
  assert.equal(manifest?.nodeVersion, "24.22.1");
  assert.equal(manifest?.postgresVersion, "17.11");
  session = new PackageSession(target, f.parent, privateRoot, instance);
  assert.equal(
    (await session.command(session.node(), ["--version"])).stdout.trim(),
    "v24.22.1",
  );
  await session.command(session.node(), [
    path.join(context.applicationRoot, "scripts/test-runtime-security.mjs"),
  ]);
  const setupUrl = await session.start();
  assert.ok(setupUrl);
  browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.setDefaultTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(setupUrl);
  await page.locator("#upgrade-confirm").waitFor();
  await page.locator("#language").selectOption("en");
  assert.equal(
    await page.locator("#upgrade-source-version").innerText(),
    "0.5.7",
  );
  assert.equal(
    await page.locator("#upgrade-target-version").innerText(),
    "0.5.9",
  );
  assert.equal(await page.locator("#upgrade-directory").innerText(), instance);
  assert.equal(await page.locator("#setup-form").isVisible(), false);
  const review = await page.screenshot({ fullPage: true });
  await writeFile(
    path.join(privateRoot, "private-upgrade-review.png"),
    review,
    { flag: "wx", mode: 0o600 },
  );
  await page.locator("#upgrade-confirm").click();
  await page.locator("#upgrade-open").waitFor();
  const appUrl = await page.locator("#upgrade-open").getAttribute("href");
  assert.ok(appUrl);
  assert.match(await page.locator("#upgrade-paused").innerText(), /paused/u);
  const complete = await page.screenshot({ fullPage: true });
  await writeFile(
    path.join(privateRoot, "private-upgrade-complete.png"),
    complete,
    { flag: "wx", mode: 0o600 },
  );
  assert.deepEqual(errors, []);
  await browser.close();
  browser = undefined;
  await session.bindApp(appUrl);
  await session.healthyPaused(true);
  const retained = await session.api("tasks");
  assert.equal(retained.length, 1);
  assert.equal(retained[0].id, baseline.createdTaskId);
  assert.equal(retained[0].resultSummary, baseline.firstTask.resultSummary);
  const journal = JSON.parse(
    await readFile(path.join(instance, "native-upgrade.json"), "utf8"),
  );
  assert.equal(journal.phase, "complete");
  const attempt = path.join(instance, "native-upgrades", journal.upgradeId);
  const migration = JSON.parse(
    await readFile(
      path.join(attempt, "stage/migration-attempt/receipt.json"),
      "utf8",
    ),
  );
  assert.equal(migration.sourceCommit, baseline.commit);
  assert.equal(migration.targetCommit, applicationCommit);
  assert.equal(migration.paused, true);
  assert.equal(migration.writeAndSequenceProbe, true);
  assert.ok(
    Array.isArray(migration.tables) &&
      migration.tables.length > 0 &&
      Array.isArray(migration.sequences),
  );
  for (const table of migration.tables) {
    assert.ok(
      table.columns.length > 0 &&
        Number.isSafeInteger(table.rows) &&
        table.rows >= 0,
    );
    assert.match(table.sha256, /^[a-f0-9]{64}$/u);
  }
  const dbUrl = new URL(
    await readFile(path.join(instance, "secrets/database_url"), "utf8"),
  );
  const args = [
    "-h",
    "127.0.0.1",
    "-p",
    dbUrl.port,
    "-U",
    dbUrl.username,
    "-d",
    "postgres",
    "-X",
    "-At",
  ];
  const dbEnv = { PGPASSWORD: decodeURIComponent(dbUrl.password) };
  const version = (
    await session.command(
      session.postgres("psql"),
      [
        ...args,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        "SHOW server_version; SHOW fsync; SHOW full_page_writes;",
      ],
      dbEnv,
    )
  ).stdout
    .trim()
    .split(/\r?\n/u);
  assert.match(version[0], /^17\.11(?:\s|$)/u);
  assert.deepEqual(version.slice(1), ["on", "on"]);
  const copy = await session.command(
    session.postgres("psql"),
    [
      ...args,
      "-v",
      "ON_ERROR_STOP=0",
      "-f",
      path.join(context.applicationRoot, "scripts/runtime-copy-security.sql"),
    ],
    dbEnv,
  );
  assert.match(copy.stderr, /runtime_security_missing/u);
  assert.match(copy.stdout, /^runtime-security-sentinel=0\r?$/mu);
  assert.doesNotMatch(copy.stdout, /^runtime-security-sentinel=[1-9]/mu);
  await session.stop();
  assert.equal(
    (await inventoryNativeCluster(path.join(attempt, "previous-database")))
      .sha256,
    before.database,
  );
  assert.deepEqual(
    await readFile(path.join(attempt, "original-installation.json")),
    originalMetadata,
  );
  assert.deepEqual(
    await readFile(path.join(attempt, "original-launch.json")),
    originalPointer,
  );
  assert.equal(
    await directoryDigest(path.join(instance, "secrets")),
    before.secrets,
  );
  assert.equal(
    await directoryDigest(path.join(instance, "data")),
    before.workspace,
  );
  assert.equal(
    hash(await readFile(path.join(instance, "runtime.env"))),
    before.runtime,
  );
  const final = JSON.parse(
    await readFile(path.join(instance, "installation.json"), "utf8"),
  );
  assert.deepEqual(final.plan.settings, original.plan.settings);
  assert.equal(
    final.runtimeOptions.ollamaUrl,
    original.runtimeOptions.ollamaUrl,
  );
  assert.equal(final.runtimeOptions.nativeBundleCommit, applicationCommit);
  assert.equal(await session.start(), null);
  await session.healthyPaused(true);
  await session.stop();
  assert.deepEqual(await readNativeDistribution(target), manifest);
  return {
    session,
    fixture: { packageRoot: target, parent: f.parent, instance, appUrl },
    before,
    original,
    receipt: {
      accepted: true,
      actualGuiUpgrade: true,
      sourceVersion: "0.5.7",
      targetVersion: "0.5.9",
      controlledBaselineTokensSimulated: true,
      retainedTasks: 1,
      retainedTableReceiptCount: migration.tables.length,
      retainedSequenceReceiptCount: migration.sequences.length,
      retainedDataCheckedBySourceMigration: true,
      originalDatabaseBackupExact: true,
      settingsConnectionBudgetsSecretsWorkspacePreserved: true,
      apiAndTwoWorkersHealthyPaused: true,
      normalPausedRestart: true,
      nodeDnsSecurityRegression: true,
      actualPostgresVersion: "17.11",
      postgresCopySecurityRegression: true,
      privateGuiReviewSha256: hash(review),
      privateGuiCompleteSha256: hash(complete),
    },
  };
}

try {
  assert.equal(process.platform, "win32");
  assert.equal(process.arch, "x64");
  assert.equal(process.version, "v24.22.1");
  assertExternalWorkflowContext({
    eventName: process.env.GITHUB_EVENT_NAME,
    runId: Number(process.env.GITHUB_RUN_ID),
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    ref: process.env.GITHUB_REF,
  });
  assert.equal(process.env.GH_TOKEN, undefined);
  assert.equal(process.env.GITHUB_TOKEN, undefined);
  assert.ok(path.isAbsolute(privateRoot) && path.isAbsolute(output));
  assert.deepEqual(
    JSON.parse(
      await readFile(process.env.ACOS_EXECUTION_CONTEXT_PATH!, "utf8"),
    ),
    {
      administratorToken: false,
      identityVerified: true,
      readonlyControlsVerified: true,
    },
  );
  ordinaryVerified = true;
  const contextPath = (
    await readFile(path.join(directory, "private-context-path.txt"), "utf8")
  ).trim();
  context = JSON.parse(await readFile(contextPath, "utf8"));
  assert.equal(context.schema, "native-release-host-private-inputs@1");
  assert.equal(context.accepted, true);
  assertReleaseConfiguration(context.config);
  applicationCommit = context.config.applicationCommit;
  applicationTree = context.config.applicationTree;
  driverCommit = context.identity.driverCommit;
  assert.equal(driverCommit, process.env.GITHUB_SHA);
  assert.equal(context.publicOutputRoot, output);
  assert.equal(context.applicationRoot, process.cwd());
  assert.equal(context.config.repo, process.env.GITHUB_REPOSITORY);
  assert.equal(context.ownedRoot, path.dirname(contextPath));
  assert.equal(await realpath(context.ownedRoot), context.ownedRoot);
  assert.equal(await realpath(privateRoot), privateRoot);
  assert.equal(
    path.dirname(privateRoot),
    await realpath(process.env.RUNNER_TEMP!),
  );
  assert.ok(path.basename(privateRoot).startsWith("acos-native-user-"));
  assert.deepEqual(await readdir(output), []);
  await sourceIdentity();
  const native = JSON.parse(
      await readFile(path.join(context.ownedRoot, "native-input.json"), "utf8"),
    ),
    baselineInput = JSON.parse(
      await readFile(
        path.join(context.ownedRoot, "baseline-input.json"),
        "utf8",
      ),
    );
  assert.equal(native.accepted, true);
  assert.equal(native.commit, applicationCommit);
  assert.equal(native.nodeVersion, "24.22.1");
  assert.equal(native.postgresVersion, "17.11");
  assert.equal(native.artifactSha256, context.config.nativeArtifactDigest);
  assert.equal(baselineInput.accepted, true);
  assert.equal(
    baselineInput.commit,
    "ea9c571be0f81f4590453086e6675ff654ab1458",
  );
  stage = "owned_model";
  console.log(JSON.stringify({ phase: stage }));
  model = await startOwnedReleaseModel(context.ownedRoot, privateRoot);
  stage = "fresh_package";
  console.log(JSON.stringify({ phase: stage }));
  model.relay.beginCase("fresh");
  const freshProof = await runPackageDriver("fresh", native.archive);
  model.relay.finishCase();
  assert.equal(freshProof.commit, applicationCommit);
  stage = "fresh_readback";
  console.log(JSON.stringify({ phase: stage }));
  fresh = await caseReadback(freshProof, "fresh");
  fresh = {
    ...fresh,
    nodeDnsSecurityRegression: freshProof.nodeDnsSecurityRegression,
    postgresCopySecurityRegression: freshProof.postgresCopySecurityRegression,
    backupRestore: freshProof.backup?.passed === true,
  };
  assert.equal(fresh.nodeDnsSecurityRegression, true);
  assert.equal(fresh.postgresCopySecurityRegression, true);
  assert.equal(fresh.backupRestore, true);
  stage = "published_baseline";
  console.log(JSON.stringify({ phase: stage }));
  const baseline = await runPackageDriver("baseline", baselineInput.archive);
  stage = "actual_gui_upgrade";
  console.log(JSON.stringify({ phase: stage }));
  const upgradedFixture = await baselineUpgrade(baseline, native);
  upgrade = upgradedFixture.receipt;
  session = upgradedFixture.session;
  const endpoint = new URL(upgradedFixture.original.runtimeOptions.ollamaUrl);
  assert.equal(endpoint.hostname, "127.0.0.1");
  await model.relay.rebind(Number(endpoint.port));
  stage = "explicit_resume";
  console.log(JSON.stringify({ phase: stage }));
  assert.equal(await session.start(), null);
  await session.healthyPaused(true);
  const ui = await authenticatedPage(session);
  browser = ui.browser;
  await ui.page
    .getByRole("button", { name: "Resume work", exact: true })
    .click();
  const dialog = ui.page.getByRole("alertdialog");
  await dialog
    .getByRole("button", { name: "Yes, resume work", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await session.healthyPaused(false);
  const beforeTasks = await session.api("tasks"),
    beforeAgents = await session.api("agents");
  assert.equal(beforeTasks.length, 1);
  assert.equal(beforeTasks[0].status, "completed");
  const owner = beforeAgents.find((agent: any) => agent.parentAgentId === null);
  assert.ok(owner);
  assert.equal(owner.modelId, baseline.firstTask.lastModelId);
  const selected = await session.api("agents/" + owner.id, "PATCH", {
    expectedConfig: owner.configVersion,
    modelMode: "manual",
    modelId: "ollama:" + releaseModel,
  });
  assert.equal(selected.modelId, "ollama:" + releaseModel);
  stage = "new_genuine_task";
  console.log(JSON.stringify({ phase: stage }));
  model.relay.beginCase("upgraded");
  const task = await session.api("tasks", "POST", {
    requestId: randomUUID(),
    title: "New real local task after native GUI upgrade",
    brief:
      "Use calculate to add 58.5 and 14.5. Report the total in EUR and complete_task. Do not browse, create agents or delegate.",
    ownerAgentId: owner.id,
    autonomyMode: "finite",
    priority: "normal",
    completionRequirements: [{ kind: "tool_succeeded", tool: "calculate" }],
  });
  const observation = {
    attempts: 0,
    transientFailures: 0,
    lastFailure: null,
    lastTaskAt: null,
  };
  await observeOwnedFirstTask({
    baseUrl: session.appUrl + "/",
    operatorToken: session.token!,
    taskId: task.id,
    deadline: Date.now() + 15 * 60000,
    summary: observation,
  });
  model.relay.finishCase();
  const afterTasks = await session.api("tasks");
  verifyNewTaskSet(beforeTasks, afterTasks, task.id);
  const upgradedProof = {
    createdTaskId: task.id,
    tasksBefore: beforeTasks,
    tasksAfter: afterTasks,
    agentIdsBefore: beforeAgents
      .map((agent: any) => agent.id)
      .sort((a: number, b: number) => a - b),
    privateFixture: upgradedFixture.fixture,
  };
  ui.verify();
  await browser.close();
  browser = undefined;
  await session.stop();
  session = undefined;
  stage = "upgraded_readback";
  console.log(JSON.stringify({ phase: stage }));
  upgraded = {
    ...(await caseReadback(upgradedProof, "upgraded")),
    explicitGuiResume: true,
    explicitManualLocalModelSelection: true,
    taskObservation: observation,
  };
  const f = upgradedFixture.fixture;
  assert.equal(
    await directoryDigest(path.join(f.instance, "secrets")),
    upgradedFixture.before.secrets,
  );
  assert.equal(
    await directoryDigest(path.join(f.instance, "data")),
    upgradedFixture.before.workspace,
  );
  assert.equal(
    hash(await readFile(path.join(f.instance, "runtime.env"))),
    upgradedFixture.before.runtime,
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(path.join(f.instance, "installation.json"), "utf8"),
    ).plan.settings,
    upgradedFixture.original.plan.settings,
  );
  stage = "final_source_identity";
  console.log(JSON.stringify({ phase: stage }));
  await sourceIdentity();
  assert.equal(model.relay.failures, 0);
  accepted = true;
} catch (error) {
  accepted = false;
  // Exception text and model prose stay private; only a closed stage is public.
  if (ordinaryVerified && privateRoot && path.isAbsolute(privateRoot)) {
    await session?.writePrivateFailure(stage).catch(() => {});
    await writeFile(
      path.join(privateRoot, "private-controller-failure.txt"),
      error instanceof Error ? (error.stack ?? error.message) : String(error),
      { flag: "wx", mode: 0o600 },
    ).catch(() => {});
  }
} finally {
  let okay = !packageDriverFailed;
  try {
    await browser?.close();
  } catch {
    okay = false;
  }
  try {
    await session?.stop();
  } catch {
    okay = false;
  }
  try {
    if (model) await model.close();
  } catch {
    okay = false;
  }
  cleanupVerified = okay;
  if (!okay) accepted = false;
  const receipt = {
    schema: "agentic-company-os/native-release-genuine@1",
    target: "win32-x64",
    applicationCommit,
    applicationTree,
    driverCommit,
    accepted,
    cleanupVerified,
    failureStage: accepted ? null : stage,
    ordinaryExecution: {
      administratorToken: ordinaryVerified ? false : null,
      identityVerified: ordinaryVerified,
      readonlyControlsVerified: ordinaryVerified,
    },
    nativeProducer: context
      ? {
          runId: context.config.nativeRunId,
          artifactId: context.config.nativeArtifactId,
          artifactDigest: context.config.nativeArtifactDigest,
        }
      : null,
    failedDependencyMaintenanceStillFailed:
      context?.failedDependencyMaintenanceStillFailed ?? [],
    model: model
      ? {
          name: releaseModel,
          digest: model.modelDigest,
          runtimeVersion: model.runtimeVersion,
          pullRequests: model.pullRequests,
          emptyStoreBefore: model.emptyStoreBefore,
          registryEntries: model.registryEntries,
        }
      : null,
    fresh,
    upgrade,
    upgraded,
    paidProvider: false,
    cloudFallbacks: 0,
    verified24h: false,
  };
  const json = JSON.stringify(receipt, null, 2) + "\n";
  assertSafePublicText(json, allSecrets);
  await save(process.env.ACOS_PRIVATE_EVIDENCE_PATH!, receipt);
  console.log(
    JSON.stringify({
      accepted,
      cleanupVerified,
      failureStage: receipt.failureStage,
    }),
  );
  if (!accepted) process.exitCode = 1;
}
