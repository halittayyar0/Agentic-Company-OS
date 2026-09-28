import assert from "node:assert/strict";
import test from "node:test";

import { executeBoundedCommand, ProcessSupervisor } from "./process-supervisor";

const childProgram = `
const name = process.env.ENDURANCE_PROCESS_NAME;
process.stdout.write(name + ":ready\\n");
process.stderr.write(name + ":diagnostic\\n");
process.on("SIGTERM", () => {
  process.stdout.write(name + ":drained\\n");
  process.exit(0);
});
setInterval(() => {}, 1000);
`;

test("bounded commands time out and terminate only their spawned process tree", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    executeBoundedCommand({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      environment: { ...process.env },
      timeoutMs: 50,
      maxBufferBytes: 16_384,
    }),
    /timed out after 50ms/iu,
  );
  assert.equal(Date.now() - startedAt < 5_000, true);
});

test("supervisor captures bounded logs and stops only the exact named child", async () => {
  const supervisor = new ProcessSupervisor({
    runId: "supervisor-test",
    gracefulStopMs: 1_000,
    logLimitBytes: 16_384,
  });
  try {
    const first = supervisor.start({
      name: "worker-a",
      command: process.execPath,
      args: ["-e", childProgram],
    });
    const second = supervisor.start({
      name: "worker-b",
      command: process.execPath,
      args: ["-e", childProgram],
    });
    await supervisor.waitUntilReady(
      () => supervisor.logs("worker-a").stdout.includes("worker-a:ready"),
      { timeoutMs: 2_000, intervalMs: 10, label: "worker-a readiness" },
    );
    await supervisor.waitUntilReady(
      () => supervisor.logs("worker-b").stderr.includes("worker-b:diagnostic"),
      { timeoutMs: 2_000, intervalMs: 10, label: "worker-b readiness" },
    );
    assert.notEqual(first.pid, second.pid);

    await supervisor.stop("worker-a");
    assert.equal(supervisor.snapshot("worker-a")?.running, false);
    assert.equal(supervisor.snapshot("worker-b")?.running, true);
    if (process.platform !== "win32") {
      assert.match(supervisor.logs("worker-a").stdout, /drained/);
    }

    await supervisor.stopAll();
    assert.equal(supervisor.snapshot("worker-b")?.running, false);
    await supervisor.stopAll();
  } finally {
    await supervisor.stopAll();
  }
});

test("readiness deadlines fail closed and partial startup is always cleanable", async () => {
  const supervisor = new ProcessSupervisor({
    runId: "deadline-test",
    gracefulStopMs: 250,
  });
  supervisor.start({
    name: "api",
    command: process.execPath,
    args: ["-e", childProgram],
  });
  try {
    await assert.rejects(
      supervisor.waitUntilReady(async () => false, {
        timeoutMs: 50,
        intervalMs: 5,
        label: "API readiness",
      }),
      /API readiness.*50ms/,
    );
  } finally {
    await supervisor.stopAll();
  }
  assert.equal(supervisor.snapshot("api")?.running, false);
});

test("duplicate names and invalid run identity are rejected", async () => {
  assert.throws(() => new ProcessSupervisor({ runId: "../unsafe" }), /runId/);
  const supervisor = new ProcessSupervisor({
    runId: "safe-run-1",
    gracefulStopMs: 250,
  });
  try {
    supervisor.start({
      name: "worker",
      command: process.execPath,
      args: ["-e", childProgram],
    });
    assert.throws(
      () =>
        supervisor.start({
          name: "worker",
          command: process.execPath,
          args: ["-e", childProgram],
        }),
      /already managed/,
    );
  } finally {
    await supervisor.stopAll();
  }
});

test("a killed process name can be reused for a fresh worker generation", async () => {
  const supervisor = new ProcessSupervisor({
    runId: "restart-test",
    gracefulStopMs: 250,
  });
  try {
    const first = supervisor.start({
      name: "worker-1",
      command: process.execPath,
      args: ["-e", childProgram],
    });
    supervisor.start({
      name: "worker-2",
      command: process.execPath,
      args: ["-e", childProgram],
    });
    await supervisor.waitUntilReady(
      () => supervisor.logs("worker-1").stdout.includes("worker-1:ready"),
      { timeoutMs: 2_000, intervalMs: 10, label: "worker-1 readiness" },
    );

    await supervisor.kill("worker-1");
    assert.equal(supervisor.snapshot("worker-1")?.running, false);
    assert.equal(supervisor.snapshot("worker-2")?.running, true);

    const restarted = supervisor.start({
      name: "worker-1",
      command: process.execPath,
      args: ["-e", childProgram],
    });
    assert.notEqual(restarted.pid, first.pid);
    await supervisor.waitUntilReady(
      () => supervisor.logs("worker-1").stdout.includes("worker-1:ready"),
      { timeoutMs: 2_000, intervalMs: 10, label: "restarted worker-1" },
    );
  } finally {
    await supervisor.stopAll();
  }
});
