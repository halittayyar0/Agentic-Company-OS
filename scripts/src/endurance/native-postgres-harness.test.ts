import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type {
  ManagedProcessSnapshot,
  ManagedProcessSpec,
} from "./process-supervisor";
import {
  NativePostgresEnduranceHarness,
  createNativeRuntimeEnvironments,
  executeNativeCommand,
  findPortablePostgresBinaries,
  reserveLoopbackPorts,
  validateNativeStateDirectoryTarget,
  type NativeCommandExecution,
  type NativeProcessSupervisor,
  type PortablePostgresBinaries,
} from "./native-postgres-harness";

test("native command execution bounds a hung pg_ctl or psql child tree", async () => {
  await assert.rejects(
    executeNativeCommand({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      environment: { ...process.env },
      timeoutMs: 50,
    }),
    /timed out after 50ms/iu,
  );
});

async function fakePostgresTree(): Promise<{
  root: string;
  binaries: PortablePostgresBinaries;
}> {
  const root = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(tmpdir(), "agentic-native-pg-bin-")),
  );
  const binDirectory = path.join(root, "nested", "pgsql", "bin");
  const shareDirectory = path.join(root, "nested", "pgsql", "share");
  await mkdir(binDirectory, { recursive: true });
  await mkdir(shareDirectory, { recursive: true });
  const executable = process.platform === "win32" ? ".exe" : "";
  for (const name of ["postgres", "initdb", "pg_ctl", "pg_isready", "psql"]) {
    await writeFile(path.join(binDirectory, `${name}${executable}`), "fixture");
  }
  await writeFile(path.join(shareDirectory, "postgres.bki"), "catalog-v1");
  return {
    root,
    binaries: {
      binDirectory,
      postgres: path.join(binDirectory, `postgres${executable}`),
      initdb: path.join(binDirectory, `initdb${executable}`),
      pgCtl: path.join(binDirectory, `pg_ctl${executable}`),
      pgIsReady: path.join(binDirectory, `pg_isready${executable}`),
      psql: path.join(binDirectory, `psql${executable}`),
    },
  };
}

test("portable PostgreSQL discovery requires one complete sibling toolchain", async () => {
  const fixture = await fakePostgresTree();
  try {
    assert.deepEqual(
      await findPortablePostgresBinaries(fixture.root),
      fixture.binaries,
    );
    await rm(fixture.binaries.pgCtl);
    await assert.rejects(
      findPortablePostgresBinaries(fixture.root),
      /pg_ctl.*missing/iu,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native runtime attestation hashes the exact PostgreSQL 17 toolchain, Node executable, and lockfile", async () => {
  const fixture = await fakePostgresTree();
  const workspace = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(tmpdir(), "agentic-native-workspace-")),
  );
  const nodeExecutable = path.join(workspace, "node-runtime.exe");
  const lockfile = path.join(workspace, "pnpm-lock.yaml");
  await Promise.all([
    writeFile(nodeExecutable, "node-v24"),
    writeFile(lockfile, "lockfileVersion: '9.0'\n"),
  ]);
  const makeHarness = () =>
    new NativePostgresEnduranceHarness({
      runId: "native-attestation",
      workspaceRoot: workspace,
      postgresRoot: fixture.root,
      runDirectory: path.join(fixture.root, "run"),
      apiPort: 55131,
      databasePort: 55440,
      operatorToken: "o".repeat(48),
      runtimeControlKey: "r".repeat(48),
      seed: 240_901,
      nodeExecutable,
      binaries: fixture.binaries,
      execute: async (execution) => ({
        stdout:
          path.resolve(execution.command) === path.resolve(nodeExecutable)
            ? "v24.19.0\n"
            : "postgres (PostgreSQL) 17.11\n",
        stderr: "",
        exitCode: 0,
      }),
    });

  try {
    const harness = makeHarness();
    const first = await harness.runtimeAttestation();
    assert.equal(first.kind, "native-postgres");
    assert.equal(first.nodeVersion, "v24.19.0");
    assert.equal(first.postgresVersion, "PostgreSQL 17.11");
    assert.deepEqual(
      first.postgresBinaries.map((binary) => binary.name),
      ["postgres", "initdb", "pg_ctl", "pg_isready", "psql"],
    );
    assert.equal(
      first.postgresBinaries.every(
        (binary) =>
          binary.sha256 ===
          createHash("sha256").update("fixture").digest("hex"),
      ),
      true,
    );
    assert.equal(
      first.nodeExecutableSha256,
      createHash("sha256").update("node-v24").digest("hex"),
    );
    assert.equal(
      first.pnpmLockSha256,
      createHash("sha256").update("lockfileVersion: '9.0'\n").digest("hex"),
    );
    assert.equal(
      first.postgresToolchainSha256,
      createHash("sha256")
        .update(
          first.postgresBinaries
            .map((binary) => `${binary.name}\0${binary.sha256}\n`)
            .join(""),
        )
        .digest("hex"),
    );
    assert.equal(
      first.postgresDistribution.rootPath,
      path.resolve(fixture.root),
    );
    assert.equal(first.postgresDistribution.fileCount, 6);
    assert.equal(first.postgresDistribution.totalBytes > 0, true);
    assert.match(first.postgresDistribution.startSha256, /^[a-f0-9]{64}$/u);
    assert.equal(
      first.postgresDistribution.endSha256,
      first.postgresDistribution.startSha256,
    );

    await writeFile(
      path.join(fixture.root, "nested", "pgsql", "share", "postgres.bki"),
      "catalog-tampered",
    );
    await assert.rejects(
      harness.runtimeAttestation(),
      /PostgreSQL distribution.*changed|start.*end/iu,
    );
  } finally {
    await Promise.all([
      rm(fixture.root, { recursive: true, force: true }),
      rm(workspace, { recursive: true, force: true }),
    ]);
  }
});

