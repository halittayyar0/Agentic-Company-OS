import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
import {
  runDurableExternalEffect,
  type ToolExecutionResult,
  type ToolRuntimeContext,
} from "./execute-tool";
import { recoverInterruptedOperation } from "./operation-receipts";
import { WORKSPACE_LOCALES } from "../workspace-locale";
import { terminalMessage } from "../vm/terminal-localization";

async function createFixture() {
  await dbReady;
  const suffix = randomUUID();
  const now = new Date();
  const leaseOwner = `durable-effect-${suffix}`;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Durable effect ${suffix}`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: new Date(now.getTime() + 120_000),
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: `Durable effect ${suffix}`,
      brief: "Exercise the exact external effect boundary.",
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
  const runtimeInstanceId = `durable-effect-runtime-${suffix}`;
  await db.insert(runtimeInstancesTable).values({
    id: runtimeInstanceId,
    role: "worker",
    state: "healthy",
    hostname: "durable-effect-test",
    processId: 2201,
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
  const attached = new Set<string>();
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
      modelToolCallId: `tool-call-${suffix}`,
      callSlot: "round:0:tool:0",
      agentLeaseOwner: leaseOwner,
    },
    attachOperationInvocation: (operation) => {
      attached.add(operation.invocationId);
    },
    detachOperationInvocation: (invocationId) => {
      attached.delete(invocationId);
    },
  };
  return {
    agent,
    task,
    attemptId,
    leaseOwner,
    logicalExecutionId,
    runtimeInstanceId,
    context,
    attached,
  };
}

function toolResult(
  toolOutcome: ToolExecutionResult["toolOutcome"] = "succeeded",
): ToolExecutionResult {
  return {
    content: "synthetic durable effect",
    createdTasks: [],
    createdAgents: [],
    toolOutcome,
  };
}

function effectInput(
  suffix: string,
  execute: Parameters<typeof runDurableExternalEffect>[1]["execute"],
) {
  return {
    toolName: "vm_run_command",
    normalizedArgs: {
      commandHash: `sha256:${suffix.padEnd(64, "a").slice(0, 64)}`,
      commandName: "synthetic",
      commandChars: 9,
    },
    execute,
    onError: async () => toolResult("rejected"),
  };
}

test("Terminal receipts replay in the execution language without changing stored evidence or repeating effects", async () => {
  const fixture = await createFixture();
  const data = { ok: true, exitCode: 0, durationMs: 4, executionLocale: "en" };
  let effects = 0;
  const input = effectInput("locale-replay", async ({ startEffect }) => {
    await startEffect();
    effects += 1;
    return { result: toolResult(), resultData: data };
  });
  const first = await runDurableExternalEffect(
    { ...fixture.context, locale: "en" },
    input,
  );
  assert.equal(first.toolOutcome, "succeeded");
  const [before] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.id, first.receiptId!));
  for (const locale of WORKSPACE_LOCALES) {
    const replay = await runDurableExternalEffect(
      { ...fixture.context, locale },
      input,
    );
    const evidence = terminalMessage(locale, "safeEvidence", {
      data: JSON.stringify(
        Object.fromEntries(
          Object.entries(data).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ),
    });
    assert.equal(
      replay.content,
      terminalMessage(locale, "replayComplete", { evidence }),
    );
    assert.equal(replay.toolOutcome, "succeeded");
    assert.equal(replay.receiptId, first.receiptId);
  }
  const [after] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.id, first.receiptId!));
  assert.equal(effects, 1);
  assert.deepEqual(after, before);
});

test("uncertain Terminal outcomes stay unknown in every language and never execute again", async () => {
  const fixture = await createFixture();
  let effects = 0;
  const input = effectInput("locale-unknown", async ({ startEffect }) => {
    await startEffect();
    effects += 1;
    throw new Error("controlled interruption");
  });
  const first = await runDurableExternalEffect(
    { ...fixture.context, locale: "en" },
    input,
  );
  assert.equal(first.toolOutcome, "unknown");
  for (const locale of WORKSPACE_LOCALES) {
    const result = await runDurableExternalEffect(
      { ...fixture.context, locale },
      input,
    );
    assert.equal(result.toolOutcome, "unknown");
    assert.equal(
      result.content,
      terminalMessage(locale, "receiptUnknown", { id: first.receiptId! }),
    );
  }
  assert.equal(effects, 1);
});

test("the handler crosses running immediately before one effect and replays the receipt", async () => {
  const fixture = await createFixture();
  let effects = 0;
  let receiptId = "";
  const first = await runDurableExternalEffect(
    fixture.context,
    effectInput("1", async ({ startEffect }) => {
      const [reserved] = await db
        .select()
        .from(operationReceiptsTable)
        .where(
          and(
            eq(
              operationReceiptsTable.logicalExecutionId,
              fixture.logicalExecutionId,
            ),
            eq(operationReceiptsTable.toolName, "vm_run_command"),
          ),
        );
      assert.equal(reserved.state, "reserved");
      receiptId = reserved.id;
      const [claimed] = await db
        .select()
        .from(operationInvocationsTable)
        .where(eq(operationInvocationsTable.receiptId, reserved.id));
      assert.equal(claimed.state, "claimed");

      await startEffect();
      effects += 1;
      return {
        result: toolResult(),
        resultData: { ok: true, exitCode: 0, durationMs: 4 },
      };
    }),
  );
  assert.equal(first.receiptId, receiptId);
  assert.equal(effects, 1);
  assert.equal(fixture.attached.size, 0);

  const replay = await runDurableExternalEffect(
    fixture.context,
    effectInput("1", async ({ startEffect }) => {
      await startEffect();
      effects += 1;
      return { result: toolResult() };
    }),
  );
  assert.equal(replay.receiptId, receiptId);
  assert.equal(replay.toolOutcome, "succeeded");
  assert.equal(effects, 1);
});

test("a pre-effect failure retires the claim and can retry without a stale runtime", async () => {
  const fixture = await createFixture();
  const first = await runDurableExternalEffect(
    fixture.context,
    effectInput("2", async () => {
      throw new Error("synthetic preflight failure");
    }),
  );
  assert.equal(first.toolOutcome, "rejected");
  assert.ok(first.receiptId);
  const invocationsAfterFailure = await db
    .select()
    .from(operationInvocationsTable)
    .where(eq(operationInvocationsTable.receiptId, first.receiptId!));
  assert.equal(
    invocationsAfterFailure.some(
      (invocation) => invocation.state === "claimed",
    ),
    false,
  );
  assert.equal(
    invocationsAfterFailure.some((invocation) => invocation.state === "failed"),
    true,
  );

  let effects = 0;
  const retry = await runDurableExternalEffect(
    fixture.context,
    effectInput("2", async ({ startEffect }) => {
      await startEffect();
      effects += 1;
      return {
        result: toolResult(),
        resultData: { ok: true, exitCode: 0, durationMs: 1 },
      };
    }),
  );
  assert.equal(retry.toolOutcome, "succeeded");
  assert.equal(retry.receiptId, first.receiptId);
  assert.equal(effects, 1);
});

test("an at-most-once failure after the boundary becomes unknown and never reruns", async () => {
  const fixture = await createFixture();
  let effects = 0;
  const first = await runDurableExternalEffect(
    fixture.context,
    effectInput("3", async ({ startEffect }) => {
      await startEffect();
      effects += 1;
      throw new Error("synthetic response loss after effect");
    }),
  );
  assert.equal(first.toolOutcome, "unknown");
  assert.ok(first.receiptId);
  const [blockedTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, fixture.task.id));
  assert.equal(blockedTask.status, "blocked");
  assert.equal(blockedTask.blockedReason, "operation_outcome_unknown");

  const replay = await runDurableExternalEffect(
    fixture.context,
    effectInput("3", async ({ startEffect }) => {
      await startEffect();
      effects += 1;
      return { result: toolResult() };
    }),
  );
  assert.equal(replay.toolOutcome, "unknown");
  assert.equal(replay.receiptId, first.receiptId);
  assert.equal(effects, 1);
});

test("the production durable wrapper converges after both post-effect finalization writes lose the database", async () => {
  const fixture = await createFixture();
  let effects = 0;
  let completeAttempts = 0;
  let unknownAttempts = 0;
  const persistenceOutage = new Error(
    "synthetic post-effect PostgreSQL outage",
  );
  const input = effectInput("4", async ({ startEffect }) => {
    await startEffect();
    effects += 1;
    return {
      result: toolResult(),
      resultData: { ok: true, exitCode: 0, durationMs: 1 },
    };
  });

  const first = await runDurableExternalEffect(fixture.context, input, {
    completeOperation: async () => {
      completeAttempts += 1;
      throw persistenceOutage;
    },
    markOperationUnknown: async () => {
      unknownAttempts += 1;
      throw persistenceOutage;
    },
  });
  assert.equal(first.toolOutcome, "unknown");
  assert.ok(first.receiptId);
  assert.equal(effects, 1);
  assert.equal(completeAttempts, 1);
  assert.equal(unknownAttempts, 1);
  assert.equal(fixture.attached.size, 0, "the wrapper must detach on exit");

  const [[runningReceipt], [runningInvocation]] = await Promise.all([
    db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, first.receiptId!)),
    db
      .select()
      .from(operationInvocationsTable)
      .where(eq(operationInvocationsTable.receiptId, first.receiptId!)),
  ]);
  assert.equal(runningReceipt.state, "running");
  assert.equal(runningInvocation.state, "running");

  const recoveryNow = new Date(Date.now() + 1_000);
  const expiredAt = new Date(recoveryNow.getTime() - 1);
  await Promise.all([
    db
      .update(tasksTable)
      .set({ leaseExpiresAt: expiredAt })
      .where(eq(tasksTable.id, fixture.task.id)),
    db
      .update(agentsTable)
      .set({ runLeaseExpiresAt: expiredAt })
      .where(eq(agentsTable.id, fixture.agent.id)),
    db
      .update(operationInvocationsTable)
      .set({ leaseExpiresAt: expiredAt })
      .where(eq(operationInvocationsTable.id, runningInvocation.id)),
    db
      .update(runtimeInstancesTable)
      .set({ state: "healthy", lastHeartbeatAt: recoveryNow })
      .where(eq(runtimeInstancesTable.id, fixture.runtimeInstanceId)),
  ]);

  const recovered = await recoverInterruptedOperation({
    receiptId: first.receiptId,
    now: recoveryNow,
    runtimeStaleBefore: new Date(recoveryNow.getTime() - 15_000),
  });
  assert.equal(recovered.disposition, "unknown");
  assert.equal(recovered.receipt.state, "unknown");

  const replay = await runDurableExternalEffect(fixture.context, input);
  assert.equal(replay.toolOutcome, "unknown");
  assert.equal(replay.receiptId, first.receiptId);
  assert.equal(effects, 1, "recovery must never replay the crossed effect");
});

for (const toolName of ["vm_run_command", "browser_scroll"]) {
  for (const crash of [false, true]) {
    test(`${toolName} unknown persistence uses the captured language after ${crash ? "crash recovery" : "normal finalization failure"}`, async () => {
      for (const locale of [
        ...WORKSPACE_LOCALES.filter((item) => item === "en"),
        ...WORKSPACE_LOCALES.filter((item) => item !== "en"),
      ]) {
        const fixture = await createFixture();
        let effects = 0;
        const input = effectInput(
          `unknown-${locale}`,
          async ({ startEffect }) => {
            await startEffect();
            effects += 1;
            throw new Error("controlled post-effect failure");
          },
        );
        input.toolName = toolName;
        const result = await runDurableExternalEffect(
          { ...fixture.context, locale },
          input,
          crash
            ? {
                markOperationUnknown: async () => {
                  throw new Error("fixture database outage");
                },
              }
            : {},
        );
        assert.equal(result.toolOutcome, "unknown");
        const [before] = await db
          .select()
          .from(operationReceiptsTable)
          .where(eq(operationReceiptsTable.id, result.receiptId!));
        if (crash) {
          assert.equal(before.state, "running");
          const later = new Date(Date.now() + 180_000);
          const recovered = await recoverInterruptedOperation({
            receiptId: before.id,
            now: later,
            runtimeStaleBefore: later,
          });
          assert.equal(recovered.disposition, "unknown");
          assert.equal(recovered.receipt.argumentHash, before.argumentHash);
        }
        const [task] = await db
          .select()
          .from(tasksTable)
          .where(eq(tasksTable.id, fixture.task.id));
        const expected = terminalMessage(locale, "receiptUnknown", {
          id: before.id,
        });
        assert.equal(task.lastError, expected);
        const events = await db
          .select()
          .from(activityEventsTable)
          .where(eq(activityEventsTable.taskId, fixture.task.id));
        const unknown = events.filter(
          (event) => event.detail?.runtimeEvent === "operation_outcome_unknown",
        );
        assert.equal(unknown.length, 1);
        assert.equal(unknown[0].summary, expected);
        const replay = await runDurableExternalEffect(
          { ...fixture.context, locale: locale === "en" ? "ar" : "en" },
          input,
        );
        assert.equal(replay.toolOutcome, "unknown");
        assert.equal(effects, 1);
        const [after] = await db
          .select()
          .from(operationReceiptsTable)
          .where(eq(operationReceiptsTable.id, before.id));
        assert.equal(after.argumentHash, before.argumentHash);
        assert.deepEqual(after.resultData, { executionLocale: locale });
        const afterEvents = await db
          .select()
          .from(activityEventsTable)
          .where(eq(activityEventsTable.taskId, fixture.task.id));
        assert.deepEqual(afterEvents, events);
      }
    });
  }
}

test("safe retry retains the original Terminal presentation without changing operation identity", async () => {
  const fixture = await createFixture();
  const preflight = effectInput(
    "presentation-retry",
    async ({ executionLocale }) => {
      assert.equal(executionLocale, "de");
      throw new Error("safe preflight rejection");
    },
  );
  const first = await runDurableExternalEffect(
    { ...fixture.context, locale: "de" },
    preflight,
  );
  assert.equal(first.toolOutcome, "rejected");
  const [reserved] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.id, first.receiptId!));
  assert.equal(reserved.state, "reserved");
  assert.deepEqual(reserved.resultData, { executionLocale: "de" });
  let effects = 0;
  const retry = await runDurableExternalEffect(
    { ...fixture.context, locale: "ar" },
    effectInput(
      "presentation-retry",
      async ({ startEffect, executionLocale }) => {
        assert.equal(executionLocale, "de");
        await startEffect();
        effects += 1;
        return {
          result: toolResult(),
          resultData: { ok: true, exitCode: 0, executionLocale },
        };
      },
    ),
  );
  assert.equal(retry.toolOutcome, "succeeded");
  assert.equal(retry.receiptId, reserved.id);
  assert.equal(effects, 1);
  const [completed] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.id, reserved.id));
  assert.equal(completed.argumentHash, reserved.argumentHash);
  assert.equal(completed.operationKey, reserved.operationKey);
  assert.equal(completed.resultData?.executionLocale, "de");
});
