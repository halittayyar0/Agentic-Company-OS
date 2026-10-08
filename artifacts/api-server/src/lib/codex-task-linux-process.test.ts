import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexTaskProcessPorts } from "./codex-task-process";
import type { CodexTaskAuthority } from "./codex-task-authority";
import { ownedAgentRuntimeCount } from "./orchestrator/owned-agent-runtimes";

const enabled = process.env.ACOS_LINUX_NAMESPACE_TESTS === "1";
if (enabled && process.platform !== "linux")
  throw new Error("Linux factory proof requires Linux");
test(
  "default Linux process factory launches the owned controller with a private home and backend workspace",
  { skip: !enabled, timeout: 30_000 },
  async () => {
    const temp = await realpath(tmpdir());
    const root = await realpath(
      await mkdtemp(path.join(temp, "acos-linux-factory-")),
    );
    const workspace = path.join(root, "workspace"),
      storageDirectory = path.join(root, "private"),
      executable = path.join(root, "fixture-cli");
    await mkdir(workspace, { mode: 0o700 });
    // Explicit protocol fixture, not a real Codex executable or inference proof.
    await writeFile(
      executable,
      `#!/usr/bin/python3
import os, sys
if sys.argv[1:] == ['--version']:
    assert 'ACOS_CODEX_ACCESS_TOKEN' not in os.environ
    print('codex-cli 0.159.2')
elif sys.argv[1:] == ['app-server']:
    assert os.environ['ACOS_CODEX_ACCESS_TOKEN'] == 'fixture-only-private-access'
    assert os.environ['CODEX_HOME'] == os.getcwd()
    print('factory-ready', flush=True)
    for line in sys.stdin:
        print(line.strip(), flush=True)
else:
    sys.exit(80)
`,
      { mode: 0o700 },
    );
    const binding = {
      taskId: 7,
      attemptId: randomUUID(),
      leaseOwner: randomUUID(),
      policyRevision: 1,
      registrationId: randomUUID(),
      registrationRevision: 1,
      accountId: "fixture-account",
      admissionVersion: 0,
    };
    const authority: CodexTaskAuthority = {
      binding,
      model: "fixture-model",
      readBinding: async () => binding,
      readLaunchContext: async () => ({
        policy: {
          id: 1,
          revision: 1,
          mode: "approval",
          custom: null,
          updatedAt: new Date(),
        },
        registration: {
          id: binding.registrationId,
          revision: 1,
          updatedAt: 1,
          hostId: "fixture-host",
          accountId: binding.accountId,
          clientId: "fixture-client",
          subject: "fixture-subject",
          credentials: {
            accessToken: "fixture-only-private-access",
            idToken: "fixture-only-private-id",
            grants: ["resource.invoke", "chatgpt.tokens.use.direct"],
            expiresAt: Date.now() + 3600000,
          },
        },
      }),
    };
    let running:
      | Awaited<
          ReturnType<ReturnType<typeof createCodexTaskProcessPorts>["launch"]>
        >
      | undefined;
    try {
      const ports = createCodexTaskProcessPorts({
        authority,
        workspace,
        storageDirectory,
        executable,
        processExecEnabled: true,
      });
      const prepared = await ports.prepare(binding);
      assert.equal(prepared.cwd, workspace);
      running = await ports.launch(prepared, binding);
      let stdout = "";
      running.child.stdout.on("data", (data) => {
        stdout += data;
      });
      const deadline = Date.now() + 5000;
      while (!stdout.includes("factory-ready")) {
        assert.ok(Date.now() < deadline);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      running.child.stdin.write("factory-challenge\n");
      while (!stdout.includes("factory-challenge")) {
        assert.ok(Date.now() < deadline);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(ownedAgentRuntimeCount(), 1);
      await running.stop();
      assert.equal(ownedAgentRuntimeCount(), 0);
      assert.doesNotMatch(stdout, /fixture-only-private/);
      await assert.rejects(ports.launch(prepared, binding));
    } finally {
      await running?.stop();
      assert.equal(ownedAgentRuntimeCount(), 0);
      assert.equal(path.dirname(await realpath(root)), temp);
      assert.ok(path.basename(root).startsWith("acos-linux-factory-"));
      await rm(root, { recursive: true, force: true });
    }
  },
);
