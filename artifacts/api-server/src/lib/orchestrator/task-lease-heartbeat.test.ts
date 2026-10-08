import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { and, eq } from "drizzle-orm";
import type { createChatCompletion } from "@workspace/ai-server";
import {
  activityEventsTable,
  agentsTable,
  approvalRequestsTable,
  db,
  dbReady,
  operationInvocationsTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  tasksTable,
  usageEventsTable,
} from "@workspace/db";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import {
  registerRuntimeInstance,
  type RuntimeInstanceHandle,
} from "./runtime-instance-registry";
import { claimDueTasks, reviveAndReleaseStaleWork } from "./scheduler";
import {
  claimOperationInvocation,
  reserveOperation,
} from "./operation-receipts";
import { stepTask } from "./step-task";
import type { ToolRuntimeContext } from "./execute-tool";
import {
  startTaskLeaseHeartbeat,
  TaskLeaseOwnershipLostError,
} from "./task-lease-heartbeat";

type TimerCallback = () => void | Promise<void>;

interface ManualTimer {
  callback: TimerCallback;
  delayMs: number;
  cleared: boolean;
  fired: boolean;
  unrefCalled: boolean;
  unref(): ManualTimer;
}

function createManualClock(initialNow = new Date()) {
  let currentTimeMs = initialNow.getTime();
  const timers: ManualTimer[] = [];
  const runtime = {
    now: () => new Date(currentTimeMs),
    setTimeout(callback: TimerCallback, delayMs: number): ManualTimer {
      const timer: ManualTimer = {
        callback,
        delayMs,
        cleared: false,
        fired: false,
        unrefCalled: false,
        unref() {
          timer.unrefCalled = true;
          return timer;
        },
      };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer: ManualTimer): void {
      timer.cleared = true;
    },
  };

  return {
    runtime,
    timers,
    now: runtime.now,
    pendingTimers(delayMs?: number): ManualTimer[] {
      return timers.filter(
        (timer) =>
          !timer.cleared &&
          !timer.fired &&
          (delayMs === undefined || timer.delayMs === delayMs),
      );
    },
    beginNext(delayMs: number): {
      timer: ManualTimer;
      completion: Promise<void>;
    } {
      const timer = this.pendingTimers(delayMs)[0];
      assert.ok(timer, `expected a pending ${delayMs}ms timer`);
      timer.fired = true;
      currentTimeMs += timer.delayMs;
      return {
        timer,
        completion: Promise.resolve(timer.callback()).then(() => undefined),
      };
    },
    async fireNext(delayMs: number): Promise<ManualTimer> {
      const { timer, completion } = this.beginNext(delayMs);
      await completion;
      return timer;
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

const workerConfig = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });

function configureTestProvider(t: TestContext): void {
  const previousKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const previousUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "task-heartbeat-test-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  t.after(() => {
    if (previousKey === undefined)
      delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = previousKey;
    if (previousUrl === undefined)
      delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = previousUrl;
  });
}

async function registerWorker(
  t: TestContext,
  clock: ReturnType<typeof createManualClock>,
): Promise<RuntimeInstanceHandle> {
  const handle = await registerRuntimeInstance(
    {
      role: "worker",
      schedulerEnabled: true,
      capabilities: { scheduler: true },
      buildVersion: `task-heartbeat-test-${randomUUID()}`,
    },
    workerConfig,
    clock.runtime,
  );
  t.after(() => handle.stopHeartbeat());
  return handle;
}

