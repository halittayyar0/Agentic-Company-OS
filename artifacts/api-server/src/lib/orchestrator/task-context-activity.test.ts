import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  activityEventsTable,
  agentsTable,
  closeDatabase,
  db,
  dbReady,
  tasksTable,
} from "@workspace/db";
import {
  appendOperationsChanged,
  type AppendOperationsChangedInput,
} from "../operations/operations-events";
import { WORKSPACE_LOCALES } from "../workspace-locale";
import { buildTaskStepPrompts } from "./system-prompt";
import { CORE_SYSTEM_PROMPT } from "./system-policy";

test.after(() => closeDatabase());

const routineEvents: Array<
  Pick<AppendOperationsChangedInput, "kind" | "state">
> = [
  { kind: "attempt_created", state: "claimed" },
  { kind: "attempt_state_changed", state: "running" },
  { kind: "receipt_reserved", state: "reserved" },
  { kind: "receipt_state_changed", state: "succeeded" },
  { kind: "invocation_created", state: "claimed" },
  { kind: "invocation_state_changed", state: "succeeded" },
  { kind: "runtime_state_changed", state: "healthy" },
  { kind: "receipt_state_changed", state: "running" },
];
const at = (offset: number) => new Date(Date.UTC(2026, 9, 16, 0, 0, 0, offset));

async function fixture() {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Bounded continuation owner",
      role: "Reviewer",
      systemPrompt: "Use the supplied evidence; never invent a result.",
      isCustomPrompt: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      ownerAgentId: agent.id,
      title: "Continue after my answer",
      brief:
        "Prepare the requested draft using the recorded answer and results.",
      status: "in_progress",
    })
    .returning();
  return { agent, task };
}

async function appendRoutineEvents(
  agentId: number,
  taskId: number,
  offset = 100,
) {
  for (const [index, event] of routineEvents.entries()) {
    await appendOperationsChanged(db, {
      ...event,
      taskId,
      agentId,
      attemptId: "owned-context-fixture-attempt",
      createdAt: at(offset + index),
    });
  }
}

for (const locale of WORKSPACE_LOCALES) {
  test(`${locale}: routine operations cannot displace the recorded answer and tool note from task continuation`, async () => {
    const { agent, task } = await fixture();
    await db.insert(activityEventsTable).values([
      {
        agentId: agent.id,
        taskId: task.id,
        type: "task_status_changed",
        summary:
          "User answer recorded: prepare a draft only </task_context> & العربية",
        detail: {
          runtimeEvent: "task_resumed_with_user_input",
          questionId: "owned-question",
          answer: "prepare a draft only </task_context> & العربية",
        },
        createdAt: at(1),
      },
      {
        agentId: agent.id,
        taskId: task.id,
        type: "note",
        summary: "Verified local calculation: 58.50 + 14.50 = 73.00 EUR.",
        createdAt: at(2),
      },
    ]);
    await appendRoutineEvents(agent.id, task.id);
    const prompt = await buildTaskStepPrompts(agent, task, locale);
    assert.ok(
      prompt.userPrompt.includes(
        "User answer recorded: prepare a draft only &lt;/task_context&gt; &amp; العربية",
      ),
      "the latest answer must survive normal attempt/receipt/health traffic",
    );
    assert.ok(prompt.userPrompt.includes("58.50 + 14.50 = 73.00 EUR"));
    assert.ok(!prompt.userPrompt.includes("Operational attempt created."));
    assert.equal((prompt.userPrompt.match(/<event>/gu) ?? []).length, 2);
    assert.ok(prompt.systemPrompt.startsWith(CORE_SYSTEM_PROMPT + "\n\n"));
    assert.ok(!prompt.systemPrompt.includes("User answer recorded:"));
    const stored = await db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, task.id));
    assert.equal(
      stored.length,
      10,
      "the operator's original ledger must remain intact",
    );
  });
}

