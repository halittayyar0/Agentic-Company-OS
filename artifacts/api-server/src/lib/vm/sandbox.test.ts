import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  approvalRequestsTable,
  db,
  dbReady,
  tasksTable,
} from "@workspace/db";
import {
  execFounderShell,
  execAgentSudo,
  execInSandbox,
  deleteEntry,
  getSandboxWorkingDirectory,
  getAgentSudoTarget,
  guardChildProcessPipes,
  redactAgentSudoText,
  readTextFile,
  safeResolve,
  stopAllAgentProcesses,
  validateAgentSudoCommand,
  writeBinaryFile,
  writeTextFile,
} from "./sandbox";
import { assertAgentSudoLocalOnly } from "../runtime-security";
import {
  registerOwnedAgentRuntime,
  ownedAgentRuntimeCount,
} from "../orchestrator/owned-agent-runtimes";
import { ceoPermissionsPreset } from "../orchestrator/permission-presets";
import { canonicalArgumentHash } from "../orchestrator/operation-receipts";
import {
  activateLocalEmergencyStop,
  captureLocalExecutionEpoch,
  deactivateLocalEmergencyStop,
} from "../orchestrator/local-emergency-epoch";

const sandboxBase = await fsp.mkdtemp(
  path.join(os.tmpdir(), "agentic-os-sandbox-test-"),
);
process.env.AGENT_SANDBOX_ROOT = sandboxBase;

test.after(async () => {
  await fsp.rm(sandboxBase, { recursive: true, force: true });
});

test("the shared sandbox emergency stop waits for owned runtime cleanup before that runtime is unregistered", async () => {
  let release!: () => void,
    invoked = 0;
  const proof = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runtime = registerOwnedAgentRuntime(
    captureLocalExecutionEpoch(),
    async () => {
      invoked++;
      await proof;
    },
  );
  try {
    assert.equal(stopAllAgentProcesses(), 1);
    assert.equal(invoked, 1);
    assert.equal(ownedAgentRuntimeCount(), 1);
    release();
    await runtime.stop();
    assert.equal(ownedAgentRuntimeCount(), 0);
  } finally {
    release();
    await runtime.stop();
    deactivateLocalEmergencyStop();
  }
});

test("safeResolve rejects traversal outside the per-agent root", () => {
  assert.throws(() => safeResolve(7, "../../outside.txt"), /Guvensiz yol/);
  assert.throws(() => safeResolve(7, "..\\..\\outside.txt"), /Guvensiz yol/);
});

test("child pipe guards absorb revocation errors without a process exception", () => {
  const child = {
    stdin: new EventEmitter(),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  } as unknown as Parameters<typeof guardChildProcessPipes>[0];
  const codes: Array<string | undefined> = [];
  guardChildProcessPipes(child, (error) => codes.push(error.code));

  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    assert.doesNotThrow(() =>
      stream?.emit(
        "error",
        Object.assign(new Error("write ECONNABORTED"), {
          code: "ECONNABORTED",
        }),
      ),
    );
  }
  assert.deepEqual(codes, ["ECONNABORTED", "ECONNABORTED", "ECONNABORTED"]);
});

test("sandbox file operations stay inside the assigned root", async () => {
  await writeTextFile(7, "notes/result.txt", "verified");
  const result = await readTextFile(7, "notes/result.txt");
  assert.equal(result.content, "verified");
  assert.ok(result.path.endsWith("notes/result.txt"));
});

test("writeTextFile awaits one hook after preflight and before the file write", async () => {
  const agentId = 40;
  const target = safeResolve(agentId, "nested/boundary.txt").abs;
  let calls = 0;
  let hookFinished = false;

  const result = await writeTextFile(
    agentId,
    "nested/boundary.txt",
    "verified",
    undefined,
    async () => {
      calls += 1;
      assert.equal(await fsp.stat(target).catch(() => null), null);
      await Promise.resolve();
      hookFinished = true;
    },
  );

  assert.equal(calls, 1);
  assert.equal(hookFinished, true);
  assert.equal(result.sizeBytes, Buffer.byteLength("verified"));
  assert.equal(await fsp.readFile(target, "utf8"), "verified");
});