test("native harness rejects Node versions outside 24.x before initdb", async () => {
  const fixture = await fakePostgresTree();
  const workspace = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(tmpdir(), "agentic-native-node-major-")),
  );
  const nodeExecutable = path.join(workspace, "node-runtime.exe");
  await Promise.all([
    writeFile(nodeExecutable, "node-v23"),
    writeFile(
      path.join(workspace, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
    ),
  ]);
  const commands: NativeCommandExecution[] = [];
  const harness = new NativePostgresEnduranceHarness({
    runId: "native-node-major-rejection",
    workspaceRoot: workspace,
    postgresRoot: fixture.root,
    runDirectory: path.join(workspace, "run"),
    apiPort: 55130,
    databasePort: 55439,
    operatorToken: "o".repeat(48),
    runtimeControlKey: "r".repeat(48),
    seed: 240_901,
    nodeExecutable,
    binaries: fixture.binaries,
    supervisor: new FakeSupervisor([]),
    waitForApiReady: async () => undefined,
    waitForTopology: async () => undefined,
    execute: async (execution) => {
      commands.push(structuredClone(execution));
      return {
        stdout:
          path.resolve(execution.command) === path.resolve(nodeExecutable)
            ? "v23.11.0\n"
            : "postgres (PostgreSQL) 17.11\n",
        stderr: "",
        exitCode: 0,
      };
    },
  });

  try {
    await assert.rejects(harness.start(), /Node(?:\.js)? 24/iu);
    assert.equal(
      commands.some((execution) =>
        path.basename(execution.command).toLowerCase().startsWith("initdb"),
      ),
      false,
    );
  } finally {
    await harness.stop().catch(() => undefined);
    await Promise.all([
      rm(fixture.root, { recursive: true, force: true }),
      rm(workspace, { recursive: true, force: true }),
    ]);
  }
});

