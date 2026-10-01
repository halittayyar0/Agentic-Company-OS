import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createWallClockRunResourceDirectory,
  parseWallClockArguments,
  removeExactRunResourceDirectory,
  wallClockExitCode,
  writeWallClockSoakReport,
} from "../run-wall-clock-soak";
import { createEnduranceReport } from "./report-schema";
import type {
  EnduranceBuildAttestation,
  EnduranceRuntime,
} from "./report-schema";
import type {
  WallClockRuntimeDriver,
  WallClockSoakResult,
} from "./run-wall-clock-soak";

test("wall-clock CLI validates duration, seed, output, and retention flags", () => {
  assert.throws(
    () => parseWallClockArguments(["--duration-hours", "0.016"]),
    /at least one minute/,
  );
  assert.throws(() => parseWallClockArguments(["--seed", "-1"]), /seed/);
  assert.throws(() => parseWallClockArguments(["--output"]), /output path/);
  assert.throws(
    () => parseWallClockArguments(["--unknown", "value"]),
    /Unknown argument/,
  );
  assert.deepEqual(
    parseWallClockArguments([
      "--duration-hours",
      String(2 / 60),
      "--seed",
      "0",
      "--output",
      "soak.json",
      "--keep-on-failure",
      "--overwrite",
      "--fault-profile",
      "compressed-all",
    ]),
    {
      runtime: "docker",
      postgresRoot: null,
      durationHours: 2 / 60,
      seed: 0,
      output: path.resolve("soak.json"),
      keepOnFailure: true,
      overwrite: true,
      faultProfile: "compressed-all",
    },
  );
  const defaults = parseWallClockArguments([]);
  assert.equal(defaults.durationHours, 24);
  assert.equal(defaults.runtime, "docker");
  assert.equal(defaults.postgresRoot, null);
  assert.equal(defaults.seed, 240_901);
  assert.equal(defaults.keepOnFailure, false);
  assert.equal(defaults.overwrite, false);
  assert.equal(defaults.faultProfile, "standard");
  assert.equal(path.isAbsolute(defaults.output), true);

  assert.throws(
    () => parseWallClockArguments(["--runtime", "native"], {}),
    /postgres-root is required/,
  );
  assert.throws(
    () => parseWallClockArguments(["--runtime", "invalid"]),
    /runtime must be docker or native/,
  );
  assert.throws(
    () => parseWallClockArguments(["--postgres-root", "portable-pg"]),
    /only valid with --runtime native/,
  );
  assert.deepEqual(
    parseWallClockArguments(
      ["--runtime", "native", "--postgres-root", "portable-pg"],
      {},
    ),
    {
      runtime: "native",
      postgresRoot: path.resolve("portable-pg"),
      durationHours: 24,
      seed: 240_901,
      output: path.join(
        tmpdir(),
        `agentic-company-os-wall-clock-${process.pid}.json`,
      ),
      keepOnFailure: false,
      overwrite: false,
      faultProfile: "standard",
    },
  );
  assert.throws(
    () =>
      parseWallClockArguments([
        "--duration-hours",
        String(1 / 60),
        "--fault-profile",
        "compressed-all",
      ]),
    /compressed-all.*two minutes/iu,
  );
});

