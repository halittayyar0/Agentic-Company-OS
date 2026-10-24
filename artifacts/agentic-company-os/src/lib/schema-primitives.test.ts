import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod/v4-mini";
import { safeInteger, stringChoices } from "./schema-primitives";

test("shared browser integer validation preserves safe bounds without coercion", () => {
  const original = z.number().check(z.int());
  const values: unknown[] = [
    0,
    -0,
    1,
    -1,
    1.5,
    -1.5,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MIN_SAFE_INTEGER - 1,
    NaN,
    Infinity,
    -Infinity,
    "1",
    "",
    null,
    undefined,
    true,
    {},
    [],
    1n,
  ];
  const pairs = [
    [original, safeInteger],
    [
      original.check(z.minimum(1), z.maximum(2147483647)),
      safeInteger.check(z.minimum(1), z.maximum(2147483647)),
    ],
  ] as const;
  for (const [before, after] of pairs) {
    for (const value of values) {
      const expected = before.safeParse(value);
      const actual = after.safeParse(value);
      assert.equal(actual.success, expected.success);
      if (actual.success && expected.success)
        assert.deepEqual(actual.data, expected.data);
    }
  }
  assert.equal(safeInteger.safeParse(-1).success, true);
});

test("browser string choices preserve exact finite values and refusal of other inputs", () => {
  const choices = ["", "pending", "accepted", "rejected"] as const;
  const original = z.enum(choices);
  const shared = stringChoices(choices);
  for (const value of [
    ...choices,
    "Pending",
    " pending",
    "accepted ",
    "unknown",
    0,
    true,
    null,
    undefined,
    [],
    {},
    { toString: () => "accepted" },
  ]) {
    const expected = original.safeParse(value);
    const actual = shared.safeParse(value);
    assert.equal(actual.success, expected.success);
    if (actual.success && expected.success)
      assert.deepEqual(actual.data, expected.data);
  }
});
