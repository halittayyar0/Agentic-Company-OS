import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareCalculationEvidence,
  readCalculationEvidence,
} from "./calculation-evidence";

test("bounded calculation evidence preserves actual finite outputs and operand order for every operation", () => {
  const examples = [
    { operation: "add", values: [58.5, 14.5], value: 73 },
    { operation: "subtract", values: [20, 3, 2], value: 15 },
    { operation: "multiply", values: [3, 19.5], value: 58.5 },
    { operation: "divide", values: [20, 2, 5], value: 2 },
    { operation: "mean", values: [4, 8], value: 6 },
    { operation: "min", values: [9, 2, 7], value: 2 },
    { operation: "max", values: [9, 2, 7], value: 9 },
    { operation: "percentage", values: [3, 12], value: 25 },
    { operation: "multiply", values: [-0, 2], value: 0 },
  ];
  for (const { operation, values, value } of examples) {
    const evidence = prepareCalculationEvidence(
      { operation, values },
      JSON.stringify({
        message: "private presentation is not retained",
        data: { operation, value, arithmetic: "IEEE-754" },
      }),
    );
    assert.deepEqual(evidence, {
      schemaVersion: 1,
      operation,
      values,
      value,
      arithmetic: "IEEE-754",
    });
    assert.deepEqual(
      readCalculationEvidence(JSON.parse(JSON.stringify(evidence))),
      {
        schemaVersion: 1,
        operation,
        values: values.map((n) => (n === 0 ? 0 : n)),
        value,
        arithmetic: "IEEE-754",
      },
    );
    assert.notEqual(evidence!.values, values);
    assert.doesNotMatch(
      JSON.stringify(evidence),
      /private|presentation|message/u,
    );
  }
});

test("calculation evidence rejects disagreement, invalid arithmetic, malformed metadata and oversized operands", () => {
  const valid = {
    schemaVersion: 1,
    operation: "add",
    values: [2, 3],
    value: 5,
    arithmetic: "IEEE-754",
  };
  const malformed: unknown[] = [
    null,
    42,
    [],
    { ...valid, schemaVersion: 2 },
    { ...valid, operation: "PRIVATE_operation" },
    { ...valid, arithmetic: "exact" },
    { ...valid, values: [] },
    { ...valid, values: Array(9).fill(1), value: 9 },
    { ...valid, values: ["PRIVATE_value", 3] },
    { ...valid, values: [NaN, 3] },
    { ...valid, value: Infinity },
    { ...valid, value: 6 },
    { ...valid, values: { 0: 2, length: 1 } },
    { ...valid, secret: "PRIVATE_metadata" },
    { ...valid, operation: "divide", values: [2, 0], value: 0 },
    { ...valid, operation: "multiply", values: [1e308, 1e308], value: 1e308 },
    { ...valid, operation: "subtract", values: [3, 2], value: -1 },
  ];
  for (const value of malformed)
    assert.equal(readCalculationEvidence(value), null);
  assert.equal(
    prepareCalculationEvidence(
      { operation: "add", values: [2, 3] },
      JSON.stringify({
        data: { operation: "add", value: 6, arithmetic: "IEEE-754" },
      }),
    ),
    null,
  );
});

test("calculation evidence copies only the bounded calculator result and rejects unrelated or malformed content", () => {
  const args = { operation: "add", values: [2, 3] };
  for (const content of [
    "PRIVATE_raw_text",
    "{",
    JSON.stringify({ data: { text: "PRIVATE_output" } }),
    JSON.stringify({
      data: { operation: "multiply", value: 5, arithmetic: "IEEE-754" },
    }),
    " ".repeat(4097),
  ]) {
    assert.equal(prepareCalculationEvidence(args, content), null);
  }
  assert.equal(
    prepareCalculationEvidence(
      { ...args, secret: "PRIVATE_argument" },
      JSON.stringify({
        data: { operation: "add", value: 5, arithmetic: "IEEE-754" },
      }),
    ),
    null,
  );
  assert.equal(
    prepareCalculationEvidence(
      { operation: "add", values: Array(9).fill(1) },
      JSON.stringify({
        data: { operation: "add", value: 9, arithmetic: "IEEE-754" },
      }),
    ),
    null,
  );
});
