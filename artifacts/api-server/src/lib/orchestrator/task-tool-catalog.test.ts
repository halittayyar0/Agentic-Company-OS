import assert from "node:assert/strict";
import test from "node:test";
import { createTaskToolCatalog } from "./task-tool-catalog";

test("rejected authorized proposals recover original schemas without dropping selected tools", () => {
  const authorized = [
    "calculate",
    "complete_task",
    "vm_read_file",
    "log_note",
  ].map((name) => ({
    type: "function" as const,
    function: {
      name,
      description: `Original schema for ${name}`,
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  }));
  const catalog = createTaskToolCatalog(authorized);
  catalog.load('{"names":["log_note"]}');
  assert.equal(catalog.recover("vm_read_file"), true);
  assert.deepEqual(
    catalog.tools.map((tool) => tool.function.name),
    ["calculate", "complete_task", "log_note", "vm_read_file", "load_tools"],
  );
  assert.strictEqual(catalog.tools[3], authorized[2]);
  assert.equal(catalog.recover("vm_read_file"), true);
  assert.equal(catalog.tools.length, 5);
  catalog.load('{"names":["log_note"]}');
  assert.ok(
    !catalog.tools.some((tool) => tool.function.name === "vm_read_file"),
  );
});

test("schema recovery cannot expose unknown tools or grow beyond eight optional schemas", () => {
  const catalog = createTaskToolCatalog(
    Array.from({ length: 9 }, (_, index) => ({
      type: "function" as const,
      function: { name: `optional_${index}`, parameters: { type: "object" } },
    })),
  );
  for (let index = 0; index < 8; index++)
    assert.equal(catalog.recover(`optional_${index}`), true);
  const before = catalog.tools;
  for (const name of [
    "optional_8",
    "not_authorized",
    " optional_0",
    "load_tools",
  ])
    assert.equal(catalog.recover(name), false);
  assert.deepEqual(catalog.tools, before);
  assert.equal(catalog.recover("optional_0"), true);
});

test("core schemas are never added or reclassified by optional recovery", () => {
  const catalog = createTaskToolCatalog([
    {
      type: "function",
      function: { name: "calculate", parameters: { type: "object" } },
    },
  ]);
  const before = catalog.tools;
  assert.equal(catalog.recover("calculate"), false);
  assert.equal(catalog.recover("complete_task"), false);
  assert.deepEqual(catalog.tools, before);
});

test("initial task envelope defers guidance and approval schemas without losing authority or parameters", () => {
  const deferredNames = [
    "list_skills",
    "read_skill",
    "request_approval",
    "update_task_progress",
    "request_user_input",
  ];
  const authorized = ["calculate", "complete_task", ...deferredNames].map(
    (name) => ({
      type: "function" as const,
      function: {
        name,
        description: `Full instructions for ${name}. `.repeat(20),
        parameters: {
          type: "object",
          properties: { input: { type: "string", enum: ["reviewed"] } },
          required: ["input"],
          additionalProperties: false,
        },
      },
    }),
  );
  const catalog = createTaskToolCatalog(authorized);
  assert.deepEqual(
    catalog.tools.map((tool) => tool.function.name),
    ["calculate", "complete_task", "load_tools"],
  );
  for (const name of deferredNames) {
    assert.ok(catalog.index.split("\n")[1]!.split(", ").includes(name));
    catalog.load(JSON.stringify({ names: [name] }));
    assert.deepEqual(
      catalog.tools.map((tool) => tool.function.name),
      ["calculate", "complete_task", name, "load_tools"],
    );
    assert.strictEqual(
      catalog.tools.find((tool) => tool.function.name === name),
      authorized.find((tool) => tool.function.name === name),
    );
    const before = catalog.tools;
    assert.throws(() =>
      catalog.load(JSON.stringify({ names: [name, "execute_unapproved"] })),
    );
    assert.deepEqual(catalog.tools, before);
  }
  catalog.load(JSON.stringify({ names: deferredNames }));
  assert.deepEqual(catalog.tools.slice(2, -1), authorized.slice(2));
  catalog.load('{"names":["calculate"]}');
  assert.deepEqual(
    catalog.tools.map((tool) => tool.function.name),
    ["calculate", "complete_task", "load_tools"],
  );
  const restricted = createTaskToolCatalog([authorized[0]!]);
  assert.ok(!restricted.index.includes("request_approval"));
  assert.throws(() => restricted.load('{"names":["request_approval"]}'));
});

test("task catalog bounds schema payload and cannot expand tool authority", () => {
  const catalog = createTaskToolCatalog(
    [
      "calculate",
      "complete_task",
      ...Array.from({ length: 60 }, (_, i) => `optional_${i}`),
    ].map((name) => ({
      type: "function",
      function: {
        name,
        description: "x".repeat(1000),
        parameters: { type: "object" },
      },
    })),
  );
  assert.deepEqual(
    catalog.tools.map((t) => t.function.name),
    ["calculate", "complete_task", "load_tools"],
  );
  assert.ok(catalog.index.includes("optional_59"));
  catalog.load('{"names":["optional_1","optional_1"]}');
  assert.equal(catalog.tools.length, 4);
  assert.throws(() => catalog.load('{"names":["unauthorized"]}'));
  assert.equal(catalog.tools.length, 4);
  assert.throws(() =>
    catalog.load(JSON.stringify({ names: Array(9).fill("optional_1") })),
  );
  assert.throws(() => catalog.load("null"));
  catalog.load('{"names":["optional_2"]}');
  assert.ok(!catalog.tools.some((t) => t.function.name === "optional_1"));
  assert.ok(catalog.tools.some((t) => t.function.name === "optional_2"));
});

test("optional tools remain fully usable without sending all descriptions in every turn", () => {
  const optional = Array.from({ length: 60 }, (_, i) => ({
    type: "function" as const,
    function: {
      name: `optional_${i}`,
      description: "Complete guidance ".repeat(100),
      parameters: {
        type: "object",
        properties: { input: { type: "string" } },
        required: ["input"],
      },
    },
  }));
  const catalog = createTaskToolCatalog(optional);
  assert.ok(Buffer.byteLength(catalog.index, "utf8") < 1600);
  for (const tool of optional)
    assert.ok(catalog.index.includes(tool.function.name));
  catalog.load(JSON.stringify({ names: ["optional_27"] }));
  assert.deepEqual(
    catalog.tools.find((tool) => tool.function.name === "optional_27"),
    optional[27],
  );
  assert.throws(() =>
    catalog.load(JSON.stringify({ names: ["not_authorized"] })),
  );
});