async function createClaimedTask(
  t: TestContext,
  input: {
    name: string;
    clock?: ReturnType<typeof createManualClock>;
    autonomyMode?: "finite" | "continuous";
  },
) {
  await dbReady;
  const clock = input.clock ?? createManualClock();
  const runtime = await registerWorker(t, clock);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `${input.name} agent`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: input.name,
      brief: "Exercise durable task attempt ownership.",
      ownerAgentId: agent.id,
      status: "pending",
      autonomyMode: input.autonomyMode ?? "finite",
      cadenceSeconds: input.autonomyMode === "continuous" ? 60 : undefined,
      createdByUser: true,
    })
    .returning();
  t.after(async () => {
    await db
      .update(tasksTable)
      .set({
        status: "cancelled",
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(eq(tasksTable.id, task.id));
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

  const claimed = (await claimDueTasks(runtime, workerConfig)).find(
    (candidate) => candidate.id === task.id,
  );
  assert.ok(claimed, `task ${task.id} should be claimed`);
  return { agent, task, claimed, runtime, clock };
}

function lifecycleCompletion(
  model: string,
  toolName = "request_user_input",
): Awaited<ReturnType<typeof createChatCompletion>> {
  return {
    provider: "replit",
    completion: {
      id: randomUUID(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1_000),
      model,
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          logprobs: null,
          message: {
            role: "assistant",
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: randomUUID(),
                type: "function",
                function: {
                  name: toolName,
                  arguments: JSON.stringify({ question: "Continue?" }),
                },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 2,
        total_tokens: 5,
      },
    },
  };
}

function suspendedToolResult() {
  return {
    content: "User input requested.",
    createdTasks: [],
    createdAgents: [],
    toolOutcome: "succeeded" as const,
    taskLifecycleEffect: "suspended" as const,
  };
}

test("claim atomically owns the task, agent, and one durable attempt", async (t) => {
  await dbReady;
  const clock = createManualClock();
  const runtime = await registerWorker(t, clock);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Atomic attempt owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Atomic attempt claim",
      brief: "Every claim write must share one owner or roll back.",
      ownerAgentId: agent.id,
      status: "pending",
      createdByUser: true,
    })
    .returning();
  t.after(async () => {
    await db
      .update(tasksTable)
      .set({ status: "cancelled", leaseOwner: null, leaseExpiresAt: null })
      .where(eq(tasksTable.id, task.id));
    await db
      .update(agentsTable)
      .set({ isActive: false, status: "archived" })
      .where(eq(agentsTable.id, agent.id));
  });

  const claimed = (await claimDueTasks(runtime, workerConfig)).find(
    (candidate) => candidate.id === task.id,
  );
  assert.ok(claimed);
  assert.equal(typeof claimed.runtimeAttemptId, "string");
  assert.equal(claimed.runtimeInstanceId, runtime.id);
  assert.ok(claimed.leaseOwner);

  const [[persistedTask], [persistedAgent], [attempt]] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
    db.select().from(agentsTable).where(eq(agentsTable.id, agent.id)),
    db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, claimed.runtimeAttemptId)),
  ]);
  assert.equal(persistedTask.leaseOwner, claimed.leaseOwner);
  assert.equal(persistedAgent.runLeaseOwner, claimed.leaseOwner);
  assert.equal(attempt.leaseOwner, claimed.leaseOwner);
  assert.equal(attempt.workerInstanceId, runtime.id);
  assert.equal(attempt.state, "claimed");
  assert.equal(attempt.attemptNumber, 1);

  const brokenRuntime = await registerWorker(t, clock);
  await brokenRuntime.stopHeartbeat();
  await db
    .delete(runtimeInstancesTable)
    .where(eq(runtimeInstancesTable.id, brokenRuntime.id));
  const [rollbackAgent] = await db
    .insert(agentsTable)
    .values({
      name: "Rollback attempt owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [rollbackTask] = await db
    .insert(tasksTable)
    .values({
      title: "Rollback attempt claim",
      brief: "A missing worker FK must roll back task and agent ownership.",
      ownerAgentId: rollbackAgent.id,
      status: "pending",
      createdByUser: true,
    })
    .returning();

  await assert.rejects(claimDueTasks(brokenRuntime, workerConfig));
  const [[rolledBackTask], [rolledBackAgent], rolledBackAttempts] =
    await Promise.all([
      db.select().from(tasksTable).where(eq(tasksTable.id, rollbackTask.id)),
      db.select().from(agentsTable).where(eq(agentsTable.id, rollbackAgent.id)),
      db
        .select()
        .from(taskAttemptsTable)
        .where(eq(taskAttemptsTable.taskId, rollbackTask.id)),
    ]);
  assert.equal(rolledBackTask.leaseOwner, null);
  assert.equal(rolledBackTask.stepAttempts, 0);
  assert.equal(rolledBackAgent.runLeaseOwner, null);
  assert.equal(rolledBackAgent.status, "idle");
  assert.equal(rolledBackAttempts.length, 0);
});

