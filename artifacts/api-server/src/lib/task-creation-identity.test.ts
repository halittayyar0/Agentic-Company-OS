import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  taskCreationInputDigest,
  type TaskCreationIdentityInput,
} from "./task-creation-identity";

const oldDigest = (input: TaskCreationIdentityInput) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        "task-creation-v1",
        input.title.trim(),
        input.brief,
        input.ownerAgentId ?? null,
        input.priority ?? "normal",
        input.dueAt?.toISOString() ?? null,
        input.autonomyMode ?? "finite",
        input.autonomyMode === "continuous"
          ? (input.cadenceSeconds ?? 3600)
          : null,
      ]),
    )
    .digest("hex");
const calculate = { kind: "tool_succeeded", tool: "calculate" } as const;

test("plain result formats preserve existing v1 and v2 request identities", () => {
  const plain = { title: "Formatted", brief: "Read notes", ownerAgentId: 7 };
  const required = {
    ...plain,
    completionRequirements: [
      { kind: "tool_succeeded", tool: "vm_read_file" } as const,
    ],
  };
  assert.equal(
    taskCreationInputDigest({ ...plain, resultFormat: null }),
    oldDigest(plain),
  );
  for (const resultFormat of [undefined, null])
    assert.equal(
      taskCreationInputDigest({ ...required, resultFormat }),
      "e410eed954aa88faeb73512dbf382c537489879717e4d9d83482aedde864293a",
    );
});

test("changing table columns or their order cannot replay another result contract", () => {
  const input = { title: "Formatted", brief: "Read notes" };
  const resultFormat = {
    kind: "table" as const,
    columns: ["Owner", "Action", "Due"],
  };
  const digest = taskCreationInputDigest({ ...input, resultFormat });
  assert.notEqual(digest, taskCreationInputDigest(input));
  assert.notEqual(
    digest,
    taskCreationInputDigest({
      ...input,
      resultFormat: { ...resultFormat, columns: ["Action", "Owner", "Due"] },
    }),
  );
  assert.notEqual(
    digest,
    taskCreationInputDigest({
      ...input,
      resultFormat: { ...resultFormat, columns: ["Owner", "Action", "Date"] },
    }),
  );
  assert.equal(
    digest,
    taskCreationInputDigest({
      ...input,
      resultFormat: { columns: ["Owner", "Action", "Due"], kind: "table" },
    }),
  );
});

test("malformed layouts cannot receive a task recovery identity", () => {
  for (const value of [
    {},
    { kind: "table", columns: [] },
    { kind: "table", columns: ["Owner", "Owner"] },
  ])
    assert.throws(
      () =>
        taskCreationInputDigest({
          title: "Invalid",
          brief: "Read",
          resultFormat:
            value as unknown as TaskCreationIdentityInput["resultFormat"],
        }),
      /task_result_format_invalid/,
    );
});

test("omitted or empty requirements preserve all existing creation recovery digests", () => {
  const inputs: TaskCreationIdentityInput[] = [
    { title: "  Legacy task  ", brief: "\nPreserve exact input\n" },
    { title: "Recurring", brief: "Repeat", autonomyMode: "continuous" },
    {
      title: "Full",
      brief: "Exact",
      ownerAgentId: 23,
      priority: "urgent",
      autonomyMode: "continuous",
      cadenceSeconds: 7200,
      dueAt: new Date("2026-10-11T10:00:00Z"),
    },
    {
      title: "Finite",
      brief: "No cadence",
      autonomyMode: "finite",
      cadenceSeconds: 7200,
      dueAt: null,
    },
  ];
  for (const input of inputs) {
    assert.equal(taskCreationInputDigest(input), oldDigest(input));
    assert.equal(
      taskCreationInputDigest({ ...input, completionRequirements: [] }),
      oldDigest(input),
    );
  }
});

test("adding or changing a required operation cannot replay an earlier creation request", () => {
  const input = { title: "Calculate", brief: "Calculate 17 times 23" };
  const required = taskCreationInputDigest({
    ...input,
    completionRequirements: [calculate],
  });
  assert.notEqual(required, taskCreationInputDigest(input));
  assert.notEqual(
    required,
    taskCreationInputDigest({
      ...input,
      completionRequirements: [
        { kind: "tool_succeeded", tool: "vm_read_file" },
      ],
    }),
  );
});

test("equivalent reordered requirements have the same recovery identity without changing the input", () => {
  const input = { title: "Required actions", brief: "Two operations" };
  const requirements = [
    calculate,
    { kind: "tool_succeeded", tool: "vm_read_file" } as const,
  ];
  assert.equal(
    taskCreationInputDigest({ ...input, completionRequirements: requirements }),
    taskCreationInputDigest({
      ...input,
      completionRequirements: [...requirements].reverse(),
    }),
  );
  assert.deepEqual(
    requirements.map((value) => value.tool),
    ["calculate", "vm_read_file"],
  );
});

test("malformed required operations cannot receive a valid creation recovery identity", () => {
  for (const value of [
    null,
    "calculate",
    [{ ...calculate, optional: true }],
    [calculate, calculate],
    [{ kind: "tool_succeeded", tool: "complete_task" }],
  ]) {
    assert.throws(
      () =>
        taskCreationInputDigest({
          title: "Invalid",
          brief: "Preserve",
          completionRequirements:
            value as unknown as TaskCreationIdentityInput["completionRequirements"],
        }),
      /completion_requirements_invalid/,
    );
  }
});

test("required-operation recovery retains the existing exact brief, owner, schedule and priority distinctions", () => {
  const input: TaskCreationIdentityInput = {
    title: "Required",
    brief: "text",
    completionRequirements: [calculate],
    ownerAgentId: 23,
    priority: "normal",
    autonomyMode: "continuous",
    cadenceSeconds: 3600,
    dueAt: new Date("2026-10-11T10:00:00Z"),
  };
  for (const changed of [
    { brief: "text\n" },
    { ownerAgentId: 24 },
    { priority: "urgent" as const },
    { autonomyMode: "finite" as const },
    { cadenceSeconds: 7200 },
    { dueAt: new Date("2026-10-12T10:00:00Z") },
  ]) {
    assert.notEqual(
      taskCreationInputDigest({ ...input, ...changed }),
      taskCreationInputDigest(input),
    );
  }
});
