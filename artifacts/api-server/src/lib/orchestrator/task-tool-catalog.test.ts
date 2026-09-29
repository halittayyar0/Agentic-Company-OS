import assert from "node:assert/strict";
import test from "node:test";
import { createTaskToolCatalog } from "./task-tool-catalog";

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
