import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, realpath } from "node:fs/promises";
import os from "node:os";
import type { CodexActionReceipt } from "./codex-action-scope";
import test, { type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  codexTaskSessionsTable,
  sourceChangesTable,
} from "@workspace/db";
import {
  claimCodexTaskSession,
  runCodexTaskInSession,
} from "./codex-task-session";
import { buildCodexTaskConfiguration } from "./codex-task-configuration";
import type { CodexTaskAuthority } from "./codex-task-authority";
import type { runCodexTask } from "./codex-task-adapter";
import type { CodexTaskPorts } from "./codex-task-adapter";

// Offline protocol peer only. This does not enforce native OS permissions and
// has no credential/provider request. Its single fixture child is awaited.
const peer = String.raw`
const {prepared, serial, mode} = JSON.parse(process.argv[1]);
const send = value => process.stdout.write(JSON.stringify(value)+'\n');
let buffer='';
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => {
  buffer+=data; let at;
  while((at=buffer.indexOf('\n'))>=0) {
    const message=JSON.parse(buffer.slice(0,at)); buffer=buffer.slice(at+1);
    send({method:'fixture/observed',params:{method:message.method}});
    if(message.method==='initialize') send({id:message.id,result:{userAgent:'fixture'}});
    else if(message.method==='config/read') send({id:message.id,result:{config:prepared.permissions.configuration.values,layers:[{name:{type:'user',file:prepared.permissions.configuration.file,profile:null},config:prepared.permissions.configuration.values,disabledReason:null}]}});
    else if(message.method==='permissionProfile/list') send({id:message.id,result:{data:[{id:prepared.permissions.id,allowed:true}],nextCursor:null}});
    else if(message.method==='thread/start'||message.method==='thread/resume') send({id:message.id,result:{thread:{id:'fixture_thread'},model:prepared.model,modelProvider:'openai_chatgpt_plan',cwd:prepared.cwd,approvalPolicy:prepared.approvalPolicy,approvalsReviewer:'user',activePermissionProfile:{id:prepared.permissions.id,extends:null},runtimeWorkspaceRoots:prepared.permissions.runtimeWorkspaceRoots}});
    else if(message.method==='turn/start') {
      const turnId='fixture_turn_'+serial;
      send({id:message.id,result:{turn:{id:turnId,status:'inProgress'}}});
      send({method:'thread/tokenUsage/updated',params:{threadId:'fixture_thread',turnId,tokenUsage:{total:{inputTokens:5*serial,outputTokens:3*serial,totalTokens:8*serial}}}});
      const action={type:'commandExecution',id:'fixture_command_'+serial,status:'inProgress',command:'node --version',cwd:prepared.cwd,pluginId:null,scriptPath:null,source:'agent'};
      send({method:'item/started',params:{threadId:'fixture_thread',turnId,startedAtMs:100,item:action}});
      send({method:'item/completed',params:{threadId:'fixture_thread',turnId,completedAtMs:105,item:{...action,status:'completed',exitCode:0}}});
      send({method:'turn/completed',params:{threadId:'fixture_thread',turnId,turn:{id:turnId,status:mode==='failed'?'failed':'completed',items:[]}}});
    }
  }
});
`;