test("native harness rejects a non-17 PostgreSQL toolchain before initdb", async () => {
  const fixture = await fakePostgresTree();
  const persistentDirectory = await import("node:fs/promises").then(
    ({ mkdtemp }) => mkdtemp(path.join(tmpdir(), "agentic-native-run-")),
  );
  const commands: NativeCommandExecution[] = [];
  const harness = new NativePostgresEnduranceHarness({
    runId: "native-major-rejection",
    workspaceRoot: process.cwd(),
    postgresRoot: fixture.root,
    runDirectory: persistentDirectory,
    apiPort: 55132,
    databasePort: 55441,
    operatorToken: "o".repeat(48),
    runtimeControlKey: "r".repeat(48),
    seed: 240_901,
    binaries: fixture.binaries,
    supervisor: new FakeSupervisor([]),
    waitForApiReady: async () => undefined,
    waitForTopology: async () => undefined,
    execute: async (execution) => {
      commands.push(structuredClone(execution));
      return {
        stdout:
          path.resolve(execution.command) === path.resolve(process.execPath)
            ? "v24.19.0\n"
            : "postgres (PostgreSQL) 16.9\n",
        stderr: "",
        exitCode: 0,
      };
    },
  });

  try {
    await assert.rejects(harness.start(), /PostgreSQL 17\.x/iu);
    assert.equal(
      commands.some((execution) =>
        path.basename(execution.command).toLowerCase().startsWith("initdb"),
      ),
      false,
    );
  } finally {
    await harness.stop().catch(() => undefined);
    await rm(fixture.root, { recursive: true, force: true });
    await rm(persistentDirectory, { recursive: true, force: true });
  }
});

test("loopback port reservation returns distinct currently bindable ports", async () => {
  const ports = await reserveLoopbackPorts(2);
  assert.equal(ports.length, 2);
  assert.notEqual(ports[0], ports[1]);
  for (const port of ports) {
    assert.equal(Number.isInteger(port), true);
    assert.equal(port > 0 && port <= 65_535, true);
  }
});

test("recursive native cleanup is limited to an exact run-prefixed direct child of the temp root", () => {
  const runId = "native-cleanup-test";
  const safe = path.join(tmpdir(), `agentic-native-${runId}-abcdef`);
  assert.doesNotThrow(() => validateNativeStateDirectoryTarget(safe, runId));
  assert.throws(
    () => validateNativeStateDirectoryTarget(tmpdir(), runId),
    /direct child/iu,
  );
  assert.throws(
    () =>
      validateNativeStateDirectoryTarget(
        path.join(tmpdir(), "agentic-native-unrelated-abcdef"),
        runId,
      ),
    /run-prefixed/iu,
  );
  assert.throws(
    () => validateNativeStateDirectoryTarget(path.join(safe, "nested"), runId),
    /direct child/iu,
  );
});

test("native runtime environments enforce one API, two workers, and no provider secrets", () => {
  const runDirectory = path.resolve("D:/native-run");
  const environments = createNativeRuntimeEnvironments({
    baseEnvironment: {
      OPENROUTER_API_KEY: "must-not-cross",
      DATABASE_URL_FILE: "must-not-cross",
      OPERATOR_AUTH_TOKEN_FILE: "must-not-cross",
    },
    databaseUrl: "postgresql://agentic:redacted@127.0.0.1:55432/postgres",
    apiPort: 55123,
    operatorToken: "o".repeat(48),
    runtimeControlKey: "r".repeat(48),
    runId: "native-env-test",
    runDirectory,
    seed: 240_901,
    expectedAgents: 10,
    staticUiDirectory: path.resolve("D:/workspace/ui"),
  });

  assert.equal(environments.api.RUNTIME_ROLE, "api");
  assert.equal(environments.api.SCHEDULER_ENABLED, "false");
  assert.equal(environments.api.SERVE_STATIC_UI, "true");
  assert.equal(environments.api.PORT, "55123");
  assert.equal(environments.worker1.RUNTIME_ROLE, "worker");
  assert.equal(environments.worker2.RUNTIME_ROLE, "worker");
  assert.equal(environments.worker1.SCHEDULER_ENABLED, "true");
  assert.equal(environments.worker1.SERVE_STATIC_UI, "false");
  assert.equal(
    environments.worker1.RUNTIME_CONTROL_API_URL,
    "http://127.0.0.1:55123/api/internal/runtime-control",
  );
  for (const environment of Object.values(environments)) {
    assert.equal(environment.NODE_ENV, "development");
    assert.equal(environment.SYNTHETIC_RUNTIME_ENABLED, "true");
    assert.equal(environment.ENDURANCE_MODE, "soak");
    assert.equal(environment.ENDURANCE_EXPECTED_AGENTS, "10");
    assert.equal(environment.ENDURANCE_RUN_DIR, runDirectory);
    assert.equal(
      environment.SYNTHETIC_RUNTIME_CONTROL_FILE,
      path.join(runDirectory, "fault-control.json"),
    );
    assert.equal(environment.OPENROUTER_API_KEY, undefined);
    assert.equal(environment.DATABASE_URL_FILE, undefined);
    assert.equal(environment.OPERATOR_AUTH_TOKEN_FILE, undefined);
  }
});

