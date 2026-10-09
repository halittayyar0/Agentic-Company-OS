import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import express from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  taskAttemptsTable,
  runtimeInstancesTable,
  executionPolicyTable,
  runtimeControlsTable,
  chatgptRegistrationLocksTable,
  chatgptRegistrationsTable,
  approvalRequestsTable,
  codexActionApprovalsTable,
  codexTaskSessionsTable,
  activityEventsTable,
  operationReceiptsTable,
  operationInvocationsTable,
  usageEventsTable,
} from "@workspace/db";
import { createPostgresChatGPTRegistrationStore } from "../chatgpt-registration-store";
import { createCodexTaskAuthority } from "../codex-task-authority";
import {
  claimCodexTaskSession,
  runCodexTaskInSession,
} from "../codex-task-session";
import { buildCodexTaskConfiguration } from "../codex-task-configuration";
import type { CodexTaskPorts } from "../codex-task-adapter";
import type { CodexTurnControl } from "../codex-task-adapter";
import { createCodexTaskApprovalBridge } from "../codex-task-approvals";
import { createCodexActionTracker } from "../codex-action-scope";
import { createApprovalsRouter } from "../../routes/approvals";
import { startTaskLeaseHeartbeat } from "../orchestrator/task-lease-heartbeat";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import type { ToolRuntimeContext } from "../orchestrator/execute-tool";

