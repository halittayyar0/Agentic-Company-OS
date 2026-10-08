import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createCodexTaskProcessPorts } from "./codex-task-process";
import type { CodexTaskAuthority } from "./codex-task-authority";
import { codexTaskConfigurationMatches } from "./codex-task-configuration";

async function fixture(taskId = 7) {
  const root = await realpath(
    await mkdtemp(
      path.join(await realpath(tmpdir()), "acos-codex-process-fixture-"),
    ),
  );
  const workspace = path.join(root, "workspace"),
    storageDirectory = path.join(root, "private-runtime"),
    executable = path.join(root, "fixture-program.exe"),
    systemDirectory = path.join(root, "system-codex");
  await mkdir(workspace);
  await writeFile(executable, "fixture-only-program-bytes-not-executed");
  const binding = Object.freeze({
    taskId,
    attemptId: randomUUID(),
    leaseOwner: randomUUID(),
    policyRevision: 1,
    registrationId: randomUUID(),
    registrationRevision: 1,
    accountId: "fixture-account",
    admissionVersion: 0,
  });
  let current = true,
    preparations = 0,
    versions = 0,
    launches = 0,
    stops = 0;
  let versionEnvironment: NodeJS.ProcessEnv | undefined,
    launched:
      | {
          cwd: string;
          environment: NodeJS.ProcessEnv;
          controlDirectory: string;
        }
      | undefined;
  const authority: CodexTaskAuthority = {
    binding,
    model: "fixture-model",
    readBinding: async () => (current ? binding : null),
    readLaunchContext: async () => {
      if (!current) throw new Error("fixture-private-lost-context");
      return {
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
          accountId: "fixture-account",
          clientId: "fixture-client",
          subject: "fixture-subject",
          credentials: {
            accessToken: "fixture-only-private-access",
            idToken: "fixture-only-private-id",
            grants: ["resource.invoke", "chatgpt.tokens.use.direct"],
            expiresAt: Date.now() + 3600000,
          },
        },
      };
    },
  };
  const input = {
    authority,
    workspace,
    storageDirectory,
    executable,
    processExecEnabled: true,
  };
  const native = {
    systemConfigDirectories: async () => [systemDirectory],
    version: async (
      _executable: string,
      _cwd: string,
      environment: NodeJS.ProcessEnv,
    ) => {
      versions++;
      versionEnvironment = environment;
      return "codex-cli 0.159.2";
    },
    prepare: async (home: string) => {
      preparations++;
      return { home };
    },
    launch: async (value: {
      cwd: string;
      environment: NodeJS.ProcessEnv;
      controlDirectory: string;
    }) => {
      launches++;
      launched = value;
      return {
        child: {} as ChildProcessWithoutNullStreams,
        stop: async () => {
          stops++;
        },
      };
    },
  };
  return {
    root,
    workspace,
    storageDirectory,
    executable,
    systemDirectory,
    binding,
    authority,
    input,
    native,
    revoke: () => {
      current = false;
    },
    observed: () => ({
      preparations,
      versions,
      launches,
      stops,
      versionEnvironment,
      launched,
    }),
  };
}

test("a durable session restores its protected Codex home and allocates a new owned launch directory", async (t) => {
  const { db, dbReady, closeDatabase, agentsTable, tasksTable } =
    await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const { claimCodexTaskSession } = await import("./codex-task-session");
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Process session fixture",
      role: "Fixture",
      systemPrompt: "Work",
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Process session fixture",
      brief: "Work",
      ownerAgentId: agent.id,
    })
    .returning();
  t.after(async () => {
    await db.delete(tasksTable).where(eq(tasksTable.id, task.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
    await closeDatabase();
  });
  const f = await fixture(task.id);
  const executableDigest = createHash("sha256")
    .update(await readFile(f.executable))
    .digest("hex");
  const scope = {
    authority: f.authority,
    agentId: agent.id,
    workspace: f.workspace,
    storageDirectory: f.storageDirectory,
    executableDigest,
  };
  const first = await claimCodexTaskSession(scope);
  const ports = createCodexTaskProcessPorts(
    { ...f.input, session: first },
    f.native,
  );
  const prepared = await ports.prepare(f.binding);
  assert.equal(
    path.dirname(prepared.permissions!.configuration.file),
    first.home,
  );
  const running = await ports.launch(prepared, f.binding);
  const firstControl = f.observed().launched!.controlDirectory;
  await running.stop();
  await first.complete({
    status: "completed",
    threadId: "fixture_thread",
    turnId: "fixture_turn",
    text: "Fixture only",
    usage: null,
    proofScope: "codex_turn",
    deliverableVerified: false,
    actionReceipts: [],
    session: {
      binding: f.binding,
      cwd: f.workspace,
      threadId: "fixture_thread",
      usage: null,
    },
  });
  const second = await claimCodexTaskSession(scope);
  const restored = createCodexTaskProcessPorts(
    { ...f.input, session: second },
    f.native,
  );
  const nextPrepared = await restored.prepare(f.binding);
  assert.equal(
    path.dirname(nextPrepared.permissions!.configuration.file),
    first.home,
  );
  const next = await restored.launch(nextPrepared, f.binding);
  assert.notEqual(f.observed().launched!.controlDirectory, firstControl);
  assert.ok(
    f.observed().launched!.controlDirectory.startsWith(first.home + path.sep),
  );
  await next.stop();
  await second.complete({
    status: "completed",
    threadId: "fixture_thread",
    turnId: "fixture_turn_two",
    text: "Fixture only",
    usage: null,
    proofScope: "codex_turn",
    deliverableVerified: false,
    actionReceipts: [],
    session: {
      binding: f.binding,
      cwd: f.workspace,
      threadId: "fixture_thread",
      usage: null,
    },
  });
  const missing = await claimCodexTaskSession(scope);
  assert.ok(missing.home.startsWith(f.root + path.sep));
  await rename(missing.home, missing.home + "-retained-fixture");
  const missingHistory = createCodexTaskProcessPorts(
    { ...f.input, session: missing },
    f.native,
  );
  await assert.rejects(missingHistory.prepare(f.binding), {
    kind: "unsupported_capability",
  });
  assert.equal(f.observed().launches, 2);
  await missing.uncertain();
});

