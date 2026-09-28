import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  activityEventsTable,
  agentsTable,
  db,
  dbReady,
  operationInvocationsTable,
  operationReceiptsTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  tasksTable,
} from "@workspace/db";

process.env.AGENT_BROWSER_ALLOW_PRIVATE_NETWORKS = "true";
process.env.AGENT_BROWSER_HEADLESS = "true";

const [
  { executeTool, runDurableExternalEffect },
  browserRuntime,
  sandboxRuntime,
  { reviveAndReleaseStaleWorkCore },
  { getProjectOperations },
] = await Promise.all([
  import("./execute-tool"),
  import("../vm/browser"),
  import("../vm/sandbox"),
  import("./scheduler"),
  import("../operations/operations-read-model"),
]);

type ToolRuntimeContext = import("./execute-tool").ToolRuntimeContext;

function refFor(snapshotLines: string[], label: string): number {
  const line = snapshotLines.find((candidate) => candidate.includes(label));
  const match = line?.match(/\[ref=(\d+)\]/u);
  assert.ok(match, `snapshot must contain a ref for ${label}`);
  return Number(match[1]);
}

async function createFixture(): Promise<{
  context: ToolRuntimeContext;
  agentId: number;
  taskId: number;
  runtimeInstanceId: string;
  runtimeAttemptId: string;
  leaseOwner: string;
}> {
  await dbReady;
  const suffix = randomUUID();
  const now = new Date();
  const leaseOwner = `safe-link-click:${suffix}`;
  const runtimeInstanceId = `safe-link-runtime:${suffix}`;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Safe link ${suffix}`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: new Date(now.getTime() + 180_000),
      permissions: {
        canCreateSubAgents: false,
        canDelegate: false,
        canSpend: false,
        canDelete: false,
        canPublish: false,
        canContactExternal: false,
        canBrowse: true,
        canUseTerminal: false,
        canUseSudo: false,
      },
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: `Safe link receipt ${suffix}`,
      brief: "Persist one ordinary safe-link click before navigation.",
      ownerAgentId: agent.id,
      createdByUser: true,
      status: "in_progress",
      leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + 180_000),
      stepAttempts: 1,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, agent.id));
  await db.insert(runtimeInstancesTable).values({
    id: runtimeInstanceId,
    role: "worker",
    state: "healthy",
    hostname: "safe-link-click-test",
    processId: 4761,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: now,
  });
  const runtimeAttemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: runtimeAttemptId,
    taskId: task.id,
    agentId: agent.id,
    workerInstanceId: runtimeInstanceId,
    leaseOwner,
    attemptNumber: 1,
    cycleNumber: 0,
    state: "running",
    logicalExecutionId,
  });
  return {
    agentId: agent.id,
    taskId: task.id,
    runtimeInstanceId,
    runtimeAttemptId,
    leaseOwner,
    context: {
      agent,
      taskId: task.id,
      taskLeaseOwner: leaseOwner,
      runtimeAttemptId,
      assertTaskLease: async () => undefined,
      operationIdentity: {
        executionKind: "task_step",
        logicalExecutionId,
        runtimeInstanceId,
        originAttemptId: runtimeAttemptId,
        sourceMessageId: null,
        modelToolCallId: `safe-link-call:${suffix}`,
        callSlot: "round:0:tool:0",
        agentLeaseOwner: leaseOwner,
      },
    },
  };
}

test(
  "an ordinary safe-link click persists one bounded receipt and replays without navigating twice",
  { timeout: 90_000 },
  async (t) => {
    const fixture = await createFixture();
    const label = `safe-link-target-${randomUUID()}`;
    let targetRequests = 0;
    const server = createServer((request, response) => {
      if (request.url === "/target") targetRequests += 1;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        `<!doctype html><html><body><a href="/target">${label}</a></body></html>`,
      );
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const sourceUrl = `http://127.0.0.1:${address.port}/`;
    const targetUrl = `http://127.0.0.1:${address.port}/target`;

    t.after(async () => {
      await browserRuntime.closeSession(fixture.agentId).catch(() => undefined);
      const { closeBrowserEgressProxy } =
        await import("../vm/browser-egress-proxy");
      await closeBrowserEgressProxy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await fsp.rm(sandboxRuntime.getSandboxRoot(fixture.agentId), {
        recursive: true,
        force: true,
      });
    });

    await browserRuntime.navigateTo(fixture.agentId, sourceUrl);
    const firstSnapshot = await browserRuntime.snapshotPage(fixture.agentId);
    const ref = refFor(firstSnapshot.lines, label);
    const first = await executeTool(
      fixture.context,
      "browser_click",
      JSON.stringify({ ref }),
    );
    const replay = await executeTool(
      fixture.context,
      "browser_click",
      JSON.stringify({ ref }),
    );

    assert.equal(first.toolOutcome, "succeeded");
    assert.ok(first.receiptId);
    assert.equal(replay.toolOutcome, "succeeded");
    assert.equal(replay.receiptId, first.receiptId);
    assert.equal(targetRequests, 1);

    const [[receipt], invocations, events] = await Promise.all([
      db
        .select()
        .from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.id, first.receiptId!)),
      db
        .select()
        .from(operationInvocationsTable)
        .where(eq(operationInvocationsTable.receiptId, first.receiptId!)),
      db
        .select()
        .from(activityEventsTable)
        .where(
          and(
            eq(activityEventsTable.agentId, fixture.agentId),
            eq(activityEventsTable.taskId, fixture.taskId),
          ),
        ),
    ]);
    assert.equal(receipt.state, "succeeded");
    assert.equal(receipt.executionKind, "task_step");
    assert.equal(receipt.toolName, "browser_click");
    assert.equal(invocations.length, 1);
    assert.equal(invocations[0]!.state, "succeeded");
    const durableText = JSON.stringify({ receipt, events });
    assert.equal(durableText.includes(label), false);
    assert.equal(durableText.includes(sourceUrl), false);
    assert.equal(durableText.includes(targetUrl), false);
  },
);