test("writeTextFile never hooks rejected preflight and hook rejection prevents the write", async () => {
  const agentId = 41;
  let rejectedPreflightCalls = 0;
  await assert.rejects(
    () =>
      writeTextFile(
        agentId,
        "../../escape.txt",
        "blocked",
        undefined,
        async () => {
          rejectedPreflightCalls += 1;
        },
      ),
    /Guvensiz yol/,
  );
  assert.equal(rejectedPreflightCalls, 0);

  const target = safeResolve(agentId, "rejected-parent/gated.txt").abs;
  const parent = path.dirname(target);
  let gateCalls = 0;
  await assert.rejects(
    () =>
      writeTextFile(
        agentId,
        "rejected-parent/gated.txt",
        "blocked",
        undefined,
        async () => {
          gateCalls += 1;
          throw new Error("effect gate rejected");
        },
      ),
    /effect gate rejected/,
  );
  assert.equal(gateCalls, 1);
  assert.equal(await fsp.stat(parent).catch(() => null), null);
  assert.equal(await fsp.stat(target).catch(() => null), null);
});

test("writeTextFile rejects a path swapped to a symlink while the awaited hook runs", async () => {
  const agentId = 44;
  const target = safeResolve(agentId, "swap-parent/proof.txt").abs;
  const parent = path.dirname(target);
  const outside = await fsp.mkdtemp(path.join(sandboxBase, "outside-text-"));
  const outsideTarget = path.join(outside, "proof.txt");

  await assert.rejects(
    () =>
      writeTextFile(
        agentId,
        "swap-parent/proof.txt",
        "must-stay-contained",
        undefined,
        async () => {
          await fsp.rm(parent, { recursive: true, force: true });
          await fsp.symlink(
            outside,
            parent,
            process.platform === "win32" ? "junction" : "dir",
          );
        },
      ),
    /Sembolik bag yolu reddedildi/,
  );
  assert.equal(await fsp.stat(outsideTarget).catch(() => null), null);
});

test("writeBinaryFile rejects a path swapped to a symlink while the awaited hook runs", async () => {
  const agentId = 45;
  const target = safeResolve(agentId, "swap-parent/proof.bin").abs;
  const parent = path.dirname(target);
  const outside = await fsp.mkdtemp(path.join(sandboxBase, "outside-binary-"));
  const outsideTarget = path.join(outside, "proof.bin");

  await assert.rejects(
    () =>
      writeBinaryFile(
        agentId,
        "swap-parent/proof.bin",
        Buffer.from("must-stay-contained"),
        undefined,
        async () => {
          await fsp.rm(parent, { recursive: true, force: true });
          await fsp.symlink(
            outside,
            parent,
            process.platform === "win32" ? "junction" : "dir",
          );
        },
      ),
    /Sembolik bag yolu reddedildi/,
  );
  assert.equal(await fsp.stat(outsideTarget).catch(() => null), null);
});

test("execInSandbox hooks each mutating builtin once but never read-only or rejected commands", async () => {
  const agentId = 42;
  let phase: "idle" | "mkdir" | "cd" | "write" | "rm" = "idle";
  const observed: string[] = [];
  const beforeEffect = async () => {
    observed.push(phase);
    if (phase === "mkdir") {
      assert.equal(
        await fsp.stat(safeResolve(agentId, "project").abs).catch(() => null),
        null,
      );
    } else if (phase === "write") {
      assert.equal(
        await fsp
          .stat(safeResolve(agentId, "project/proof.txt").abs)
          .catch(() => null),
        null,
      );
    } else if (phase === "rm") {
      assert.equal(
        await fsp
          .readFile(safeResolve(agentId, "project/proof.txt").abs, "utf8")
          .catch(() => null),
        "verified",
      );
    }
  };

  assert.equal(
    (await execInSandbox(agentId, "pwd", 15_000, beforeEffect)).ok,
    true,
  );
  assert.deepEqual(observed, []);

  phase = "mkdir";
  assert.equal(
    (await execInSandbox(agentId, "mkdir project", 15_000, beforeEffect)).ok,
    true,
  );
  phase = "cd";
  assert.equal(
    (await execInSandbox(agentId, "cd project", 15_000, beforeEffect)).ok,
    true,
  );
  phase = "write";
  assert.equal(
    (
      await execInSandbox(
        agentId,
        "write proof.txt verified",
        15_000,
        beforeEffect,
      )
    ).ok,
    true,
  );
  phase = "rm";
  assert.equal(
    (await execInSandbox(agentId, "rm proof.txt", 15_000, beforeEffect)).ok,
    true,
  );
  assert.deepEqual(observed, ["mkdir", "cd", "write", "rm"]);

  phase = "write";
  const rejected = await execInSandbox(
    agentId,
    "write ../../escape.txt blocked",
    15_000,
    beforeEffect,
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.note, "path-policy");
  assert.deepEqual(observed, ["mkdir", "cd", "write", "rm"]);
});