function driverPorts(
  t: TestContext,
  f: Awaited<ReturnType<typeof fixture>>,
  home: string,
  mode = "ok",
) {
  let serial = 0,
    release!: () => void,
    entered!: () => void;
  const cleanupEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const cleanupGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const methods: string[] = [];
  const built = buildCodexTaskConfiguration({
    cwd: f.input.workspace,
    executable: process.execPath,
    home,
    model: f.input.authority.model,
    policy: { mode: "approval" },
    canUseTerminal: true,
    processExecEnabled: true,
  });
  const ports: CodexTaskPorts = {
    readBinding: () => f.input.authority.readBinding(),
    readSession: async () => {
      throw new Error("fixture-private-untrusted-session");
    },
    prepare: async () => ({
      cwd: f.input.workspace,
      model: f.input.authority.model,
      approvalPolicy: built.approvalPolicy,
      permissions: built.permissions,
      config: {},
      secrets: [],
    }),
    launch: async (prepared) => {
      const turn = ++serial;
      const child = spawn(
        process.execPath,
        ["-e", peer, JSON.stringify({ prepared, serial: turn, mode })],
        { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      let observed = "";
      child.stdout.on("data", (chunk) => {
        observed += chunk.toString();
        let at;
        while ((at = observed.indexOf("\n")) >= 0) {
          const event = JSON.parse(observed.slice(0, at));
          observed = observed.slice(at + 1);
          if (event.method === "fixture/observed")
            methods.push(event.params.method);
        }
      });
      t.after(() => {
        release();
        child.kill();
      });
      return {
        child,
        stop: async () => {
          entered();
          if (mode === "ok" && turn === 1) await cleanupGate;
          const closed = once(child, "close");
          child.kill();
          await closed;
          if (mode === "cleanup_failed")
            throw new Error("fixture-private-cleanup-diagnostic");
        },
      };
    },
  };
  return { ports, cleanupEntered, release: () => release(), methods };
}

async function fixture(t: TestContext) {
  await dbReady;
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "acos-session-scope-")),
  );
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  t.after(async () => {
    assert.ok(path.dirname(root) === (await realpath(os.tmpdir())));
    await rm(root, { recursive: true, force: true });
  });
  const [agent] = await db
    .insert(agentsTable)
    .values({ name: "Session fixture", role: "Fixture", systemPrompt: "Work" })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({ title: "Session fixture", brief: "Work", ownerAgentId: agent.id })
    .returning();
  t.after(async () => {
    await db.delete(tasksTable).where(eq(tasksTable.id, task.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });
  const binding = Object.freeze({
    taskId: task.id,
    attemptId: randomUUID(),
    leaseOwner: randomUUID(),
    policyRevision: 1,
    registrationId: randomUUID(),
    registrationRevision: 2,
    accountId: "fixture-account",
    admissionVersion: 0,
  });
  let current = true;
  const authority: CodexTaskAuthority = {
    binding,
    model: "fixture-model",
    readBinding: async () => (current ? binding : null),
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
        revision: 2,
        updatedAt: 1,
        hostId: "fixture-host",
        clientId: "fixture-client",
        subject: "fixture-subject",
        accountId: binding.accountId,
        credentials: {
          accessToken: "fixture-private-access",
          idToken: "fixture-private-id",
          refreshToken: "fixture-private-refresh",
          grants: ["resource.invoke", "chatgpt.tokens.use.direct"],
          expiresAt: Date.now() + 3600000,
        },
      },
    }),
  };
  const input = {
    authority,
    agentId: agent.id,
    workspace,
    storageDirectory: path.join(root, "private-runtime"),
    executableDigest: "a".repeat(64),
  };
  const result = (
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    } | null = { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
  ) =>
    ({
      status: "completed",
      threadId: "fixture_thread",
      turnId: "fixture_turn",
      text: "fixture-private-access must not persist",
      usage,
      proofScope: "codex_turn",
      deliverableVerified: false,
      actionReceipts: [],
      session: {
        threadId: "fixture_thread",
        binding,
        cwd: input.workspace,
        usage,
      },
    }) as Awaited<ReturnType<typeof runCodexTask>>;
  return {
    input,
    binding,
    result,
    revoke: () => {
      current = false;
    },
    row: async () =>
      (
        await db
          .select()
          .from(codexTaskSessionsTable)
          .where(eq(codexTaskSessionsTable.taskId, task.id))
      )[0],
  };
}

test("a native checkpoint cannot resume against a different source-change revision or lose its source fence", async (t) => {
  const f = await fixture(t),
    id = randomUUID();
  try {
    await db.insert(sourceChangesTable).values({
      id,
      taskId: f.binding.taskId,
      agentId: f.input.agentId,
      sourcePath: "PRIVATE_original",
      request: "Fixture",
      baseCommit: "1".repeat(40),
      state: "draft",
      revision: 1,
    });
    const authority = {
      ...f.input.authority,
      sourceChange: { id, revision: 1 },
    };
    const first = await claimCodexTaskSession({ ...f.input, authority });
    assert.equal((await f.row()).sourceChangeId, id);
    assert.equal((await f.row()).sourceChangeRevision, 1);
    await first.complete(f.result());
    await db
      .update(sourceChangesTable)
      .set({ revision: 3 })
      .where(eq(sourceChangesTable.id, id));
    await assert.rejects(
      claimCodexTaskSession({
        ...f.input,
        authority: { ...authority, sourceChange: { id, revision: 3 } },
      }),
      { kind: "ownership_lost" },
    );
    assert.equal((await f.row()).state, "ready");
    assert.equal((await f.row()).sourceChangeRevision, 1);
    await assert.rejects(claimCodexTaskSession(f.input), {
      kind: "ownership_lost",
    });
  } finally {
    await db.delete(sourceChangesTable).where(eq(sourceChangesTable.id, id));
  }
});

