import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  writeFile,
  readFile,
  readlink,
  readdir,
} from "node:fs/promises";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  prepareLinuxOwnedNamespace,
  launchLinuxOwnedNamespace,
} from "./linux-owned-namespace";
import {
  ownedAgentRuntimeCount,
  stopOwnedAgentRuntimes,
} from "../orchestrator/owned-agent-runtimes";
import {
  activateLocalEmergencyStop,
  deactivateLocalEmergencyStop,
} from "../orchestrator/local-emergency-epoch";

const enabled = process.env.ACOS_LINUX_NAMESPACE_TESTS === "1";
if (enabled && process.platform !== "linux")
  throw new Error("Linux launcher proof requires Linux");
const options = { skip: !enabled, timeout: 30_000 };
const program = String.raw`
const {spawn}=await import('node:child_process');
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
child.unref();
process.stdout.write('fixture-ready\n');
process.stdin.on('data', data=>process.stdout.write(data));
setInterval(()=>{},1000);
`;
async function until(check: () => boolean | Promise<boolean>) {
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("Linux fixture deadline");
}
async function fixture() {
  const temp = await realpath(tmpdir());
  const root = await realpath(
    await mkdtemp(path.join(temp, "acos-linux-launcher-")),
  );
  const home = path.join(root, "home"),
    workspace = path.join(root, "workspace");
  await mkdir(home, { mode: 0o700 });
  await mkdir(workspace, { mode: 0o700 });
  const helper = await prepareLinuxOwnedNamespace(path.join(home, "helper"));
  return {
    root,
    home,
    workspace,
    helper,
    input: {
      helper,
      executable: process.execPath,
      args: ["--input-type=module", "-e", program],
      cwd: home,
      workspace,
      controlDirectory: path.join(home, "control"),
      environment: {
        PATH: "/usr/bin:/bin",
        HOME: home,
        ACOS_CODEX_ACCESS_TOKEN: "fixture-only-private-access",
      },
      assertOwned: async () => {},
    },
    async cleanup() {
      assert.equal(ownedAgentRuntimeCount(), 0);
      const actual = await realpath(root);
      assert.equal(path.dirname(actual), temp);
      assert.ok(path.basename(actual).startsWith("acos-linux-launcher-"));
      await rm(actual, { recursive: true, force: true });
    },
  };
}

test(
  "Linux launcher preserves protocol pipes and stops detached descendants with actual cleanup",
  options,
  async () => {
    const f = await fixture();
    let running:
      Awaited<ReturnType<typeof launchLinuxOwnedNamespace>> | undefined;
    try {
      running = await launchLinuxOwnedNamespace(f.input);
      let stdout = "",
        stderr = "";
      running.child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      running.child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      await until(() => stdout.includes("fixture-ready\n"));
      running.child.stdin.write("protocol-challenge\n");
      await until(() => stdout.includes("protocol-challenge\n")).catch(() => {
        assert.fail(
          JSON.stringify({
            phase: "protocol-echo",
            stdinEnded: stdout.includes("stdin-ended"),
            stdinError: stdout.includes("stdin-error"),
            stdoutBytes: stdout.length,
            stderrBytes: stderr.length,
            stdout: stdout
              .replaceAll("fixture-only-private-access", "REDACTED")
              .slice(0, 300),
            stderr: stderr
              .replaceAll("fixture-only-private-access", "REDACTED")
              .slice(0, 1400),
          }),
        );
      });
      assert.equal(ownedAgentRuntimeCount(), 1);
      await running.stop();
      assert.equal(ownedAgentRuntimeCount(), 0);
      assert.equal(stdout.includes("fixture-only-private-access"), false);
      assert.equal(stderr.includes("fixture-only-private-access"), false);
      const proof = JSON.parse(
        await readFile(
          path.join(f.input.controlDirectory, "stopped.json"),
          "utf8",
        ),
      );
      assert.equal(proof.activeProcesses, 0);
      assert.equal(proof.namespaceDestroyed, true);
    } finally {
      await running?.stop();
      await f.cleanup();
    }
  },
);