test("task heartbeat resumes an attached invocation after repeated transient persistence failures", async (t) => {
  const fixture = await createClaimedTask(t, {
    name: "Attached operation heartbeat",
  });
  await db
    .update(runtimeInstancesTable)
    .set({ state: "healthy" })
    .where(eq(runtimeInstancesTable.id, fixture.claimed.runtimeInstanceId));
  const now = fixture.clock.now();
  const reservation = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "task_step",
    logicalExecutionId: fixture.claimed.logicalExecutionId,
    toolName: "vm_write_file",
    args: {
      pathHash: `sha256:${"1".repeat(64)}`,
      contentHash: `sha256:${"2".repeat(64)}`,
      byteCount: 4,
    },
    physical: {
      attemptId: fixture.claimed.runtimeAttemptId,
      workerInstanceId: fixture.claimed.runtimeInstanceId,
      modelToolCallId: "attached-heartbeat-call",
      callSlot: "round:0:tool:0",
    },
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: fixture.claimed.runtimeAttemptId,
    sideEffectClass: "idempotent",
  });
  const invocationLeaseOwner = `operation:${randomUUID()}`;
  const initialExpiry = new Date(now.getTime() + 1_000);
  const claim = await claimOperationInvocation({
    receiptId: reservation.receipt.id,
    executionKind: "task_step",
    attemptId: fixture.claimed.runtimeAttemptId,
    workerInstanceId: fixture.claimed.runtimeInstanceId,
    modelToolCallId: "attached-heartbeat-call",
    leaseOwner: invocationLeaseOwner,
    leaseExpiresAt: initialExpiry,
    taskLeaseOwner: fixture.claimed.leaseOwner,
    agentLeaseOwner: fixture.claimed.leaseOwner,
    now,
  });
  assert.ok(claim.invocation);

  const heartbeat = startTaskLeaseHeartbeat({
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    attemptId: fixture.claimed.runtimeAttemptId,
    leaseOwner: fixture.claimed.leaseOwner,
    config: workerConfig,
    runtime: fixture.clock.runtime,
  });
  heartbeat.attachOperationInvocation({
    receiptId: reservation.receipt.id,
    invocationId: claim.invocation.id,
    leaseOwner: invocationLeaseOwner,
    workerInstanceId: fixture.claimed.runtimeInstanceId,
  });
  t.after(() => heartbeat.stop());

  await fixture.clock.fireNext(workerConfig.taskHeartbeatMs);
  const [firstRenewal] = await db
    .select()
    .from(operationInvocationsTable)
    .where(eq(operationInvocationsTable.id, claim.invocation.id));
  assert.ok(firstRenewal.leaseExpiresAt.getTime() > initialExpiry.getTime());
  assert.equal(
    firstRenewal.lastHeartbeatAt.getTime(),
    fixture.clock.now().getTime(),
  );

  const mutableDb = db as typeof db & { transaction: typeof db.transaction };
  const originalTransaction = mutableDb.transaction;
  let databaseUnavailable = true;
  let failedTransactions = 0;
  mutableDb.transaction = ((...args: unknown[]) => {
    if (databaseUnavailable) {
      failedTransactions += 1;
      return Promise.reject(
        new Error("synthetic attached invocation persistence outage"),
      );
    }
    return (originalTransaction as (...values: unknown[]) => unknown).apply(
      db,
      args,
    );
  }) as typeof db.transaction;

  try {
    for (let failure = 0; failure < 3; failure += 1) {
      await fixture.clock.fireNext(workerConfig.taskHeartbeatMs);
      assert.equal(
        fixture.clock.pendingTimers(workerConfig.taskHeartbeatMs).length,
        1,
        "a transient persistence error must keep one same-cadence retry",
      );
    }
    assert.equal(failedTransactions, 3);
    await assert.rejects(
      heartbeat.assertOwned("Kesinti sırasında sahipliği doğrula"),
      TaskLeaseOwnershipLostError,
    );
    assert.equal(failedTransactions, 4);

    databaseUnavailable = false;
    await fixture.clock.fireNext(workerConfig.taskHeartbeatMs);
    const [recoveredRenewal] = await db
      .select()
      .from(operationInvocationsTable)
      .where(eq(operationInvocationsTable.id, claim.invocation.id));
    assert.ok(
      recoveredRenewal.leaseExpiresAt.getTime() >
        firstRenewal.leaseExpiresAt.getTime(),
    );
    assert.equal(
      recoveredRenewal.lastHeartbeatAt.getTime(),
      fixture.clock.now().getTime(),
    );
    await heartbeat.assertOwned("Kesinti sonrası sahipliği doğrula");
  } finally {
    mutableDb.transaction = originalTransaction;
  }

  heartbeat.detachOperationInvocation(claim.invocation.id);
});