test("owned session persists only a terminal checkpoint, and rebinds it to a new admitted attempt", async (t) => {
  const f = await fixture(t);
  const first = await claimCodexTaskSession(f.input);
  assert.equal(await first.readSession(), null);
  assert.equal((await f.row()).state, "running");
  assert.equal(path.dirname(first.home), f.input.storageDirectory);
  await first.complete(f.result());
  const saved = await f.row();
  assert.equal(saved.state, "ready");
  assert.equal(saved.cleanupState, "verified");
  assert.ok(saved.cleanupAt instanceof Date);
  assert.equal(saved.ownerToken, null);
  assert.equal(saved.threadId, "fixture_thread");
  assert.equal(saved.totalTokens, 8);
  assert.doesNotMatch(
    JSON.stringify(saved),
    /fixture-private-access|fixture-private-refresh|"text"|"credentials"|"accountId"/,
  );
  const binding = {
    ...f.binding,
    attemptId: randomUUID(),
    leaseOwner: randomUUID(),
    registrationRevision: 3,
  };
  const authority = {
    ...f.input.authority,
    binding,
    readBinding: async () => binding,
    readLaunchContext: async () => {
      const context = await f.input.authority.readLaunchContext();
      context.registration.revision = binding.registrationRevision;
      return context;
    },
  };
  const second = await claimCodexTaskSession({ ...f.input, authority });
  assert.equal(second.home, first.home);
  assert.equal((await f.row()).cleanupState, "unknown");
  assert.equal((await f.row()).cleanupAt, null);
  assert.deepEqual(await second.readSession(), {
    threadId: "fixture_thread",
    binding,
    cwd: f.input.workspace,
    usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
  });
  await assert.rejects(first.complete(f.result()), /codex_task_ownership_lost/);
  await second.uncertain();
});