test(
  "execInSandbox awaits one hook immediately before spawn and a rejected hook prevents it",
  { timeout: 15_000 },
  async () => {
    const previous = process.env.ALLOW_AGENT_PROCESS_EXEC;
    const agentId = 43;
    process.env.ALLOW_AGENT_PROCESS_EXEC = "true";
    try {
      await writeTextFile(
        agentId,
        "spawn-effect.cjs",
        'require("node:fs").writeFileSync("spawned.txt", "yes");',
      );
      const marker = safeResolve(agentId, "spawned.txt").abs;
      let calls = 0;
      const outcome = await execInSandbox(
        agentId,
        "node spawn-effect.cjs",
        15_000,
        async () => {
          calls += 1;
          assert.equal(await fsp.stat(marker).catch(() => null), null);
          await Promise.resolve();
        },
      );
      assert.equal(outcome.ok, true);
      assert.equal(calls, 1);
      assert.equal(await fsp.readFile(marker, "utf8"), "yes");

      await fsp.rm(marker);
      await assert.rejects(
        () =>
          execInSandbox(agentId, "node spawn-effect.cjs", 15_000, async () => {
            throw new Error("spawn gate rejected");
          }),
        /spawn gate rejected/,
      );
      assert.equal(await fsp.stat(marker).catch(() => null), null);

      let rejectedPreflightCalls = 0;
      const rejected = await execInSandbox(
        agentId,
        "not-allowlisted",
        15_000,
        async () => {
          rejectedPreflightCalls += 1;
        },
      );
      assert.equal(rejected.note, "allowlist");
      assert.equal(rejectedPreflightCalls, 0);
    } finally {
      stopAllAgentProcesses();
      deactivateLocalEmergencyStop();
      if (previous === undefined) delete process.env.ALLOW_AGENT_PROCESS_EXEC;
      else process.env.ALLOW_AGENT_PROCESS_EXEC = previous;
    }
  },
);

test(
  "execInSandbox rejects a cwd swapped to a symlink while the awaited hook runs",
  { timeout: 15_000 },
  async () => {
    const previous = process.env.ALLOW_AGENT_PROCESS_EXEC;
    const agentId = 46;
    const workdir = safeResolve(agentId, "swap-cwd").abs;
    const outside = await fsp.mkdtemp(path.join(sandboxBase, "outside-cwd-"));
    const outsideMarker = path.join(outside, "spawned.txt");
    process.env.ALLOW_AGENT_PROCESS_EXEC = "true";

    try {
      await writeTextFile(
        agentId,
        "swap-cwd/spawn-effect.cjs",
        'require("node:fs").writeFileSync("spawned.txt", "escaped");',
      );
      await fsp.writeFile(
        path.join(outside, "spawn-effect.cjs"),
        'require("node:fs").writeFileSync("spawned.txt", "escaped");',
      );
      assert.equal((await execInSandbox(agentId, "cd swap-cwd")).ok, true);

      await assert.rejects(
        () =>
          execInSandbox(agentId, "node spawn-effect.cjs", 15_000, async () => {
            await fsp.rm(workdir, { recursive: true, force: true });
            await fsp.symlink(
              outside,
              workdir,
              process.platform === "win32" ? "junction" : "dir",
            );
          }),
        /Sembolik bag yolu reddedildi/,
      );
      assert.equal(await fsp.stat(outsideMarker).catch(() => null), null);
    } finally {
      stopAllAgentProcesses();
      deactivateLocalEmergencyStop();
      if (previous === undefined) delete process.env.ALLOW_AGENT_PROCESS_EXEC;
      else process.env.ALLOW_AGENT_PROCESS_EXEC = previous;
    }
  },
);

