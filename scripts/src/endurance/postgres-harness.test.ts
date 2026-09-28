import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  PostgresEnduranceHarness,
  type CommandExecution,
  type CommandExecutor,
} from "./postgres-harness";

const TEST_SOURCE_IDENTITY = {
  sourceCommitSha: "1".repeat(40),
  sourceTreeSha256: "2".repeat(64),
};
const resolveTestSourceIdentity = async () => ({ ...TEST_SOURCE_IDENTITY });

function recordingExecutor(input?: { failOnUp?: boolean }): {
  calls: CommandExecution[];
  execute: CommandExecutor;
} {
  const calls: CommandExecution[] = [];
  return {
    calls,
    execute: async (execution) => {
      calls.push(structuredClone(execution));
      if (input?.failOnUp && execution.args.includes("up")) {
        throw new Error("simulated compose startup failure");
      }
      return { stdout: "ok", stderr: "", exitCode: 0 };
    },
  };
}

test("compose harness owns one exact run-scoped project and worker target", async () => {
  const fake = recordingExecutor();
  const harness = new PostgresEnduranceHarness({
    runId: "run-240901",
    resolveSourceIdentity: resolveTestSourceIdentity,
    workspaceRoot: "D:/workspace",
    execute: fake.execute,
  });

  await harness.start();
  await harness.killWorker("worker-1");
  await harness.stop();
  await harness.stop();

  assert.equal(fake.calls.length, 4);
  const [build, up, kill, down] = fake.calls;
  for (const call of fake.calls) {
    assert.equal(call.command, "docker");
    assert.equal(call.environment.ENDURANCE_RUN_ID, "run-240901");
    assert.equal(call.cwd, path.resolve("D:/workspace"));
    assert.deepEqual(call.args.slice(0, 4), [
      "compose",
      "--project-name",
      "agentic-os-soak-run-240901",
      "--file",
    ]);
  }
  assert.deepEqual(build.args.slice(-4), [
    "build",
    "app",
    "worker-1",
    "worker-2",
  ]);
  assert.equal(up.args.includes("up"), true);
  assert.equal(up.args.includes("--wait"), true);
  assert.deepEqual(
    kill.args.slice(-3),
    ["kill", "--signal", "SIGKILL", "worker-1"].slice(-3),
  );
  assert.equal(kill.args.at(-1), "worker-1");
  assert.equal(down.args.includes("--volumes"), true);
  assert.equal(down.args.includes("--remove-orphans"), true);
  await assert.rejects(
    harness.killWorker("db" as "worker-1"),
    /worker-1 or worker-2/,
  );
});

