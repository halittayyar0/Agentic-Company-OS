import assert from "node:assert/strict";
import test from "node:test";
import {
  isRequestedCalculationCall,
  isRequestedCalculatorResult,
  verifyRealFirstTask,
  type ModelCapture,
} from "./real-local-first-task-proof";

const model = "qwen3.5:2b-q4_K_M";
const calculation = {
  id: "calculation-1",
  function: {
    name: "calculate",
    arguments: JSON.stringify({ operation: "add", values: [58.5, 14.5] }),
  },
};
const result = {
  role: "tool",
  tool_call_id: calculation.id,
  content: JSON.stringify({
    runtimeToolResult: {
      toolName: "calculate",
      content: JSON.stringify({
        data: { operation: "add", value: 73, arithmetic: "IEEE-754" },
      }),
    },
  }),
};
function capture(tools: unknown[], messages: unknown[] = []): ModelCapture {
  return {
    status: 200,
    request: { model: model + ":local", messages },
    response: {
      choices: [{ message: { tool_calls: tools } }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    },
  };
}
function evidence() {
  return {
    model,
    captures: [
      capture([calculation]),
      capture(
        [
          {
            id: "complete-1",
            function: { name: "complete_task", arguments: "{}" },
          },
        ],
        [result],
      ),
      capture([]),
    ],
    task: {
      status: "completed",
      completionAuthority: "agent",
      resultSummary: "The calculated result is 73.",
      lastModelId: "ollama:" + model,
      modelFallbackCount: 0,
      tokensUsed: 36,
    },
    tasksAfter: 1,
    agentsBefore: 5,
    agentsAfter: 5,
    sourceUnchanged: true,
  };
}

test("genuine first-task arithmetic binds the exact operation, values and tool ID", () => {
  assert.equal(isRequestedCalculationCall(calculation), true);
  assert.equal(
    isRequestedCalculationCall({
      ...calculation,
      function: {
        ...calculation.function,
        arguments: '{"operation":"add","values":[14.5,58.5]}',
      },
    }),
    true,
  );
  for (const args of [
    "not json",
    '{"operation":"add","values":[58.5,14.5,0]}',
    '{"operation":"multiply","values":[58.5,14.5]}',
    '{"operation":"add","values":["58.5",14.5]}',
  ])
    assert.equal(
      isRequestedCalculationCall({
        ...calculation,
        function: { ...calculation.function, arguments: args },
      }),
      false,
    );
  assert.equal(isRequestedCalculationCall({ ...calculation, id: "" }), false);
});

test("genuine first-task result rejects unbound IDs, prose and a different number", () => {
  const ids = new Set([calculation.id]);
  assert.equal(isRequestedCalculatorResult(result, ids), true);
  assert.equal(isRequestedCalculatorResult(result, new Set()), false);
  assert.equal(
    isRequestedCalculatorResult({ ...result, content: "73" }, ids),
    false,
  );
  assert.equal(
    isRequestedCalculatorResult(
      {
        ...result,
        content: result.content.replace('\\"value\\":73', '\\"value\\":173'),
      },
      ids,
    ),
    false,
  );
  assert.equal(
    isRequestedCalculatorResult({ ...result, role: "assistant" }, ids),
    false,
  );
});

test("genuine first-task acceptance requires settled usage and observed calculation before completion", () => {
  assert.deepEqual(verifyRealFirstTask(evidence()), {
    calls: 3,
    tokens: 36,
    arithmeticResult: 73,
    completionAuthority: "agent",
  });
});

test("genuine first-task proof refuses incomplete, replayed, cloud or unknown-usage work", () => {
  const variations = [
    (e: ReturnType<typeof evidence>) => {
      e.task.status = "blocked";
    },
    (e: ReturnType<typeof evidence>) => {
      e.task.completionAuthority = "operator";
    },
    (e: ReturnType<typeof evidence>) => {
      e.task.modelFallbackCount = 1;
    },
    (e: ReturnType<typeof evidence>) => {
      e.task.tokensUsed = 35;
    },
    (e: ReturnType<typeof evidence>) => {
      e.tasksAfter = 2;
    },
    (e: ReturnType<typeof evidence>) => {
      e.agentsAfter++;
    },
    (e: ReturnType<typeof evidence>) => {
      e.sourceUnchanged = false;
    },
    (e: ReturnType<typeof evidence>) => {
      e.captures[1] = capture([], [result]);
    },
    (e: ReturnType<typeof evidence>) => {
      e.captures[1] = capture([
        { function: { name: "complete_task", arguments: "{}" } },
      ]);
    },
    (e: ReturnType<typeof evidence>) => {
      e.captures[0].status = 500;
    },
    (e: ReturnType<typeof evidence>) => {
      e.captures[0].request = { model, messages: [] };
    },
    (e: ReturnType<typeof evidence>) => {
      e.captures[0].response = { choices: [] };
    },
    (e: ReturnType<typeof evidence>) => {
      e.captures = Array.from({ length: 13 }, () => capture([]));
    },
    (e: ReturnType<typeof evidence>) => {
      e.captures[0] = capture([
        { function: { name: "delegate_task", arguments: "{}" } },
      ]);
    },
    (e: ReturnType<typeof evidence>) => {
      e.captures[0] = capture([
        {
          function: {
            name: "load_tools",
            arguments: '{"names":["browser_click"]}',
          },
        },
      ]);
    },
  ];
  for (const change of variations) {
    const value = evidence();
    change(value);
    assert.throws(() => verifyRealFirstTask(value));
  }
});
