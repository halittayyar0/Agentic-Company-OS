import assert from "node:assert/strict";
import test from "node:test";
import { parseCompletionRequirements } from "./completion-requirements";

test("omitted and empty owner requirements preserve the legacy empty contract", () => {
  assert.deepEqual(parseCompletionRequirements(undefined), []);
  assert.deepEqual(parseCompletionRequirements([]), []);
});

test("required operations have a stable exact-name ordering without changing owner input", () => {
  const input = Object.freeze([
    Object.freeze({ kind: "tool_succeeded", tool: "vm_read_file" }),
    Object.freeze({ kind: "tool_succeeded", tool: "calculate" }),
  ]);
  const actual = parseCompletionRequirements(input);
  assert.deepEqual(actual, [
    { kind: "tool_succeeded", tool: "calculate" },
    { kind: "tool_succeeded", tool: "vm_read_file" },
  ]);
  assert.equal(input[0].tool, "vm_read_file");
  assert.notEqual(actual, input);
  assert.notEqual(actual[0], input[1]);
  actual[0].tool = "vm_list_files";
  assert.equal(input[1].tool, "calculate");
});

test("the same required operations produce identical canonical input in either order", () => {
  const a = [
    { kind: "tool_succeeded", tool: "vm_read_file" },
    { kind: "tool_succeeded", tool: "calculate" },
  ];
  const b = [...a].reverse();
  assert.equal(
    JSON.stringify(parseCompletionRequirements(a)),
    JSON.stringify(parseCompletionRequirements(b)),
  );
});

test("invalid structures cannot silently remove or expand the completion contract", () => {
  for (const input of [
    null,
    true,
    "calculate",
    {},
    { tool: "calculate" },
    [null],
    [[]],
    ["calculate"],
    [{ kind: "tool_succeeded" }],
    [{ tool: "calculate" }],
    [{ kind: "answer_contains", tool: "calculate" }],
    [{ kind: "tool_succeeded", tool: "calculate", optional: true }],
    [{ kind: "tool_succeeded", tool: "calculate", approved: true }],
  ]) {
    assert.throws(
      () => parseCompletionRequirements(input),
      /completion_requirements_invalid/u,
      JSON.stringify(input),
    );
  }
});

test("tool identifiers reject private commands, paths, whitespace and control characters", () => {
  for (const tool of [
    "",
    " calculate",
    "calculate ",
    "calculate\n",
    "x\u0000",
    "../calculate",
    "C:\\PRIVATE\\file",
    "vm_run_command:echo secret",
    "计算",
    "_calculate",
    "a".repeat(81),
  ]) {
    assert.throws(
      () => parseCompletionRequirements([{ kind: "tool_succeeded", tool }]),
      /completion_requirements_invalid/u,
      JSON.stringify(tool),
    );
  }
});

test("duplicate exact operations and oversized criteria are refused instead of silently weakened", () => {
  const item = { kind: "tool_succeeded", tool: "calculate" };
  assert.throws(
    () => parseCompletionRequirements([item, { ...item }]),
    /completion_requirements_invalid/u,
  );
  const eight = Array.from({ length: 8 }, (_, i) => ({
    kind: "tool_succeeded",
    tool: "fixture_" + i,
  }));
  assert.equal(parseCompletionRequirements(eight).length, 8);
  assert.throws(
    () =>
      parseCompletionRequirements([
        ...eight,
        { kind: "tool_succeeded", tool: "fixture_8" },
      ]),
    /completion_requirements_invalid/u,
  );
});

test("lifecycle, delegation, approval and Codex-turn names cannot masquerade as output proof", () => {
  for (const tool of [
    "complete_task",
    "request_approval",
    "request_user_input",
    "delegate_task",
    "create_sub_agent",
    "update_task_progress",
    "load_tools",
    "list_skills",
    "read_skill",
    "list_extensions",
    "log_note",
    "post_company_message",
    "vm_codex_task",
  ]) {
    assert.throws(
      () => parseCompletionRequirements([{ kind: "tool_succeeded", tool }]),
      /completion_requirements_invalid/u,
      tool,
    );
  }
});

test("valid identifiers preserve case and a null prototype cannot bypass field validation", () => {
  const bare = Object.create(null);
  bare.kind = "tool_succeeded";
  bare.tool = "Fixture_1";
  assert.deepEqual(parseCompletionRequirements([bare]), [
    { kind: "tool_succeeded", tool: "Fixture_1" },
  ]);
  bare.extra = "private";
  assert.throws(
    () => parseCompletionRequirements([bare]),
    /completion_requirements_invalid/u,
  );
});