class FakeSupervisor implements NativeProcessSupervisor {
  readonly events: string[];
  readonly specs = new Map<string, ManagedProcessSpec>();
  private readonly state = new Map<string, ManagedProcessSnapshot>();
  private nextPid = 1_000;
  private stopFailuresRemaining: number;

  constructor(events: string[], stopFailuresRemaining = 0) {
    this.events = events;
    this.stopFailuresRemaining = stopFailuresRemaining;
  }

  start(spec: ManagedProcessSpec): ManagedProcessSnapshot {
    this.events.push(`process:start:${spec.name}`);
    this.specs.set(spec.name, structuredClone(spec));
    const snapshot: ManagedProcessSnapshot = {
      name: spec.name,
      pid: this.nextPid++,
      running: true,
      exitCode: null,
      signal: null,
    };
    this.state.set(spec.name, snapshot);
    return { ...snapshot };
  }

  snapshot(name: string): ManagedProcessSnapshot | undefined {
    const snapshot = this.state.get(name);
    return snapshot ? { ...snapshot } : undefined;
  }

  snapshots(): ManagedProcessSnapshot[] {
    return [...this.state.values()].map((item) => ({ ...item }));
  }

  logs(name: string): { stdout: string; stderr: string } {
    return {
      stdout: `${name}:stdout\nWorker ready\n`,
      stderr: `${name}:stderr\n`,
    };
  }

  async waitUntilReady(
    probe: () => boolean | Promise<boolean>,
    options: { timeoutMs: number; intervalMs?: number; label: string },
  ): Promise<void> {
    this.events.push(`ready:${options.label}`);
    assert.equal(await probe(), true);
  }

  async kill(name: string): Promise<void> {
    this.events.push(`process:kill:${name}`);
    const snapshot = this.state.get(name);
    if (snapshot) snapshot.running = false;
  }

  async stopAll(): Promise<void> {
    this.events.push("process:stop-all");
    if (this.stopFailuresRemaining > 0) {
      this.stopFailuresRemaining -= 1;
      throw new Error("simulated process cleanup failure");
    }
    for (const snapshot of this.state.values()) snapshot.running = false;
  }
}