test("a stale emergency epoch cannot mutate sandbox files", async () => {
  const agentId = 35;
  deactivateLocalEmergencyStop();
  await writeTextFile(agentId, "existing.txt", "keep");
  const staleEpoch = captureLocalExecutionEpoch();
  activateLocalEmergencyStop();

  try {
    await assert.rejects(
      () => writeTextFile(agentId, "late.txt", "blocked", staleEpoch),
      /Emergency stop/,
    );
    await assert.rejects(
      () =>
        writeBinaryFile(
          agentId,
          "late.bin",
          Buffer.from("blocked"),
          staleEpoch,
        ),
      /Emergency stop/,
    );
    await assert.rejects(
      () => deleteEntry(agentId, "existing.txt", staleEpoch),
      /Emergency stop/,
    );
    await assert.rejects(() => readTextFile(agentId, "late.txt"));
    await assert.rejects(() => readTextFile(agentId, "late.bin"));
    assert.equal((await readTextFile(agentId, "existing.txt")).content, "keep");
  } finally {
    deactivateLocalEmergencyStop();
  }
});

test("sandbox terminal keeps a path-safe working directory across commands", async () => {
  const agentId = 31;
  assert.equal((await execInSandbox(agentId, "mkdir project")).ok, true);
  const changed = await execInSandbox(agentId, "cd project");
  assert.equal(changed.stdout, "/project\n");
  assert.equal(changed.cwd, "/project");
  assert.equal(await getSandboxWorkingDirectory(agentId), "/project");
  assert.equal(
    (await execInSandbox(agentId, "write proof.txt verified")).ok,
    true,
  );
  assert.equal(
    (await readTextFile(agentId, "project/proof.txt")).content,
    "verified",
  );
  assert.equal((await execInSandbox(agentId, "pwd")).stdout, "/project\n");
  const traversal = await execInSandbox(agentId, "cd ../../outside");
  assert.equal(traversal.ok, false);
  assert.equal(traversal.note, "path-policy");
  assert.equal(await getSandboxWorkingDirectory(agentId), "/project");
});

test("host process and founder shell execution are disabled by default", async () => {
  delete process.env.ALLOW_AGENT_PROCESS_EXEC;
  delete process.env.ALLOW_FOUNDER_SHELL;
  delete process.env.ALLOW_AGENT_SUDO;

  const agentExec = await execInSandbox(7, "node --version");
  assert.equal(agentExec.ok, false);
  assert.equal(agentExec.note, "process-exec-disabled");

  const founderExec = await execFounderShell("echo should-not-run");
  assert.equal(founderExec.ok, false);
  assert.equal(founderExec.note, "disabled");

  let rejectedSudoHookCalls = 0;
  const sudoExec = await execAgentSudo({
    agentId: 7,
    command: "echo should-not-run",
    approvalId: 1,
    leaseOwner: "none",
    argsHash: "none",
    beforeEffect: async () => {
      rejectedSudoHookCalls += 1;
    },
  });
  assert.equal(sudoExec.ok, false);
  assert.equal(sudoExec.note, "disabled");
  assert.equal(rejectedSudoHookCalls, 0);
});

test("sudo command policy rejects oversized, control, and bidi input", () => {
  assert.equal(validateAgentSudoCommand("echo safe").ok, true);
  assert.equal(validateAgentSudoCommand("x".repeat(1_001)).ok, false);
  assert.equal(validateAgentSudoCommand("echo a\necho b").ok, false);
  assert.equal(validateAgentSudoCommand("echo \u202esecret").ok, false);
  assert.equal(validateAgentSudoCommand("echo \u0085secret").ok, false);
  assert.equal(validateAgentSudoCommand("echo \u009bsecret").ok, false);
  assert.equal(validateAgentSudoCommand("echo \u200bsecret").ok, false);
  assert.equal(validateAgentSudoCommand("echo \ufeffsecret").ok, false);
});

test("sudo redaction removes known and inline credential material", () => {
  const previous = process.env.TEST_PRIVATE_TOKEN;
  process.env.TEST_PRIVATE_TOKEN = "unit-secret-value";
  try {
    const redacted = redactAgentSudoText(
      "unit-secret-value API_KEY=abc123 Bearer opaque-token ghp_abcdefghijk",
    );
    assert.doesNotMatch(
      redacted,
      /unit-secret-value|abc123|opaque-token|abcdefghijk/,
    );
    assert.match(redacted, /REDACTED/);
  } finally {
    if (previous === undefined) delete process.env.TEST_PRIVATE_TOKEN;
    else process.env.TEST_PRIVATE_TOKEN = previous;
  }
});

