import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import { createTaskToolCatalog } from "../orchestrator/task-tool-catalog";
import {
  createSyntheticCompletion,
  SYNTHETIC_FIXTURE_TOOL_NAME,
} from "./synthetic-completion";
import { createSyntheticFaultPlan } from "./synthetic-fault-plan";

const seed = 240901;
const identity = { taskId: 42, attemptNumber: 1, step: 0 };
const authorized: OpenAI.Chat.Completions.ChatCompletionFunctionTool[] = [
  "calculate",
  "complete_task",
  "delegate_task",
  SYNTHETIC_FIXTURE_TOOL_NAME,
].map((name) => ({
  type: "function",
  function: { name, parameters: { type: "object", properties: {} } },
}));

for (const delegations of [[], [{ agentId: 2 }]]) {
  const expected = delegations.length
    ? "delegate_task"
    : SYNTHETIC_FIXTURE_TOOL_NAME;
  test(`synthetic ${expected} loads its schema before a separately accounted action`, async () => {
    const catalog = createTaskToolCatalog(authorized);
    const completion = createSyntheticCompletion({
      runId: "owned-synthetic-tool-protocol",
      seed,
      identity,
      delegations,
      faultPlan: createSyntheticFaultPlan({ seed }),
    });
    const events: string[] = [];
    const responseIds: string[] = [];
    const request = {
      model: "synthetic/endurance",
      messages: [{ role: "user" as const, content: "Offline fixture only" }],
      beforeRequest: async () => {
        events.push("dispatch");
      },
      onResponseUsage: async (evidence: { responseId?: string | null }) => {
        assert.equal(events.at(-1), "dispatch");
        assert.ok(evidence.responseId);
        responseIds.push(evidence.responseId);
        events.push("usage");
      },
    };
    const first = await completion({ ...request, tools: catalog.tools });
    const calls = first.completion.choices[0]!.message.tool_calls!;
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.type, "function");
    if (calls[0]!.type !== "function") throw new Error("Expected function");
    assert.equal(calls[0]!.function.name, "load_tools");
    assert.deepEqual(JSON.parse(calls[0]!.function.arguments), {
      names: [expected],
    });
    assert.ok(catalog.tools.every((tool) => tool.function.name !== expected));

    // A narrated loader result cannot substitute for the next request's schema.
    const messages = [
      ...request.messages,
      first.completion.choices[0]!.message,
      {
        role: "tool" as const,
        tool_call_id: calls[0]!.id,
        content: "Tools available",
      },
    ];
    const stillUnloaded = await completion({
      ...request,
      messages,
      tools: catalog.tools,
    });
    assert.equal(
      stillUnloaded.completion.choices[0]!.message.tool_calls![0]!.function
        .name,
      "load_tools",
    );
    catalog.load(calls[0]!.function.arguments);
    const action = await completion({
      ...request,
      messages,
      tools: catalog.tools,
    });
    const actionCalls = action.completion.choices[0]!.message.tool_calls!;
    assert.equal(actionCalls.length, 1);
    assert.equal(actionCalls[0]!.function.name, expected);
    assert.notEqual(first.completion.id, action.completion.id);
    assert.notEqual(calls[0]!.id, actionCalls[0]!.id);
    assert.deepEqual(events, [
      "dispatch",
      "usage",
      "dispatch",
      "usage",
      "dispatch",
      "usage",
    ]);
    assert.equal(responseIds[0], first.completion.id);
    assert.equal(responseIds[2], action.completion.id);
  });
}

test("a synthetic request with neither the action schema nor loader fails before dispatch", async () => {
  for (const tools of [undefined, []]) {
    let dispatches = 0;
    let usage = 0;
    await assert.rejects(
      createSyntheticCompletion({
        runId: "owned-synthetic-missing-tools",
        seed,
        identity,
        faultPlan: createSyntheticFaultPlan({ seed }),
      })({
        model: "synthetic/endurance",
        messages: [],
        tools,
        beforeRequest: async () => {
          dispatches++;
        },
        onResponseUsage: async () => {
          usage++;
        },
      }),
      /synthetic_tool_schema_unavailable/u,
    );
    assert.equal(dispatches, 0);
    assert.equal(usage, 0);
  }
});