test("two deterministic heartbeat ticks renew task, agent, and running attempt during a provider delay", async (t) => {
  configureTestProvider(t);
  const fixture = await createClaimedTask(t, {
    name: "Deferred provider heartbeat",
  });
  const providerStarted = createDeferred<void>();
  const providerResult =
    createDeferred<Awaited<ReturnType<typeof createChatCompletion>>>();
  let selectedModel: string | undefined;
  let dispatchedTools = 0;
  let dispatchedContext: ToolRuntimeContext | undefined;
  const createCompletion: typeof createChatCompletion = async (params) => {
    selectedModel = params.model;
    providerStarted.resolve();
    return providerResult.promise.then((result) => ({
      ...result,
      completion: { ...result.completion, model: params.model },
    }));
  };
  const dependencies = {
    createCompletion,
    runTool: async (context: ToolRuntimeContext) => {
      dispatchedTools++;
      dispatchedContext = context;
      return suspendedToolResult();
    },
    leaseHeartbeatRuntime: fixture.clock.runtime,
    runtimeOperationsConfig: workerConfig,
  };
  const stepping = stepTask(fixture.claimed, dependencies);

  try {
    await providerStarted.promise;
    assert.equal(fixture.clock.pendingTimers(15_000).length, 1);
    await fixture.clock.fireNext(15_000);
    await fixture.clock.fireNext(15_000);

    const [[task], [agent], [attempt]] = await Promise.all([
      db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
      db.select().from(agentsTable).where(eq(agentsTable.id, fixture.agent.id)),
      db
        .select()
        .from(taskAttemptsTable)
        .where(eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId)),
    ]);
    assert.equal(attempt.state, "running");
    assert.equal(
      task.leaseExpiresAt?.getTime(),
      fixture.clock.now().getTime() + workerConfig.taskLeaseMs,
    );
    assert.equal(
      agent.runLeaseExpiresAt?.getTime(),
      task.leaseExpiresAt?.getTime(),
    );
    assert.equal(
      attempt.lastHeartbeatAt.getTime(),
      fixture.clock.now().getTime(),
    );
  } finally {
    providerResult.resolve(lifecycleCompletion("test-model"));
    await stepping;
  }
  assert.equal(dispatchedTools, 1);
  assert.ok(dispatchedContext);
  assert.equal(dispatchedContext.turnModelId, selectedModel);
  assert.equal(
    dispatchedContext.runtimeAttemptId,
    fixture.claimed.runtimeAttemptId,
  );
});

