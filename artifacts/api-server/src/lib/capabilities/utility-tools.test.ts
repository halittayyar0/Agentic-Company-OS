import assert from "node:assert/strict";
import test from "node:test";
import { runUtility, validateUtilityArgs } from "./utility-tools";

test("arithmetic computes bounded numbers without executing expressions", () => {
  assert.equal(
    runUtility("calculate", { operation: "divide", values: [10, 4] }).value,
    2.5,
  );
  assert.equal(
    runUtility("calculate", { operation: "percentage", values: [3, 12] }).value,
    25,
  );
  assert.throws(() =>
    runUtility("calculate", { operation: "divide", values: [1, 0] }),
  );
  assert.throws(() =>
    runUtility("calculate", { operation: "multiply", values: [1e300, 1e300] }),
  );
  assert.equal(
    validateUtilityArgs("calculate", { expression: "process.exit()" }),
    false,
  );
  assert.equal(
    validateUtilityArgs("calculate", { operation: "add", values: [Infinity] }),
    false,
  );
});

test("JSON inspection uses exact own-property pointers and preserves literal evidence", () => {
  const json = JSON.stringify({ "a/b": { "~key": ["$& {x}", 2] }, "": false });
  assert.deepEqual(
    runUtility("inspect_json", { text: json, pointer: "/a~1b/~0key/0" }).value,
    "$& {x}",
  );
  assert.equal(
    runUtility("inspect_json", { text: json, pointer: "/" }).value,
    false,
  );
  assert.throws(() =>
    runUtility("inspect_json", { text: json, pointer: "/toString" }),
  );
  assert.throws(() =>
    runUtility("inspect_json", { text: json, pointer: "/a~2b" }),
  );
  assert.throws(() => runUtility("inspect_json", { text: "[broken" }));
  assert.equal(
    validateUtilityArgs("inspect_json", { text: "x".repeat(50_000) }),
    false,
  );
});

test("JSON inspection rejects numeric changes instead of silently rounding source evidence", () => {
  for (const text of [
    '{"id":9007199254740993}',
    '{"amount":1e400}',
    "1e-400",
    "1.0000000000000001",
    "-0",
  ]) {
    assert.throws(() => runUtility("inspect_json", { text }), text);
  }
  for (const text of [
    "0.1",
    "1.20e2",
    "1e300",
    "0e99999999",
    "9007199254740992",
  ]) {
    assert.equal(runUtility("inspect_json", { text }).value, JSON.parse(text));
  }
});

test("CSV reports excluded numeric values and approximate aggregate overflow explicitly", () => {
  const data = runUtility("profile_csv", {
    text: "id\n9007199254740992\n9007199254740993\n1e400\n1e-400",
  });
  const column = (data.columns as any[])[0];
  assert.equal(column.numeric, 1);
  assert.equal(column.unrepresentableNumeric, 3);
  assert.equal(column.distinct, 4);
  assert.equal(data.arithmetic, "IEEE-754");
  const overflow = (
    runUtility("profile_csv", { text: "x\n1e308\n1e308" }).columns as any[]
  )[0];
  assert.equal(overflow.sum, null);
  assert.equal(overflow.sumOverflow, true);
});

test("CSV profiling handles quoted commas, escaped quotes, multiline cells and duplicate headers", () => {
  const result = runUtility("profile_csv", {
    text: 'name,name,value\r\n"a,b","say ""hi""",12\r\n"line\nbreak",,8\r\n',
  });
  assert.equal(result.rows, 2);
  assert.equal(result.raggedRows, 0);
  assert.equal(result.duplicateHeaders, true);
  assert.deepEqual((result.columns as any[])[2], {
    index: 2,
    name: "value",
    empty: 0,
    distinct: 2,
    numeric: 2,
    unrepresentableNumeric: 0,
    min: 8,
    max: 12,
    sum: 20,
    sumOverflow: false,
  });
  assert.equal(
    runUtility("profile_csv", { text: "a,b\n1\n2,3,4" }).raggedRows,
    2,
  );
  assert.throws(() => runUtility("profile_csv", { text: 'a\n"unterminated' }));
  assert.throws(() => runUtility("profile_csv", { text: 'a\n"closed"junk' }));
});

test("text tools bound excerpts and handle Unicode and empty input", () => {
  const stats = runUtility("analyze_text", { text: "👩‍💻 世界\r\nhello" }, "en");
  assert.equal(stats.lines, 2);
  assert.ok((stats.graphemes as number) < (stats.codePoints as number));
  assert.equal(runUtility("analyze_text", { text: "" }).lines, 0);
  const comparison = runUtility("compare_text", {
    before: "a\nb",
    after: "a\nc\nd",
  });
  assert.equal(comparison.equal, false);
  assert.equal((comparison.changes as any[]).length, 2);
  assert.equal(
    runUtility("compare_text", { before: "a", after: "a" }).equal,
    true,
  );
});

test("collection limits and truncation are explicit even on adversarial supplied data", () => {
  assert.equal(
    validateUtilityArgs("calculate", {
      operation: "add",
      values: Array(1_001).fill(1),
    }),
    false,
  );
  assert.throws(() =>
    runUtility("profile_csv", { text: "header\n" + "1\n".repeat(2_001) }),
  );
  assert.throws(() =>
    runUtility("profile_csv", { text: Array(129).fill("column").join(",") }),
  );
  const json = runUtility("inspect_json", {
    text: JSON.stringify({ source: "x".repeat(9_000) }),
  });
  assert.equal(json.truncated, true);
  assert.equal((json.preview as string).length, 8_000);
  const compare = runUtility("compare_text", {
    before: "x\n".repeat(101),
    after: "y\n".repeat(101),
  });
  assert.equal(compare.changedPositions, 101);
  assert.equal(compare.truncated, true);
  assert.equal((compare.changes as unknown[]).length, 100);
  assert.equal(runUtility("profile_csv", { text: "formula\n=2+2" }).rows, 1);
  assert.equal(
    (runUtility("profile_csv", { text: "formula\n=2+2" }).columns as any[])[0]
      .numeric,
    0,
  );
});

test("date, URL, and hashing tools are deterministic and reject ambiguous input", () => {
  const date = runUtility(
    "convert_datetime",
    { iso: "2026-09-28T12:30:00Z", timeZone: "Europe/Istanbul" },
    "en",
  );
  assert.equal(date.iso, "2026-09-28T12:30:00.000Z");
  assert.throws(() =>
    runUtility("convert_datetime", {
      iso: "2026-02-30T00:00:00Z",
      timeZone: "UTC",
    }),
  );
  assert.throws(() =>
    runUtility("convert_datetime", { iso: "2026-09-28", timeZone: "UTC" }),
  );
  assert.throws(() =>
    runUtility("convert_datetime", {
      iso: "2026-09-28T12:30:00Z",
      timeZone: "invalid",
    }),
  );
  assert.equal(
    runUtility("inspect_url", { url: "https://example.com/a?q=1&q=2#b" })
      .networkRequest,
    false,
  );
  assert.throws(() => runUtility("inspect_url", { url: "file:///etc/passwd" }));
  assert.throws(() =>
    runUtility("inspect_url", { url: "https://user:secret@example.com" }),
  );
  assert.equal(
    runUtility("hash_text", { text: "abc" }).sha256,
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(
    validateUtilityArgs("hash_text", { text: "abc", path: "/secret" }),
    false,
  );
});
