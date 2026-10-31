import assert from "node:assert/strict";

export interface ModelCapture {
  status: number;
  request: unknown;
  response: unknown;
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function parse(value: unknown, limit: number): Record<string, unknown> | null {
  if (typeof value !== "string" || value.length > limit) return null;
  try {
    return record(JSON.parse(value));
  } catch {
    return null;
  }
}
export function isRequestedCalculationCall(value: unknown): boolean {
  const call = record(value),
    fn = record(call?.function);
  if (
    typeof call?.id !== "string" ||
    !call.id ||
    call.id.length > 256 ||
    fn?.name !== "calculate"
  )
    return false;
  const args = parse(fn.arguments, 4096);
  return (
    args?.operation === "add" &&
    Array.isArray(args.values) &&
    args.values.length === 2 &&
    args.values.every((number) => typeof number === "number") &&
    [...args.values].sort((a: number, b: number) => a - b)[0] === 14.5 &&
    [...args.values].sort((a: number, b: number) => a - b)[1] === 58.5
  );
}
export function isRequestedCalculatorResult(
  value: unknown,
  ids: Set<string>,
): boolean {
  const message = record(value);
  if (
    message?.role !== "tool" ||
    typeof message.tool_call_id !== "string" ||
    !ids.has(message.tool_call_id)
  )
    return false;
  const tool = record(parse(message.content, 16384)?.runtimeToolResult);
  if (tool?.toolName !== "calculate") return false;
  const data = record(parse(tool.content, 4096)?.data);
  return (
    data?.operation === "add" &&
    data.value === 73 &&
    data.arithmetic === "IEEE-754"
  );
}

export function verifyRealFirstTask(input: {
  model: string;
  captures: ModelCapture[];
  task: {
    status: string;
    completionAuthority?: string | null;
    resultSummary?: string | null;
    lastModelId?: string | null;
    modelFallbackCount: number;
    tokensUsed: number;
  };
  tasksAfter: number;
  agentsBefore: number;
  agentsAfter: number;
  sourceUnchanged: boolean;
}) {
  assert.equal(input.model, "qwen3.5:2b-q4_K_M");
  assert.ok(
    input.captures.length > 0 && input.captures.length <= 12,
    "genuine_call_bound",
  );
  const ids = new Set<string>();
  let arithmeticObserved = false,
    completedAfterArithmetic = false,
    tokens = 0;
  for (const capture of input.captures) {
    assert.equal(capture.status, 200, "genuine_local_response_required");
    const request = record(capture.request),
      response = record(capture.response);
    assert.equal(
      request?.model,
      input.model + ":local",
      "explicit_local_selector_required",
    );
    assert.ok(Array.isArray(request?.messages), "captured_messages_required");
    if (
      request.messages.some((message) =>
        isRequestedCalculatorResult(message, ids),
      )
    )
      arithmeticObserved = true;
    const usage = record(response?.usage);
    for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) {
      assert.ok(
        Number.isSafeInteger(usage?.[key]) && (usage![key] as number) >= 0,
        "reported_integer_usage_required",
      );
    }
    assert.ok((usage!.total_tokens as number) > 0, "positive_usage_required");
    assert.equal(
      usage!.total_tokens,
      (usage!.prompt_tokens as number) + (usage!.completion_tokens as number),
      "usage_sum_mismatch",
    );
    tokens += usage!.total_tokens as number;
    assert.ok(Number.isSafeInteger(tokens), "exact_usage_total_required");
    assert.ok(
      Array.isArray(response?.choices) && response.choices.length > 0,
      "captured_choices_required",
    );
    for (const choice of response.choices) {
      const message = record(record(choice)?.message);
      assert.ok(message, "captured_response_message_required");
      if (message.tool_calls === undefined) continue;
      assert.ok(
        Array.isArray(message.tool_calls),
        "captured_tool_calls_required",
      );
      for (const call of message.tool_calls) {
        const fn = record(record(call)?.function);
        assert.ok(
          fn &&
            ["load_tools", "calculate", "complete_task"].includes(
              String(fn.name),
            ),
          "unrelated_tool_refused",
        );
        if (fn.name === "calculate") {
          assert.ok(
            isRequestedCalculationCall(call),
            "requested_calculation_required",
          );
          ids.add(record(call)!.id as string);
        } else if (fn.name === "complete_task") {
          assert.ok(
            arithmeticObserved,
            "completion_must_follow_bound_calculator_result",
          );
          completedAfterArithmetic = true;
        } else {
          const args = parse(fn.arguments, 4096);
          assert.ok(
            Array.isArray(args?.names) &&
              args.names.length > 0 &&
              args.names.every((name) =>
                ["calculate", "complete_task"].includes(String(name)),
              ),
            "unrelated_tool_discovery_refused",
          );
        }
      }
    }
  }
  assert.ok(
    arithmeticObserved && completedAfterArithmetic,
    "actual_calculation_and_completion_required",
  );
  assert.equal(input.task.status, "completed");
  assert.equal(input.task.completionAuthority, "agent");
  assert.match(input.task.resultSummary ?? "", /(?:^|\D)73(?:\D|$)/u);
  assert.equal(input.task.lastModelId, "ollama:" + input.model);
  assert.equal(input.task.modelFallbackCount, 0);
  assert.equal(
    input.task.tokensUsed,
    tokens,
    "durably_recorded_usage_must_match_raw_responses",
  );
  assert.equal(input.tasksAfter, 1, "exactly_one_task_required");
  assert.equal(input.agentsAfter, input.agentsBefore, "agent_creation_refused");
  assert.equal(
    input.sourceUnchanged,
    true,
    "tested_source_must_remain_unchanged",
  );
  return {
    calls: input.captures.length,
    tokens,
    arithmeticResult: 73,
    completionAuthority: "agent" as const,
  };
}