test("agent sudo is refused for any remote-capable API binding", () => {
  assert.doesNotThrow(() =>
    assertAgentSudoLocalOnly({
      host: "127.0.0.1",
      agentSudoEnabled: true,
      remoteAccessEnabled: false,
    }),
  );
  assert.throws(() =>
    assertAgentSudoLocalOnly({
      host: "0.0.0.0",
      agentSudoEnabled: true,
      remoteAccessEnabled: false,
    }),
  );
  assert.throws(() =>
    assertAgentSudoLocalOnly({
      host: "127.0.0.1",
      agentSudoEnabled: true,
      remoteAccessEnabled: true,
    }),
  );
});

test(
  "execAgentSudo awaits one hook after live approval preflight and before spawn",
  { timeout: 15_000 },
  async () => {
    await dbReady;
    const previousGate = process.env.ALLOW_AGENT_SUDO;
    const leaseOwner = "sudo-effect-boundary";
    const future = new Date(Date.now() + 5 * 60_000);
    process.env.ALLOW_AGENT_SUDO = "true";

    try {
      const [agent] = await db
        .insert(agentsTable)
        .values({
          name: "Sudo boundary CEO",
          role: "Chief Executive Officer",
          depth: 0,
          parentAgentId: null,
          templateKey: "ceo",
          isRootCeo: true,
          systemPrompt: "Test only",
          permissions: ceoPermissionsPreset,
          status: "working",
          runLeaseOwner: leaseOwner,
          runLeaseExpiresAt: future,
          createdByUser: true,
        })
        .returning();
      const [task] = await db
        .insert(tasksTable)
        .values({
          title: "Sudo boundary task",
          brief: "Exercise the exact sudo spawn boundary.",
          ownerAgentId: agent.id,
          status: "awaiting_approval",
          leaseOwner,
          leaseExpiresAt: future,
          createdByUser: true,
        })
        .returning();
      const command = `node -e "require('node:fs').writeFileSync('sudo-boundary.txt','yes')"`;
      const argsHash = canonicalArgumentHash({ command });
      const target = await getAgentSudoTarget(agent.id);
      const [approval] = await db
        .insert(approvalRequestsTable)
        .values({
          taskId: task.id,
          agentId: agent.id,
          category: "other",
          title: "Sudo boundary approval",
          description: "Exact harmless test command",
          status: "approved",
          resolvedAt: new Date(),
          expiresAt: future,
          scope: {
            toolName: "vm_run_sudo_command",
            argsHash,
            target: target.target,
          },
          actionPayload: {
            toolName: "vm_run_sudo_command",
            args: { command },
          },
        })
        .returning();
      const marker = safeResolve(agent.id, "sudo-boundary.txt").abs;
      let calls = 0;

      const outcome = await execAgentSudo({
        agentId: agent.id,
        command,
        approvalId: approval.id,
        leaseOwner,
        argsHash,
        beforeEffect: async () => {
          calls += 1;
          assert.equal(await fsp.stat(marker).catch(() => null), null);
          await db
            .update(approvalRequestsTable)
            .set({ consumedAt: new Date(), actionPayload: null })
            .where(eq(approvalRequestsTable.id, approval.id));
        },
      });
      assert.equal(outcome.ok, true);
      assert.equal(calls, 1);
      assert.equal(await fsp.readFile(marker, "utf8"), "yes");
      const [consumedApproval] = await db
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, approval.id));
      assert.ok(consumedApproval.consumedAt);
      assert.equal(consumedApproval.actionPayload, null);

      await fsp.rm(marker);
      const [revokedApproval] = await db
        .insert(approvalRequestsTable)
        .values({
          taskId: task.id,
          agentId: agent.id,
          category: "other",
          title: "Revoked sudo boundary approval",
          description: "Live permission revocation after consumption must win.",
          status: "approved",
          resolvedAt: new Date(),
          expiresAt: future,
          scope: {
            toolName: "vm_run_sudo_command",
            argsHash,
            target: target.target,
          },
          actionPayload: {
            toolName: "vm_run_sudo_command",
            args: { command },
          },
        })
        .returning();
      const revokedOutcome = await execAgentSudo({
        agentId: agent.id,
        command,
        approvalId: revokedApproval.id,
        leaseOwner,
        argsHash,
        beforeEffect: async () => {
          await db
            .update(approvalRequestsTable)
            .set({ consumedAt: new Date(), actionPayload: null })
            .where(eq(approvalRequestsTable.id, revokedApproval.id));
          await db
            .update(agentsTable)
            .set({
              permissions: { ...ceoPermissionsPreset, canUseSudo: false },
            })
            .where(eq(agentsTable.id, agent.id));
        },
      });
      assert.equal(revokedOutcome.ok, false);
      assert.equal(revokedOutcome.note, "permission-denied");
      assert.equal(await fsp.stat(marker).catch(() => null), null);
      await db
        .update(agentsTable)
        .set({ permissions: ceoPermissionsPreset })
        .where(eq(agentsTable.id, agent.id));

      const [rejectedApproval] = await db
        .insert(approvalRequestsTable)
        .values({
          taskId: task.id,
          agentId: agent.id,
          category: "other",
          title: "Rejected sudo boundary approval",
          description: "A rejected effect gate must leave this unconsumed.",
          status: "approved",
          resolvedAt: new Date(),
          expiresAt: future,
          scope: {
            toolName: "vm_run_sudo_command",
            argsHash,
            target: target.target,
          },
          actionPayload: {
            toolName: "vm_run_sudo_command",
            args: { command },
          },
        })
        .returning();
      let rejectedCalls = 0;
      await assert.rejects(
        () =>
          execAgentSudo({
            agentId: agent.id,
            command,
            approvalId: rejectedApproval.id,
            leaseOwner,
            argsHash,
            beforeEffect: async () => {
              rejectedCalls += 1;
              throw new Error("sudo gate rejected");
            },
          }),
        /sudo gate rejected/,
      );
      assert.equal(rejectedCalls, 1);
      assert.equal(await fsp.stat(marker).catch(() => null), null);
      const [stillUnconsumed] = await db
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, rejectedApproval.id));
      assert.equal(stillUnconsumed.consumedAt, null);
      assert.ok(stillUnconsumed.actionPayload);
    } finally {
      stopAllAgentProcesses();
      deactivateLocalEmergencyStop();
      if (previousGate === undefined) delete process.env.ALLOW_AGENT_SUDO;
      else process.env.ALLOW_AGENT_SUDO = previousGate;
    }
  },
);

