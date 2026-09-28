import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  activityEventsTable,
  agentsTable,
  approvalRequestsTable,
  db,
  dbReady,
  runtimeInstancesTable,
  tasksTable,
} from "@workspace/db";
import { executeApprovedAction, executeTool } from "./execute-tool";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import { terminalMessage } from "../vm/terminal-localization";
import { readWorkspaceLocale } from "../workspace-locale";
import { reviveAndReleaseStaleWork } from "./scheduler";
import {
  ceoPermissionsPreset,
  specialistPermissionsPreset,
} from "./permission-presets";
import { getToolsForAgent } from "./tools";
import {
  execAgentSudo,
  getAgentSudoTarget,
  getSandboxRoot,
  readTextFile,
} from "../vm/sandbox";

const runtimeOperationsConfig = readRuntimeOperationsConfig();

function sudoArgsHash(command: string): string {
  return createHash("sha256").update(JSON.stringify({ command })).digest("hex");
}

test("approved actions stay queued when the agent lease is busy", async () => {
  await dbReady;
  const future = new Date(Date.now() + 10 * 60_000);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Approval lease test agent",
      role: "Test",
      status: "working",
      systemPrompt: "Test only",
      createdByUser: true,
      runLeaseOwner: "chat:test-owner",
      runLeaseExpiresAt: future,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Approval lease test task",
      brief: "The approved action must not race an active agent run.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "external_contact",
      title: "Test scoped action",
      description: "No side effect should run while the agent is busy.",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt: future,
      scope: {
        toolName: "browser_click",
        argsHash: "test-hash",
        target: "https://example.test",
      },
      actionPayload: {
        toolName: "browser_click",
        args: { ref: 1 },
      },
    })
    .returning();

  const result = await executeApprovedAction(
    approval.id,
    runtimeOperationsConfig,
  );
  assert.equal(result.claimed, false);

  const [persistedApproval] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, approval.id));
  const [persistedTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  const [persistedAgent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, agent.id));

  assert.equal(persistedApproval.consumedAt, null);
  assert.equal(persistedTask.status, "awaiting_approval");
  assert.equal(persistedTask.leaseOwner, null);
  assert.equal(persistedAgent.runLeaseOwner, "chat:test-owner");
});

test("sub-agents cannot inherit capabilities their parent does not have", async () => {
  await dbReady;
  const [parent] = await db
    .insert(agentsTable)
    .values({
      name: "Restricted parent agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      permissions: {
        canCreateSubAgents: true,
        canDelegate: true,
        canSpend: false,
        canDelete: false,
        canPublish: false,
        canContactExternal: false,
        canBrowse: false,
        canUseTerminal: false,
        canUseSudo: false,
      },
    })
    .returning();

  const result = await executeTool(
    { agent: parent, taskId: null },
    "create_sub_agent",
    JSON.stringify({
      name: "Restricted child agent",
      role: "Test child",
      systemPrompt: "Test only",
    }),
  );
  assert.equal(result.createdAgents.length, 1);
  const child = result.createdAgents[0];
  assert.equal(child.permissions.canBrowse, false);
  assert.equal(child.permissions.canUseTerminal, false);
  assert.equal(child.permissions.canSpend, false);
  assert.equal(child.permissions.canPublish, false);
});

test("browser text entry cannot implicitly submit with a global Enter key", async () => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Two-step browser test agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const result = await executeTool(
    { agent, taskId: null },
    "browser_type",
    JSON.stringify({ ref: 1, text: "approved draft", submit: true }),
  );
  assert.match(
    result.content,
    /metin girişi ve form gönderimi ayrı onaylı eylemler/,
  );
  assert.equal(result.toolOutcome, "rejected");
  assert.equal(result.createdTasks.length, 0);
});