test("compose harness starts a prebuilt exact image with no build and attests running image identities", async () => {
  const sourceCommitSha = "1".repeat(40);
  const sourceTreeSha256 = "2".repeat(64);
  const applicationImageId = `sha256:${"a".repeat(64)}`;
  const databaseImageId = `sha256:${"b".repeat(64)}`;
  let worker2ImageId = applicationImageId;
  let reportedSourceTreeSha256 = sourceTreeSha256;
  const containers = new Map([
    ["app", "a".repeat(64)],
    ["worker-1", "b".repeat(64)],
    ["worker-2", "c".repeat(64)],
    ["db", "d".repeat(64)],
  ]);
  const calls: CommandExecution[] = [];
  const harness = new PostgresEnduranceHarness({
    runId: "prebuilt-attestation",
    resolveSourceIdentity: resolveTestSourceIdentity,
    workspaceRoot: process.cwd(),
    environment: {
      ENDURANCE_PREBUILT_IMAGE: "true",
      ENDURANCE_RUNTIME_IMAGE: "agentic-company-os:endurance-ci",
      ENDURANCE_SOURCE_COMMIT_SHA: sourceCommitSha,
      ENDURANCE_SOURCE_TREE_SHA256: sourceTreeSha256,
    },
    execute: async (execution) => {
      calls.push(structuredClone(execution));
      if (execution.args.includes("build")) {
        throw new Error("prebuilt execution must not build");
      }
      if (execution.args.includes("ps") && execution.args.includes("--quiet")) {
        const service = execution.args.at(-1) ?? "";
        return {
          stdout: `${containers.get(service) ?? ""}\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      if (execution.args[0] === "inspect") {
        const containerId = execution.args.at(-1);
        const service = [...containers.entries()].find(
          ([, id]) => id === containerId,
        )?.[0];
        const imageId =
          service === "db"
            ? databaseImageId
            : service === "worker-2"
              ? worker2ImageId
              : applicationImageId;
        const labels =
          service === "db"
            ? {}
            : {
                "org.opencontainers.image.revision": sourceCommitSha,
                "com.agentic-company-os.source-tree-sha256":
                  service === "worker-2"
                    ? reportedSourceTreeSha256
                    : sourceTreeSha256,
              };
        return {
          stdout: `${JSON.stringify(imageId)}\t${JSON.stringify(labels)}\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      if (execution.args[0] === "image") {
        const reference = execution.args.at(-1);
        return {
          stdout: `${JSON.stringify(
            reference === "agentic-company-os:endurance-ci"
              ? applicationImageId
              : databaseImageId,
          )}\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  });

  await harness.start();
  assert.deepEqual(await harness.runtimeAttestation(), {
    kind: "docker",
    serviceImageIds: {
      app: applicationImageId,
      worker1: applicationImageId,
      worker2: applicationImageId,
      database: databaseImageId,
    },
    applicationImageLabels: { sourceCommitSha, sourceTreeSha256 },
  });
  worker2ImageId = `sha256:${"c".repeat(64)}`;
  await assert.rejects(
    harness.runtimeAttestation(),
    /worker-2.*exact requested endurance image/iu,
  );
  worker2ImageId = applicationImageId;
  reportedSourceTreeSha256 = "3".repeat(64);
  await assert.rejects(
    harness.runtimeAttestation(),
    /worker-2.*OCI source identity labels/iu,
  );
  await harness.stop();

  const up = calls.find((call) => call.args.includes("up"));
  assert.ok(up);
  assert.equal(up.args.includes("--no-build"), true);
  assert.equal(up.args.includes("--build"), false);
  assert.equal(
    calls.some((call) => call.args.includes("build")),
    false,
  );
});

test("compose harness builds once before a no-build startup when no prebuilt image is supplied", async () => {
  const fake = recordingExecutor();
  const harness = new PostgresEnduranceHarness({
    runId: "local-build-once",
    resolveSourceIdentity: resolveTestSourceIdentity,
    workspaceRoot: process.cwd(),
    environment: {
      ENDURANCE_SOURCE_COMMIT_SHA: "1".repeat(40),
      ENDURANCE_SOURCE_TREE_SHA256: "2".repeat(64),
    },
    execute: fake.execute,
  });

  await harness.start();
  await harness.stop();

  const build = fake.calls.find((call) => call.args.includes("build"));
  const up = fake.calls.find((call) => call.args.includes("up"));
  assert.ok(build);
  assert.deepEqual(build.args.slice(-4), [
    "build",
    "app",
    "worker-1",
    "worker-2",
  ]);
  assert.ok(up);
  assert.equal(up.args.includes("--no-build"), true);
  assert.equal(up.args.includes("--build"), false);
  assert.equal(fake.calls.indexOf(build) < fake.calls.indexOf(up), true);
});

test("partial compose startup tears down the same project", async () => {
  const fake = recordingExecutor({ failOnUp: true });
  const harness = new PostgresEnduranceHarness({
    runId: "partial-start",
    resolveSourceIdentity: resolveTestSourceIdentity,
    workspaceRoot: process.cwd(),
    execute: fake.execute,
  });
  await assert.rejects(harness.start(), /startup failure/);
  assert.equal(fake.calls.length, 4);
  assert.equal(fake.calls[0].args.includes("build"), true);
  assert.equal(fake.calls[1].args.includes("up"), true);
  assert.equal(fake.calls[2].args.includes("logs"), true);
  assert.equal(fake.calls[3].args.includes("down"), true);
  assert.equal(harness.state().running, false);
});

test("compose cleanup preserves ownership after failure and retries the exact project", async () => {
  const calls: CommandExecution[] = [];
  let downFailuresRemaining = 1;
  const harness = new PostgresEnduranceHarness({
    runId: "cleanup-retry",
    resolveSourceIdentity: resolveTestSourceIdentity,
    workspaceRoot: process.cwd(),
    cleanupTimeoutMs: 20,
    execute: async (execution) => {
      calls.push(structuredClone(execution));
      if (execution.args.includes("down") && downFailuresRemaining > 0) {
        downFailuresRemaining -= 1;
        await new Promise((resolve) =>
          setTimeout(resolve, execution.timeoutMs),
        );
        throw new Error("simulated compose cleanup timed out");
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  });

  await harness.start();
  await assert.rejects(harness.stop(), /cleanup timed out/iu);
  assert.equal(harness.state().running, true);
  await harness.stop();
  assert.equal(harness.state().running, false);
  await harness.stop();
  assert.equal(calls.filter((call) => call.args.includes("down")).length, 2);
  assert.equal(
    calls
      .filter((call) => call.args.includes("down"))
      .every((call) => call.timeoutMs === 20),
    true,
  );
});

test("compose startup aggregates the primary error with failed cleanup and remains retryable", async () => {
  const calls: CommandExecution[] = [];
  let downFailuresRemaining = 1;
  const harness = new PostgresEnduranceHarness({
    runId: "startup-cleanup-retry",
    resolveSourceIdentity: resolveTestSourceIdentity,
    workspaceRoot: process.cwd(),
    execute: async (execution) => {
      calls.push(structuredClone(execution));
      if (execution.args.includes("up")) {
        throw new Error("simulated compose startup failure");
      }
      if (execution.args.includes("down") && downFailuresRemaining > 0) {
        downFailuresRemaining -= 1;
        throw new Error("simulated compose cleanup failure");
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  });

  await assert.rejects(
    harness.start(),
    (error: unknown) =>
      error instanceof AggregateError &&
      error.errors.some((item) => String(item).includes("startup failure")) &&
      error.errors.some((item) => String(item).includes("cleanup failure")),
  );
  await harness.stop();
  await harness.stop();
  assert.equal(calls.filter((call) => call.args.includes("down")).length, 2);
});

test("unsafe identifiers and duplicate starts fail closed", async () => {
  assert.throws(
    () =>
      new PostgresEnduranceHarness({
        runId: "../broad-target",
        workspaceRoot: process.cwd(),
      }),
    /runId/,
  );
  const fake = recordingExecutor();
  const harness = new PostgresEnduranceHarness({
    runId: "single-start",
    resolveSourceIdentity: resolveTestSourceIdentity,
    workspaceRoot: process.cwd(),
    execute: fake.execute,
  });
  await harness.start();
  await assert.rejects(harness.start(), /already running/);
  await harness.stop();
});

test("database faults and provenance stay scoped to the running compose project", async () => {
  const fake = recordingExecutor();
  fake.execute = async (execution) => {
    fake.calls.push(structuredClone(execution));
    if (execution.args.includes("ps")) {
      return {
        stdout: "app\ndb\nworker-2\nworker-1\n",
        stderr: "",
        exitCode: 0,
      };
    }
    if (execution.args.includes("exec")) {
      return {
        stdout: "postgres (PostgreSQL) 17.6\n",
        stderr: "",
        exitCode: 0,
      };
    }
    return { stdout: "ok", stderr: "", exitCode: 0 };
  };
  const harness = new PostgresEnduranceHarness({
    runId: "fault-controls",
    resolveSourceIdentity: resolveTestSourceIdentity,
    workspaceRoot: process.cwd(),
    execute: fake.execute,
  });

  await harness.start();
  await harness.pauseDatabase();
  await harness.resumeDatabase();
  assert.deepEqual(await harness.listRunningServices(), [
    "app",
    "db",
    "worker-1",
    "worker-2",
  ]);
  assert.equal(await harness.postgresVersion(), "PostgreSQL 17.6");
  await harness.stop();

  assert.deepEqual(fake.calls[2].args.slice(-2), ["pause", "db"]);
  assert.deepEqual(fake.calls[3].args.slice(-2), ["unpause", "db"]);
  assert.deepEqual(fake.calls[4].args.slice(-4), [
    "ps",
    "--services",
    "--filter",
    "status=running",
  ]);
  assert.deepEqual(fake.calls[5].args.slice(-5), [
    "exec",
    "--no-TTY",
    "db",
    "postgres",
    "--version",
  ]);
  assert.equal(
    fake.calls.every((call) =>
      call.args.includes("agentic-os-soak-fault-controls"),
    ),
    true,
  );
});

test("durable fault evidence query is fixed, read-only, and strictly parsed", async () => {
  const fake = recordingExecutor();
  fake.execute = async (execution) => {
    fake.calls.push(structuredClone(execution));
    if (execution.args.includes("--command")) {
      return {
        stdout: `${JSON.stringify({
          id: "42",
          eventType: "error",
          kind: "task_retry_scheduled",
          state: null,
          taskId: 7,
          attemptId: "attempt-7",
          attemptNumber: 4,
          occurredAt: "2026-09-01T00:01:05.000Z",
          providerFailureKinds: ["timeout"],
        })}\n`,
        stderr: "",
        exitCode: 0,
      };
    }
    return { stdout: "ok", stderr: "", exitCode: 0 };
  };
  const harness = new PostgresEnduranceHarness({
    runId: "durable-evidence",
    resolveSourceIdentity: resolveTestSourceIdentity,
    workspaceRoot: process.cwd(),
    execute: fake.execute,
  });
  await harness.start();
  assert.deepEqual(
    await harness.readDurableEnduranceEvents(
      new Date("2026-09-01T00:01:00.000Z"),
    ),
    [
      {
        id: "42",
        eventType: "error",
        kind: "task_retry_scheduled",
        state: null,
        taskId: 7,
        attemptId: "attempt-7",
        attemptNumber: 4,
        occurredAt: "2026-09-01T00:01:05.000Z",
        providerFailureKinds: ["timeout"],
      },
    ],
  );
  const query = fake.calls.at(-1)!;
  const usernameIndex = query.args.indexOf("--username");
  assert.deepEqual(query.args.slice(usernameIndex, usernameIndex + 2), [
    "--username",
    "agentic",
  ]);
  assert.equal(query.args.includes("--command"), true);
  const sql = query.args.at(-1) ?? "";
  assert.match(sql, /^SELECT json_build_object/iu);
  assert.match(sql, /activity_events/iu);
  assert.doesNotMatch(sql, /delete|update|insert/iu);
  await assert.rejects(
    harness.readDurableEnduranceEvents(new Date(Number.NaN)),
    /valid date/,
  );
  await harness.stop();
});

test("short-run provider wake is project-scoped and returns only due continuous tasks", async () => {
  const fake = recordingExecutor();
  fake.execute = async (execution) => {
    fake.calls.push(structuredClone(execution));
    if (execution.args.includes("--command")) {
      return { stdout: "7\n9\n", stderr: "", exitCode: 0 };
    }
    return { stdout: "ok", stderr: "", exitCode: 0 };
  };
  const harness = new PostgresEnduranceHarness({
    runId: "provider-wake",
    resolveSourceIdentity: resolveTestSourceIdentity,
    workspaceRoot: process.cwd(),
    execute: fake.execute,
  });
  await harness.start();
  assert.deepEqual(await harness.makeContinuousTasksDue(7, [9, 7, 9]), [7, 9]);

  const command = fake.calls.at(-1)!;
  const sql = command.args.at(-1) ?? "";
  assert.match(sql, /^UPDATE tasks/iu);
  assert.match(sql, /autonomy_mode = 'continuous'/iu);
  assert.match(sql, /lease_owner IS NULL/iu);
  assert.match(sql, /status = 'in_progress'/iu);
  assert.match(sql, /\(id = 7 OR parent_task_id = 7\)/iu);
  assert.match(sql, /id IN \(7, 9\)/iu);
  assert.doesNotMatch(sql, /delete|drop|truncate/iu);
  await assert.rejects(
    harness.makeContinuousTasksDue(7, [0]),
    /positive safe integer/iu,
  );
  await harness.stop();
});