test(
  "emergency stop terminates an agent process and its descendant tree",
  { timeout: 25_000 },
  async () => {
    const previous = process.env.ALLOW_AGENT_PROCESS_EXEC;
    const agentId = 33;
    process.env.ALLOW_AGENT_PROCESS_EXEC = "true";
    try {
      await writeTextFile(
        agentId,
        "tree-parent.cjs",
        [
          'const { spawn } = require("node:child_process");',
          'const fs = require("node:fs");',
          'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
          'fs.writeFileSync("child.pid", String(child.pid));',
          "setInterval(() => {}, 1000);",
        ].join("\n"),
      );

      let launchOutcome: Awaited<ReturnType<typeof execInSandbox>> | null =
        null;
      let launchFailure: string | null = null;
      const running = execInSandbox(agentId, "node tree-parent.cjs", 60_000);
      void running.then(
        (outcome) => {
          launchOutcome = outcome;
        },
        (error) => {
          launchFailure =
            error instanceof Error ? error.message : String(error);
        },
      );
      let descendantPid: number | null = null;
      let lastPidError = "";
      // Process startup is not the behavior under test. Wait for the evidence
      // file, but report an early process exit immediately and bound the wait
      // when the full suite is competing for Windows process startup time.
      const pidDeadline = Date.now() + 12_000;
      while (Date.now() < pidDeadline) {
        try {
          descendantPid = Number(
            (await readTextFile(agentId, "child.pid")).content.trim(),
          );
          if (Number.isInteger(descendantPid) && descendantPid > 0) break;
        } catch (error) {
          lastPidError = error instanceof Error ? error.message : String(error);
        }
        if (launchOutcome || launchFailure) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const sandboxFiles = descendantPid
        ? []
        : await fsp.readdir(safeResolve(agentId, "").abs).catch(() => []);
      assert.ok(
        descendantPid && descendantPid > 0,
        `descendant pid was recorded; ${JSON.stringify({ launchOutcome, launchFailure, lastPidError, sandboxFiles })}`,
      );

      const terminated = stopAllAgentProcesses();
      assert.ok(terminated >= 1);
      await running;

      const exitDeadline = Date.now() + 5_000;
      let descendantAlive = true;
      while (Date.now() < exitDeadline) {
        try {
          process.kill(descendantPid, 0);
        } catch {
          descendantAlive = false;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(
        descendantAlive,
        false,
        "descendant survived emergency stop",
      );
    } finally {
      stopAllAgentProcesses();
      deactivateLocalEmergencyStop();
      if (previous === undefined) delete process.env.ALLOW_AGENT_PROCESS_EXEC;
      else process.env.ALLOW_AGENT_PROCESS_EXEC = previous;
    }
  },
);

test(
  "a command queued before emergency stop cannot spawn after cleanup",
  { timeout: 15_000 },
  async () => {
    const previous = process.env.ALLOW_AGENT_PROCESS_EXEC;
    const agentId = 34;
    process.env.ALLOW_AGENT_PROCESS_EXEC = "true";
    deactivateLocalEmergencyStop();
    try {
      await writeTextFile(
        agentId,
        "queue-blocker.cjs",
        [
          'require("node:fs").writeFileSync("queue-started", "yes");',
          "setInterval(() => {}, 1000);",
        ].join("\n"),
      );
      await writeTextFile(
        agentId,
        "late-effect.cjs",
        'require("node:fs").writeFileSync("late-marker", "must-not-exist");',
      );
      const running = execInSandbox(agentId, "node queue-blocker.cjs", 60_000);
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        try {
          if ((await readTextFile(agentId, "queue-started")).content === "yes")
            break;
        } catch {
          // The blocker has not reached its first statement yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const queued = execInSandbox(agentId, "node late-effect.cjs", 60_000);
      stopAllAgentProcesses();
      await Promise.all([running, queued]);
      await assert.rejects(() => readTextFile(agentId, "late-marker"));
    } finally {
      stopAllAgentProcesses();
      deactivateLocalEmergencyStop();
      if (previous === undefined) delete process.env.ALLOW_AGENT_PROCESS_EXEC;
      else process.env.ALLOW_AGENT_PROCESS_EXEC = previous;
    }
  },
);

test("pre-existing symbolic-link escapes are rejected", async (t) => {
  const root = path.join(sandboxBase, "agent-7");
  const outside = await fsp.mkdtemp(
    path.join(os.tmpdir(), "agentic-os-outside-"),
  );
  await fsp.writeFile(path.join(outside, "secret.txt"), "outside");
  const link = path.join(root, "escape");

  try {
    await fsp.symlink(
      outside,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("This Windows account cannot create a test junction");
      return;
    }
    throw error;
  }

  await assert.rejects(
    () => readTextFile(7, "escape/secret.txt"),
    /Sembolik bag/,
  );
  await fsp.rm(outside, { recursive: true, force: true });
});

test("binary screenshot writer rejects a symlinked evidence directory", async (t) => {
  const agentId = 32;
  const root = path.join(sandboxBase, `agent-${agentId}`);
  const outside = await fsp.mkdtemp(
    path.join(os.tmpdir(), "agentic-os-screenshot-outside-"),
  );
  await fsp.mkdir(root, { recursive: true });
  const link = path.join(root, "ekran-goruntuleri");
  try {
    await fsp.symlink(
      outside,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    await fsp.rm(outside, { recursive: true, force: true });
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("This Windows account cannot create a test junction");
      return;
    }
    throw error;
  }

  await assert.rejects(
    () =>
      writeBinaryFile(
        agentId,
        "ekran-goruntuleri/proof.png",
        Buffer.from("png"),
      ),
    /Sembolik bag/,
  );
  await fsp.rm(outside, { recursive: true, force: true });
});

test("sudo target rejects a symlinked agent root", async (t) => {
  const root = path.join(sandboxBase, "agent-12");
  const outside = await fsp.mkdtemp(
    path.join(os.tmpdir(), "agentic-os-sudo-root-outside-"),
  );
  await fsp.rm(root, { recursive: true, force: true });
  try {
    await fsp.symlink(
      outside,
      root,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    await fsp.rm(outside, { recursive: true, force: true });
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("This Windows account cannot create a test junction");
      return;
    }
    throw error;
  }

  await assert.rejects(() => getAgentSudoTarget(12), /sembolik bag/);
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(outside, { recursive: true, force: true });
});