test(
  "a worker loss after an ordinary safe-link effect starts becomes reconcilable unknown and cannot navigate again",
  { timeout: 90_000 },
  async (t) => {
    const fixture = await createFixture();
    const label = `crash-safe-link-${randomUUID()}`;
    let targetRequests = 0;
    let signalTargetStarted!: () => void;
    const targetStarted = new Promise<void>((resolve) => {
      signalTargetStarted = resolve;
    });
    let releaseTarget!: () => void;
    const targetRelease = new Promise<void>((resolve) => {
      releaseTarget = resolve;
    });
    const server = createServer((request, response) => {
      if (request.url === "/target") {
        targetRequests += 1;
        signalTargetStarted();
        void targetRelease.then(() => {
          response.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
          });
          response.end("<!doctype html><html><body>target</body></html>");
        });
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        `<!doctype html><html><body><a href="/target">${label}</a></body></html>`,
      );
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const sourceUrl = `http://127.0.0.1:${address.port}/`;
    const targetUrl = `http://127.0.0.1:${address.port}/target`;

    t.after(async () => {
      releaseTarget();
      await browserRuntime.closeSession(fixture.agentId).catch(() => undefined);
      const { closeBrowserEgressProxy } =
        await import("../vm/browser-egress-proxy");
      await closeBrowserEgressProxy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fsp.rm(sandboxRuntime.getSandboxRoot(fixture.agentId), {
        recursive: true,
        force: true,
      });
    });

    await browserRuntime.navigateTo(fixture.agentId, sourceUrl);
    const snapshot = await browserRuntime.snapshotPage(fixture.agentId);
    const ref = refFor(snapshot.lines, label);
    const firstExecution = executeTool(
      fixture.context,
      "browser_click",
      JSON.stringify({ ref }),
    );
    void firstExecution.catch(() => undefined);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        targetStarted,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("safe-link navigation did not start")),
            15_000,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    const [runningReceipt] = await db
      .select()
      .from(operationReceiptsTable)
      .where(
        and(
          eq(operationReceiptsTable.taskId, fixture.taskId),
          eq(operationReceiptsTable.toolName, "browser_click"),
        ),
      );
    assert.ok(runningReceipt);
    assert.equal(runningReceipt.state, "running");
    const [runningInvocation] = await db
      .select()
      .from(operationInvocationsTable)
      .where(eq(operationInvocationsTable.receiptId, runningReceipt.id));
    assert.ok(runningInvocation?.effectStartedAt);
    assert.equal(runningInvocation.state, "running");

    const staleAt = new Date(Date.now() - 120_000);
    await db
      .update(runtimeInstancesTable)
      .set({ state: "stale", lastHeartbeatAt: staleAt })
      .where(eq(runtimeInstancesTable.id, fixture.runtimeInstanceId));
    await db
      .update(agentsTable)
      .set({ runLeaseExpiresAt: staleAt })
      .where(eq(agentsTable.id, fixture.agentId));
    await db
      .update(tasksTable)
      .set({ leaseExpiresAt: staleAt })
      .where(eq(tasksTable.id, fixture.taskId));
    await db
      .update(operationInvocationsTable)
      .set({ leaseExpiresAt: staleAt })
      .where(eq(operationInvocationsTable.id, runningInvocation.id));

    await reviveAndReleaseStaleWorkCore(60_000);

    const [
      [unknownReceipt],
      [unknownInvocation],
      [blockedTask],
      [blockedAttempt],
    ] = await Promise.all([
      db
        .select()
        .from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.id, runningReceipt.id)),
      db
        .select()
        .from(operationInvocationsTable)
        .where(eq(operationInvocationsTable.id, runningInvocation.id)),
      db.select().from(tasksTable).where(eq(tasksTable.id, fixture.taskId)),
      db
        .select()
        .from(taskAttemptsTable)
        .where(eq(taskAttemptsTable.id, fixture.runtimeAttemptId)),
    ]);
    assert.equal(unknownReceipt.state, "unknown");
    assert.equal(unknownInvocation.state, "unknown");
    assert.equal(blockedTask.status, "blocked");
    assert.equal(blockedTask.blockedReason, "operation_outcome_unknown");
    assert.equal(blockedTask.nextAttemptAt, null);
    assert.equal(blockedAttempt.state, "blocked");

    let replayedEffectCalls = 0;
    const destinationHash = `sha256:${createHash("sha256")
      .update(targetUrl)
      .digest("hex")}`;
    const replay = await runDurableExternalEffect(fixture.context, {
      toolName: "browser_click",
      normalizedArgs: { bindingRef: ref, destinationHash },
      execute: async ({ startEffect }) => {
        replayedEffectCalls += 1;
        await startEffect();
        return {
          result: {
            content: "must not execute",
            createdTasks: [],
            createdAgents: [],
            toolOutcome: "succeeded",
          },
          resultData: { ok: true },
        };
      },
      onError: async () => ({
        content: "must not fail",
        createdTasks: [],
        createdAgents: [],
        toolOutcome: "rejected",
      }),
    });
    assert.equal(replay.toolOutcome, "unknown");
    assert.equal(replay.receiptId, runningReceipt.id);
    assert.equal(replayedEffectCalls, 0);
    assert.equal(targetRequests, 1);

    const project = await getProjectOperations({
      rootTaskId: fixture.taskId,
      now: new Date(),
    });
    const projectReceipt = project.receipts.find(
      (receipt) => receipt.id === runningReceipt.id,
    );
    assert.ok(projectReceipt);
    assert.equal(projectReceipt.state, "unknown");
    assert.equal(projectReceipt.reconciliation.eligible, true);
    assert.equal(projectReceipt.reconciliation.decision, null);

    releaseTarget();
    const first = await firstExecution;
    assert.equal(first.toolOutcome, "unknown");
    assert.equal(first.receiptId, runningReceipt.id);
    assert.equal(targetRequests, 1);
    const events = await db
      .select()
      .from(activityEventsTable)
      .where(
        and(
          eq(activityEventsTable.agentId, fixture.agentId),
          eq(activityEventsTable.taskId, fixture.taskId),
        ),
      );
    const durableText = JSON.stringify({ unknownReceipt, events });
    assert.equal(durableText.includes(label), false);
    assert.equal(durableText.includes(sourceUrl), false);
    assert.equal(durableText.includes(targetUrl), false);
  },
);