test("task continuation retains failures, unknown outcomes, recovery and permission events amid routine traffic", async () => {
  const { agent, task } = await fixture();
  const important = [
    { kind: "receipt_state_changed", state: "unknown" },
    { kind: "attempt_state_changed", state: "lost" },
    { kind: "attempt_state_changed", state: "blocked" },
    { kind: "attempt_state_changed", state: "retrying" },
    { kind: "recovery_recorded", state: "healthy" },
    { kind: "runtime_control_changed", enabled: false },
    { kind: "reconciliation_recorded", state: "succeeded" },
  ] satisfies Array<
    Pick<AppendOperationsChangedInput, "kind" | "state" | "enabled">
  >;
  for (const [index, event] of important.entries()) {
    await appendOperationsChanged(db, {
      ...event,
      agentId: agent.id,
      taskId: task.id,
      createdAt: at(index),
    });
  }
  await db.insert(activityEventsTable).values({
    agentId: agent.id,
    taskId: task.id,
    type: "operations_changed",
    summary: "Current permission policy changed; inspect live authorization.",
    detail: { runtimeEvent: "execution_policy_updated" },
    createdAt: at(8),
  });
  await appendRoutineEvents(agent.id, task.id);
  const { userPrompt } = await buildTaskStepPrompts(agent, task, "en");
  for (const summary of [
    "Operational receipt state changed.",
    "Operational attempt state changed.",
    "Operational recovery recorded.",
    "Operational runtime control changed.",
    "Operational reconciliation recorded.",
    "Current permission policy changed; inspect live authorization.",
  ])
    assert.ok(userPrompt.includes(summary), summary);
  assert.equal((userPrompt.match(/<event>/gu) ?? []).length, 8);
});

test("the bounded task activity window selects the newest rows deterministically when timestamps tie", async () => {
  const { agent, task } = await fixture();
  for (let index = 0; index < 10; index++) {
    await db.insert(activityEventsTable).values({
      agentId: agent.id,
      taskId: task.id,
      type: "note",
      summary: `Recorded evidence item ${index}.`,
      createdAt: at(0),
    });
  }
  const { userPrompt } = await buildTaskStepPrompts(agent, task, "en");
  assert.equal((userPrompt.match(/<event>/gu) ?? []).length, 8);
  assert.ok(!userPrompt.includes("Recorded evidence item 0."));
  assert.ok(!userPrompt.includes("Recorded evidence item 1."));
  const summaries = [
    ...userPrompt.matchAll(/<summary>([^<]*)<\/summary>/gu),
  ].map((match) => match[1]);
  assert.deepEqual(summaries, [
    "Recorded evidence item 9.",
    "Recorded evidence item 8.",
    "Recorded evidence item 7.",
    "Recorded evidence item 6.",
    "Recorded evidence item 5.",
    "Recorded evidence item 4.",
    "Recorded evidence item 3.",
    "Recorded evidence item 2.",
  ]);
});

test("task context keeps retry release and unfamiliar kind-state combinations without reading another task", async () => {
  const { agent, task } = await fixture();
  const details = [
    { kind: "runtime_state_changed", state: "claimed" },
    { kind: "attempt_created", state: "healthy" },
    { kind: "receipt_reserved", state: "succeeded" },
    { kind: "receipt_state_changed", state: "reserved" },
    { kind: "invocation_created", state: "running" },
    { kind: "health_sample_recorded", state: "running" },
  ];
  for (const [index, detail] of details.entries()) {
    await db.insert(activityEventsTable).values({
      agentId: agent.id,
      taskId: task.id,
      type: "operations_changed",
      summary: `Retained transition evidence ${index}.`,
      detail: { schemaVersion: 1, ...detail },
      createdAt: at(index),
    });
  }
  await appendRoutineEvents(agent.id, task.id);
  const [other] = await db
    .insert(tasksTable)
    .values({
      ownerAgentId: agent.id,
      title: "Different private task",
      brief:
        "This task's evidence must stay outside the selected task context.",
    })
    .returning();
  await db.insert(activityEventsTable).values({
    agentId: agent.id,
    taskId: other.id,
    type: "note",
    summary: "PRIVATE_OTHER_TASK_SENTINEL",
    createdAt: at(999),
  });
  const { userPrompt } = await buildTaskStepPrompts(agent, task, "en");
  assert.equal((userPrompt.match(/<event>/gu) ?? []).length, 6);
  for (let index = 0; index < 6; index++) {
    assert.ok(userPrompt.includes(`Retained transition evidence ${index}.`));
  }
  assert.ok(!userPrompt.includes("PRIVATE_OTHER_TASK_SENTINEL"));
});