export async function fixture(t: TestContext, approvalTimeoutMs?: number) {
  await dbReady;
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "acos-live-approval-")),
  );
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  const [oldPolicy] = await db.select().from(executionPolicyTable);
  const [oldControl] = await db.select().from(runtimeControlsTable);
  await db
    .update(executionPolicyTable)
    .set({ mode: "approval", revision: 1, custom: null });
  await db.update(runtimeControlsTable).set({ emergencyStopEnabled: false });
  const now = Date.now(),
    leaseOwner = randomUUID(),
    workerId = randomUUID(),
    attemptId = randomUUID(),
    logicalId = randomUUID();
  await db.insert(runtimeInstancesTable).values({
    id: workerId,
    role: "worker",
    state: "healthy",
    hostname: "fixture",
    processId: process.pid,
    buildVersion: "fixture",
    lastHeartbeatAt: new Date(now),
  });
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Approval owner fixture",
      role: "Fixture",
      systemPrompt: "Fixture",
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: new Date(now + 900000),
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Approval task",
      brief: "Fixture",
      ownerAgentId: agent.id,
      status: "in_progress",
      lastModelId: "chatgpt:fixture-model",
      lastModelProvider: "chatgpt",
      leaseOwner,
      leaseExpiresAt: new Date(now + 900000),
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, agent.id));
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: task.id,
    agentId: agent.id,
    workerInstanceId: workerId,
    leaseOwner,
    attemptNumber: 1,
    cycleNumber: 0,
    logicalExecutionId: logicalId,
    state: "running",
    lastHeartbeatAt: new Date(now),
  });
  const store = await createPostgresChatGPTRegistrationStore(
    db,
    "owned-live-approval-fixture-private-key",
  );
  const registration = await store.replaceRegistration(0, {
    id: randomUUID(),
    hostId: await store.getHostId(),
    clientId: "fixture-client",
    subject: "fixture-subject",
    accountId: "fixture-account",
    credentials: {
      accessToken: "fixture-private-access",
      idToken: "fixture-private-id",
      grants: ["resource.invoke", "chatgpt.tokens.use.direct"],
      expiresAt: now + 3600000,
    },
  });
  await store.activateRegistration(registration.id, registration.revision);
  const heartbeat = startTaskLeaseHeartbeat({
    taskId: task.id,
    agentId: agent.id,
    attemptId,
    leaseOwner,
    config: readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" }),
  });
  const context = {
    agent,
    taskId: task.id,
    runtimeAttemptId: attemptId,
    taskLeaseOwner: leaseOwner,
    turnModelId: "chatgpt:fixture-model",
    assertTaskLease: () => heartbeat.assertOwned("Live approval fixture"),
    operationIdentity: {
      executionKind: "task_step",
      logicalExecutionId: logicalId,
      runtimeInstanceId: workerId,
      originAttemptId: attemptId,
      sourceMessageId: null,
      modelToolCallId: "fixture_call",
      callSlot: "round:1:tool:0",
      agentLeaseOwner: leaseOwner,
    },
  } as ToolRuntimeContext;
  const authority = await createCodexTaskAuthority(context, {
    store: async () => store,
    sessions: async () => ({
      renewRegistration: async () => (await store.readActiveRegistration())!,
    }),
  });
  const session = await claimCodexTaskSession({
    authority,
    agentId: agent.id,
    workspace,
    storageDirectory: path.join(root, "private"),
    executableDigest: "a".repeat(64),
  });
  const bridge = createCodexTaskApprovalBridge({
    authority,
    session,
    locale: "en",
    pollIntervalMs: 20,
    approvalTimeoutMs,
  });
  const app = express();
  app.use(express.json());
  app.use("/api", createApprovalsRouter());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/api`;
  t.after(async () => {
    await bridge.close().catch(() => {});
    await session.uncertain().catch(() => {});
    await heartbeat.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db
      .delete(activityEventsTable)
      .where(eq(activityEventsTable.taskId, task.id));
    const receipts = await db
      .select({ id: operationReceiptsTable.id })
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.taskId, task.id));
    for (const receipt of receipts)
      await db
        .delete(operationInvocationsTable)
        .where(eq(operationInvocationsTable.receiptId, receipt.id));
    await db
      .delete(operationReceiptsTable)
      .where(eq(operationReceiptsTable.taskId, task.id));
    await db
      .delete(approvalRequestsTable)
      .where(eq(approvalRequestsTable.taskId, task.id));
    await db
      .delete(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, attemptId));
    await db
      .delete(usageEventsTable)
      .where(eq(usageEventsTable.taskId, task.id));
    await db.delete(tasksTable).where(eq(tasksTable.id, task.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
    await db
      .delete(runtimeInstancesTable)
      .where(eq(runtimeInstancesTable.id, workerId));
    await db
      .update(chatgptRegistrationLocksTable)
      .set({ activeRegistrationId: null })
      .where(
        eq(chatgptRegistrationLocksTable.activeRegistrationId, registration.id),
      );
    await db
      .delete(chatgptRegistrationsTable)
      .where(eq(chatgptRegistrationsTable.id, registration.id));
    await db.update(executionPolicyTable).set(oldPolicy);
    await db.update(runtimeControlsTable).set(oldControl);
    assert.equal(path.dirname(root), await realpath(os.tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  function request(itemId = "fixture_item") {
    const tracker = createCodexActionTracker({
      workspace,
      secrets: ["fixture-private-access", "fixture-private-id"],
    });
    tracker.observe({
      method: "item/started",
      params: {
        threadId: "fixture_thread",
        turnId: "fixture_turn",
        startedAtMs: 100,
        item: {
          type: "commandExecution",
          id: itemId,
          command: "node --version",
          cwd: workspace,
          source: "agent",
          status: "inProgress",
        },
      },
    });
    return tracker.review({
      id: itemId,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "fixture_thread",
        turnId: "fixture_turn",
        itemId,
        command: "node --version",
        cwd: workspace,
        startedAtMs: 101,
      },
    }).request;
  }
  async function pending(running?: Promise<unknown>) {
    // Task admission, digest reads, session creation and peer startup precede
    // the approval. Observe the actual running task and bound this fixture
    // wait independently of those phases, rather than assuming 100 fast polls.
    let settled = false,
      failure: unknown;
    void running?.then(
      () => {
        settled = true;
      },
      (error) => {
        settled = true;
        failure = error;
      },
    );
    const until = Date.now() + 15_000;
    while (Date.now() < until) {
      if (settled) {
        if (failure !== undefined) throw failure;
        assert.fail("Owned task ended before an approval was created");
      }
      const [row] = await db
        .select()
        .from(approvalRequestsTable)
        .where(
          and(
            eq(approvalRequestsTable.taskId, task.id),
            eq(approvalRequestsTable.status, "pending"),
          ),
        );
      if (row) return row;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail("Owned approval was not created");
  }
  const row = async () =>
    (
      await db
        .select()
        .from(codexActionApprovalsTable)
        .where(eq(codexActionApprovalsTable.taskId, task.id))
    )[0];
  const decide = async (id: number, body: Record<string, unknown>) => {
    const response = await fetch(`${url}/approvals/${id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  };
  return {
    authority,
    session,
    bridge,
    agent,
    task,
    leaseOwner,
    attemptId,
    workerId,
    store,
    registration,
    request,
    pending,
    row,
    decide,
    url,
    workspace,
    root,
    context,
  };
}