test(
  "Linux launcher rejects a changed protected guardian before any native launch",
  options,
  async () => {
    const f = await fixture();
    try {
      await writeFile(f.helper.script, "fixture-tampered-guardian", {
        mode: 0o600,
      });
      await assert.rejects(launchLinuxOwnedNamespace(f.input), {
        message: "owned_linux_runtime_unsupported",
      });
      assert.equal(ownedAgentRuntimeCount(), 0);
    } finally {
      await f.cleanup();
    }
  },
);

test(
  "Linux launcher rechecks live authority after startup and awaits cleanup on loss",
  options,
  async () => {
    const f = await fixture();
    let checks = 0;
    try {
      await assert.rejects(
        launchLinuxOwnedNamespace({
          ...f.input,
          assertOwned: async () => {
            if (++checks > 1) throw new Error("fixture-authority-lost");
          },
        }),
        { message: "fixture-authority-lost" },
      );
      assert.ok(checks >= 2);
      assert.equal(ownedAgentRuntimeCount(), 0);
      const proof = JSON.parse(
        await readFile(
          path.join(f.input.controlDirectory, "stopped.json"),
          "utf8",
        ),
      );
      assert.equal(proof.namespaceDestroyed, true);
    } finally {
      await f.cleanup();
    }
  },
);

test(
  "Linux launcher closes emergency epoch gap before spawn",
  options,
  async () => {
    const f = await fixture();
    try {
      await assert.rejects(
        launchLinuxOwnedNamespace({
          ...f.input,
          assertOwned: async () => {
            activateLocalEmergencyStop();
          },
        }),
        { name: "LocalEmergencyStopError" },
      );
      assert.equal(ownedAgentRuntimeCount(), 0);
    } finally {
      deactivateLocalEmergencyStop();
      await f.cleanup();
    }
  },
);

test(
  "Linux launcher participates in the existing emergency runtime registry",
  options,
  async () => {
    const f = await fixture();
    let running:
      Awaited<ReturnType<typeof launchLinuxOwnedNamespace>> | undefined;
    try {
      running = await launchLinuxOwnedNamespace(f.input);
      activateLocalEmergencyStop();
      assert.equal(stopOwnedAgentRuntimes(), 1);
      await until(() => ownedAgentRuntimeCount() === 0);
      await running.stop();
      const proof = JSON.parse(
        await readFile(
          path.join(f.input.controlDirectory, "stopped.json"),
          "utf8",
        ),
      );
      assert.equal(proof.namespaceDestroyed, true);
    } finally {
      await running?.stop();
      deactivateLocalEmergencyStop();
      await f.cleanup();
    }
  },
);

test(
  "Linux launcher can give an offline verifier a separate network namespace",
  options,
  async () => {
    const f = await fixture();
    let running:
      Awaited<ReturnType<typeof launchLinuxOwnedNamespace>> | undefined;
    try {
      const input = {
        ...f.input,
        isolateNetwork: true,
        args: [
          "--input-type=module",
          "-e",
          "const fs=await import('node:fs');process.stdout.write(fs.readlinkSync('/proc/self/ns/net')+'\\n');setInterval(()=>{},1000)",
        ],
      };
      running = await launchLinuxOwnedNamespace(input);
      let output = "";
      running.child.stdout.on("data", (data) => {
        output += data;
      });
      await until(() => output.includes("\n"));
      assert.match(output.trim(), /^net:\[\d+\]$/u);
      assert.notEqual(output.trim(), await readlink("/proc/self/ns/net"));
    } finally {
      await running?.stop();
      await f.cleanup();
    }
  },
);

