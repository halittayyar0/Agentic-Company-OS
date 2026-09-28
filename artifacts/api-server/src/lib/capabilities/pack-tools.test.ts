import assert from "node:assert/strict";
import test from "node:test";
import { runPackTool } from "./pack-tools";

test("CSV tools preserve quoted cells and join all matching rows without prototype keys", () => {
  const source =
    'id,note\r\n1,"hello, world"\r\n2,"line\nnext"\r\n1,"hello, world"';
  const unique = runPackTool("csv_dedupe", {
    text: source,
    keys: ["id", "note"],
  });
  assert.equal(
    unique.text,
    'id,note\r\n1,"hello, world"\r\n2,"line\nnext"\r\n',
  );
  const joined = runPackTool("csv_join", {
    left: "id,name\n1,A\n1,B\n2,C",
    right: "id,value\n1,x\n1,y",
    key: "id",
    kind: "left",
  });
  assert.equal(joined.rows, 5);
  assert.match(String(joined.text), /2,C,/);
  assert.throws(() =>
    runPackTool("csv_filter", {
      text: "id,id\n1,2",
      column: "id",
      operator: "equals",
      value: "1",
    }),
  );
  assert.throws(() =>
    runPackTool("json_to_csv", { text: '[{"__proto__":"x"}]' }),
  );
});

test("document tools escape HTML and require every template input", () => {
  const report = runPackTool("render_report", {
    title: "<script>x</script>",
    sections: [{ heading: "Notes", body: "<img src=x onerror=alert(1)>" }],
  });
  assert.ok(!String(report.html).includes("<script>"));
  assert.match(String(report.html), /&lt;img/);
  assert.equal(
    runPackTool("fill_template", {
      template: "Hello {{name}}",
      values: { name: "Ada" },
    }).text,
    "Hello Ada",
  );
  assert.throws(() =>
    runPackTool("fill_template", { template: "{{missing}}", values: {} }),
  );
});

test("JSON and data tools reject lossy numbers, missing keys, oversized values and unbounded join expansion", () => {
  assert.throws(() =>
    runPackTool("json_to_csv", { text: '[{"id":9007199254740993}]' }),
  );
  assert.throws(() =>
    runPackTool("csv_sort", {
      text: "a\n1",
      column: "missing",
      direction: "asc",
    }),
  );
  assert.throws(() =>
    runPackTool("csv_dedupe", { text: "a".repeat(48001), keys: ["a"] }),
  );
  const repeated = "id\n" + "1\n".repeat(50);
  assert.throws(() =>
    runPackTool("csv_join", {
      left: repeated,
      right: repeated,
      key: "id",
      kind: "inner",
    }),
  );
  assert.deepEqual(
    runPackTool("json_diff", {
      before: '{"a":1,"b":2}',
      after: '{"a":3,"c":4}',
    }).changes,
    [
      { key: "a", before: 1, after: 3 },
      { key: "b", before: 2 },
      { key: "c", after: 4 },
    ],
  );
});