test("two workers cannot acquire the same session, including first insertion", async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled([
    claimCodexTaskSession(f.input),
    claimCodexTaskSession(f.input),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  for (const result of results)
    if (result.status === "fulfilled") await result.value.uncertain();
});

test("a crashed or uncertain session never gets automatic replay or lease takeover", async (t) => {
  const f = await fixture(t);
  const lease = await claimCodexTaskSession(f.input);
  await assert.rejects(
    claimCodexTaskSession(f.input),
    /codex_task_ownership_lost/,
  );
  await lease.uncertain();
  assert.equal((await f.row()).state, "uncertain");
  await assert.rejects(
    claimCodexTaskSession(f.input),
    /codex_task_ownership_lost/,
  );
});

test("account, model, workspace, host, executable, policy and admission changes cannot resume a checkpoint", async (t) => {
  const f = await fixture(t);
  await (await claimCodexTaskSession(f.input)).complete(f.result());
  const mutations = [
    { workspace: path.resolve("other-workspace") },
    { storageDirectory: path.resolve("other-private-runtime") },
    { executableDigest: "b".repeat(64) },
    ...[
      { accountId: "other-account" },
      { registrationId: randomUUID() },
      { policyRevision: 2 },
      { admissionVersion: 1 },
      { registrationRevision: 1 },
    ].map((change) => {
      const binding = { ...f.binding, ...change };
      return {
        authority: {
          ...f.input.authority,
          binding,
          readBinding: async () => binding,
        },
      };
    }),
    { authority: { ...f.input.authority, model: "other-model" } },
    {
      authority: {
        ...f.input.authority,
        readLaunchContext: async () => {
          const context = await f.input.authority.readLaunchContext();
          context.registration.hostId = "other-host";
          return context;
        },
      },
    },
  ];
  for (const change of mutations)
    await assert.rejects(
      claimCodexTaskSession({ ...f.input, ...change }),
      /codex_task_ownership_lost/,
    );
  assert.equal((await f.row()).state, "ready");
});

test("lost authority cannot publish completion; cleanup can still mark its own map uncertain", async (t) => {
  const f = await fixture(t);
  const lease = await claimCodexTaskSession(f.input);
  f.revoke();
  await assert.rejects(lease.complete(f.result()), /codex_task_ownership_lost/);
  await lease.uncertain();
  assert.equal((await f.row()).state, "uncertain");
});

test("a fake or rebound terminal result does not become a resumable session", async (t) => {
  const f = await fixture(t);
  const lease = await claimCodexTaskSession(f.input);
  for (const patch of [
    { status: "failed" },
    { proofScope: "task" },
    { deliverableVerified: true },
    { threadId: "other" },
    {
      session: {
        ...f.result().session,
        binding: { ...f.binding, attemptId: randomUUID() },
      },
    },
    { session: { ...f.result().session, cwd: path.resolve("foreign") } },
    {
      session: {
        ...f.result().session,
        usage: { promptTokens: 4, completionTokens: 3, totalTokens: 1 },
      },
    },
  ])
    await assert.rejects(
      lease.complete({ ...f.result(), ...patch } as Awaited<
        ReturnType<typeof runCodexTask>
      >),
      /codex_task_protocol/,
    );
  assert.equal((await f.row()).state, "running");
  await lease.uncertain();
});

test("missing usage is unknown and a reused turn ID or decreasing cumulative counters cannot checkpoint", async (t) => {
  const f = await fixture(t);
  await (await claimCodexTaskSession(f.input)).complete(f.result());
  const next = await claimCodexTaskSession(f.input);
  await assert.rejects(next.complete(f.result()), /codex_task_protocol/);
  await assert.rejects(
    next.complete({
      ...f.result(),
      turnId: "next_turn",
      session: {
        ...f.result().session,
        usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 },
      },
    }),
    /codex_task_protocol/,
  );
  await next.complete({ ...f.result(null), turnId: "next_turn" });
  const row = await f.row();
  assert.equal(row.promptTokens, null);
  assert.equal(row.completionTokens, null);
  assert.equal(row.totalTokens, null);
  const after = await claimCodexTaskSession(f.input);
  assert.equal((await after.readSession())?.usage, null);
  await after.uncertain();
});

test("validated completion counters and identity cannot change while its ownership check yields", async (t) => {
  const f = await fixture(t);
  const lease = await claimCodexTaskSession(f.input);
  const result = f.result();
  const saving = lease.complete(result);
  result.threadId = "changed_thread";
  result.turnId = "changed_turn";
  result.session.usage!.totalTokens = 99;
  await saving;
  const row = await f.row();
  assert.equal(row.threadId, "fixture_thread");
  assert.equal(row.lastTurnId, "fixture_turn");
  assert.equal(row.totalTokens, 8);
});

test("a private home is only supplied to the same bound backend runtime scope", async (t) => {
  const f = await fixture(t);
  const lease = await claimCodexTaskSession(f.input);
  const scope = {
    binding: f.binding,
    workspace: f.input.workspace,
    storageDirectory: f.input.storageDirectory,
    model: f.input.authority.model,
    executableDigest: f.input.executableDigest,
  };
  assert.equal(await lease.readRuntimeHome(scope), lease.home);
  for (const change of [
    { workspace: path.resolve("foreign") },
    { model: "foreign" },
    { executableDigest: "b".repeat(64) },
    { binding: { ...f.binding, taskId: f.binding.taskId + 1 } },
  ])
    await assert.rejects(
      lease.readRuntimeHome({ ...scope, ...change }),
      /codex_task_ownership_lost/,
    );
  await lease.uncertain();
});

