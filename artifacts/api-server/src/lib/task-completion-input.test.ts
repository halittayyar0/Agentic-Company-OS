import assert from "node:assert/strict";
import test from "node:test";
import { CreateTaskBody } from "@workspace/api-zod";

const task = {
  title: "Verify a calculation",
  brief: "Use calculate for 17 times 23.",
};
const requirement = { kind: "tool_succeeded", tool: "calculate" };

test("the API creation contract retains explicit required tools for persistence and recovery", () => {
  const parsed = CreateTaskBody.parse({
    ...task,
    completionRequirements: [requirement],
  });
  assert.deepEqual(Reflect.get(parsed, "completionRequirements"), [
    requirement,
  ]);
});

test("legacy and explicitly empty API operation contracts remain compatible", () => {
  assert.equal(CreateTaskBody.safeParse(task).success, true);
  const parsed = CreateTaskBody.parse({ ...task, completionRequirements: [] });
  assert.deepEqual(Reflect.get(parsed, "completionRequirements"), []);
});

test("the API contract refuses over-limit, malformed and non-tool requirements", () => {
  const malformed = [
    null,
    "calculate",
    [null],
    [{ tool: "calculate" }],
    [{ kind: "answer_contains", tool: "calculate" }],
    [{ kind: "tool_succeeded", tool: "a".repeat(81) }],
    [{ kind: "tool_succeeded", tool: "../private" }],
    Array.from({ length: 9 }, (_, i) => ({
      kind: "tool_succeeded",
      tool: "fixture_" + i,
    })),
  ];
  for (const completionRequirements of malformed) {
    assert.equal(
      CreateTaskBody.safeParse({ ...task, completionRequirements }).success,
      false,
    );
  }
});