test("invalid spend caps are rejected before build, runtime, or output directories", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "endurance-invalid-spend-"),
  );
  const output = path.join(directory, "absent", "report.json");
  let builds = 0;
  let runtimes = 0;
  try {
    await assert.rejects(
      writeWallClockSoakReport(parseWallClockArguments(["--output", output]), {
        environment: { MAX_TASK_TOKENS: "private-invalid-value" },
        prepareBuildAttestation: async () => {
          builds++;
          throw new Error("unexpected build");
        },
        driverFactory: () => {
          runtimes++;
          throw new Error("unexpected runtime");
        },
      }),
      /Invalid endurance spend setting: MAX_TASK_TOKENS/,
    );
    assert.equal(builds, 0);
    assert.equal(runtimes, 0);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("wall-clock cleanup guard rejects temp root, unrelated prefixes, and nested paths", async () => {
  const runId = "soak-cleanup-guard";
  const unrelated = await mkdtemp(path.join(tmpdir(), "not-endurance-run-"));
  const nested = path.join(unrelated, `agentic-os-soak-run-${runId}-nested`);
  await mkdir(nested);
  const owned = await createWallClockRunResourceDirectory(runId);
  try {
    await assert.rejects(
      removeExactRunResourceDirectory(tmpdir(), runId),
      /Refusing to remove an unscoped endurance run directory/,
    );
    await assert.rejects(
      removeExactRunResourceDirectory(unrelated, runId),
      /Refusing to remove an unscoped endurance run directory/,
    );
    await assert.rejects(
      removeExactRunResourceDirectory(nested, runId),
      /Refusing to remove an unscoped endurance run directory/,
    );
    assert.equal((await lstat(unrelated)).isDirectory(), true);
    assert.equal((await lstat(nested)).isDirectory(), true);
    await removeExactRunResourceDirectory(owned.runResourceDirectory, runId);
    await assert.rejects(lstat(owned.runResourceDirectory), { code: "ENOENT" });
  } finally {
    await rm(unrelated, { recursive: true, force: true });
  }
});

function failedResult(runId: string): WallClockSoakResult {
  const completedAt = "2026-09-01T00:01:00.000Z";
  return {
    report: createEnduranceReport({
      runId,
      mode: "wall_clock",
      seed: 7,
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      startedAt: "2026-09-01T00:00:00.000Z",
      completedAt,
      wallClockHours: 1 / 60,
      simulatedMinutes: 0,
      topology: { api: 1, workers: 2, agents: 10, database: "postgres" },
      injections: [],
      metrics: {
        expectedResponsibilities: 10,
        completedResponsibilities: 0,
        maxResponsibilityCycleLag: 0,
        irreversibleReceiptSuccessCount: 0,
        duplicateIrreversibleReceiptKeys: [],
        staleOwnerCommits: 0,
        recoveryDurationsMs: [],
        missingIncidentIds: [],
        healthTruthMismatches: ["runner_failure"],
        sseReconnectObserved: false,
        healthSampleBuckets: 0,
        requiredHealthSampleBuckets: 1,
      },
    }),
    journal: [
      {
        schemaVersion: 1,
        runId,
        sequence: 0,
        occurredAt: completedAt,
        kind: "run_failed",
        data: { failure: "simulated failure" },
      },
    ],
    primaryEvidence: [],
    browser: null,
    projectId: null,
    failure: "simulated failure",
  };
}

function testBuildAttestation(
  runtime: EnduranceRuntime,
  commitSha = "0123456789abcdef0123456789abcdef01234567",
): EnduranceBuildAttestation {
  return {
    schemaVersion: 1,
    cleanTree: true,
    nodeVersion: "v24.19.0",
    sourceCommitSha: commitSha,
    sourceTreeSha256: "a".repeat(64),
    runtime,
    subject:
      runtime === "native-postgres"
        ? "native-runtime-artifacts"
        : "docker-build-context",
    runtimeArtifactSha256: "b".repeat(64),
    runtimeArtifactFileCount: 7,
    ...(runtime === "native-postgres"
      ? {
          nativeRuntimeDependencies: [
            {
              name: "@electric-sql/pglite" as const,
              version: "0.5.8",
              path: "artifacts/api-server/dist/node_modules/@electric-sql/pglite",
              sha256: "c".repeat(64),
              fileCount: 4,
            },
            {
              name: "playwright-core" as const,
              version: "1.62.1",
              path: "artifacts/api-server/dist/node_modules/playwright-core",
              sha256: "d".repeat(64),
              fileCount: 4,
            },
          ],
        }
      : {}),
  };
}

test("wall-clock writer completes build attestation before constructing the runtime", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-wall-cli-"));
  const output = path.join(directory, "attested.json");
  const order: string[] = [];
  try {
    const result = await writeWallClockSoakReport(
      {
        runtime: "native",
        postgresRoot: path.join(directory, "postgres"),
        durationHours: 1 / 60,
        seed: 7,
        output,
        keepOnFailure: false,
        overwrite: false,
      },
      {
        workspaceRoot: directory,
        commitSha: () => "0123456789abcdef0123456789abcdef01234567",
        prepareBuildAttestation: async (input) => {
          order.push(`build:${input.runtime}`);
          return testBuildAttestation(input.runtime);
        },
        driverFactory: () => {
          order.push("driver");
          return {} as WallClockRuntimeDriver;
        },
        runSoak: async (options) => {
          order.push("soak");
          const soakResult = failedResult(options.runId ?? "missing-run");
          soakResult.report.provenance = {
            runner: {
              os: "test",
              node: process.version,
              postgres: "17",
              browser: "Chromium",
            },
            workflowRunId: null,
            configuration: { runtime: "native-postgres" },
            automatedSignOff: {
              status: "failed",
              generatedAt: soakResult.report.completedAt,
            },
          };
          return soakResult;
        },
      },
    );
    assert.deepEqual(order, ["build:native-postgres", "driver", "soak"]);
    assert.deepEqual(
      result.report.provenance?.buildAttestation,
      testBuildAttestation("native-postgres"),
    );
    const persisted = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(
      persisted.provenance.buildAttestation,
      testBuildAttestation("native-postgres"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("wall-clock writer always emits JSON, JSONL, and SHA evidence and forwards cancellation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-wall-cli-"));
  const output = path.join(directory, "report.json");
  const cancellation = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  let receivedRunId = "";
  let driverEnvironment: NodeJS.ProcessEnv | undefined;
  let driverControlDirectory = "";
  const workspaceRoot = path.join(directory, "workspace");
  const sourceSecrets = path.join(workspaceRoot, ".secrets");
  await mkdir(sourceSecrets, { recursive: true });
  await Promise.all([
    writeFile(path.join(sourceSecrets, "database_url"), "database-url\n"),
    writeFile(path.join(sourceSecrets, "operator_auth_token"), "old-token\n"),
    writeFile(path.join(sourceSecrets, "runtime_control_key"), "control-key\n"),
    writeFile(path.join(sourceSecrets, "postgres_password"), "postgres-pass\n"),
  ]);
  try {
    const result = await writeWallClockSoakReport(
      {
        runtime: "docker",
        postgresRoot: null,
        durationHours: 1 / 60,
        seed: 7,
        output,
        keepOnFailure: true,
        overwrite: false,
      },
      {
        signal: cancellation.signal,
        workspaceRoot,
        operatorToken: "local-test-token",
        commitSha: () => "0123456789abcdef0123456789abcdef01234567",
        prepareBuildAttestation: async (input) =>
          testBuildAttestation(input.runtime, input.commitSha),
        driverFactory: (input) => {
          driverEnvironment = input.environment;
          driverControlDirectory = input.controlDirectory;
          return {} as WallClockRuntimeDriver;
        },
        runSoak: async (options, _driver, dependencies) => {
          receivedSignal = dependencies?.signal;
          receivedRunId = options.runId ?? "";
          await mkdir(options.browserOutputDirectory, { recursive: true });
          const startPath = path.join(
            options.browserOutputDirectory,
            `${receivedRunId}-000-start.png`,
          );
          const endPath = path.join(
            options.browserOutputDirectory,
            `${receivedRunId}-001-end.png`,
          );
          const startBytes = Buffer.from("start-checkpoint", "utf8");
          const endBytes = Buffer.from("end-checkpoint", "utf8");
          await Promise.all([
            writeFile(startPath, startBytes),
            writeFile(endPath, endBytes),
          ]);
          const result = failedResult(receivedRunId);
          const startDigest = createHash("sha256")
            .update(startBytes)
            .digest("hex");
          const endDigest = createHash("sha256").update(endBytes).digest("hex");
          result.browser = {
            pass: true,
            restarts: 0,
            samples: [
              {
                index: 0,
                capturedAt: "2026-09-01T00:00:00.000Z",
                runtimeLabel: "Canlı",
                incidentVisible: false,
                reconnectCursorAdvanced: false,
                pageErrors: [],
              },
              {
                index: 1,
                capturedAt: "2026-09-01T00:01:00.000Z",
                runtimeLabel: "Canlı",
                incidentVisible: true,
                reconnectCursorAdvanced: true,
                pageErrors: [],
              },
            ],
            checkpoints: [
              {
                kind: "start",
                path: startPath,
                sha256: startDigest,
                capturedAt: "2026-09-01T00:00:00.000Z",
              },
              {
                kind: "end",
                path: endPath,
                sha256: endDigest,
                capturedAt: "2026-09-01T00:01:00.000Z",
              },
            ],
            errors: [],
            startCheckpointSha256: startDigest,
            endCheckpointSha256: endDigest,
            incidentCorrelations: 1,
            sseReconnectEventIdAdvanced: true,
          };
          result.report.evidence = {
            browser: {
              startCheckpointSha256: startDigest,
              endCheckpointSha256: endDigest,
              incidentCorrelations: 1,
              sseReconnectEventIdAdvanced: true,
            },
          };
          return result;
        },
      },
    );

    assert.equal(receivedSignal, cancellation.signal);
    assert.match(receivedRunId, /^[a-z0-9][a-z0-9-]{0,39}$/);
    assert.equal(
      driverEnvironment?.ENDURANCE_CONTROL_DIR_HOST,
      driverControlDirectory,
    );
    assert.equal(
      driverEnvironment?.ENDURANCE_OPERATOR_TOKEN_SECRET_FILE,
      path.join(
        path.dirname(driverControlDirectory),
        "secrets",
        "operator_auth_token",
      ),
    );
    assert.equal(
      driverEnvironment?.ENDURANCE_DATABASE_URL_SECRET_FILE,
      path.join(
        path.dirname(driverControlDirectory),
        "secrets",
        "database_url",
      ),
    );
    assert.equal(
      driverEnvironment?.ENDURANCE_RUNTIME_CONTROL_KEY_SECRET_FILE,
      path.join(
        path.dirname(driverControlDirectory),
        "secrets",
        "runtime_control_key",
      ),
    );
    assert.equal(
      driverEnvironment?.ENDURANCE_POSTGRES_PASSWORD_SECRET_FILE,
      path.join(
        path.dirname(driverControlDirectory),
        "secrets",
        "postgres_password",
      ),
    );
    assert.equal(
      await readFile(
        driverEnvironment?.ENDURANCE_OPERATOR_TOKEN_SECRET_FILE ?? "",
        "utf8",
      ),
      "local-test-token\n",
    );
    assert.equal(
      await readFile(
        driverEnvironment?.ENDURANCE_DATABASE_URL_SECRET_FILE ?? "",
        "utf8",
      ),
      "database-url\n",
    );
    assert.equal(
      await readFile(
        driverEnvironment?.ENDURANCE_RUNTIME_CONTROL_KEY_SECRET_FILE ?? "",
        "utf8",
      ),
      "control-key\n",
    );
    assert.equal(
      await readFile(
        driverEnvironment?.ENDURANCE_POSTGRES_PASSWORD_SECRET_FILE ?? "",
        "utf8",
      ),
      "postgres-pass\n",
    );
    assert.equal(result.reportPath, output);
    assert.equal(result.journalPath, path.join(directory, "report.jsonl"));
    assert.equal(result.sha256Path, `${output}.sha256`);
    assert.equal(result.browserManifestPath, `${output}.browser-manifest.json`);
    assert.equal(
      result.primaryEvidencePath,
      `${output}.primary-evidence.jsonl`,
    );
    const reportBytes = await readFile(output);
    const report = JSON.parse(reportBytes.toString("utf8"));
    const journalBytes = await readFile(result.journalPath);
    const journal = journalBytes
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const digest = createHash("sha256").update(reportBytes).digest("hex");
    assert.equal((await readFile(result.sha256Path, "utf8")).trim(), digest);
    assert.equal(
      report.evidence.journalSha256,
      createHash("sha256").update(journalBytes).digest("hex"),
    );
    const primaryEvidenceBytes = await readFile(result.primaryEvidencePath);
    assert.equal(
      report.evidence.primaryEvidenceSha256,
      createHash("sha256").update(primaryEvidenceBytes).digest("hex"),
    );
    assert.equal(report.pass, false);
    assert.equal(report.verified24h, false);
    assert.equal(journal.at(-1).kind, "run_failed");
    assert.equal(wallClockExitCode(result), 1);
    const browserManifest = JSON.parse(
      await readFile(result.browserManifestPath, "utf8"),
    );
    assert.equal(browserManifest.runId, receivedRunId);
    assert.equal(browserManifest.reportFile, "report.json");
    assert.deepEqual(
      browserManifest.checkpoints.map((item: { path: string }) => item.path),
      [
        `report.json.browser/${receivedRunId}/${receivedRunId}-000-start.png`,
        `report.json.browser/${receivedRunId}/${receivedRunId}-001-end.png`,
      ],
    );
    assert.equal(browserManifest.samples.length, 2);
    assert.deepEqual(
      browserManifest.samples.map((item: { index: number }) => item.index),
      [0, 1],
    );
    assert.ok(result.report.evidence?.browser);
    assert.equal(
      result.report.evidence.browser.manifestSha256,
      createHash("sha256")
        .update(await readFile(result.browserManifestPath))
        .digest("hex"),
    );

    await assert.rejects(
      writeWallClockSoakReport(
        {
          runtime: "docker",
          postgresRoot: null,
          durationHours: 1 / 60,
          seed: 7,
          output,
          keepOnFailure: false,
          overwrite: false,
        },
        {
          operatorToken: "local-test-token",
          commitSha: () => "0123456789abcdef0123456789abcdef01234567",
          prepareBuildAttestation: async (input) =>
            testBuildAttestation(input.runtime, input.commitSha),
          driverFactory: () => ({}) as WallClockRuntimeDriver,
          runSoak: async () => failedResult("must-not-run"),
        },
      ),
      /already exists/,
    );
  } finally {
    if (driverControlDirectory && receivedRunId) {
      await removeExactRunResourceDirectory(
        path.dirname(driverControlDirectory),
        receivedRunId,
      );
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("wall-clock writer converts unexpected startup errors into redacted durable failure evidence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-wall-cli-"));
  const output = path.join(directory, "startup-failure.json");
  const secret = "operator-secret-that-must-not-leak";
  const workspaceRoot = path.join(directory, "workspace");
  const sourceSecrets = path.join(workspaceRoot, ".secrets");
  await mkdir(sourceSecrets, { recursive: true });
  await Promise.all([
    writeFile(path.join(sourceSecrets, "database_url"), "database-url\n"),
    writeFile(path.join(sourceSecrets, "operator_auth_token"), "old-token\n"),
    writeFile(path.join(sourceSecrets, "runtime_control_key"), "control-key\n"),
    writeFile(path.join(sourceSecrets, "postgres_password"), "postgres-pass\n"),
  ]);
  let retainedControlDirectory: string | null = null;
  let retainedRunId = "";
  try {
    const result = await writeWallClockSoakReport(
      {
        runtime: "docker",
        postgresRoot: null,
        durationHours: 24,
        seed: 9,
        output,
        keepOnFailure: true,
        overwrite: false,
      },
      {
        operatorToken: secret,
        workspaceRoot,
        commitSha: () => "abcdef0123456789abcdef0123456789abcdef01",
        prepareBuildAttestation: async (input) =>
          testBuildAttestation(input.runtime, input.commitSha),
        driverFactory: () => {
          throw new Error(`startup rejected ${secret}`);
        },
      },
    );
    retainedControlDirectory = result.controlDirectory;
    retainedRunId = result.report.runId;
    const combined = [
      await readFile(result.reportPath, "utf8"),
      await readFile(result.journalPath, "utf8"),
    ].join("\n");
    assert.equal(combined.includes(secret), false);
    assert.match(result.failure ?? "", /\[redacted\]/);
    assert.equal(result.report.pass, false);
    assert.equal(result.report.verified24h, false);
    assert.equal(wallClockExitCode(result), 1);
    await readFile(result.sha256Path, "utf8");
  } finally {
    if (retainedControlDirectory && retainedRunId) {
      await removeExactRunResourceDirectory(
        path.dirname(retainedControlDirectory),
        retainedRunId,
      );
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("native wall-clock runtime uses the exact control directory and needs no Docker secrets", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "agentic-wall-native-cli-"),
  );
  const output = path.join(directory, "native.json");
  const postgresRoot = path.join(directory, "portable-postgres");
  let retainedControlDirectory: string | null = null;
  let retainedRunId = "";
  let driverInput:
    | Parameters<
        NonNullable<
          import("../run-wall-clock-soak").WallClockWriteDependencies["driverFactory"]
        >
      >[0]
    | undefined;
  try {
    const result = await writeWallClockSoakReport(
      {
        runtime: "native",
        postgresRoot,
        durationHours: 1 / 60,
        seed: 11,
        output,
        keepOnFailure: true,
        overwrite: false,
      },
      {
        workspaceRoot: directory,
        commitSha: () => "abcdef0123456789abcdef0123456789abcdef01",
        prepareBuildAttestation: async (input) =>
          testBuildAttestation(input.runtime, input.commitSha),
        driverFactory: (input) => {
          driverInput = input;
          return {} as WallClockRuntimeDriver;
        },
        runSoak: async (options) => failedResult(options.runId ?? "missing"),
      },
    );
    retainedControlDirectory = result.controlDirectory;
    retainedRunId = result.report.runId;
    assert.equal(driverInput?.runtime, "native");
    assert.equal(driverInput?.postgresRoot, path.resolve(postgresRoot));
    assert.equal(driverInput?.runDirectory, driverInput?.controlDirectory);
    assert.equal(driverInput?.baseUrl, null);
    assert.equal((driverInput?.operatorToken.length ?? 0) >= 32, true);
    assert.equal((driverInput?.runtimeControlKey?.length ?? 0) >= 32, true);
    assert.deepEqual(
      await import("node:fs/promises").then(({ readdir }) =>
        readdir(
          path.join(
            path.dirname(driverInput?.controlDirectory ?? ""),
            "secrets",
          ),
        ),
      ),
      [],
    );
  } finally {
    if (retainedControlDirectory && retainedRunId) {
      await removeExactRunResourceDirectory(
        path.dirname(retainedControlDirectory),
        retainedRunId,
      );
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("wall-clock exit code rejects a passing but shorter-than-24-hour report", () => {
  const result = failedResult("short-run");
  result.failure = null;
  result.report.pass = true;
  result.report.verified24h = false;
  assert.equal(wallClockExitCode(result), 1);
});

test("wall-clock writer rejects an evidence directory redirected through a junction", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-wall-cli-"));
  const externalDirectory = await mkdtemp(
    path.join(tmpdir(), "agentic-wall-external-"),
  );
  const linkedDirectory = path.join(directory, "linked-evidence");
  try {
    try {
      await symlink(
        externalDirectory,
        linkedDirectory,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["EPERM", "EACCES", "ENOTSUP"].includes(String(error.code))
      ) {
        context.skip(`symlink creation is unavailable: ${String(error.code)}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      writeWallClockSoakReport(
        {
          runtime: "native",
          postgresRoot: path.join(directory, "postgres"),
          durationHours: 1 / 60,
          seed: 17,
          output: path.join(linkedDirectory, "report.json"),
          keepOnFailure: false,
          overwrite: true,
        },
        {
          workspaceRoot: directory,
          commitSha: () => "abcdef0123456789abcdef0123456789abcdef01",
          prepareBuildAttestation: async (input) =>
            testBuildAttestation(input.runtime, input.commitSha),
          driverFactory: () => ({}) as WallClockRuntimeDriver,
          runSoak: async (options) =>
            failedResult(options.runId ?? "missing-run"),
        },
      ),
      /evidence.*directory|output directory|redirected/iu,
    );
    assert.deepEqual(await readdir(externalDirectory), []);
  } finally {
    await Promise.all([
      rm(directory, { recursive: true, force: true }),
      rm(externalDirectory, { recursive: true, force: true }),
    ]);
  }
});

test("wall-clock writer does not create a missing output parent through an ancestor junction", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-wall-cli-"));
  const externalDirectory = await mkdtemp(
    path.join(tmpdir(), "agentic-wall-external-"),
  );
  const linkedAncestor = path.join(directory, "linked-ancestor");
  try {
    try {
      await symlink(
        externalDirectory,
        linkedAncestor,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["EPERM", "EACCES", "ENOTSUP"].includes(String(error.code))
      ) {
        context.skip(`symlink creation is unavailable: ${String(error.code)}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      writeWallClockSoakReport(
        {
          runtime: "native",
          postgresRoot: path.join(directory, "postgres"),
          durationHours: 1 / 60,
          seed: 17,
          output: path.join(linkedAncestor, "missing", "report.json"),
          keepOnFailure: false,
          overwrite: true,
        },
        {
          workspaceRoot: directory,
          commitSha: () => "abcdef0123456789abcdef0123456789abcdef01",
          prepareBuildAttestation: async (input) =>
            testBuildAttestation(input.runtime, input.commitSha),
          driverFactory: () => ({}) as WallClockRuntimeDriver,
          runSoak: async (options) =>
            failedResult(options.runId ?? "missing-run"),
        },
      ),
      /output directory|redirected|real directory/iu,
    );
    assert.deepEqual(await readdir(externalDirectory), []);
  } finally {
    await Promise.all([
      rm(directory, { recursive: true, force: true }),
      rm(externalDirectory, { recursive: true, force: true }),
    ]);
  }
});

test("wall-clock writer rejects a redirected browser root before starting the soak", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-wall-cli-"));
  const externalDirectory = await mkdtemp(
    path.join(tmpdir(), "agentic-wall-browser-external-"),
  );
  const output = path.join(directory, "report.json");
  const browserRoot = `${output}.browser`;
  let soakStarted = false;
  try {
    try {
      await symlink(
        externalDirectory,
        browserRoot,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["EPERM", "EACCES", "ENOTSUP"].includes(String(error.code))
      ) {
        context.skip(`symlink creation is unavailable: ${String(error.code)}`);
        return;
      }
      throw error;
    }
    const result = await writeWallClockSoakReport(
      {
        runtime: "native",
        postgresRoot: path.join(directory, "postgres"),
        durationHours: 1 / 60,
        seed: 7,
        output,
        keepOnFailure: false,
        overwrite: true,
      },
      {
        workspaceRoot: directory,
        commitSha: () => "abcdef0123456789abcdef0123456789abcdef01",
        prepareBuildAttestation: async (input) =>
          testBuildAttestation(input.runtime, input.commitSha),
        driverFactory: () => ({}) as WallClockRuntimeDriver,
        runSoak: async (options) => {
          soakStarted = true;
          await mkdir(options.browserOutputDirectory, { recursive: true });
          await writeFile(
            path.join(options.browserOutputDirectory, "escaped.png"),
            "escaped",
          );
          return failedResult(options.runId ?? "missing-run");
        },
      },
    );
    assert.equal(soakStarted, false);
    assert.match(result.failure ?? "", /browser.*directory|redirected/iu);
    assert.deepEqual(await readdir(externalDirectory), []);
  } finally {
    await Promise.all([
      rm(directory, { recursive: true, force: true }),
      rm(externalDirectory, { recursive: true, force: true }),
    ]);
  }
});

test("wall-clock writer cleans temporary controls when durable evidence writing fails", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-wall-cli-"));
  const output = path.join(directory, "report.json");
  await mkdir(`${output}.browser-manifest.json`);
  let controlDirectory = "";
  try {
    await assert.rejects(
      writeWallClockSoakReport(
        {
          runtime: "native",
          postgresRoot: path.join(directory, "postgres"),
          durationHours: 1 / 60,
          seed: 19,
          output,
          keepOnFailure: false,
          overwrite: true,
        },
        {
          workspaceRoot: directory,
          commitSha: () => "abcdef0123456789abcdef0123456789abcdef01",
          prepareBuildAttestation: async (input) =>
            testBuildAttestation(input.runtime, input.commitSha),
          driverFactory: (input) => {
            controlDirectory = input.controlDirectory;
            return {} as WallClockRuntimeDriver;
          },
          runSoak: async (options) =>
            failedResult(options.runId ?? "missing-run"),
        },
      ),
      /regular.*file|directory|EISDIR/iu,
    );
    assert.ok(controlDirectory);
    await assert.rejects(lstat(path.dirname(controlDirectory)), {
      code: "ENOENT",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
