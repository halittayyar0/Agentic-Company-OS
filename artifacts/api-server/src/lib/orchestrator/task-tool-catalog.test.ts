import assert from "node:assert/strict";
import test from "node:test";
import { createTaskToolCatalog } from "./task-tool-catalog";

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