test("an approved browser effect without immutable affinity stays unconsumed and never dispatches", async (t) => {
  await dbReady;
  const args = { ref: 44 };
  const argsHash = createHash("sha256")
    .update(JSON.stringify(args))
    .digest("hex");
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Approved browser ambiguity agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      permissions: {
        ...specialistPermissionsPreset,
        canBrowse: true,
        canContactExternal: true,
      },
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Approved browser ambiguity",
      brief:
        "A dispatched browser action must never be reported as definite failure.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "external_contact",
      title: "Ambiguous browser click",
      description: "The click may already have reached the page.",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      scope: { toolName: "browser_click", argsHash, target: null },
      actionPayload: {
        toolName: "browser_click",
        args,
        taskDisposition: "resume",
      },
    })
    .returning();
  t.after(async () => {
    await db
      .update(agentsTable)
      .set({
        isActive: false,
        status: "archived",
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
      })
      .where(eq(agentsTable.id, agent.id));
  });

  let dispatched = false;
  const outcome = await executeApprovedAction(
    approval.id,
    runtimeOperationsConfig,
    {
      executeAction: async () => {
        dispatched = true;
        return {
          content: "must not run",
          createdTasks: [],
          createdAgents: [],
          toolOutcome: "succeeded" as const,
        };
      },
    },
  );

  assert.equal(outcome.status, "queued");
  assert.equal(outcome.claimed, false);
  assert.equal(dispatched, false);
  const [[persistedTask], [persistedApproval], events] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
    db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, approval.id)),
    db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, task.id)),
  ]);
  assert.equal(persistedTask.status, "awaiting_approval");
  assert.equal(persistedTask.blockedReason, null);
  assert.equal(persistedApproval.consumedAt, null);
  assert.equal(
    events.some((event) => event.detail?.approvalId === approval.id),
    false,
  );
  const replay = await executeApprovedAction(
    approval.id,
    runtimeOperationsConfig,
  );
  assert.equal(replay.status, "queued");
  assert.equal(replay.claimed, false);
});

