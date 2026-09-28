import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  agentsTable,
  db,
  dbReady,
  operationReceiptsTable,
  projectMembersTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  tasksTable,
} from "@workspace/db";
import { classifyRecoverableModelError } from "../orchestrator/model-fallback";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import {
  executeTool,
  type ToolRuntimeContext,
} from "../orchestrator/execute-tool";
import { getToolsForAgent } from "../orchestrator/tools";
import {
  createSyntheticCompletion,
  SYNTHETIC_FIXTURE_TOOL_NAME,
  type SyntheticDelegation,
} from "./synthetic-completion";
import {
  createSyntheticFaultPlan,
  createSyntheticFaultControlWriter,
  createFileBackedSyntheticFaultSource,
  parseSyntheticFaultPlan,
  parseSyntheticSeed,
  SYNTHETIC_FAULT_CONTROL_FILE_MODE,
  type SyntheticStepIdentity,
} from "./synthetic-fault-plan";
import { createSyntheticToolExecutor } from "./synthetic-tool";
import { createSyntheticClaimedTaskRunner } from "./synthetic-runtime";

const RUN_ID = "adapter-test-run";
const SEED = 240_901;

async function createDurableTaskFixture(options?: { canDelegate?: boolean }) {
  await dbReady;
  const suffix = randomUUID();
  const now = new Date();
  const leaseOwner = `synthetic-adapter-${suffix}`;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Synthetic adapter ${suffix}`,
      role: "Endurance test",
      systemPrompt: "Synthetic endurance fixture only.",
      createdByUser: true,
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: new Date(now.getTime() + 120_000),
      ...(options?.canDelegate
        ? {
            permissions: {
              canCreateSubAgents: false,
              canDelegate: true,
              canSpend: false,
              canDelete: false,
              canPublish: false,
              canContactExternal: false,
              canBrowse: false,
              canUseTerminal: false,
              canUseSudo: false,
            },
          }
        : {}),
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: `Synthetic adapter ${suffix}`,
      brief: "Exercise safe receipt-backed synthetic work.",
      ownerAgentId: agent.id,
      createdByUser: true,
      status: "in_progress",
      leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + 120_000),
      stepAttempts: 1,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, agent.id));
  const runtimeInstanceId = `synthetic-runtime-${suffix}`;
  await db.insert(runtimeInstancesTable).values({
    id: runtimeInstanceId,
    role: "worker",
    state: "healthy",
    hostname: "synthetic-adapter-test",
    processId: 24_090,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: now,
  });
  const attemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: task.id,
    agentId: agent.id,
    workerInstanceId: runtimeInstanceId,
    leaseOwner,
    attemptNumber: 1,
    cycleNumber: 0,
    state: "running",
    logicalExecutionId,
  });
  const context: ToolRuntimeContext = {
    agent,
    taskId: task.id,
    taskLeaseOwner: leaseOwner,
    runtimeAttemptId: attemptId,
    assertTaskLease: async () => undefined,
    operationIdentity: {
      executionKind: "task_step",
      logicalExecutionId,
      runtimeInstanceId,
      originAttemptId: attemptId,
      sourceMessageId: null,
      modelToolCallId: `synthetic-call-${suffix}`,
      callSlot: "round:0:tool:0",
      agentLeaseOwner: leaseOwner,
    },
  };
  return { agent, task, context };
}

function identity(taskId = 42, step = 7): SyntheticStepIdentity {
  return { taskId, attemptNumber: 3, step };
}

function planFor(
  stepIdentity: SyntheticStepIdentity,
  outcome:
    "success" | "timeout" | "rate_limit" | "malformed" | "unknown_outcome",
) {
  return createSyntheticFaultPlan({
    seed: SEED,
    entries: [{ ...stepIdentity, outcome, delayMs: 60_000 }],
  });
}

function completionArgs(model = "synthetic/endurance") {
  return {
    model,
    messages: [{ role: "user" as const, content: "deterministic work" }],
    maxTokens: 200,
  };
}

test("identical synthetic completion identities produce byte-identical content and usage", async () => {
  const stepIdentity = identity();
  const faultPlan = planFor(stepIdentity, "success");
  const first = await createSyntheticCompletion({
    runId: RUN_ID,
    seed: SEED,
    identity: stepIdentity,
    faultPlan,
  })(completionArgs());
  const second = await createSyntheticCompletion({
    runId: RUN_ID,
    seed: SEED,
    identity: stepIdentity,
    faultPlan,
  })(completionArgs());

  assert.deepEqual(first, second);
  assert.equal(first.provider, "ollama");
  assert.ok(first.completion.usage);
  const call = first.completion.choices[0]?.message.tool_calls?.[0];
  assert.equal(call?.function.name, SYNTHETIC_FIXTURE_TOOL_NAME);
  assert.match(call?.function.arguments ?? "", /adapter-test-run/u);
});

test("timeout waits safely and observes the caller abort signal", async () => {
  const stepIdentity = identity(43);
  const completion = createSyntheticCompletion({
    runId: RUN_ID,
    seed: SEED,
    identity: stepIdentity,
    faultPlan: planFor(stepIdentity, "timeout"),
  });
  const controller = new AbortController();
  const pending = completion({
    ...completionArgs(),
    signal: controller.signal,
  });
  controller.abort(new DOMException("test abort", "AbortError"));
  await assert.rejects(pending, { name: "AbortError" });
});

test("synthetic 429 remains a retryable provider failure", async () => {
  const stepIdentity = identity(44);
  const completion = createSyntheticCompletion({
    runId: RUN_ID,
    seed: SEED,
    identity: stepIdentity,
    faultPlan: planFor(stepIdentity, "rate_limit"),
  });
  await assert.rejects(completion(completionArgs()), (error: unknown) => {
    assert.equal(classifyRecoverableModelError(error), "rate_limit");
    assert.equal((error as { status?: unknown }).status, 429);
    return true;
  });
});

test("malformed synthetic output reaches the existing empty-choice validator", async () => {
  const stepIdentity = identity(45);
  const completion = await createSyntheticCompletion({
    runId: RUN_ID,
    seed: SEED,
    identity: stepIdentity,
    faultPlan: planFor(stepIdentity, "malformed"),
  })(completionArgs());
  assert.deepEqual(completion.completion.choices, []);
});

test("root synthetic completion deterministically delegates continuous responsibilities in bounded batches", async () => {
  const stepIdentity = identity(46);
  const delegations: SyntheticDelegation[] = Array.from(
    { length: 9 },
    (_, index) => ({ agentId: 100 + index }),
  );
  const completion = createSyntheticCompletion({
    runId: RUN_ID,
    seed: SEED,
    identity: stepIdentity,
    faultPlan: planFor(stepIdentity, "success"),
    delegations,
  });
  const first = await completion(completionArgs());
  const firstCalls = first.completion.choices[0]!.message.tool_calls!;
  assert.equal(firstCalls.length, 8);
  assert.ok(firstCalls.every((call) => call.function.name === "delegate_task"));
  const firstArguments = firstCalls.map((call) =>
    JSON.parse(call.function.arguments),
  );
  assert.ok(
    firstArguments.every(
      (args) =>
        args.autonomyMode === "continuous" && args.cadenceSeconds === 60,
    ),
  );
  const continuedMessages = [
    ...completionArgs().messages,
    first.completion.choices[0]!.message,
    ...firstCalls.map((call) => ({
      role: "tool" as const,
      tool_call_id: call.id,
      content: "delegated",
    })),
  ];
  const second = await completion({
    ...completionArgs(),
    messages: continuedMessages,
  });
  const secondCalls = second.completion.choices[0]!.message.tool_calls!;
  assert.equal(secondCalls.length, 1);
  assert.equal(JSON.parse(secondCalls[0]!.function.arguments).agentId, 108);
});

async function claimSyntheticCycle(
  taskId: number,
  agentId: number,
  runtimeInstanceId: string,
) {
  const now = new Date();
  const leaseOwner = `synthetic-cycle-${randomUUID()}`;
  const leaseExpiresAt = new Date(now.getTime() + 120_000);
  const [task] = await db
    .update(tasksTable)
    .set({
      status: "in_progress",
      leaseOwner,
      leaseExpiresAt,
      stepAttempts: sql`${tasksTable.stepAttempts} + 1`,
    })
    .where(eq(tasksTable.id, taskId))
    .returning();
  const [agent] = await db
    .update(agentsTable)
    .set({
      status: "working",
      currentTaskId: taskId,
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: leaseExpiresAt,
    })
    .where(eq(agentsTable.id, agentId))
    .returning();
  assert.ok(task);
  assert.ok(agent);
  const attemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId,
    agentId,
    workerInstanceId: runtimeInstanceId,
    leaseOwner,
    attemptNumber: task.stepAttempts,
    cycleNumber: task.cycleCount,
    state: "claimed",
    logicalExecutionId,
  });
  return {
    ...task,
    leaseOwner,
    runtimeAttemptId: attemptId,
    runtimeInstanceId,
    logicalExecutionId,
  };
}

test("one full synthetic stepTask cycle advances all ten agents while finite children remain blockers", async () => {
  await dbReady;
  const suffix = randomUUID();
  const runId = `ten-agent-${suffix}`;
  const permissions = {
    canCreateSubAgents: false,
    canDelegate: true,
    canSpend: false,
    canDelete: false,
    canPublish: false,
    canContactExternal: false,
    canBrowse: false,
    canUseTerminal: false,
    canUseSudo: false,
  };
  const [coordinator] = await db
    .insert(agentsTable)
    .values({
      name: `Synthetic coordinator ${suffix}`,
      role: "Endurance coordinator",
      systemPrompt: "Synthetic endurance only.",
      permissions,
      createdByUser: true,
    })
    .returning();
  const members = [];
  for (let index = 0; index < 9; index += 1) {
    const [member] = await db
      .insert(agentsTable)
      .values({
        name: `Synthetic member ${index} ${suffix}`,
        role: "Endurance member",
        systemPrompt: "Synthetic endurance only.",
        parentAgentId: coordinator.id,
        depth: 1,
        createdByUser: true,
      })
      .returning();
    members.push(member);
  }
  const [rootTask] = await db
    .insert(tasksTable)
    .values({
      title: `Synthetic ten-agent project ${suffix}`,
      brief: "Advance exactly one durable cycle for every project agent.",
      ownerAgentId: coordinator.id,
      status: "pending",
      autonomyMode: "continuous",
      cadenceSeconds: 60,
      createdByUser: true,
    })
    .returning();
  await db.insert(projectMembersTable).values([
    {
      taskId: rootTask.id,
      agentId: coordinator.id,
      memberRole: "coordinator",
    },
    ...members.map((member) => ({
      taskId: rootTask.id,
      agentId: member.id,
      memberRole: "member" as const,
    })),
  ]);
  const runtimeInstanceId = `ten-agent-runtime-${suffix}`;
  await db.insert(runtimeInstancesTable).values({
    id: runtimeInstanceId,
    role: "worker",
    state: "healthy",
    hostname: "synthetic-full-cycle-test",
    processId: 24_091,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: new Date(),
  });
  const runner = createSyntheticClaimedTaskRunner({
    runtimeOperationsConfig: readRuntimeOperationsConfig({
      RUNTIME_ROLE: "worker",
    }),
    synthetic: {
      enabled: true,
      mode: "accelerated",
      runId,
      seed: SEED,
      faultPlan: createSyntheticFaultPlan({ seed: SEED }),
      expectedAgents: 10,
      runDirectory: null,
      controlFile: null,
    },
  });

  await runner(
    await claimSyntheticCycle(rootTask.id, coordinator.id, runtimeInstanceId),
    { afterInitialLeaseHeartbeat() {} },
  );
  const children = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.parentTaskId, rootTask.id));
  assert.equal(children.length, 9);
  assert.ok(
    children.every(
      (child) =>
        child.autonomyMode === "continuous" && child.cadenceSeconds === 60,
    ),
  );
  for (const child of children) {
    await runner(
      await claimSyntheticCycle(
        child.id,
        child.ownerAgentId,
        runtimeInstanceId,
      ),
      { afterInitialLeaseHeartbeat() {} },
    );
  }

  const taskIds = [rootTask.id, ...children.map((child) => child.id)];
  const advanced = await db
    .select()
    .from(tasksTable)
    .where(inArray(tasksTable.id, taskIds));
  assert.equal(advanced.length, 10);
  assert.ok(advanced.every((task) => task.cycleCount === 1));
  assert.ok(
    advanced.every(
      (task) =>
        task.nextAttemptAt?.getTime() === task.createdAt.getTime() + 60_000,
    ),
  );
  const fixtureReceipts = await db
    .select()
    .from(operationReceiptsTable)
    .where(
      and(
        inArray(operationReceiptsTable.taskId, taskIds),
        eq(operationReceiptsTable.toolName, SYNTHETIC_FIXTURE_TOOL_NAME),
      ),
    );
  assert.equal(fixtureReceipts.length, 10);
  assert.ok(fixtureReceipts.every((receipt) => receipt.state === "succeeded"));

  await db.insert(tasksTable).values({
    title: `Finite blocker ${suffix}`,
    brief: "A finite child must still prevent parent cycle finalization.",
    ownerAgentId: members[0]!.id,
    assignedByAgentId: coordinator.id,
    parentTaskId: rootTask.id,
    status: "pending",
    autonomyMode: "finite",
    createdByUser: false,
  });
  await runner(
    await claimSyntheticCycle(rootTask.id, coordinator.id, runtimeInstanceId),
    { afterInitialLeaseHeartbeat() {} },
  );
  const [blockedRootCycle] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, rootTask.id));
  assert.equal(blockedRootCycle.cycleCount, 1);
});

test("delegate_task durably persists a continuous synthetic responsibility", async () => {
  const fixture = await createDurableTaskFixture({ canDelegate: true });
  const [target] = await db
    .insert(agentsTable)
    .values({
      name: `Synthetic responsibility ${randomUUID()}`,
      role: "Endurance responsibility",
      systemPrompt: "Synthetic endurance fixture only.",
      parentAgentId: fixture.agent.id,
      depth: fixture.agent.depth + 1,
      createdByUser: true,
    })
    .returning();
  const title = `Endurance ${RUN_ID} · ajan ${target.id}`;
  const delegated = await executeTool(
    fixture.context,
    "delegate_task",
    JSON.stringify({
      agentId: target.id,
      title,
      brief: "Run-scoped continuous synthetic responsibility.",
      priority: "normal",
      autonomyMode: "continuous",
      cadenceSeconds: 60,
    }),
  );

  assert.equal(delegated.toolOutcome, "succeeded");
  const [child] = await db
    .select()
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.parentTaskId, fixture.task.id),
        eq(tasksTable.ownerAgentId, target.id),
      ),
    );
  assert.equal(child.title, title);
  assert.equal(child.autonomyMode, "continuous");
  assert.equal(child.cadenceSeconds, 60);
  assert.equal(child.status, "pending");
});

test("one synthetic operation key replays one durable at-most-once success receipt", async () => {
  const fixture = await createDurableTaskFixture();
  const stepIdentity = identity(fixture.task.id, 0);
  const faultPlan = planFor(stepIdentity, "success");
  const completion = await createSyntheticCompletion({
    runId: RUN_ID,
    seed: SEED,
    identity: stepIdentity,
    faultPlan,
  })(completionArgs());
  const call = completion.completion.choices[0]!.message.tool_calls![0]!;
  const runTool = createSyntheticToolExecutor({
    runId: RUN_ID,
    seed: SEED,
    identity: stepIdentity,
    faultPlan,
  });

  const first = await runTool(
    fixture.context,
    call.function.name,
    call.function.arguments,
  );
  const replay = await runTool(
    fixture.context,
    call.function.name,
    call.function.arguments,
  );
  assert.equal(first.toolOutcome, "succeeded");
  assert.equal(replay.toolOutcome, "succeeded");
  assert.equal(replay.receiptId, first.receiptId);
  const receipts = await db
    .select()
    .from(operationReceiptsTable)
    .where(
      and(
        eq(operationReceiptsTable.taskId, fixture.task.id),
        eq(operationReceiptsTable.toolName, SYNTHETIC_FIXTURE_TOOL_NAME),
      ),
    );
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]?.state, "succeeded");
  assert.equal(receipts[0]?.sideEffectClass, "at_most_once");
  assert.equal(receipts[0]?.resultData?.runId, RUN_ID);
  assert.equal(
    JSON.stringify(receipts),
    JSON.stringify(receipts).replace(/deterministic work/gu, ""),
  );
});

test("unknown synthetic outcome blocks once and is never retried", async () => {
  const fixture = await createDurableTaskFixture();
  const stepIdentity = identity(fixture.task.id, 1);
  const faultPlan = planFor(stepIdentity, "unknown_outcome");
  const completion = await createSyntheticCompletion({
    runId: RUN_ID,
    seed: SEED,
    identity: stepIdentity,
    faultPlan,
  })(completionArgs());
  const call = completion.completion.choices[0]!.message.tool_calls![0]!;
  const runTool = createSyntheticToolExecutor({
    runId: RUN_ID,
    seed: SEED,
    identity: stepIdentity,
    faultPlan,
  });

  const first = await runTool(
    fixture.context,
    call.function.name,
    call.function.arguments,
  );
  const replay = await runTool(
    fixture.context,
    call.function.name,
    call.function.arguments,
  );
  assert.equal(first.toolOutcome, "unknown");
  assert.equal(replay.toolOutcome, "unknown");
  assert.equal(replay.receiptId, first.receiptId);
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, fixture.task.id));
  assert.equal(task.status, "blocked");
  assert.equal(task.blockedReason, "operation_outcome_unknown");
});

test("synthetic tools reject other runs, unknown tools and non-canonical arguments", async () => {
  const fixture = await createDurableTaskFixture();
  const stepIdentity = identity(fixture.task.id, 2);
  const faultPlan = planFor(stepIdentity, "success");
  const runTool = createSyntheticToolExecutor({
    runId: RUN_ID,
    seed: SEED,
    identity: stepIdentity,
    faultPlan,
  });
  for (const [name, args] of [
    ["browser_open", JSON.stringify({ url: "https://example.com" })],
    [
      SYNTHETIC_FIXTURE_TOOL_NAME,
      JSON.stringify({ runId: "another-run", operationKey: "x", value: "x" }),
    ],
    [
      SYNTHETIC_FIXTURE_TOOL_NAME,
      JSON.stringify({
        runId: RUN_ID,
        operationKey: "x",
        value: "x",
        command: "whoami",
      }),
    ],
  ] as const) {
    const result = await runTool(fixture.context, name, args);
    assert.equal(result.toolOutcome, "rejected");
    assert.equal(result.receiptId, undefined);
  }
});

test("the endurance-only fixture tool is absent from the normal catalog and dispatcher", async () => {
  const fixture = await createDurableTaskFixture();
  const catalog = await getToolsForAgent(fixture.agent, true);
  assert.equal(
    catalog.some((tool) => tool.function.name === SYNTHETIC_FIXTURE_TOOL_NAME),
    false,
  );
  const result = await executeTool(
    fixture.context,
    SYNTHETIC_FIXTURE_TOOL_NAME,
    JSON.stringify({
      runId: RUN_ID,
      operationKey: `synthetic:v1:${"a".repeat(64)}`,
      value: `work-unit:${"b".repeat(32)}`,
    }),
  );
  assert.equal(result.toolOutcome, "rejected");
  assert.equal(result.receiptId, undefined);
  assert.match(result.content, /bilinmeyen araç/iu);
});

test("fault-plan seeds and JSON plans fail closed on ambiguity", () => {
  assert.equal(parseSyntheticSeed("0"), 0);
  assert.equal(parseSyntheticSeed("4294967295"), 4_294_967_295);
  for (const value of ["", "-1", "+1", "01", "1.2", "4294967296"]) {
    assert.throws(() => parseSyntheticSeed(value), /seed/iu);
  }
  assert.throws(
    () =>
      parseSyntheticFaultPlan(
        JSON.stringify([
          { taskId: 1, attemptNumber: 1, step: 0, outcome: "success" },
          { taskId: 1, attemptNumber: 1, step: 0, outcome: "timeout" },
        ]),
        SEED,
      ),
    /duplicate/iu,
  );
  assert.throws(
    () => parseSyntheticFaultPlan('[{"outcome":"publish"}]', SEED),
    /fault plan/iu,
  );
});

test("run-scoped atomic fault control sets and clears provider faults across processes", async (t) => {
  const runDirectory = await mkdtemp(
    path.join(tmpdir(), "agentic-endurance-fault-control-"),
  );
  t.after(() => rm(runDirectory, { recursive: true, force: true }));
  const controlFile = path.join(runDirectory, `${RUN_ID}.faults.json`);
  const basePlan = createSyntheticFaultPlan({ seed: SEED });
  const source = createFileBackedSyntheticFaultSource({
    runId: RUN_ID,
    seed: SEED,
    runDirectory,
    controlFile,
    basePlan,
  });
  const writer = createSyntheticFaultControlWriter({
    runId: RUN_ID,
    seed: SEED,
    runDirectory,
    controlFile,
  });
  const target = identity(88, 4);

  assert.equal((await source.resolve(target)).outcome, "success");
  const setRevision = await writer.set([{ ...target, outcome: "rate_limit" }]);
  assert.equal(setRevision, 1);
  assert.equal((await source.resolve(target)).outcome, "rate_limit");
  const document = JSON.parse(await readFile(controlFile, "utf8"));
  assert.equal(document.runId, RUN_ID);
  assert.equal(document.revision, 1);
  assert.equal(document.seed, SEED);
  assert.equal(SYNTHETIC_FAULT_CONTROL_FILE_MODE, 0o644);
  if (process.platform !== "win32") {
    assert.equal((await lstat(controlFile)).mode & 0o777, 0o644);
  }

  const clearRevision = await writer.clear();
  assert.equal(clearRevision, 2);
  assert.equal((await source.resolve(target)).outcome, "success");

  await writeFile(
    controlFile,
    `${JSON.stringify({
      schemaVersion: 1,
      runId: RUN_ID,
      revision: 1,
      seed: SEED,
      entries: [{ ...target, outcome: "timeout", delayMs: 1 }],
    })}\n`,
    "utf8",
  );
  await assert.rejects(source.resolve(target), /revision rollback/iu);

  assert.throws(
    () =>
      createFileBackedSyntheticFaultSource({
        runId: RUN_ID,
        seed: SEED,
        runDirectory,
        controlFile: path.resolve(runDirectory, "..", "outside.json"),
        basePlan,
      }),
    /run directory/iu,
  );
});