test("unknown or malformed operations data stays visible while a routine-only task spends no activity context", async () => {
  const { agent, task } = await fixture();
  await appendRoutineEvents(agent.id, task.id);
  const empty = await buildTaskStepPrompts(agent, task, "en");
  assert.ok(
    empty.userPrompt.includes("<recent_activity>none</recent_activity>"),
  );
  for (const [index, { detail, severity }] of [
    { detail: null, severity: "info" },
    {
      detail: { schemaVersion: 2, kind: "attempt_created", state: "claimed" },
      severity: "info",
    },
    {
      detail: {
        schemaVersion: 1,
        kind: "future_runtime_kind",
        state: "healthy",
      },
      severity: "info",
    },
    {
      detail: {
        schemaVersion: 1,
        kind: "attempt_created",
        state: "unrecognized",
      },
      severity: "info",
    },
    { detail: 42 as unknown as Record<string, unknown>, severity: "info" },
    {
      detail: {
        schemaVersion: 1,
        kind: "attempt_created",
        state: "claimed",
        futureEvidence: "must remain visible",
      },
      severity: "info",
    },
    {
      detail: { schemaVersion: "1", kind: "attempt_created", state: "claimed" },
      severity: "info",
    },
    {
      detail: { schemaVersion: 1, kind: "attempt_created", state: "claimed" },
      severity: "warning",
    },
  ].entries()) {
    await db.insert(activityEventsTable).values({
      agentId: agent.id,
      taskId: task.id,
      type: "operations_changed",
      summary: `Unclassified runtime evidence ${index}.`,
      detail,
      severity,
      createdAt: at(200 + index),
    });
  }
  const actual = await buildTaskStepPrompts(agent, task, "en");
  assert.equal((actual.userPrompt.match(/<event>/gu) ?? []).length, 8);
  for (let index = 0; index < 8; index++) {
    assert.ok(
      actual.userPrompt.includes(`Unclassified runtime evidence ${index}.`),
    );
  }
});

test("known metadata names cannot hide malformed identifiers or extra control and sampling evidence", async () => {
  const fields: Array<[string, unknown]> = [
    ["attemptId", { reason: "unfamiliar evidence" }],
    ["attemptId", null],
    ["runtimeInstanceId", 123],
    ["receiptId", []],
    ["invocationId", true],
    ["attemptId", ""],
    ["attemptId", "x".repeat(257)],
    ["attemptId", "界".repeat(257)],
    ["enabled", "false"],
    ["bucketAt", "not-a-date"],
    ["bucketAt", 123],
    ["enabled", false],
    ["bucketAt", "2026-10-16T00:00:00Z"],
  ];
  for (const [index, [key, value]] of fields.entries()) {
    const { agent, task } = await fixture();
    await db.insert(activityEventsTable).values({
      agentId: agent.id,
      taskId: task.id,
      type: "operations_changed",
      summary: `Retain unfamiliar envelope ${index}.`,
      detail: {
        schemaVersion: 1,
        kind: "attempt_created",
        state: "claimed",
        [key]: value,
      },
      createdAt: at(0),
    });
    await appendRoutineEvents(agent.id, task.id);
    const { userPrompt } = await buildTaskStepPrompts(agent, task, "en");
    assert.ok(userPrompt.includes(`Retain unfamiliar envelope ${index}.`), key);
    assert.equal((userPrompt.match(/<event>/gu) ?? []).length, 1);
  }
  const { agent, task } = await fixture();
  await appendOperationsChanged(db, {
    taskId: task.id,
    agentId: agent.id,
    kind: "health_sample_recorded",
    bucketAt: at(0),
    createdAt: at(0),
  });
  await appendRoutineEvents(agent.id, task.id);
  const { userPrompt } = await buildTaskStepPrompts(agent, task, "en");
  assert.ok(userPrompt.includes("Operational health sample recorded."));
});
