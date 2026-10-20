import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { executeBoundedCommand, ProcessSupervisor } from "./process-supervisor";

test("parent-bound Node child terminates after forced parent death without relying on inherited stdout", async (t) => {
  const directory = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-parent-disconnect-"),
  );
  const ready = path.join(directory, "ready.json"),
    stopped = path.join(directory, "disconnected");
  const childEntry = path.join(directory, "child.cjs");
  await writeFile(
    childEntry,
    `const fs=require('node:fs'); const [stopped,ready]=process.argv.slice(2); if(!process.connected)process.exit(9); const stop=()=>{fs.writeFileSync(stopped,'observed');process.exit(0)}; let heartbeat=setTimeout(stop,3000); process.on('message',message=>{if(message.type!=='parent_alive')process.exit(7);clearTimeout(heartbeat);heartbeat=setTimeout(stop,3000);fs.writeFileSync(ready,JSON.stringify({pid:process.pid}))}); process.once('disconnect',stop); setTimeout(()=>process.exit(8),15000);`,
  );
  const entry = path.join(directory, "parent.mjs");
  await writeFile(
    entry,
    `const {executeBoundedCommand}=await import(process.argv[2]); await executeBoundedCommand({command:process.execPath,args:process.argv.slice(3),cwd:process.cwd(),environment:process.env,timeoutMs:20000,maxBufferBytes:16384,ignoreInheritedStdio:true,notifyParentDisconnect:true});`,
  );
  const parent = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href,
      entry,
      new URL("./process-supervisor.ts", import.meta.url).href,
      childEntry,
      stopped,
      ready,
    ],
    { stdio: "ignore", windowsHide: true, env: { ...process.env } },
  );
  let exited = false;
  parent.once("exit", () => {
    exited = true;
  });
  t.after(() => {
    if (!exited) parent.kill("SIGKILL");
  });
  async function waitFor(file: string, terminatingPid?: number) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        return await readFile(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (terminatingPid) {
        try {
          process.kill(terminatingPid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH")
            return "child_exited";
          throw error;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("owned parent-loss marker timeout");
  }
  const childPid = JSON.parse(await waitFor(ready)).pid as number;
  assert.ok(childPid > 0);
  // Stay alive beyond the child's missed-heartbeat deadline while parent lives.
  await new Promise((resolve) => setTimeout(resolve, 3500));
  await assert.rejects(readFile(stopped), { code: "ENOENT" });
  assert.doesNotThrow(() => process.kill(childPid, 0));
  parent.kill("SIGKILL");
  const outcome = await waitFor(stopped, childPid);
  t.diagnostic(`parent loss cleanup: ${outcome}`);
  assert.ok(["observed", "child_exited"].includes(outcome));
});

test("bounded Node commands can receive parent disconnect without inheriting terminal pipes", async () => {
  for (const ignoreInheritedStdio of [false, true]) {
    const result = await executeBoundedCommand({
      command: process.execPath,
      args: [
        "-e",
        "if(!process.connected || typeof process.send !== 'function') process.exit(9); process.stdout.write('bound'); process.disconnect();",
      ],
      cwd: process.cwd(),
      environment: { ...process.env },
      timeoutMs: 5000,
      maxBufferBytes: 16384,
      notifyParentDisconnect: true,
      ignoreInheritedStdio,
    });
    assert.equal(result.stdout, ignoreInheritedStdio ? "" : "bound");
  }
});

const childProgram = `
const name = process.env.ENDURANCE_PROCESS_NAME;
process.on("SIGTERM", () => {
  process.stdout.write(name + ":drained\\n");
  process.exit(0);
});
process.stdout.write(name + ":ready\\n");
process.stderr.write(name + ":diagnostic\\n");
if (process.env.ENDURANCE_FIXTURE_DELAY_AFTER_READY === "1") {
  // Keep the readiness-to-stop window open while this child finishes startup.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
}
setInterval(() => {}, 1000);
`;

test("ignored IPC commands cancel without waiting for a missing close event", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300);
  try {
    await assert.rejects(
      executeBoundedCommand({
        command: process.execPath,
        args: ["-e", "process.on('message',()=>{}); setInterval(()=>{},1000)"],
        cwd: process.cwd(),
        environment: { ...process.env },
        timeoutMs: 5000,
        maxBufferBytes: 16384,
        ignoreInheritedStdio: true,
        notifyParentDisconnect: true,
        signal: controller.signal,
      }),
      /cancelled/u,
    );
  } finally {
    clearTimeout(timer);
  }
});
test("bounded command cancellation ends the owned process before the ordinary timeout", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50);
  try {
    await assert.rejects(
      executeBoundedCommand({
        command: process.execPath,
        args: ["-e", "setInterval(()=>{},1000)"],
        cwd: process.cwd(),
        environment: { ...process.env },
        timeoutMs: 500,
        maxBufferBytes: 16384,
        signal: controller.signal,
      }),
      /cancelled/,
    );
  } finally {
    clearTimeout(timer);
  }
});

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
      env: { ENDURANCE_FIXTURE_DELAY_AFTER_READY: "1" },
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
