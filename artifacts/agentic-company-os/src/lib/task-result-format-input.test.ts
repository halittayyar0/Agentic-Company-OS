import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskResultFormat } from "../../../../lib/db/src/task-result-format";
import { resultFormatInputSchema } from "./task-result-format-input";

test("browser submission and server contracts agree for persisted JSON heading boundaries", () => {
  const values: unknown[] = [
    null,
    {},
    [],
    "table",
    { kind: "table", columns: ["A", "B"], extra: true },
  ];
  for (const columns of [
    ["Owner", "Action"],
    ["المسؤول", "İş | 工作", "😀".repeat(40)],
    ["\\", "|"],
    Array.from({ length: 8 }, (_, index) => String(index)),
    [],
    ["One"],
    ["same", "same"],
    ["", "Action"],
    [" Owner", "Action"],
    ["Owner\u00a0", "Action"],
    ["Owner\n", "Action"],
    ["A\u007f", "B"],
    ["\ud800", "B"],
    ["\udfff", "B"],
    ["😀".repeat(41), "B"],
    Array.from({ length: 9 }, (_, index) => String(index)),
  ])
    values.push({ kind: "table", columns });
  for (const value of values) {
    let accepted = false,
      expected;
    try {
      expected = parseTaskResultFormat(value);
      accepted = true;
    } catch {
      /* rejected at server boundary */
    }
    const browser = resultFormatInputSchema.safeParse(value);
    assert.equal(browser.success, accepted, JSON.stringify(value));
    if (browser.success) assert.deepEqual(browser.data, expected);
  }
});