test(
  "Linux launcher supplies private writable temporary space without exposing host temporary files",
  options,
  async () => {
    const f = await fixture();
    const hostMarker = path.join(f.root, "host-only-marker");
    const privateMarker = path.join(
      await realpath(tmpdir()),
      "acos-private-tmp-" + randomUUID(),
    );
    await writeFile(hostMarker, "host-only", { mode: 0o600 });
    let running:
      Awaited<ReturnType<typeof launchLinuxOwnedNamespace>> | undefined;
    try {
      const program = `const fs=await import('node:fs');let visible=false,writable=false;try{fs.readFileSync(${JSON.stringify(hostMarker)});visible=true;}catch{}try{fs.writeFileSync(${JSON.stringify(privateMarker)},'private');writable=true;}catch{}process.stdout.write(JSON.stringify({visible,writable})+'\\n');setInterval(()=>{},1000);`;
      running = await launchLinuxOwnedNamespace({
        ...f.input,
        args: ["--input-type=module", "-e", program],
      });
      let output = "";
      running.child.stdout.on("data", (data) => {
        output += data;
      });
      await until(() => output.includes("\n"));
      assert.deepEqual(JSON.parse(output), { visible: false, writable: true });
      await assert.rejects(readFile(privateMarker), { code: "ENOENT" });
    } finally {
      await running?.stop();
      // This exact random marker is test-owned even if a faulty launcher leaks it.
      await rm(privateMarker, { force: true });
      await f.cleanup();
    }
  },
);

test(
  "Linux launcher owner SIGKILL destroys its actual namespace and detached descendants",
  options,
  async () => {
    const f = await fixture();
    const workerPath =
      process.env.ACOS_LINUX_LAUNCHER_WORKER ??
      fileURLToPath(
        new URL("./testing/linux-launcher-owner.ts", import.meta.url),
      );
    const worker = fork(workerPath, [], {
      env: {
        PATH: "/usr/bin:/bin",
        HOME: f.home,
        ACOS_LINUX_LAUNCHER_FIXTURE_ROOT: f.root,
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let namespace = "",
      initPid = 0;
    try {
      const message = await Promise.race([
        once(worker, "message"),
        once(worker, "exit").then(() => {
          throw new Error("fixture_owner_exited_early");
        }),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("fixture_owner_deadline")),
            10_000,
          );
          timer.unref();
        }),
      ]);
      const info = message[0] as { initPid: number; monitorPid: number };
      assert.ok(Number.isSafeInteger(info.initPid) && info.initPid > 1);
      assert.ok(Number.isSafeInteger(info.monitorPid) && info.monitorPid > 1);
      initPid = info.initPid;
      namespace = await readlink(`/proc/${initPid}/ns/pid`);
      assert.notEqual(namespace, await readlink("/proc/self/ns/pid"));
      const members = async () => {
        const matches: number[] = [];
        for (const entry of await readdir("/proc"))
          if (/^\d+$/u.test(entry)) {
            try {
              if ((await readlink(`/proc/${entry}/ns/pid`)) === namespace)
                matches.push(Number(entry));
            } catch {}
          }
        return matches;
      };
      assert.ok((await members()).length >= 3);
      const exited = once(worker, "exit");
      worker.kill("SIGKILL");
      await exited;
      await until(async () => (await members()).length === 0);
      await until(async () => {
        try {
          await readFile(`/proc/${info.monitorPid}/stat`);
          return false;
        } catch (error) {
          return (error as NodeJS.ErrnoException).code === "ENOENT";
        }
      });
    } finally {
      if (worker.exitCode === null && worker.signalCode === null) {
        const exited = once(worker, "exit");
        worker.kill("SIGKILL");
        await exited;
      }
      // A failed assertion still cleans only the captured, verified private PID1.
      try {
        if (
          namespace &&
          (await readlink(`/proc/${initPid}/ns/pid`)) === namespace
        )
          process.kill(initPid, "SIGKILL");
      } catch {}
      await f.cleanup();
    }
  },
);