test("the durable approval fence is backend-only, exact to the live session and cannot survive terminal checkpoint or uncertain cleanup", async (t) => {
  const f = await fixture(t);
  const lease = await claimCodexTaskSession(f.input);
  const read = (
    lease as typeof lease & {
      readApprovalFence(binding: typeof f.binding): Promise<{
        taskId: number;
        agentId: number;
        revision: number;
        ownerToken: string;
        attemptId: string;
        leaseOwner: string;
        policyRevision: number;
        registrationId: string;
        registrationRevision: number;
        admissionVersion: number;
      }>;
    }
  ).readApprovalFence;
  assert.equal(typeof read, "function");
  const fence = await read(f.binding);
  assert.equal(fence.taskId, f.binding.taskId);
  assert.equal(fence.agentId, f.input.agentId);
  assert.equal(fence.attemptId, f.binding.attemptId);
  assert.equal(fence.leaseOwner, f.binding.leaseOwner);
  assert.equal(fence.registrationId, f.binding.registrationId);
  assert.equal(fence.registrationRevision, f.binding.registrationRevision);
  assert.equal(fence.admissionVersion, 0);
  assert.match(fence.ownerToken, /^[a-f0-9-]{36}$/);
  assert.ok(Object.isFrozen(fence));
  assert.doesNotMatch(
    JSON.stringify(fence),
    /fixture-private|fixture-account|fixture-subject|fixture-host/,
  );
  await assert.rejects(
    read({ ...f.binding, attemptId: randomUUID() }),
    /codex_task_ownership_lost/,
  );
  await lease.complete(f.result());
  await assert.rejects(read(f.binding), /codex_task_ownership_lost/);
  const next = await claimCodexTaskSession(f.input);
  const nextRead = (next as typeof lease & { readApprovalFence: typeof read })
    .readApprovalFence;
  const nextFence = await nextRead(f.binding);
  assert.notEqual(nextFence.ownerToken, fence.ownerToken);
  assert.ok(nextFence.revision > fence.revision);
  await next.uncertain();
  await assert.rejects(nextRead(f.binding), /codex_task_ownership_lost/);
});

test("changing persisted session scope without rotating its token cannot authorize a pending action", async (t) => {
  const f = await fixture(t);
  const lease = await claimCodexTaskSession(f.input);
  await db
    .update(codexTaskSessionsTable)
    .set({ registrationRevision: f.binding.registrationRevision + 1 })
    .where(eq(codexTaskSessionsTable.taskId, f.binding.taskId));
  await assert.rejects(
    lease.readApprovalFence(f.binding),
    /codex_task_ownership_lost/,
  );
});

test("actual driver cleanup precedes checkpoint and resumed usage counts only the new turn", async (t) => {
  const f = await fixture(t);
  const lease = await claimCodexTaskSession(f.input);
  const peer = driverPorts(t, f, lease.home);
  const input = {
    binding: f.binding,
    prompt: "Fixture only",
    resume: true,
    requestTimeoutMs: 2000,
    turnTimeoutMs: 3000,
    fenceIntervalMs: 100,
  };
  const running = runCodexTaskInSession(lease, input, peer.ports);
  await peer.cleanupEntered;
  assert.equal((await f.row()).state, "running");
  assert.equal((await f.row()).cleanupState, "unknown");
  peer.release();
  const first = await running;
  assert.equal(first.usage?.totalTokens, 8);
  assert.equal(first.actionReceipts.length, 1);
  assert.equal(first.actionReceipts[0].status, "completed");
  assert.equal((await f.row()).state, "ready");
  const next = await claimCodexTaskSession(f.input);
  const second = await runCodexTaskInSession(
    next,
    { ...input, resume: false },
    peer.ports,
  );
  assert.equal(second.usage?.totalTokens, 8);
  assert.equal((await f.row()).totalTokens, 16);
  assert.equal(
    peer.methods.filter((method) => method === "thread/start").length,
    1,
  );
  assert.equal(
    peer.methods.filter((method) => method === "thread/resume").length,
    1,
  );
});