test("CEO sudo is canonical, scoped, single-use, affinity-bound, and minimized", async () => {
  await dbReady;
  const previousGate = process.env.ALLOW_AGENT_SUDO;
  const previousSecret = process.env.TEST_PRIVATE_TOKEN;
  process.env.ALLOW_AGENT_SUDO = "true";
  process.env.TEST_PRIVATE_TOKEN = "must-not-reach-child";

  try {
    const runtimeInstanceId = `approved-sudo-test-${randomUUID()}`;
    await db.insert(runtimeInstancesTable).values({
      id: runtimeInstanceId,
      role: "worker",
      state: "healthy",
      hostname: "approved-sudo-test",
      processId: 2_202,
      buildVersion: "test",
      schedulerEnabled: true,
      lastHeartbeatAt: new Date(),
    });
    const executionDependencies = { runtimeInstanceId, locale: "tr" as const };
    const [rootCeo] = await db
      .insert(agentsTable)
      .values({
        name: "Canonical root CEO",
        role: "Chief Executive Officer",
        depth: 0,
        parentAgentId: null,
        templateKey: "ceo",
        isRootCeo: true,
        systemPrompt: "Test only",
        permissions: ceoPermissionsPreset,
        createdByUser: true,
      })
      .returning();
    const [spoofedCeo] = await db
      .insert(agentsTable)
      .values({
        name: "Spoofed nested CEO",
        role: "Chief Executive Officer",
        depth: 1,
        parentAgentId: rootCeo.id,
        templateKey: "ceo",
        isRootCeo: false,
        systemPrompt: "Test only",
        permissions: ceoPermissionsPreset,
        createdByUser: true,
      })
      .returning();

    const rootTools = (await getToolsForAgent(rootCeo, false)).map(
      (tool) => tool.function.name,
    );
    const spoofedTools = (await getToolsForAgent(spoofedCeo, false)).map(
      (tool) => tool.function.name,
    );
    assert.ok(rootTools.includes("vm_run_sudo_command"));
    assert.ok(!spoofedTools.includes("vm_run_sudo_command"));

    const spoofedAttempt = await executeTool(
      { agent: spoofedCeo, taskId: null },
      "vm_run_sudo_command",
      JSON.stringify({ command: "echo forbidden" }),
    );
    assert.match(spoofedAttempt.content, /yalnızca kök CEO/);
    assert.equal(spoofedAttempt.toolOutcome, "rejected");

    const forgedApproval = await executeTool(
      { agent: spoofedCeo, taskId: null },
      "request_approval",
      JSON.stringify({
        category: "other",
        title: "Forged sudo",
        description: "Must fail before persistence",
        toolName: "vm_run_sudo_command",
        toolArgs: { command: "echo forbidden" },
      }),
    );
    assert.match(forgedApproval.content, /sudo onayı yalnızca/);
    const forgedRows = await db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.agentId, spoofedCeo.id));
    assert.equal(forgedRows.length, 0);

    const command = `node -e "const fs=require('node:fs');fs.writeFileSync('env-proof.json',JSON.stringify({secret:process.env.TEST_PRIVATE_TOKEN??null,cwd:process.cwd(),home:process.env.HOME,temp:process.env.TEMP}));process.stdout.write(['operator-user','API_KEY=do-not-persist',...Array.from({length:20},(_,i)=>'line-'+(i+1))].join('\\n'))"`;
    const argsHash = sudoArgsHash(command);
    const target = await getAgentSudoTarget(rootCeo.id);
    const [task] = await db
      .insert(tasksTable)
      .values({
        title: "Approved sudo task",
        brief: "Execute one harmless test command.",
        ownerAgentId: rootCeo.id,
        status: "awaiting_approval",
        createdByUser: true,
      })
      .returning();
    const [approval] = await db
      .insert(approvalRequestsTable)
      .values({
        taskId: task.id,
        agentId: rootCeo.id,
        category: "other",
        title: "CEO Host Shell",
        description: "Exact test command",
        status: "approved",
        resolvedAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60_000),
        scope: {
          toolName: "vm_run_sudo_command",
          argsHash,
          target: target.target,
          preview: command,
        },
        actionPayload: {
          toolName: "vm_run_sudo_command",
          args: { command },
          taskDisposition: "complete",
        },
      })
      .returning();

    const executed = await executeApprovedAction(
      approval.id,
      runtimeOperationsConfig,
      executionDependencies,
    );
    assert.equal(executed.claimed, true);
    assert.match(executed.output ?? "", /operator-user/);
    assert.ok(
      executed.output?.startsWith(
        terminalMessage("tr", "approvedCompleted", {
          tool: "vm_run_sudo_command",
          exitCode: 0,
        }),
      ),
    );
    assert.match(executed.output ?? "", /API_KEY=\[REDACTED\]/);
    assert.doesNotMatch(executed.output ?? "", /do-not-persist|line-20/);
    const replay = await executeApprovedAction(
      approval.id,
      runtimeOperationsConfig,
      executionDependencies,
    );
    assert.equal(replay.claimed, false);

    const envProof = await readTextFile(rootCeo.id, "env-proof.json");
    const childEnv = JSON.parse(envProof.content) as {
      secret: string | null;
      cwd: string;
      home: string;
      temp: string;
    };
    const expectedRoot = path.resolve(getSandboxRoot(rootCeo.id));
    assert.equal(childEnv.secret, null);
    assert.equal(path.resolve(childEnv.cwd), expectedRoot);
    assert.equal(path.resolve(childEnv.home), expectedRoot);
    assert.equal(path.resolve(childEnv.temp), expectedRoot);

    const [persisted] = await db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, approval.id));
    assert.equal(persisted.actionPayload, null);
    assert.equal(persisted.scope?.argsHash, argsHash);
    assert.equal(persisted.scope?.target, target.target);
    assert.match(persisted.scope?.preview ?? "", /sha256:/);
    assert.doesNotMatch(persisted.scope?.preview ?? "", /node -e/);

    const [completedTask] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    assert.equal(completedTask.status, "completed");
    assert.equal(completedTask.progressPercent, 100);
    assert.ok(completedTask.completedAt);
    assert.equal(
      completedTask.resultSummary,
      terminalMessage("tr", "approvedCompleted", {
        tool: "vm_run_sudo_command",
        exitCode: 0,
      }),
    );
    assert.doesNotMatch(
      completedTask.resultSummary ?? "",
      /operator-user|API_KEY|do-not-persist|line-20|node -e/,
    );

    const sudoEvents = await db
      .select()
      .from(activityEventsTable)
      .where(
        and(
          eq(activityEventsTable.agentId, rootCeo.id),
          eq(activityEventsTable.taskId, task.id),
        ),
      );
    const persistedTelemetry = JSON.stringify(sudoEvents);
    assert.doesNotMatch(persistedTelemetry, /node -e|do-not-persist|line-20/);
    assert.doesNotMatch(persistedTelemetry, /operator-user|API_KEY/);
    assert.match(persistedTelemetry, new RegExp(argsHash));
    const resolvedEvent = sudoEvents.find(
      (event) => event.type === "approval_resolved",
    );
    assert.equal(resolvedEvent?.detail?.taskDisposition, "complete");
    assert.equal(resolvedEvent?.detail?.outputStored, false);
    assert.equal(typeof resolvedEvent?.detail?.receiptId, "string");
    assert.equal(resolvedEvent?.detail?.stdoutPreview, undefined);

    const resumeSource = "resume-output 原文/متن/🧭";
    const resumeCommand = `node -e "const b=Buffer.from('resume-output 原文/متن/🧭');let i=0;const t=setInterval(()=>{if(i===b.length){clearInterval(t);return;}process.stdout.write(b.subarray(i,i+1));process.stderr.write(b.subarray(i,i+1));i++;},15)"`;
    const resumeHash = sudoArgsHash(resumeCommand);
    const [resumeTask] = await db
      .insert(tasksTable)
      .values({
        title: "Resume after approved sudo",
        brief: "The approved action is one step inside a larger task.",
        ownerAgentId: rootCeo.id,
        status: "awaiting_approval",
        createdByUser: true,
      })
      .returning();
    const [resumeApproval] = await db
      .insert(approvalRequestsTable)
      .values({
        taskId: resumeTask.id,
        agentId: rootCeo.id,
        category: "other",
        title: "CEO Host Shell resume",
        description: "Resume the parent workflow after this exact command.",
        status: "approved",
        resolvedAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60_000),
        scope: {
          toolName: "vm_run_sudo_command",
          argsHash: resumeHash,
          target: target.target,
          preview: resumeCommand,
        },
        // Deliberately omit taskDisposition to prove pre-upgrade payloads fail
        // safe to resume rather than completing an existing task.
        actionPayload: {
          toolName: "vm_run_sudo_command",
          args: { command: resumeCommand },
        },
      })
      .returning();
    const resumedExecution = await executeApprovedAction(
      resumeApproval.id,
      runtimeOperationsConfig,
      {
        ...executionDependencies,
        executeAction: async (ctx, name, args) => {
          const result = await executeTool(ctx, name, args);
          assert.equal(result.sudoOutcome?.stdoutPreview, resumeSource);
          assert.equal(result.sudoOutcome?.stderrPreview, resumeSource);
          return result;
        },
      },
    );
    assert.equal(resumedExecution.claimed, true);
    assert.match(resumedExecution.output ?? "", /resume-output/);
    const [resumedTask] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, resumeTask.id));
    assert.equal(resumedTask.status, "in_progress");
    assert.equal(resumedTask.resultSummary, null);

    const failureCommand = `node -e "process.exit(1)"`;
    const failureHash = sudoArgsHash(failureCommand);
    const [failureTask] = await db
      .insert(tasksTable)
      .values({
        title: "Failing sudo task",
        brief: "Nonzero exit must be recorded as failed.",
        ownerAgentId: rootCeo.id,
        status: "awaiting_approval",
        createdByUser: true,
      })
      .returning();
    const [failureApproval] = await db
      .insert(approvalRequestsTable)
      .values({
        taskId: failureTask.id,
        agentId: rootCeo.id,
        category: "other",
        title: "CEO Host Shell",
        description: "Expected failure",
        status: "approved",
        resolvedAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60_000),
        scope: {
          toolName: "vm_run_sudo_command",
          argsHash: failureHash,
          target: target.target,
          preview: failureCommand,
        },
        actionPayload: {
          toolName: "vm_run_sudo_command",
          args: { command: failureCommand },
          taskDisposition: "complete",
        },
      })
      .returning();
    const failedExecution = await executeApprovedAction(
      failureApproval.id,
      runtimeOperationsConfig,
      executionDependencies,
    );
    assert.equal(failedExecution.claimed, true);
    assert.equal(failedExecution.status, "failed");
    assert.ok(
      failedExecution.output?.startsWith(
        terminalMessage("tr", "approvedFailed", {
          tool: "vm_run_sudo_command",
          exitCode: 1,
        }),
      ),
    );
    const failureEvents = await db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, failureTask.id));
    const approvalFailureEvent = failureEvents.find(
      (event) => event.type === "approval_resolved",
    );
    assert.equal(approvalFailureEvent?.detail?.outcome, "failed");
    assert.equal(approvalFailureEvent?.detail?.exitCode, 1);
    assert.equal(
      failureEvents.find(
        (event) =>
          event.type === "vm_command" &&
          event.detail?.authority === "agent_sudo",
      )?.summary,
      terminalMessage("tr", "sudoFailed", { name: rootCeo.name }),
    );
    const [blockedFailureTask] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, failureTask.id));
    assert.equal(blockedFailureTask.status, "blocked");
    assert.match(blockedFailureTask.lastError ?? "", /exitCode=1/);

    const [unknownTask] = await db
      .insert(tasksTable)
      .values({
        title: "Interrupted approved action",
        brief: "A consumed action with no durable outcome must never replay.",
        ownerAgentId: rootCeo.id,
        status: "awaiting_approval",
        createdByUser: true,
        leaseOwner: "expired-approval-lease",
        leaseExpiresAt: new Date(Date.now() - 60_000),
      })
      .returning();
    await db.insert(approvalRequestsTable).values({
      taskId: unknownTask.id,
      agentId: rootCeo.id,
      category: "other",
      title: "Interrupted exact action",
      description: "The side effect outcome is unknown.",
      status: "approved",
      resolvedAt: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(Date.now() - 90_000),
      scope: {
        toolName: "vm_run_sudo_command",
        argsHash: sudoArgsHash("echo unknown"),
        target: target.target,
        preview: "TUKETILDI",
      },
      actionPayload: null,
    });
    const recoveryLocale = await readWorkspaceLocale();
    await reviveAndReleaseStaleWork();
    const [blockedUnknownTask] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, unknownTask.id));
    assert.equal(blockedUnknownTask.status, "blocked");
    assert.equal(
      blockedUnknownTask.lastError,
      terminalMessage(recoveryLocale, "approvedUnknown"),
    );
    const unknownEvents = await db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, unknownTask.id));
    assert.equal(
      unknownEvents.some(
        (event) =>
          event.type === "error" && event.detail?.replayBlocked === true,
      ),
      true,
    );

    const mismatchCommand = "echo affinity-mismatch";
    const [mismatchApproval] = await db
      .insert(approvalRequestsTable)
      .values({
        taskId: task.id,
        agentId: rootCeo.id,
        category: "other",
        title: "Wrong host",
        description: "Must not run",
        status: "approved",
        resolvedAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60_000),
        scope: {
          toolName: "vm_run_sudo_command",
          argsHash: sudoArgsHash(mismatchCommand),
          target: "host=other;cwd=/other",
        },
        actionPayload: {
          toolName: "vm_run_sudo_command",
          args: { command: mismatchCommand },
        },
      })
      .returning();
    const mismatch = await executeApprovedAction(
      mismatchApproval.id,
      runtimeOperationsConfig,
      executionDependencies,
    );
    assert.equal(mismatch.claimed, false);
    const [unconsumedMismatch] = await db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, mismatchApproval.id));
    assert.equal(unconsumedMismatch.consumedAt, null);

    await db
      .update(agentsTable)
      .set({
        permissions: { ...ceoPermissionsPreset, canUseSudo: false },
      })
      .where(eq(agentsTable.id, rootCeo.id));
    const revoked = await execAgentSudo({
      agentId: rootCeo.id,
      command: "echo must-not-run",
      approvalId: approval.id,
      leaseOwner: "forged-direct-call",
      argsHash: sudoArgsHash("echo must-not-run"),
    });
    assert.equal(revoked.note, "permission-denied");
  } finally {
    if (previousGate === undefined) delete process.env.ALLOW_AGENT_SUDO;
    else process.env.ALLOW_AGENT_SUDO = previousGate;
    if (previousSecret === undefined) delete process.env.TEST_PRIVATE_TOKEN;
    else process.env.TEST_PRIVATE_TOKEN = previousSecret;
  }
});
