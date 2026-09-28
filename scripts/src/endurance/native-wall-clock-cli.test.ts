import assert from "node:assert/strict";
import {
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
  archiveNativeRuntimeLogs,
  executeNativeWallClockCommand,
  parseNativeWallClockArguments,
  runtimeDirectoryForNativeReport,
} from "../run-native-wall-clock-soak";
import type { WallClockRuntimeDriver } from "./run-wall-clock-soak";

test("native CLI adds a required portable PostgreSQL root to wall-clock arguments", () => {
  assert.throws(
    () => parseNativeWallClockArguments([], {}),
    /postgres-root.*required/iu,
  );
  assert.throws(
    () => parseNativeWallClockArguments(["--postgres-root"], {}),
    /postgres-root.*required/iu,
  );
  const parsed = parseNativeWallClockArguments(
    [
      "--postgres-root",
      "D:/portable-postgres",
      "--duration-hours",
      String(1 / 60),
      "--seed",
      "7",
      "--output",
      "native-report.json",
      "--overwrite",
    ],
    {},
  );
  assert.equal(parsed.postgresRoot, path.resolve("D:/portable-postgres"));
  assert.equal(parsed.runtime, "native");
  assert.equal(parsed.durationHours, 1 / 60);
  assert.equal(parsed.seed, 7);
  assert.equal(parsed.output, path.resolve("native-report.json"));
  assert.equal(parsed.overwrite, true);
});

test("native CLI accepts ENDURANCE_POSTGRES_ROOT and keeps each run's logs beside its report", () => {
  const parsed = parseNativeWallClockArguments([], {
    ENDURANCE_POSTGRES_ROOT: "D:/postgres-from-env",
  });
  assert.equal(parsed.postgresRoot, path.resolve("D:/postgres-from-env"));
  assert.equal(parsed.runtime, "native");
  assert.equal(parsed.durationHours, 24);
  const reportPath = path.resolve("D:/evidence/endurance.json");
  assert.equal(
    runtimeDirectoryForNativeReport(reportPath, "soak-safe-run"),
    path.join(
      path.dirname(reportPath),
      "endurance.json.native-runtime",
      "soak-safe-run",
    ),
  );
  assert.throws(
    () => runtimeDirectoryForNativeReport(reportPath, "../unsafe"),
    /runId/,
  );
});

test("native CLI archives only process logs beside the report before temporary controls are cleaned", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-native-cli-"));
  const output = path.join(directory, "native-report.json");
  const temporaryControlDirectory = path.join(directory, "temporary-control");
  const runId = "soak-native-retention";
  await mkdir(temporaryControlDirectory);
  try {
    const result = await executeNativeWallClockCommand(
      [
        "--postgres-root",
        path.join(directory, "postgres"),
        "--duration-hours",
        String(2 / 60),
        "--fault-profile",
        "compressed-all",
        "--output",
        output,
      ],
      {
        environment: {},
        driverFactory: (options) => {
          assert.equal(options.faultProfile, "compressed-all");
          return {
            stop: async () => {
              assert.equal(options.runDirectory, temporaryControlDirectory);
              await mkdir(path.join(options.runDirectory, "logs"));
              await Promise.all([
                writeFile(
                  path.join(options.runDirectory, "logs", "app.log"),
                  "redacted api log\n",
                ),
                writeFile(
                  path.join(options.runDirectory, "fault-control.json"),
                  "ephemeral control\n",
                ),
              ]);
            },
          } as unknown as WallClockRuntimeDriver;
        },
        writeReport: async (options, dependencies) => {
          assert.ok(dependencies);
          const driver = dependencies.driverFactory?.({
            runtime: "native",
            postgresRoot: options.postgresRoot,
            runId,
            seed: options.seed,
            faultProfile: options.faultProfile ?? "standard",
            durationHours: options.durationHours,
            workspaceRoot: directory,
            runDirectory: temporaryControlDirectory,
            controlDirectory: temporaryControlDirectory,
            baseUrl: null,
            operatorToken: "o".repeat(32),
            runtimeControlKey: "r".repeat(32),
            environment: {},
          });
          assert.ok(driver);
          await driver.stop({ keepData: false });
          return {
            reportPath: options.output,
            journalPath: `${options.output}.jsonl`,
            sha256Path: `${options.output}.sha256`,
            browserManifestPath: `${options.output}.browser-manifest.json`,
            controlDirectory: null,
            report: { pass: false, verified24h: false },
            journal: [],
            primaryEvidence: [],
            browser: null,
            projectId: null,
            failure: "test-only",
          } as never;
        },
      },
    );

    const expectedRuntimeDirectory = runtimeDirectoryForNativeReport(
      output,
      runId,
    );
    assert.equal(result.runtimeDirectory, expectedRuntimeDirectory);
    assert.equal(
      await readFile(
        path.join(expectedRuntimeDirectory, "logs", "app.log"),
        "utf8",
      ),
      "redacted api log\n",
    );
    assert.deepEqual(await readdir(expectedRuntimeDirectory), ["logs"]);
    assert.deepEqual(
      await readdir(path.join(expectedRuntimeDirectory, "logs")),
      ["app.log"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("native log archive never overwrites a prior run directory", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-native-cli-"));
  const controlDirectory = path.join(directory, "control");
  const reportPath = path.join(directory, "report.json");
  const sourceLog = path.join(controlDirectory, "logs", "worker.log");
  await mkdir(path.dirname(sourceLog), { recursive: true });
  await writeFile(sourceLog, "first log\n");
  try {
    const archived = await archiveNativeRuntimeLogs({
      reportPath,
      runId: "soak-no-overwrite",
      controlDirectory,
    });
    await writeFile(sourceLog, "replacement log\n");
    await assert.rejects(
      archiveNativeRuntimeLogs({
        reportPath,
        runId: "soak-no-overwrite",
        controlDirectory,
      }),
      /already exists|overwrite/iu,
    );
    assert.equal(
      await readFile(path.join(archived, "logs", "worker.log"), "utf8"),
      "first log\n",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("native log archive rejects a runtime evidence root redirected through a junction", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-native-cli-"));
  const externalDirectory = await mkdtemp(
    path.join(tmpdir(), "agentic-native-external-"),
  );
  const controlDirectory = path.join(directory, "control");
  const reportPath = path.join(directory, "report.json");
  const runtimeDirectory = runtimeDirectoryForNativeReport(
    reportPath,
    "soak-no-junction",
  );
  await mkdir(path.join(controlDirectory, "logs"), { recursive: true });
  await writeFile(path.join(controlDirectory, "logs", "app.log"), "log\n");
  try {
    try {
      await symlink(
        externalDirectory,
        path.dirname(runtimeDirectory),
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
      archiveNativeRuntimeLogs({
        reportPath,
        runId: "soak-no-junction",
        controlDirectory,
      }),
      /real local directory|redirected/iu,
    );
    assert.deepEqual(await readdir(externalDirectory), []);
  } finally {
    await Promise.all([
      rm(directory, { recursive: true, force: true }),
      rm(externalDirectory, { recursive: true, force: true }),
    ]);
  }
});
