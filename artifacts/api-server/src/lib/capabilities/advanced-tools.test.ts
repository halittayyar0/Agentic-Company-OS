import assert from "node:assert/strict";
import test from "node:test";
import { runPackTool as run } from "./pack-tools";

test("literal text operations reject unpaired surrogates in every text field", () => {
  for (const malformed of ["\uDE00", "\uD83D"]) {
    assert.throws(() => run("text_find", { text: "😀a😀a", query: malformed }));
    assert.throws(() => run("text_find", { text: malformed, query: "a" }));
    assert.throws(() =>
      run("text_replace", { text: "😀", search: malformed, replacement: "X" }),
    );
    assert.throws(() =>
      run("text_replace", { text: malformed, search: "a", replacement: "X" }),
    );
    assert.throws(() =>
      run("text_replace", { text: "a", search: "a", replacement: malformed }),
    );
  }
});
test("literal text operations preserve astral characters and combining text", () => {
  assert.deepEqual(run("text_find", { text: "😀a😀a", query: "😀" }).matches, [
    { offset: 0, line: 1, column: 1 },
    { offset: 2, line: 1, column: 3 },
  ]);
  assert.deepEqual(
    run("text_replace", {
      text: "😀e\u0301😀e\u0301",
      search: "😀",
      replacement: "🚀",
    }),
    { text: "🚀e\u0301🚀e\u0301", replacements: 2 },
  );
  assert.deepEqual(
    run("text_find", { text: "é e\u0301", query: "e\u0301" }).matches,
    [{ offset: 2, line: 1, column: 3 }],
  );
});

test("group minima, maxima and counts use exact negative decimal ordering", () => {
  for (const [operation, value] of [
    ["min", "-12.01"],
    ["max", "-2"],
    ["count", "3"],
  ]) {
    assert.deepEqual(
      run("csv_group", {
        text: "k,n\na,-2\na,-12.01\na,-2.001",
        keys: ["k"],
        column: "n",
        operation,
      }).groups,
      [{ keys: ["a"], value, count: 3 }],
    );
  }
});
test("JSON reads only own properties and keeps prototype-shaped keys inert", () => {
  assert.deepEqual(
    run("json_select", {
      text: '{"__proto__":{"x":1}}',
      paths: ["/constructor", "/__proto__/x"],
    }).selections,
    [
      { path: "/constructor", found: false },
      { path: "/__proto__/x", found: true, value: 1 },
    ],
  );
  assert.deepEqual(run("json_flatten", { text: '{"__proto__":{}}' }).entries, [
    { path: "/__proto__", value: {} },
  ]);
  assert.equal(Object.hasOwn(Object.prototype, "x"), false);
});
test("output limits reject expansion and too many literal matches", () => {
  assert.throws(() =>
    run("json_select", {
      text: JSON.stringify({ v: "x".repeat(2000) }),
      paths: Array(40).fill("/v"),
    }),
  );
  assert.throws(() => run("text_find", { text: "a".repeat(1001), query: "a" }));
  assert.throws(() =>
    run("json_flatten", { text: JSON.stringify(Array(2001).fill(0)) }),
  );
});

test("tiny binary unit conversion retains every terminating decimal digit", () => {
  assert.equal(
    run("convert_units", {
      value: "0." + "0".repeat(95) + "1",
      from: "B",
      to: "GiB",
    }).value,
    "0." + "0".repeat(105) + "931322574615478515625",
  );
});
test("aggregate input bounds reject many individually valid cells", () => {
  assert.throws(() =>
    run("compare_lists", {
      left: Array(100).fill("x".repeat(1000)),
      right: [],
      mode: "set",
    }),
  );
  assert.throws(() =>
    run("markdown_table", {
      headers: ["a"],
      rows: Array(100).fill(["x".repeat(1000)]),
    }),
  );
});