test("process factory prepares an isolated private home, probes without credentials and launches once with an explicit environment", async () => {
  const f = await fixture();
  const previous = process.env.ACOS_FIXTURE_HUMAN_SECRET;
  process.env.ACOS_FIXTURE_HUMAN_SECRET = "fixture-never-inherited";
  try {
    const ports = createCodexTaskProcessPorts(f.input, f.native);
    const prepared = await ports.prepare(f.binding);
    const home = path.dirname(prepared.permissions!.configuration.file);
    assert.ok(home.startsWith(f.storageDirectory + path.sep));
    assert.equal(prepared.cwd, f.workspace);
    assert.equal(prepared.model, "fixture-model");
    assert.deepEqual(prepared.permissions!.definition.filesystem, {
      ":minimal": "read",
      ":workspace_roots": "read",
      [home]: "deny",
      [f.executable]: "read",
    });
    const values = prepared.permissions!.configuration.values;
    assert.equal(
      values.projects,
      undefined,
      "No persisted project trust may replace the named filesystem policy",
    );
    const config = await readFile(
      prepared.permissions!.configuration.file,
      "utf8",
    );
    assert.ok(!config.includes("fixture-only-private"));
    assert.ok(!config.includes("fixture-never-inherited"));
    assert.ok(!config.includes('"trust_level"'));
    assert.equal(
      f.observed().versionEnvironment?.ACOS_CODEX_ACCESS_TOKEN,
      undefined,
    );
    assert.equal(
      f.observed().versionEnvironment?.ACOS_FIXTURE_HUMAN_SECRET,
      undefined,
    );
    assert.equal(
      f.observed().versionEnvironment
        ?.CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED,
      "1",
    );
    assert.equal(f.observed().versionEnvironment?.CODEX_HOME, home);
    assert.equal(f.observed().versionEnvironment?.HOME, home);
    assert.ok(Object.isFrozen(prepared));
    assert.ok(Object.isFrozen(prepared.permissions!.definition));
    const running = await ports.launch(prepared, f.binding);
    assert.equal(
      f.observed().launched?.cwd,
      home,
      "Start outside the source/project configuration tree",
    );
    assert.equal(
      f.observed().launched?.environment.ACOS_CODEX_ACCESS_TOKEN,
      "fixture-only-private-access",
    );
    assert.equal(
      f.observed().launched?.environment.ACOS_FIXTURE_HUMAN_SECRET,
      undefined,
    );
    assert.equal(f.observed().launched?.environment.USERPROFILE, home);
    assert.ok(
      f.observed().launched?.controlDirectory.startsWith(home + path.sep),
    );
    await running.stop();
    await assert.rejects(ports.launch(prepared, f.binding), {
      kind: "unsupported_capability",
    });
    assert.equal(f.observed().launches, 1);
    assert.equal(f.observed().stops, 1);
  } finally {
    if (previous === undefined) delete process.env.ACOS_FIXTURE_HUMAN_SECRET;
    else process.env.ACOS_FIXTURE_HUMAN_SECRET = previous;
  }
});

