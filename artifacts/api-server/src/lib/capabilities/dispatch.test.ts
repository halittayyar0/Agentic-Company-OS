import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import type { ToolRuntimeContext } from "../orchestrator/execute-tool";
import { CAPABILITY_TOOL_NAMES, getCapabilityCatalog } from "./catalog";
import { WORKSPACE_LOCALES } from "../workspace-locale";
import {
  saveExtension,
  listExtensions,
  readCapabilityPacks,
  setCapabilityPacks,
  toolPack,
} from "./extension-store";
import { createTaskToolCatalog } from "../orchestrator/task-tool-catalog";

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
  if (!(await listExtensions()).some((row) => row.id === "user-test-total"))
    await saveExtension({
      manifest: {
        schemaVersion: 1,
        id: "user-test-total",
        kind: "tool",
        title: "Total",
        description: "Test",
        tool: "calculate",
        defaults: { operation: "add" },
      },
      expectedRevision: 0,
      enabled: true,
    });
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
  csv_select: { text: "name,total\nA,2", columns: ["total"] },
  csv_group: {
    text: "team,total\na,0.1\na,0.2",
    keys: ["team"],
    column: "total",
    operation: "sum",
  },
  json_select: { text: '{"id":"001"}', paths: ["/id", "/missing"] },
  json_flatten: { text: '{"items":[{"name":"A"}]}' },
  compare_lists: { left: ["A", "A"], right: ["A", "B"], mode: "multiset" },
  text_find: { text: "Résumé 原文", query: "原文" },
  text_replace: { text: "{{title}}", search: "{{title}}", replacement: "$&" },
  markdown_table: { headers: ["Name"], rows: [["<tag> | value"]] },
  convert_units: { value: "1.25", from: "km", to: "m" },
  date_interval: { start: "2024-02-28", end: "2024-03-01" },
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
  list_extensions: {},
  run_extension: { id: "user-test-total", args: { values: [2, 3] } },
  csv_filter: {
    text: "id,name\n1,A\n2,B",
    column: "id",
    operator: "equals",
    value: "1",
  },
  csv_sort: { text: "id\n2\n1", column: "id", direction: "asc" },
  csv_dedupe: { text: "id\n1\n1", keys: ["id"] },
  csv_join: {
    left: "id,name\n1,A",
    right: "id,value\n1,x",
    key: "id",
    kind: "inner",
  },
  csv_to_json: { text: "id\n1" },
  json_to_csv: { text: '[{"id":"1"}]' },
  json_diff: { before: '{"a":1}', after: '{"a":2}' },
  json_format: { text: '{"a":1}' },
  render_report: {
    title: "Report",
    sections: [{ heading: "Result", body: "Test" }],
  },
  fill_template: { template: "Hello {{name}}", values: { name: "Ada" } },
  markdown_outline: { text: "# Report\n## Findings" },
  compare_page_text: { before: "old page", after: "new page" },
};

test("all production capability tools execute locally in seven languages without file or browser permission", async () => {
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

test("new tools stay lazy and disabled packs revoke direct and personal execution", async () => {
  const ctx = await fixture();
  const definitions = await getToolsForAgent(ctx.agent, false);
  const catalog = createTaskToolCatalog(definitions);
  assert.ok(catalog.index.includes("csv_group"));
  assert.ok(!catalog.tools.some((tool) => tool.function.name === "csv_group"));
  catalog.load('{"names":["csv_group"]}');
  assert.ok(catalog.tools.some((tool) => tool.function.name === "csv_group"));
  const saved = await saveExtension({
    manifest: {
      schemaVersion: 1,
      id: "user-region-totals",
      kind: "tool",
      title: "Region totals",
      description: "Sum supplied revenue by region",
      tool: "csv_group",
      defaults: { keys: ["team"], column: "total", operation: "sum" },
    },
    expectedRevision: 0,
    enabled: true,
  });
  assert.equal(saved.enabled, true);
  const invocation = JSON.stringify({
    id: "user-region-totals",
    args: { text: samples.csv_group.text },
  });
  const result = await executeTool(ctx, "run_extension", invocation);
  assert.equal(result.toolOutcome, "succeeded", result.content);
  assert.equal(JSON.parse(result.content).data.groups[0].value, "0.3");
  const packs = await readCapabilityPacks();
  const disabled = await setCapabilityPacks({
    enabledPacks: [],
    expectedRevision: packs.revision,
  });
  try {
    const restricted = createTaskToolCatalog(
      await getToolsForAgent(ctx.agent, false),
    );
    for (const name of [
      "csv_select",
      "csv_group",
      "json_select",
      "json_flatten",
      "compare_lists",
      "text_find",
      "text_replace",
      "markdown_table",
      "convert_units",
      "date_interval",
    ] as const) {
      assert.ok(toolPack(name), name);
      assert.throws(
        () => restricted.load(JSON.stringify({ names: [name] })),
        name,
      );
      const direct = await executeTool(
        ctx,
        name,
        JSON.stringify(samples[name]),
      );
      assert.equal(
        direct.toolOutcome,
        "rejected",
        `${name}: ${direct.content}`,
      );
    }
    const personal = await executeTool(ctx, "run_extension", invocation);
    assert.equal(personal.toolOutcome, "rejected", personal.content);
  } finally {
    await setCapabilityPacks({
      enabledPacks: packs.enabledPacks,
      expectedRevision: disabled.revision,
    });
  }
});