test("select CSV columns in requested order preserving quoted Unicode", () => {
  assert.equal(
    run("csv_select", {
      text: 'id,note,extra\n1,"İzmir, 東京",x',
      columns: ["note", "id"],
    }).text,
    'note,id\r\n"İzmir, 東京",1\r\n',
  );
});
test("group CSV with exact decimal sums and first-seen ordering", () => {
  assert.deepEqual(
    run("csv_group", {
      text: "team,n\na,9007199254740993.1\na,0.2\nb,-0.01",
      keys: ["team"],
      column: "n",
      operation: "sum",
    }).groups,
    [
      { keys: ["a"], value: "9007199254740993.3", count: 2 },
      { keys: ["b"], value: "-0.01", count: 1 },
    ],
  );
});
test("JSON pointers distinguish missing and null and decode escaped keys", () => {
  assert.deepEqual(
    run("json_select", {
      text: '{"a/b":{"~":null},"items":["✓"]}',
      paths: ["/a~1b/~0", "/items/0", "/missing"],
    }).selections,
    [
      { path: "/a~1b/~0", found: true, value: null },
      { path: "/items/0", found: true, value: "✓" },
      { path: "/missing", found: false },
    ],
  );
});
test("flatten JSON preserves empty containers with escaped pointer paths", () => {
  assert.deepEqual(
    run("json_flatten", { text: '{"a/b":[1,{}],"~":[]}' }).entries,
    [
      { path: "/a~1b/0", value: 1 },
      { path: "/a~1b/1", value: {} },
      { path: "/~0", value: [] },
    ],
  );
});
test("list comparison explicitly counts multiplicities", () => {
  assert.deepEqual(
    run("compare_lists", {
      left: ["x", "x", "y"],
      right: ["x", "z"],
      mode: "multiset",
    }),
    { onlyLeft: ["x", "y"], onlyRight: ["z"], common: ["x"] },
  );
  assert.deepEqual(
    run("compare_lists", { left: ["x", "x"], right: [], mode: "set" }).onlyLeft,
    ["x"],
  );
});
test("literal search returns code point offsets without interpreting regex", () => {
  assert.deepEqual(
    run("text_find", { text: "😀a.*\na.*", query: "a.*" }).matches,
    [
      { offset: 1, line: 1, column: 2 },
      { offset: 5, line: 2, column: 1 },
    ],
  );
});
test("literal replacement never interprets replacement dollar sequences", () => {
  assert.deepEqual(
    run("text_replace", { text: "a.a", search: "a", replacement: "$&" }),
    { text: "$&.$&", replacements: 2 },
  );
});
test("markdown tables escape user HTML, pipes, backticks and line breaks", () => {
  assert.equal(
    run("markdown_table", { headers: ["A"], rows: [["<img>|`\n*"]] }).text,
    "| A |\n| --- |\n| &lt;img&gt;&#124;&#96; &#42; |\n",
  );
});
test("unit conversion is exact and dimension checked", () => {
  assert.deepEqual(
    run("convert_units", { value: "9007199254740993.1", from: "km", to: "m" }),
    { value: "9007199254740993100", from: "km", to: "m" },
  );
  assert.equal(
    run("convert_units", { value: "1", from: "h", to: "s" }).value,
    "3600",
  );
});
test("date intervals validate leap dates and preserve signed calendar distance", () => {
  assert.deepEqual(
    run("date_interval", { start: "2024-02-28", end: "2024-03-01" }),
    { days: 2 },
  );
  assert.equal(
    run("date_interval", { start: "2024-03-01", end: "2024-02-28" }).days,
    -2,
  );
});
test("advanced tools fail closed on malformed, ambiguous and oversized data", () => {
  const cases: [string, unknown][] = [
    ["csv_select", { text: "a,a\n1,2", columns: ["a"] }],
    ["csv_select", { text: "a\n1", columns: ["a", "a"] }],
    ["csv_select", { text: "__proto__\nx", columns: ["__proto__"] }],
    [
      "csv_group",
      { text: "a,n\nx,1e3", keys: ["a"], column: "n", operation: "sum" },
    ],
    ["json_select", { text: '{"n":9007199254740993}', paths: ["/n"] }],
    ["json_select", { text: "{}", paths: ["/~2"] }],
    ["json_select", { text: "[]", paths: ["/01"] }],
    ["json_flatten", { text: "[".repeat(70) + "0" + "]".repeat(70) }],
    ["text_find", { text: "a", query: "" }],
    [
      "text_replace",
      { text: "a".repeat(1000), search: "a", replacement: "x".repeat(1000) },
    ],
    ["markdown_table", { headers: ["a"], rows: [["x", "y"]] }],
    ["convert_units", { value: "1", from: "m", to: "g" }],
    ["convert_units", { value: "1", from: "s", to: "h" }],
    ["date_interval", { start: "2023-02-29", end: "2024-01-01" }],
    ["date_interval", { start: "2024-01-01T00:00:00Z", end: "2024-01-02" }],
    ["compare_lists", { left: ["a"], right: [], mode: "set", extra: true }],
  ];
  for (const [name, args] of cases) assert.throws(() => run(name, args), name);
});