test("disabled execution, overlapping paths and foreign system config refuse before any executable probe", async () => {
  const f = await fixture();
  for (const patch of [
    { processExecEnabled: false },
    { storageDirectory: f.workspace },
    { storageDirectory: path.join(f.workspace, "private") },
    { workspace: f.root },
    { workspace: "relative" },
  ]) {
    const ports = createCodexTaskProcessPorts(
      { ...f.input, ...patch },
      f.native,
    );
    await assert.rejects(ports.prepare(f.binding), {
      kind: "unsupported_capability",
    });
  }
  await mkdir(f.systemDirectory);
  await writeFile(
    path.join(f.systemDirectory, "config.toml"),
    '[mcp_servers.foreign]\ncommand="fixture-never-launch"\n',
  );
  await assert.rejects(
    createCodexTaskProcessPorts(f.input, f.native).prepare(f.binding),
    { kind: "unsupported_capability" },
  );
  assert.equal(f.observed().versions, 0);
  assert.equal(f.observed().preparations, 0);
  assert.equal(f.observed().launches, 0);
});

test("a coding executable inside the model-writable workspace cannot reach even the credential-free version probe", async () => {
  const f = await fixture();
  const executable = path.join(f.workspace, "workspace-codex.exe");
  await writeFile(executable, await readFile(f.executable));
  await assert.rejects(
    createCodexTaskProcessPorts({ ...f.input, executable }, f.native).prepare(
      f.binding,
    ),
    { kind: "unsupported_capability" },
  );
  assert.equal(f.observed().versions, 0);
  assert.equal(f.observed().launches, 0);
});

test("changed binary or owned config bytes cannot launch a prepared coding task", async () => {
  for (const scenario of ["binary", "config"] as const) {
    const f = await fixture();
    const ports = createCodexTaskProcessPorts(f.input, f.native),
      prepared = await ports.prepare(f.binding);
    await writeFile(
      scenario === "binary"
        ? f.executable
        : prepared.permissions!.configuration.file,
      "fixture-changed-bytes",
    );
    await assert.rejects(ports.launch(prepared, f.binding), {
      kind: "unsupported_capability",
    });
    assert.equal(f.observed().launches, 0);
  }
});

test("lost/rebound authority, foreign prepared object and unsupported executable version never launch", async () => {
  const f = await fixture(),
    ports = createCodexTaskProcessPorts(f.input, f.native);
  await assert.rejects(
    ports.prepare({ ...f.binding, attemptId: randomUUID() }),
    { kind: "ownership_lost" },
  );
  const prepared = await ports.prepare(f.binding);
  await assert.rejects(ports.launch({ ...prepared }, f.binding), {
    kind: "unsupported_capability",
  });
  f.revoke();
  await assert.rejects(ports.launch(prepared, f.binding), {
    kind: "ownership_lost",
  });
  assert.equal(f.observed().launches, 0);
  const unsupported = await fixture();
  await assert.rejects(
    createCodexTaskProcessPorts(unsupported.input, {
      ...unsupported.native,
      version: async () => "codex-cli 0.1.0",
    }).prepare(unsupported.binding),
    { kind: "unsupported_capability" },
  );
  assert.equal(unsupported.observed().preparations, 0);
});

test("trust configuration does not treat a disabled project layer as an executable inheritance source", async () => {
  const f = await fixture(),
    prepared = await createCodexTaskProcessPorts(f.input, f.native).prepare(
      f.binding,
    );
  const expected = prepared.permissions!.configuration;
  assert.equal(
    codexTaskConfigurationMatches(
      {
        config: expected.values,
        layers: [
          {
            name: { type: "user", file: expected.file },
            config: expected.values,
          },
          {
            name: {
              type: "project",
              file: path.join(f.workspace, ".codex/config.toml"),
            },
            config: {
              mcp_servers: { foreign: { command: "fixture-never-launch" } },
            },
            disabledReason: "Untrusted project",
          },
        ],
      },
      expected,
    ),
    true,
  );
});

test("concurrent launch calls admit only one owned child", async () => {
  const f = await fixture(),
    ports = createCodexTaskProcessPorts(f.input, f.native);
  const prepared = await ports.prepare(f.binding);
  const results = await Promise.allSettled([
    ports.launch(prepared, f.binding),
    ports.launch(prepared, f.binding),
  ]);
  assert.equal(f.observed().launches, 1);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
});

test("authority lost during native launch awaits child cleanup before returning failure", async () => {
  const f = await fixture();
  const native = {
    ...f.native,
    launch: async (input: Parameters<typeof f.native.launch>[0]) => {
      const running = await f.native.launch(input);
      f.revoke();
      return running;
    },
  };
  const ports = createCodexTaskProcessPorts(f.input, native),
    prepared = await ports.prepare(f.binding);
  await assert.rejects(ports.launch(prepared, f.binding), {
    kind: "ownership_lost",
  });
  assert.equal(f.observed().launches, 1);
  assert.equal(f.observed().stops, 1);
});
