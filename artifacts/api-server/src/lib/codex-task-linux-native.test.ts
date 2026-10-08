import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import {
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createCodexTaskProcessPorts } from "./codex-task-process";
import { runCodexTask, CodexTaskError } from "./codex-task-adapter";
import { codexTaskConfigurationMatches } from "./codex-task-configuration";
import type { CodexTaskAuthority } from "./codex-task-authority";
import { ownedAgentRuntimeCount } from "./orchestrator/owned-agent-runtimes";
import {
  prepareLinuxOwnedNamespace,
  launchLinuxOwnedNamespace,
} from "./vm/linux-owned-namespace";
import { codexOfflineRpc } from "./vm/testing/codex-offline-rpc";

const enabled = process.env.ACOS_LINUX_CODEX_TESTS === "1";
const executable = process.env.ACOS_LINUX_CODEX_EXECUTABLE;
if (
  enabled &&
  (process.platform !== "linux" || !executable || !path.isAbsolute(executable))
)
  throw new Error("native_Linux_Codex_fixture_required");
function record(value: unknown): asserts value is Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
}
const cases = [
  { mode: "approval", writable: false },
  { mode: "full_access", writable: true },
  { mode: "custom", custom: { files: false, terminal: true }, writable: false },
  { mode: "custom", custom: { files: true, terminal: true }, writable: true },
] as const;
for (const policy of cases)
  test(
    `actual Linux Codex ${policy.mode} files=${policy.writable} enforces the owned named permission boundary without inference`,
    { skip: !enabled, timeout: 45_000 },
    async () => {
      const parent = await realpath(tmpdir());
      const root = await realpath(
        await mkdtemp(path.join(parent, "acos-native-codex-proof-")),
      );
      const workspace = path.join(root, "workspace"),
        storageDirectory = path.join(root, "private");
      await mkdir(workspace, { mode: 0o700 });
      await writeFile(
        path.join(workspace, "read-marker"),
        "workspace-readable",
      );
      const outside = path.join(root, "outside-sentinel");
      await writeFile(outside, "outside-private", { mode: 0o600 });
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
        model: "fixture-offline-model",
        readBinding: async () => binding,
        readLaunchContext: async () => ({
          policy: {
            id: 1,
            revision: 1,
            mode: policy.mode,
            custom:
              "custom" in policy
                ? {
                    ...policy.custom,
                    browser: false,
                    delegation: false,
                    sudo: false,
                  }
                : null,
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
      // Use the production factory and Linux controller with an EXTRA server-level
      // network restriction for this offline test. Default normal-model launcher
      // wiring is separately tested; this seam cannot grant filesystem access.
      let namespaceInitPid = 0;
      const ports = createCodexTaskProcessPorts(
        {
          authority,
          workspace,
          storageDirectory,
          executable: executable!,
          processExecEnabled: true,
        },
        {
          systemConfigDirectories: async () => ["/etc/codex"],
          version: async (file, cwd, environment) =>
            (
              await promisify(execFile)(file, ["--version"], {
                cwd,
                env: environment,
                timeout: 5000,
                maxBuffer: 8192,
              })
            ).stdout,
          prepare: (home) =>
            prepareLinuxOwnedNamespace(
              path.join(home, "owned-namespace-helper"),
            ),
          launch: async (input) => {
            const running = await launchLinuxOwnedNamespace({
              ...input,
              args: ["app-server"],
              helper: input.handle as Awaited<
                ReturnType<typeof prepareLinuxOwnedNamespace>
              >,
              isolateNetwork: true,
              environment: { ...input.environment, RUST_LOG: "codex_core=debug,codex_app_server=warn" },
            });

            namespaceInitPid = running.namespaceInitPid;
            return running;
          },
        },
      );
      let running: Awaited<ReturnType<typeof ports.launch>> | undefined;
      let rpc: ReturnType<typeof codexOfflineRpc> | undefined;
      try {
        const prepared = await ports.prepare(binding);
        assert.ok(prepared.permissions);
        const home = path.dirname(prepared.permissions.configuration.file);
        const sentinel = path.join(home, "private-sentinel");
        await writeFile(sentinel, "fixture-private-sentinel", { mode: 0o600 });
        await symlink(home, path.join(workspace, "private-link"));
        // Positive controls: the owned backend can read both denied files and use
        // AF_INET sockets. A different namespace alone does not forbid sockets.
        assert.equal(
          await readFile(sentinel, "utf8"),
          "fixture-private-sentinel",
        );
        assert.equal(await readFile(outside, "utf8"), "outside-private");
        const controlSocket = createServer();
        controlSocket.listen(0, "127.0.0.1");
        await once(controlSocket, "listening");
        await new Promise<void>((resolve, reject) =>
          controlSocket.close((error) => (error ? reject(error) : resolve())),
        );
        running = await ports.launch(prepared, binding);
        assert.ok(namespaceInitPid > 1);
        assert.notEqual(
          await readlink(`/proc/${namespaceInitPid}/ns/net`),
          await readlink("/proc/self/ns/net"),
        );
        rpc = codexOfflineRpc(running.child, workspace);
        await rpc.request("initialize", {
          clientInfo: {
            name: "acos_offline_permission_probe",
            version: "0.3.13",
          },
          capabilities: { experimentalApi: true },
        });
        rpc.initialized();
        const effective = await rpc.request("config/read", {
          cwd: workspace,
          includeLayers: true,
        });
        assert.equal(
          codexTaskConfigurationMatches(
            effective,
            prepared.permissions.configuration,
          ),
          true,
        );
        const profiles = await rpc.request("permissionProfile/list", {
          cwd: workspace,
        });
        record(profiles);
        assert.ok(Array.isArray(profiles.data));
        assert.ok(
          profiles.data.some((item) => {
            record(item);
            return item.id === "acos_task" && item.allowed === true;
          }),
        );
        const thread = await rpc.request("thread/start", {
          model: prepared.model,
          modelProvider: "openai_chatgpt_plan",
          cwd: workspace,
          approvalPolicy: prepared.approvalPolicy,
          approvalsReviewer: "user",
          permissions: "acos_task",
          runtimeWorkspaceRoots: [workspace],
          config: {},
          ephemeral: true,
          allowProviderModelFallback: false,
        });
        record(thread);
        record(thread.activePermissionProfile);
        assert.equal(thread.activePermissionProfile.id, "acos_task");
        assert.equal(thread.model, prepared.model);
        const program = `import errno,json,os,socket
r={'read':open('read-marker').read(),'tokenPresent':'ACOS_CODEX_ACCESS_TOKEN' in os.environ}
def readable(file):
 try:
  open(file,'rb').read();return True
 except OSError:return False
r['privateReadable']=readable(${JSON.stringify(sentinel)})
r['outsideReadable']=readable(${JSON.stringify(outside)})
r['symlinkReadable']=readable('private-link/private-sentinel')
try:
 open('write-marker','w').write('written');r['writable']=True
except OSError:r['writable']=False
try:
 fd=os.open(${JSON.stringify(executable)},os.O_WRONLY);os.close(fd);r['executableWritable']=True
except OSError:r['executableWritable']=False
try:
 s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.close();r['socketPermissionDenied']=False
except OSError as e:r['socketPermissionDenied']=e.errno in (errno.EPERM,errno.EACCES)
r['procTokenReadable']=False
r['procPrivateReadable']=False
for p in os.listdir('/proc'):
 if not p.isdigit():continue
 try:
  if b'fixture-only-private-access' in open('/proc/'+p+'/environ','rb').read():r['procTokenReadable']=True
 except OSError:pass
 try:
  if open('/proc/'+p+'/root'+${JSON.stringify(sentinel)}).read()=='fixture-private-sentinel':r['procPrivateReadable']=True
 except OSError:pass
print(json.dumps(r))
`;
        const response = await rpc.request("command/exec", {
          command: ["/usr/bin/python3", "-I", "-S", "-c", program],
          cwd: workspace,
          permissionProfile: "acos_task",
          timeoutMs: 5000,
          outputBytesCap: 4096,
        });
        record(response);
        assert.equal(response.exitCode, 0);
        assert.equal(typeof response.stdout, "string");
        const observed = JSON.parse(response.stdout as string);
        assert.deepEqual(observed, {
          read: "workspace-readable",
          tokenPresent: false,
          privateReadable: false,
          outsideReadable: false,
          symlinkReadable: false,
          writable: policy.writable,
          executableWritable: false,
          socketPermissionDenied: true,
          procTokenReadable: false,
          procPrivateReadable: false,
        });
        assert.deepEqual(rpc.methods, [
          "initialize",
          "config/read",
          "permissionProfile/list",
          "thread/start",
          "command/exec",
        ]);
        const controls = await readFile(path.join(home, "config.toml"), "utf8");
        assert.doesNotMatch(controls, /fixture-only-private-access/);
        if (policy.writable)
          assert.equal(
            await readFile(path.join(workspace, "write-marker"), "utf8"),
            "written",
          );
        else
          await assert.rejects(readFile(path.join(workspace, "write-marker")), {
            code: "ENOENT",
          });
        console.log(
          JSON.stringify({
            kind: "native-linux-permission-case",
            mode: policy.mode,
            ...observed,
            inferenceRequested: false,
          }),
        );
      } finally {
        rpc?.dispose();
        await running?.stop();
        assert.equal(ownedAgentRuntimeCount(), 0);
        assert.equal(path.dirname(await realpath(root)), parent);
        assert.ok(path.basename(root).startsWith("acos-native-codex-proof-"));
        await rm(root, { recursive: true, force: true });
      }
    },
  );

test(
  "actual Linux Codex production driver awaits final admission and cleans up without requesting inference",
  { skip: !enabled, timeout: 45_000 },
  async () => {
    const parent = await realpath(tmpdir());
    const root = await realpath(
      await mkdtemp(path.join(parent, "acos-native-codex-admission-")),
    );
    const workspace = path.join(root, "workspace"),
      storageDirectory = path.join(root, "private");
    await mkdir(workspace, { mode: 0o700 });
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
      model: "fixture-offline-model",
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
    const ports = createCodexTaskProcessPorts(
      {
        authority,
        workspace,
        storageDirectory,
        executable: executable!,
        processExecEnabled: true,
      },
      {
        systemConfigDirectories: async () => ["/etc/codex"],
        version: async (file, cwd, environment) =>
          (
            await promisify(execFile)(file, ["--version"], {
              cwd,
              env: environment,
              timeout: 5000,
              maxBuffer: 8192,
            })
          ).stdout,
        prepare: (home) =>
          prepareLinuxOwnedNamespace(path.join(home, "owned-namespace-helper")),
        launch: (input) =>
          launchLinuxOwnedNamespace({
            ...input,
            args: ["app-server"],
            helper: input.handle as Awaited<
              ReturnType<typeof prepareLinuxOwnedNamespace>
            >,
            isolateNetwork: true,
          }),
      },
    );
    const methods: string[] = [];
    let admissions = 0;
    try {
      await assert.rejects(
        runCodexTask(
          {
            binding,
            prompt: "This fixture prompt must never reach inference.",
            requestTimeoutMs: 15_000,
            turnTimeoutMs: 30_000,
          },
          {
            ...ports,
            launch: async (prepared, selected) => {
              const running = await ports.launch(prepared, selected);
              const stream = running.child.stdin,
                write = stream.write.bind(stream);
              stream.write = ((...args: Parameters<typeof stream.write>) => {
                const message = JSON.parse(String(args[0]));
                if (message.method) {
                  assert.notEqual(
                    message.method,
                    "turn/start",
                    "Offline test must refuse the physical inference write",
                  );
                  methods.push(message.method);
                }
                return write(...args);
              }) as typeof stream.write;
              return running;
            },
            beforeTurnStart: async (selected) => {
              assert.deepEqual(selected, binding);
              admissions++;
              await new Promise((resolve) => setTimeout(resolve, 25));
              throw new CodexTaskError("cancelled");
            },
          },
        ),
        { kind: "cancelled", requestStarted: false, cleanupState: "verified" },
      );
      assert.equal(admissions, 1);
      assert.deepEqual(methods, [
        "initialize",
        "initialized",
        "config/read",
        "permissionProfile/list",
        "thread/start",
      ]);
      assert.equal(ownedAgentRuntimeCount(), 0);
    } finally {
      assert.equal(ownedAgentRuntimeCount(), 0);
      assert.equal(path.dirname(await realpath(root)), parent);
      assert.ok(path.basename(root).startsWith("acos-native-codex-admission-"));
      await rm(root, { recursive: true, force: true });
    }
  },
);
