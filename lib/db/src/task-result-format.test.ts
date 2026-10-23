import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskResultFormat } from "./task-result-format";

test("legacy tasks have no implicit result format", () => {
  assert.equal(parseTaskResultFormat(undefined), null);
  assert.equal(parseTaskResultFormat(null), null);
});

test("table headings retain their order and are copied without mutation", () => {
  const input = { kind: "table", columns: ["Owner", "Action", "Due"] };
  const parsed = parseTaskResultFormat(input);
  assert.deepEqual(parsed, input);
  input.columns.reverse();
  assert.deepEqual(parsed?.columns, ["Owner", "Action", "Due"]);
  assert.deepEqual(
    parseTaskResultFormat({ kind: "table", columns: ["B", "A"] })?.columns,
    ["B", "A"],
  );
});

test("result contracts reject malformed shapes and noncanonical headings", () => {
  for (const value of [
    [],
    "table",
    false,
    1,
    {},
    { kind: "text" },
    { kind: "table", columns: ["One"] },
    { kind: "table", columns: Array.from({ length: 9 }, (_, i) => String(i)) },
    { kind: "table", columns: ["Owner", "Owner"] },
    { kind: "table", columns: ["Owner", ""] },
    { kind: "table", columns: [" Owner", "Action"] },
    { kind: "table", columns: ["Owner", "Action "] },
    { kind: "table", columns: ["Owner", "Line\nbreak"] },
    { kind: "table", columns: ["Owner", "NUL\0value"] },
    { kind: "table", columns: ["Owner", "\ud800"] },
    { kind: "table", columns: ["Owner", "\udfff"] },
    { kind: "table", columns: ["Owner", "x".repeat(81)] },
    { kind: "table", columns: ["Owner", 3] },
    { kind: "table", columns: ["Owner", "Action"], permissions: true },
  ])
    assert.throws(
      () => parseTaskResultFormat(value),
      /task_result_format_invalid/,
    );
});

test("result contract parsing never calls field or array getters", () => {
  let reads = 0;
  const columns = ["Owner", "Action"];
  Object.defineProperty(columns, "0", {
    get: () => {
      reads++;
      return "Owner";
    },
  });
  const object = {
    kind: "table",
    get columns() {
      reads++;
      return ["Owner", "Action"];
    },
  };
  assert.throws(
    () => parseTaskResultFormat(object),
    /task_result_format_invalid/,
  );
  assert.throws(
    () => parseTaskResultFormat({ kind: "table", columns }),
    /task_result_format_invalid/,
  );
  assert.equal(reads, 0);
});

test("result contracts reject sparse and extra-property arrays", () => {
  const sparse = new Array(2);
  sparse[1] = "Action";
  const extra = Object.assign(["Owner", "Action"], {
    privateData: "not a column",
  });
  for (const columns of [sparse, extra])
    assert.throws(
      () => parseTaskResultFormat({ kind: "table", columns }),
      /task_result_format_invalid/,
    );
});

test("bounded Unicode headings and literal pipe data remain supported", () => {
  const columns = [
    "المسؤول",
    "İş | 工作",
    "Path \\ name",
    "🧑 Result",
    "x".repeat(80),
  ];
  assert.deepEqual(
    parseTaskResultFormat({ kind: "table", columns })?.columns,
    columns,
  );
  assert.equal(
    parseTaskResultFormat({
      kind: "table",
      columns: Array.from({ length: 8 }, (_, i) => String(i)),
    })?.columns.length,
    8,
  );
});