test("provider completion during a persistence outage stays fail closed", async (t) => {
  configureTestProvider(t);
  const fixture = await createClaimedTask(t, {
    name: "Heartbeat failure circuit",
  });
  const providerStarted = createDeferred<void>();
  const providerResult =
    createDeferred<Awaited<ReturnType<typeof createChatCompletion>>>();
  const createCompletion: typeof createChatCompletion = async (params) => {
    providerStarted.resolve();
    return providerResult.promise.then((result) => ({
      ...result,
      completion: { ...result.completion, model: params.model },
    }));
  };
  let toolCalls = 0;
  const dependencies = {
    createCompletion,
    runTool: async () => {
      toolCalls += 1;
      return suspendedToolResult();
    },
    leaseHeartbeatRuntime: fixture.clock.runtime,
    runtimeOperationsConfig: workerConfig,
  };
  const stepping = stepTask(fixture.claimed, dependencies);
  await providerStarted.promise;

  const [eventsBefore, approvalsBefore] = await Promise.all([
    db
      .select({ id: activityEventsTable.id })
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, fixture.task.id)),
    db
      .select({ id: approvalRequestsTable.id })
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.taskId, fixture.task.id)),
  ]);

  const mutableDb = db as typeof db & { transaction: typeof db.transaction };
  const originalTransaction = mutableDb.transaction;
  let failedTransactions = 0;
  mutableDb.transaction = (() => {
    failedTransactions += 1;
    return Promise.reject(new Error("synthetic heartbeat persistence outage"));
  }) as typeof db.transaction;
  try {
    await fixture.clock.fireNext(15_000);
    await fixture.clock.fireNext(15_000);
    await fixture.clock.fireNext(15_000);
    assert.equal(fixture.clock.pendingTimers(15_000).length, 1);
    providerResult.resolve(
      lifecycleCompletion("test-model", "request_approval"),
    );
    await stepping;
  } finally {
    mutableDb.transaction = originalTransaction;
    providerResult.resolve(
      lifecycleCompletion("test-model", "request_approval"),
    );
    await stepping;
  }
  assert.ok(
    failedTransactions > 3,
    "the provider boundary must recheck ownership while persistence is unavailable",
  );
  assert.equal(fixture.clock.pendingTimers(15_000).length, 0);

  const [[task], [attempt], usage, eventsAfter, approvalsAfter] =
    await Promise.all([
      db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
      db
        .select()
        .from(taskAttemptsTable)
        .where(eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId)),
      db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.taskId, fixture.task.id)),
      db
        .select({ id: activityEventsTable.id })
        .from(activityEventsTable)
        .where(eq(activityEventsTable.taskId, fixture.task.id)),
      db
        .select({ id: approvalRequestsTable.id })
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.taskId, fixture.task.id)),
    ]);
  assert.equal(toolCalls, 0);
  assert.equal(usage.length, 1);
  assert.equal(task.tokensUsed, 0);
  assert.equal(task.leaseOwner, fixture.claimed.leaseOwner);
  assert.equal(attempt.state, "running");
  assert.deepEqual(eventsAfter, eventsBefore);
  assert.deepEqual(approvalsAfter, approvalsBefore);
});

test("revoking the exact owner after provider completion prevents the injected tool runner", async (t) => {
  configureTestProvider(t);
  const fixture = await createClaimedTask(t, {
    name: "Revoke before tool",
  });
  let toolCalls = 0;
  const replacementOwner = `replacement:${randomUUID()}`;
  const createCompletion: typeof createChatCompletion = async (params) => {
    await db
      .update(tasksTable)
      .set({ leaseOwner: replacementOwner })
      .where(eq(tasksTable.id, fixture.task.id));
    await db
      .update(agentsTable)
      .set({ runLeaseOwner: replacementOwner })
      .where(eq(agentsTable.id, fixture.agent.id));
    return lifecycleCompletion(params.model, "browser_click");
  };

  await stepTask(fixture.claimed, {
    createCompletion,
    runTool: async () => {
      toolCalls += 1;
      return suspendedToolResult();
    },
    leaseHeartbeatRuntime: fixture.clock.runtime,
    runtimeOperationsConfig: workerConfig,
  });

  const [[task], [attempt]] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
    db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId)),
  ]);
  assert.equal(toolCalls, 0);
  assert.equal(task.leaseOwner, replacementOwner);
  assert.equal(attempt.state, "lost");
  assert.equal(attempt.failureKind, "lease_lost");
});

