import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import { eligibleCompletionToolNames } from "./task-completion-catalog";

const tool = (
  name: string,
): OpenAI.Chat.Completions.ChatCompletionFunctionTool => ({
  type: "function",
  function: {
    name,
    description: "private fixture description",
    parameters: { type: "object" },
  },
});

test("the completion catalog excludes lifecycle, delegation, discovery and approval tools", () => {
  const excluded = [
    "complete_task",
    "delegate_task",
    "create_sub_agent",
    "request_approval",
    "request_user_input",
    "load_tools",
    "list_skills",
    "read_skill",
    "list_extensions",
    "log_note",
    "post_company_message",
    "update_task_progress",
    "vm_codex_task",
  ];
  assert.deepEqual(
    eligibleCompletionToolNames([...excluded.map(tool), tool("calculate")]),
    ["calculate"],
  );
});

test("ambiguous duplicate tool registrations cannot become completion proof choices", () => {
  assert.deepEqual(
    eligibleCompletionToolNames([
      tool("calculate"),
      tool("calculate"),
      tool("vm_read_file"),
    ]),
    ["vm_read_file"],
  );
});

test("completion choices are bounded safe names in stable order and cannot disclose descriptions or schemas", () => {
  const tools = [
    tool("vm_read_file"),
    tool("calculate"),
    tool("private/path"),
    tool("x".repeat(81)),
  ];
  assert.deepEqual(eligibleCompletionToolNames(tools), [
    "calculate",
    "vm_read_file",
  ]);
  assert.deepEqual(
    tools.map((value) =>
      value.type === "function" ? value.function.name : null,
    ),
    ["vm_read_file", "calculate", "private/path", "x".repeat(81)],
  );
  assert.doesNotMatch(
    JSON.stringify(eligibleCompletionToolNames(tools)),
    /private|description|parameters|schema/,
  );
});

test("an empty permitted catalog cannot enable a missing capability", () => {
  assert.deepEqual(eligibleCompletionToolNames([]), []);
});