// Offline protocol peer. It reports fixture item events and never executes the
// displayed command, accesses a real provider or enforces native containment.
const peer = String.raw`
const {prepared, mode} = JSON.parse(process.argv[1]);
const send = value => process.stdout.write(JSON.stringify(value)+'\n');
const action={type:'commandExecution',id:'fixture_command',status:'inProgress',command:'node --version',cwd:prepared.cwd,source:'agent'};
const event=(method, params)=>send({method,params:{threadId:'fixture_thread',turnId:'fixture_turn',...params}});
let buffer='';
process.stdin.setEncoding('utf8');
process.stdin.on('data', data=>{
 buffer+=data; let at;
 while((at=buffer.indexOf('\n'))>=0) {
  const message=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);
  if(message.method==='initialize') send({id:message.id,result:{userAgent:'fixture'}});
  else if(message.method==='config/read') send({id:message.id,result:{config:prepared.permissions.configuration.values,layers:[{name:{type:'user',file:prepared.permissions.configuration.file,profile:null},config:prepared.permissions.configuration.values,disabledReason:null}]}});
  else if(message.method==='permissionProfile/list') send({id:message.id,result:{data:[{id:prepared.permissions.id,allowed:true}],nextCursor:null}});
  else if(message.method==='thread/start'||message.method==='thread/resume') send({id:message.id,result:{thread:{id:'fixture_thread'},model:prepared.model,modelProvider:'openai_chatgpt_plan',cwd:prepared.cwd,approvalPolicy:prepared.approvalPolicy,approvalsReviewer:'user',activePermissionProfile:{id:prepared.permissions.id,extends:null},runtimeWorkspaceRoots:prepared.permissions.runtimeWorkspaceRoots}});
  else if(message.method==='turn/start') {
   send({id:message.id,result:{turn:{id:'fixture_turn',status:'inProgress'}}});
   event('thread/tokenUsage/updated',{tokenUsage:{total:{inputTokens:5,outputTokens:3,totalTokens:8}}});
   event('item/started',{startedAtMs:100,item:action});
   send({id:'fixture_approval',method:'item/commandExecution/requestApproval',params:{threadId:'fixture_thread',turnId:'fixture_turn',itemId:action.id,command:action.command,cwd:action.cwd,startedAtMs:101}});
  } else if(message.method==='turn/steer') {
   send({id:message.id,result:{turnId:'fixture_turn'}});
   send({method:'serverRequest/resolved',params:{threadId:'fixture_thread',requestId:'fixture_approval'}});
   event('item/completed',{completedAtMs:105,item:{...action,status:'declined',exitCode:null}});
   event('turn/completed',{turn:{id:'fixture_turn',status:'completed',items:[]}});
  } else if(message.id==='fixture_approval') {
   if(message.result.decision!=='accept') process.exit(2);
   if(mode==='lost_after_consumption') process.exit(1);
   event('item/completed',{completedAtMs:105,item:{...action,status:'completed',exitCode:0}});
   event('turn/completed',{turn:{id:'fixture_turn',status:mode==='failed_after_receipt'?'failed':'completed',items:[],error:mode==='failed_after_receipt'?{message:'fixture-private-diagnostic'}:null}});
  }
 }
});`;

export function nativeFixturePorts(
  t: TestContext,
  f: Awaited<ReturnType<typeof fixture>>,
  mode: string,
): CodexTaskPorts {
  const built = buildCodexTaskConfiguration({
    cwd: f.workspace,
    executable: process.execPath,
    home: f.session.home,
    model: f.authority.model,
    policy: { mode: "approval" },
    canUseTerminal: true,
    processExecEnabled: true,
  });
  return {
    readBinding: () => f.authority.readBinding(),
    approve: f.bridge.approve,
    onActionReceipt: f.bridge.onActionReceipt,
    prepare: async () => ({
      cwd: f.workspace,
      model: f.authority.model,
      approvalPolicy: built.approvalPolicy,
      permissions: built.permissions,
      config: {},
      secrets: ["fixture-private-access", "fixture-private-id"],
    }),
    launch: async (prepared) => {
      const child = spawn(
        process.execPath,
        ["-e", peer, JSON.stringify({ prepared, mode })],
        { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      t.after(() => {
        child.kill();
      });
      return {
        child,
        stop: async () => {
          if (child.exitCode === null && child.signalCode === null) {
            const stopped = once(child, "close");
            child.kill();
            await stopped;
          }
          await f.bridge.close();
        },
      };
    },
  };
}
