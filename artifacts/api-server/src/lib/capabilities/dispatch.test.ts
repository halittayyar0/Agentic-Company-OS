import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import type { ToolRuntimeContext } from "../orchestrator/execute-tool";
import { CAPABILITY_TOOL_NAMES, getCapabilityCatalog } from "./catalog";
import { WORKSPACE_LOCALES } from "../workspace-locale";

delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
const {
  db,
  dbReady,
  agentsTable,
  tasksTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  operationReceiptsTable,
  closeDatabase,
} = await import("@workspace/db");
const { executeTool } = await import("../orchestrator/execute-tool");
const { getToolsForAgent } = await import("../orchestrator/tools");
const { classifyToolSideEffect } =
  await import("../orchestrator/operation-receipts");
const { setEmergencyStop } =
  await import("../orchestrator/runtime-emergency-stop");
const { specialistPermissionsPreset } =
  await import("../orchestrator/permission-presets");
test.after(async () => {
  await closeDatabase();
});

async function fixture(): Promise<ToolRuntimeContext> {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Capability test",
      role: "Test",
      systemPrompt: "Test",
      createdByUser: true,
      permissions: {
        ...specialistPermissionsPreset,
        canBrowse: false,
        canUseTerminal: false,
      },
    })
    .returning();
  return { agent, taskId: null, locale: "en" };
}
const samples = {
  list_skills: {},
  read_skill: { id: "csv-quality" },
  calculate: { operation: "add", values: [2, 3] },
  analyze_text: { text: "hello 原文" },
  compare_text: { before: "a", after: "b" },
  inspect_json: { text: '{"source":"$& {x}"}' },
  profile_csv: { text: "name,value\na,2" },
  convert_datetime: { iso: "2026-09-28T12:00:00Z", timeZone: "UTC" },
  inspect_url: { url: "https://example.com/a" },
  hash_text: { text: "abc" },
};

test("all ten production tools execute locally in seven languages without file or browser permission", async () => {
  const ctx = await fixture();
  const names = (await getToolsForAgent(ctx.agent, false)).map(
    (tool) => tool.function.name,
  );
  for (const name of CAPABILITY_TOOL_NAMES) {
    assert.ok(names.includes(name), name);
    assert.equal(classifyToolSideEffect({ toolName: name }), "read_only");
    for (const locale of WORKSPACE_LOCALES) {
      const result = await executeTool(
        { ...ctx, locale },
        name,
        JSON.stringify(samples[name]),
      );
      assert.equal(
        result.toolOutcome,
        "succeeded",
        `${name}/${locale}: ${result.content}`,
      );
      const parsed = JSON.parse(result.content);
      assert.equal(parsed.message, getCapabilityCatalog(locale).copy.completed);
      if (name === "read_skill")
        assert.deepEqual(parsed.data.unavailableTools, ["vm_read_file"]);
      if (name === "calculate") assert.equal(parsed.data.value, 5);
    }
  }
});

test("dispatch rejects invalid arguments, inactive agents, explicit exclusivity, and emergency stop", async () => {
  const ctx = await fixture();
  for (const locale of WORKSPACE_LOCALES) {
    const lossy = await executeTool(
      { ...ctx, locale },
      "inspect_json",
      JSON.stringify({ text: '{"id":9007199254740993}' }),
    );
    assert.equal(lossy.toolOutcome, "rejected");
    assert.equal(
      JSON.parse(lossy.content).message,
      getCapabilityCatalog(locale).copy.invalid,
    );
  }
  assert.equal(
    (
      await executeTool(
        ctx,
        "calculate",
        '{"operation":"add","values":[1],"path":"/secret"}',
      )
    ).toolOutcome,
    "rejected",
  );
  assert.equal(
    (await executeTool(ctx, "read_skill", '{"id":"../../secret"}')).toolOutcome,
    "rejected",
  );
  const exclusive: ToolRuntimeContext = {
    ...ctx,
    exclusiveTurnPolicy: {
      source: "explicit_user_exclusivity",
      families: ["browser"],
      allowedTools: ["browser_snapshot"],
    },
  };
  assert.equal(
    (await executeTool(exclusive, "hash_text", '{"text":"abc"}')).toolOutcome,
    "rejected",
  );
  await setEmergencyStop({ enabled: true, reason: "capability test" });
  try {
    assert.equal(
      (await executeTool(ctx, "list_skills", "{}")).toolOutcome,
      "rejected",
    );
  } finally {
    await setEmergencyStop({ enabled: false, reason: null });
  }
  await db
    .update(agentsTable)
    .set({ isActive: false })
    .where(eq(agentsTable.id, ctx.agent.id));
  assert.equal(
    (await executeTool(ctx, "list_skills", "{}")).toolOutcome,
    "rejected",
  );
});

test("task-backed computation uses durable read-only receipts and replay boundaries", async () => {
  const ctx = await fixture();
  const now = new Date(),
    leaseOwner = randomUUID(),
    instance = randomUUID(),
    attempt = randomUUID();
  await db
    .update(agentsTable)
    .set({
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: new Date(now.getTime() + 180_000),
    })
    .where(eq(agentsTable.id, ctx.agent.id));
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Utility receipt",
      brief: "Test",
      ownerAgentId: ctx.agent.id,
      status: "in_progress",
      createdByUser: true,
      leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + 180_000),
      stepAttempts: 1,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, ctx.agent.id));
  await db.insert(runtimeInstancesTable).values({
    id: instance,
    role: "worker",
    state: "healthy",
    hostname: "test",
    processId: 123,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: now,
  });
  const logicalExecutionId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: attempt,
    taskId: task.id,
    agentId: ctx.agent.id,
    workerInstanceId: instance,
    leaseOwner,
    attemptNumber: 1,
    cycleNumber: 0,
    state: "running",
    logicalExecutionId,
  });
  const durable: ToolRuntimeContext = {
    ...ctx,
    taskId: task.id,
    taskLeaseOwner: leaseOwner,
    runtimeAttemptId: attempt,
    assertTaskLease: async () => undefined,
    operationIdentity: {
      executionKind: "task_step",
      logicalExecutionId,
      runtimeInstanceId: instance,
      originAttemptId: attempt,
      sourceMessageId: null,
      modelToolCallId: "utility-1",
      callSlot: "0:0",
      agentLeaseOwner: leaseOwner,
    },
  };
  const result = await executeTool(
    durable,
    "hash_text",
    '{"text":"sensitive-literal"}',
  );
  assert.equal(result.toolOutcome, "succeeded", result.content);
  assert.ok(result.receiptId);
  const [receipt] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.id, result.receiptId!));
  assert.equal(receipt.state, "succeeded");
  assert.equal(receipt.sideEffectClass, "read_only");
  assert.equal(receipt.resultData?.executionLocale, "en");
  assert.ok(!JSON.stringify(receipt.resultData).includes("sensitive-literal"));
  const replay = await executeTool(
    { ...durable, locale: "ar" },
    "hash_text",
    '{"text":"sensitive-literal"}',
  );
  assert.equal(replay.toolOutcome, "deferred");
  assert.equal(replay.receiptId, result.receiptId);
});