for (const mode of ["failed", "cleanup_failed"])
  test(`actual ${mode} driver result retains reported usage and makes its map uncertain`, async (t) => {
    const f = await fixture(t);
    const lease = await claimCodexTaskSession(f.input);
    const peer = driverPorts(t, f, lease.home, mode);
    await assert.rejects(
      runCodexTaskInSession(
        lease,
        {
          binding: f.binding,
          prompt: "Fixture only",
          requestTimeoutMs: 2000,
          turnTimeoutMs: 3000,
          fenceIntervalMs: 100,
        },
        peer.ports,
      ),
      (error: {
        kind: string;
        usage: { totalTokens: number };
        message: string;
        actionReceipts: readonly CodexActionReceipt[];
      }) => {
        assert.equal(
          error.kind,
          mode === "failed" ? "turn_failed" : "cleanup_failed",
        );
        assert.equal(error.usage.totalTokens, 8);
        assert.equal(error.actionReceipts.length, 1);
        assert.equal(error.actionReceipts[0].status, "completed");
        assert.equal(error.actionReceipts[0].proofScope, "codex_item");
        assert.doesNotMatch(error.message, /fixture-private/);
        return true;
      },
    );
    assert.equal((await f.row()).state, "uncertain");
    assert.equal(
      (await f.row()).cleanupState,
      mode === "failed" ? "verified" : "unknown",
    );
    assert.equal((await f.row()).cleanupAt !== null, mode === "failed");
    await assert.rejects(
      claimCodexTaskSession(f.input),
      /codex_task_ownership_lost/,
    );
  });

test("post-shutdown accounting failure preserves cleanup proof without a successful checkpoint or replay", async (t) => {
  const f = await fixture(t);
  const lease = await claimCodexTaskSession(f.input);
  const peer = driverPorts(t, f, lease.home);
  peer.release();
  await assert.rejects(
    runCodexTaskInSession(
      lease,
      {
        binding: f.binding,
        prompt: "Fixture",
        requestTimeoutMs: 2000,
        turnTimeoutMs: 3000,
        fenceIntervalMs: 100,
      },
      peer.ports,
      {
        beforeCheckpoint: async () => {
          throw new Error("fixture-private-accounting-error");
        },
      },
    ),
    (error: { cleanupState: string; usage: { totalTokens: number } }) => {
      assert.equal(error.cleanupState, "verified");
      assert.equal(error.usage.totalTokens, 8);
      return true;
    },
  );
  const row = await f.row();
  assert.equal(row.state, "uncertain");
  assert.equal(row.cleanupState, "verified");
  assert.ok(row.cleanupAt instanceof Date);
  assert.equal(row.threadId, null);
  await assert.rejects(
    claimCodexTaskSession(f.input),
    /codex_task_ownership_lost/,
  );
});

test("a cleanup acknowledgement cannot cross persisted scope changes or a later owner", async (t) => {
  const f = await fixture(t);
  const first = await claimCodexTaskSession(f.input);
  await first.complete(f.result());
  const next = await claimCodexTaskSession(f.input);
  await first.uncertain("verified");
  assert.equal((await f.row()).state, "running");
  assert.equal((await f.row()).cleanupState, "unknown");
  await db
    .update(codexTaskSessionsTable)
    .set({ executableDigest: "b".repeat(64) })
    .where(eq(codexTaskSessionsTable.taskId, f.binding.taskId));
  await assert.rejects(next.uncertain("verified"), /codex_task_ownership_lost/);
  assert.equal((await f.row()).cleanupState, "unknown");
  assert.equal((await f.row()).cleanupAt, null);
});

test("prelaunch rejection is durable but cannot authorize a legacy checkpoint or uncertain replay", async (t) => {
  const f = await fixture(t);
  const lease = await claimCodexTaskSession(f.input);
  const peer = driverPorts(t, f, lease.home);
  peer.ports.prepare = async () => {
    throw new Error("fixture-private-prelaunch");
  };
  await assert.rejects(
    runCodexTaskInSession(
      lease,
      { binding: f.binding, prompt: "Fixture" },
      peer.ports,
    ),
    { cleanupState: "not_launched", requestStarted: false },
  );
  assert.equal((await f.row()).state, "uncertain");
  assert.equal((await f.row()).cleanupState, "not_launched");
  assert.ok((await f.row()).cleanupAt instanceof Date);
  await assert.rejects(
    claimCodexTaskSession(f.input),
    /codex_task_ownership_lost/,
  );
  await db
    .update(codexTaskSessionsTable)
    .set({ state: "ready", cleanupState: "unknown", cleanupAt: null })
    .where(eq(codexTaskSessionsTable.taskId, f.binding.taskId));
  await assert.rejects(
    claimCodexTaskSession(f.input),
    /codex_task_ownership_lost/,
  );
});

test.after(() => closeDatabase());