test("step shutdown awaits an in-flight renewal, clears its unref'd timer, and cannot reschedule", async (t) => {
  configureTestProvider(t);
  const fixture = await createClaimedTask(t, {
    name: "Heartbeat stop serialization",
  });
  const providerStarted = createDeferred<void>();
  const providerResult =
    createDeferred<Awaited<ReturnType<typeof createChatCompletion>>>();
  const createCompletion: typeof createChatCompletion = async (params) => {
    providerStarted.resolve();
    return providerResult.promise.then((result) => ({
      ...result,
      completion: { ...result.completion, model: params.model },
    }));
  };
  const dependencies = {
    createCompletion,
    runTool: async () => suspendedToolResult(),
    leaseHeartbeatRuntime: fixture.clock.runtime,
    runtimeOperationsConfig: workerConfig,
  };
  const order: string[] = [];
  let stepSettled = false;
  const stepping = stepTask(fixture.claimed, dependencies).then(() => {
    stepSettled = true;
    order.push("step");
  });
  await providerStarted.promise;

  const mutableDb = db as typeof db & { transaction: typeof db.transaction };
  const originalTransaction = mutableDb.transaction;
  const renewalStarted = createDeferred<void>();
  const releaseRenewal = createDeferred<void>();
  let interceptNext = true;
  mutableDb.transaction = ((...args: unknown[]) => {
    if (!interceptNext) {
      return (originalTransaction as (...values: unknown[]) => unknown).apply(
        db,
        args,
      );
    }
    interceptNext = false;
    renewalStarted.resolve();
    return releaseRenewal.promise.then(() =>
      (originalTransaction as (...values: unknown[]) => unknown).apply(
        db,
        args,
      ),
    );
  }) as typeof db.transaction;

  let tick: { timer: ManualTimer; completion: Promise<void> } | undefined;
  try {
    tick = fixture.clock.beginNext(15_000);
    await renewalStarted.promise;
    providerResult.resolve(lifecycleCompletion("test-model"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(stepSettled, false);
    releaseRenewal.resolve();
    await tick.completion;
    order.push("renewal");
  } finally {
    mutableDb.transaction = originalTransaction;
    releaseRenewal.resolve();
    providerResult.resolve(lifecycleCompletion("test-model"));
  }
  assert.ok(tick);
  await stepping;
  assert.equal(tick.timer.unrefCalled, true);
  assert.deepEqual(order, ["renewal", "step"]);
  assert.equal(fixture.clock.pendingTimers(15_000).length, 0);

  const timerCount = fixture.clock.timers.length;
  const clearedTaskTimers = fixture.clock.timers.filter(
    (timer) => timer.delayMs === 15_000 && timer.cleared,
  );
  assert.ok(clearedTaskTimers.length >= 1);
  for (const timer of clearedTaskTimers) await timer.callback();
  assert.equal(fixture.clock.timers.length, timerCount);
  assert.equal(fixture.clock.pendingTimers(15_000).length, 0);
});

test("heartbeat stop awaits exact ownership-loss persistence after a failed renewal", async (t) => {
  const fixture = await createClaimedTask(t, {
    name: "Ownership loss persistence serialization",
  });
  await db
    .update(taskAttemptsTable)
    .set({ state: "running" })
    .where(eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId));
  await db
    .update(tasksTable)
    .set({ leaseOwner: `replacement:${randomUUID()}` })
    .where(eq(tasksTable.id, fixture.task.id));

  const heartbeat = startTaskLeaseHeartbeat({
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    attemptId: fixture.claimed.runtimeAttemptId,
    leaseOwner: fixture.claimed.leaseOwner,
    config: workerConfig,
    runtime: fixture.clock.runtime,
  });
  const mutableDb = db as typeof db & { transaction: typeof db.transaction };
  const originalTransaction = mutableDb.transaction;
  const persistenceStarted = createDeferred<void>();
  const releasePersistence = createDeferred<void>();
  let transactionCalls = 0;
  mutableDb.transaction = ((...args: unknown[]) => {
    transactionCalls += 1;
    if (transactionCalls === 1) {
      return (originalTransaction as (...values: unknown[]) => unknown).apply(
        db,
        args,
      );
    }
    persistenceStarted.resolve();
    return releasePersistence.promise.then(() =>
      (originalTransaction as (...values: unknown[]) => unknown).apply(
        db,
        args,
      ),
    );
  }) as typeof db.transaction;

  const tick = fixture.clock.beginNext(workerConfig.taskHeartbeatMs);
  try {
    await persistenceStarted.promise;
    let stopped = false;
    const stopping = heartbeat.stop().then(() => {
      stopped = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(
      stopped,
      false,
      "stop must include the failure-persistence promise, not only renewal tail",
    );
    releasePersistence.resolve();
    await tick.completion;
    await stopping;
  } finally {
    mutableDb.transaction = originalTransaction;
    releasePersistence.resolve();
    await heartbeat.stop();
  }
  const [attempt] = await db
    .select()
    .from(taskAttemptsTable)
    .where(eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId));
  assert.equal(attempt.state, "lost");
});

test("expired recovery loses only the matching attempt and links the next claim", async (t) => {
  const fixture = await createClaimedTask(t, {
    name: "Attempt-aware expired recovery",
  });
  const expiredAt = new Date(Date.now() - 60_000);
  const replacementOwner = `new-owner:${randomUUID()}`;
  const replacementExpiry = new Date(Date.now() + 60_000);
  await db
    .update(taskAttemptsTable)
    .set({ state: "running" })
    .where(eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId));
  const shadowAttemptId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: shadowAttemptId,
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    workerInstanceId: fixture.runtime.id,
    leaseOwner: `shadow:${randomUUID()}`,
    attemptNumber: 99,
    cycleNumber: 0,
    state: "claimed",
  });
  await db
    .update(tasksTable)
    .set({
      leaseExpiresAt: expiredAt,
      lastSteppedAt: new Date(Date.now() - 10_000),
    })
    .where(eq(tasksTable.id, fixture.task.id));
  await db
    .update(agentsTable)
    .set({
      runLeaseOwner: replacementOwner,
      runLeaseExpiresAt: replacementExpiry,
    })
    .where(eq(agentsTable.id, fixture.agent.id));

  await reviveAndReleaseStaleWork();

  const [[recovered], [agentAfterRecovery], [oldAttempt], [shadowAttempt]] =
    await Promise.all([
      db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
      db.select().from(agentsTable).where(eq(agentsTable.id, fixture.agent.id)),
      db
        .select()
        .from(taskAttemptsTable)
        .where(eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId)),
      db
        .select()
        .from(taskAttemptsTable)
        .where(eq(taskAttemptsTable.id, shadowAttemptId)),
    ]);
  assert.equal(recovered.leaseOwner, null);
  assert.equal(recovered.recoveryCount, 1);
  assert.ok(recovered.nextAttemptAt);
  assert.equal(oldAttempt.state, "lost");
  assert.equal(oldAttempt.failureKind, "lease_expired");
  assert.equal(shadowAttempt.state, "claimed");
  assert.equal(agentAfterRecovery.runLeaseOwner, replacementOwner);
  assert.equal(
    agentAfterRecovery.runLeaseExpiresAt?.getTime(),
    replacementExpiry.getTime(),
  );

  await db
    .update(agentsTable)
    .set({
      status: "idle",
      runLeaseOwner: null,
      runLeaseExpiresAt: null,
      currentTaskId: null,
      currentAction: null,
    })
    .where(eq(agentsTable.id, fixture.agent.id));
  const nextClaim = (await claimDueTasks(fixture.runtime, workerConfig)).find(
    (candidate) => candidate.id === fixture.task.id,
  );
  assert.ok(nextClaim);
  const [nextAttempt] = await db
    .select()
    .from(taskAttemptsTable)
    .where(
      and(
        eq(taskAttemptsTable.id, nextClaim.runtimeAttemptId),
        eq(
          taskAttemptsTable.recoveryOfAttemptId,
          fixture.claimed.runtimeAttemptId,
        ),
      ),
    );
  assert.ok(nextAttempt);
  assert.equal(nextAttempt.attemptNumber, 2);
});