test("native harness starts API before workers and recovers exact worker and database faults", async () => {
  const fixture = await fakePostgresTree();
  const persistentDirectory = await import("node:fs/promises").then(
    ({ mkdtemp }) => mkdtemp(path.join(tmpdir(), "agentic-native-run-")),
  );
  const stateDirectory = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(tmpdir(), "agentic-native-native-lifecycle-")),
  );
  const events: string[] = [];
  const commands: NativeCommandExecution[] = [];
  const supervisor = new FakeSupervisor(events);
  const harness = new NativePostgresEnduranceHarness({
    runId: "native-lifecycle",
    workspaceRoot: process.cwd(),
    postgresRoot: fixture.root,
    runDirectory: persistentDirectory,
    apiPort: 55124,
    databasePort: 55433,
    operatorToken: "o".repeat(48),
    runtimeControlKey: "r".repeat(48),
    seed: 240_901,
    commandTimeoutMs: 111,
    cleanupTimeoutMs: 22,
    binaries: fixture.binaries,
    supervisor,
    createStateDirectory: async () => stateDirectory,
    execute: async (execution) => {
      commands.push(structuredClone(execution));
      const command = path.basename(execution.command).toLowerCase();
      events.push(`command:${command}:${execution.args.join(" ")}`);
      if (path.resolve(execution.command) === path.resolve(process.execPath)) {
        return { stdout: "v24.19.0\n", stderr: "", exitCode: 0 };
      }
      if (command.startsWith("postgres")) {
        return {
          stdout: "postgres (PostgreSQL) 17.10\n",
          stderr: "",
          exitCode: 0,
        };
      }
      if (command.startsWith("psql")) {
        const sql = execution.args.at(-1) ?? "";
        if (sql.startsWith("SELECT json_build_object")) {
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
        return { stdout: "7\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    waitForApiReady: async () => {
      events.push("ready:api");
    },
    waitForTopology: async () => {
      events.push("ready:topology");
    },
    probeTopology: async () => {
      events.push("ready:replacement-baseline");
      return {
        ready: true,
        apiInstances: 1,
        workerInstances: 2,
        schedulerWorkers: 2,
        healthyWorkerIds: ["worker-old-1", "worker-old-2"],
      };
    },
    waitForWorkerReplacement: async (input) => {
      events.push("ready:replacement-runtime-id");
      assert.deepEqual(input.previousWorkerIds, [
        "worker-old-1",
        "worker-old-2",
      ]);
      return {
        ready: true,
        apiInstances: 1,
        workerInstances: 2,
        schedulerWorkers: 2,
        healthyWorkerIds: ["worker-new-3", "worker-old-2"],
      };
    },
  });

  try {
    await harness.start();
    assert.deepEqual(
      events.filter((event) => event.startsWith("process:start")),
      ["process:start:app", "process:start:worker-1", "process:start:worker-2"],
    );
    assert.equal(
      events.indexOf("process:start:app") < events.indexOf("ready:api"),
      true,
    );
    assert.equal(
      events.indexOf("ready:api") < events.indexOf("process:start:worker-1"),
      true,
    );
    assert.equal(
      events.indexOf("process:start:worker-2") <
        events.indexOf("ready:topology"),
      true,
    );
    assert.deepEqual(await harness.listRunningServices(), [
      "app",
      "db",
      "worker-1",
      "worker-2",
    ]);
    assert.equal(await harness.postgresVersion(), "PostgreSQL 17.10");
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
    assert.deepEqual(await harness.makeContinuousTasksDue(7, [7]), [7]);

    const firstWorker = supervisor.snapshot("worker-1")?.pid;
    await harness.killWorker("worker-1");
    assert.deepEqual(await harness.listRunningServices(), [
      "app",
      "db",
      "worker-2",
    ]);
    await harness.restartWorker("worker-1");
    assert.notEqual(supervisor.snapshot("worker-1")?.pid, firstWorker);
    assert.equal(events.includes("ready:worker-1 process"), true);
    assert.equal(events.includes("ready:replacement-baseline"), true);
    assert.equal(events.includes("ready:replacement-runtime-id"), true);

    await harness.pauseDatabase();
    assert.deepEqual(await harness.listRunningServices(), [
      "app",
      "worker-1",
      "worker-2",
    ]);
    await harness.resumeDatabase();
    assert.deepEqual(await harness.listRunningServices(), [
      "app",
      "db",
      "worker-1",
      "worker-2",
    ]);

    const diagnostics = harness.diagnostics();
    assert.equal("databaseUrl" in diagnostics, false);
    assert.equal("operatorToken" in diagnostics, false);
    assert.equal(diagnostics.apiPort, 55124);
    assert.equal(diagnostics.databasePort, 55433);
  } finally {
    await harness.stop();
  }

  assert.equal(
    commands.some((item) => item.args.includes("initdb")),
    false,
  );
  const psqlCommands = commands.filter((item) =>
    path.basename(item.command).toLowerCase().startsWith("psql"),
  );
  assert.equal(psqlCommands.length, 2);
  for (const command of psqlCommands) {
    const password = command.environment.PGPASSWORD;
    assert.equal(typeof password, "string");
    assert.ok((password?.length ?? 0) >= 32);
    assert.equal(command.args.includes(password ?? ""), false);
    assert.equal(
      command.args.some((argument) => argument.includes(password ?? "")),
      false,
    );
    assert.equal(command.args.includes("--no-password"), true);
  }
  assert.equal(
    commands.some((item) => path.basename(item.command).startsWith("initdb")),
    true,
  );
  assert.equal(
    commands.filter(
      (item) =>
        path.basename(item.command).startsWith("pg_ctl") &&
        item.args.includes("start"),
    ).length,
    2,
  );
  assert.equal(
    commands.filter(
      (item) =>
        path.basename(item.command).startsWith("pg_ctl") &&
        item.args.includes("stop"),
    ).length,
    2,
  );
  assert.equal(
    commands
      .filter((item) => path.basename(item.command).startsWith("pg_ctl"))
      .every((item) => item.ignoreInheritedStdio === true),
    true,
    "pg_ctl must not inherit captured stdio because the server process outlives pg_ctl on Windows",
  );
  assert.equal(
    commands
      .filter((item) => !path.basename(item.command).startsWith("pg_ctl"))
      .every((item) => item.ignoreInheritedStdio !== true),
    true,
  );
  assert.equal(
    commands
      .filter((item) => path.basename(item.command).startsWith("psql"))
      .every((item) => item.timeoutMs === 111),
    true,
  );
  assert.equal(
    commands
      .filter(
        (item) =>
          path.basename(item.command).startsWith("pg_ctl") &&
          item.args.includes("stop"),
      )
      .every((item) => item.timeoutMs === 22),
    true,
  );
  assert.match(
    await readFile(
      path.join(persistentDirectory, "logs", "worker-1-generation-0.log"),
      "utf8",
    ),
    /worker-1:stdout/,
  );
  await assert.rejects(
    readFile(path.join(stateDirectory, ".native-run-owner")),
  );

  await rm(fixture.root, { recursive: true, force: true });
  await rm(persistentDirectory, { recursive: true, force: true });
});

test("native startup aggregates cleanup failures and a later stop retries owned processes, database, and state", async () => {
  const fixture = await fakePostgresTree();
  const persistentDirectory = await import("node:fs/promises").then(
    ({ mkdtemp }) => mkdtemp(path.join(tmpdir(), "agentic-native-run-")),
  );
  const stateDirectory = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(tmpdir(), "agentic-native-native-retry-")),
  );
  const events: string[] = [];
  const commands: NativeCommandExecution[] = [];
  const supervisor = new FakeSupervisor(events, 1);
  let databaseStopFailuresRemaining = 1;
  const harness = new NativePostgresEnduranceHarness({
    runId: "native-retry",
    workspaceRoot: process.cwd(),
    postgresRoot: fixture.root,
    runDirectory: persistentDirectory,
    apiPort: 55125,
    databasePort: 55434,
    operatorToken: "o".repeat(48),
    runtimeControlKey: "r".repeat(48),
    seed: 240_901,
    cleanupTimeoutMs: 20,
    binaries: fixture.binaries,
    supervisor,
    createStateDirectory: async () => stateDirectory,
    execute: async (execution) => {
      commands.push(structuredClone(execution));
      const command = path.basename(execution.command).toLowerCase();
      if (path.resolve(execution.command) === path.resolve(process.execPath)) {
        return { stdout: "v24.19.0\n", stderr: "", exitCode: 0 };
      }
      if (command.startsWith("postgres")) {
        return {
          stdout: "postgres (PostgreSQL) 17.10\n",
          stderr: "",
          exitCode: 0,
        };
      }
      if (
        command.startsWith("pg_ctl") &&
        execution.args.includes("stop") &&
        databaseStopFailuresRemaining > 0
      ) {
        databaseStopFailuresRemaining -= 1;
        await new Promise((resolve) =>
          setTimeout(resolve, execution.timeoutMs),
        );
        throw new Error("simulated database cleanup timed out");
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    waitForApiReady: async () => undefined,
    waitForTopology: async () => {
      throw new Error("simulated topology startup failure");
    },
  });

  try {
    await assert.rejects(
      harness.start(),
      (error: unknown) =>
        error instanceof AggregateError &&
        error.errors.some((item) => String(item).includes("startup failure")) &&
        error.errors.some((item) => String(item).includes("cleanup failed")),
    );
    assert.equal(
      await readFile(path.join(stateDirectory, ".native-run-owner"), "utf8"),
      "native-retry",
    );
    await harness.stop();
    await harness.stop();
    assert.equal(
      events.filter((event) => event === "process:stop-all").length,
      2,
    );
    assert.equal(
      commands.filter(
        (execution) =>
          path.basename(execution.command).toLowerCase().startsWith("pg_ctl") &&
          execution.args.includes("stop"),
      ).length,
      2,
    );
    await assert.rejects(
      readFile(path.join(stateDirectory, ".native-run-owner")),
    );
  } finally {
    await harness.stop().catch(() => undefined);
    await rm(fixture.root, { recursive: true, force: true });
    await rm(persistentDirectory, { recursive: true, force: true });
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
