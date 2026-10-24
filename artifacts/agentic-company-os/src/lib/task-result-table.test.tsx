import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseResultTable } from "./task-result-table";
import ResultTable from "../components/tasks/result-table";
import { Markdown } from "./markdown";
import { checkTaskResultFormat } from "../../../api-server/src/lib/task-result-format";

// The canonical Node runner preserves classic JSX for the legacy Markdown
// module; the browser build uses Vite's automatic JSX runtime.
const priorReact = Reflect.get(globalThis, "React");
Reflect.set(globalThis, "React", React);
test.after(() => {
  if (priorReact === undefined) Reflect.deleteProperty(globalThis, "React");
  else Reflect.set(globalThis, "React", priorReact);
});

const format = {
  kind: "table",
  columns: ["Owner | جهة", "Action \\", "Date 😀"],
};
const table =
  "| Owner \\| جهة | Action \\\\ | Date 😀 |\n| --- | --- | --- |\n| Mira | Review <script>alert(1)</script> | 2026-10-26 |\n| Deniz | FAQ \\| source | 2026-10-27 |";
test("table parsing preserves literal escaped headings, data and surrounding narrative without changing stored output", () => {
  assert.deepEqual(
    parseResultTable(
      format,
      "Before\r\n\r\n" +
        table.replaceAll("\n", "\r\n") +
        "\r\n\r\nLaunch remains undecided.",
    ),
    {
      columns: format.columns,
      rows: [
        ["Mira", "Review <script>alert(1)</script>", "2026-10-26"],
        ["Deniz", "FAQ | source", "2026-10-27"],
      ],
      before: "Before\n",
      after: "\nLaunch remains undecided.",
    },
  );
});
test("only matching bounded unfenced tables earn structured rendering", () => {
  for (const content of [
    "```\n" + table + "\n```",
    "~~~\n" + table + "\n~~~",
    table
      .split("\n")
      .map((row) => "    " + row)
      .join("\n"),
    table.replace("--- | --- | ---", "--- | -- | ---"),
    table.replace("Deniz | FAQ \\| source", "Deniz | FAQ | extra"),
    table + "\nFooter without blank",
    "x".repeat(65_537),
  ])
    assert.equal(parseResultTable(format, content), null, content.slice(0, 80));
  assert.equal(parseResultTable(null, table), null);
  assert.equal(
    parseResultTable({ ...format, columns: ["A", "A"] }, table),
    null,
  );
});
test("table renderer and server structure gate agree on accepted and rejected boundary fixtures", () => {
  const plain = { kind: "table", columns: ["A", "B"] };
  for (const content of [
    "A | B\n--- | ---\nx | y",
    "| A | B |\n| :--- | ---: |\n| x | y |\n\nFooter",
    "````\nA | B\n--- | ---\nx | y\n````",
    "~~~\nignored\n~~~\nA | B\n--- | ---\nx | y",
    "A | B\n--- | ---",
    "A | B\n--- | ---\n| |",
    "A | B\n--- | ---\nx | y | z",
    "A | B\n--- | ---\n" +
      Array.from({ length: 200 }, () => "x | y").join("\n"),
    "A | B\n--- | ---\n" +
      Array.from({ length: 201 }, () => "x | y").join("\n"),
  ])
    assert.equal(
      parseResultTable(plain, content) !== null,
      checkTaskResultFormat(plain, content).status === "satisfied",
    );
});
test("accepted table rows render semantic scoped headers and text-only cells in a keyboard-scrollable region", () => {
  const html = renderToStaticMarkup(
    <ResultTable content={table} format={format} label="Delivery" />,
  );
  assert.match(html, /<table\b/u);
  assert.equal((html.match(/scope="col"/gu) ?? []).length, 3);
  assert.equal((html.match(/<td\b/gu) ?? []).length, 6);
  assert.match(html, /role="region"/u);
  assert.match(html, /tabindex="0"/u);
  assert.ok(html.includes("Owner | جهة") && html.includes("FAQ | source"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!html.includes("<script") && !html.includes("javascript:"));
});
test("unselected or malformed tables keep the existing conservative Markdown behavior", () => {
  for (const selected of [
    null,
    { kind: "table", columns: ["Different", "Heading"] },
  ])
    assert.equal(
      renderToStaticMarkup(
        <ResultTable content={table} format={selected} label="Delivery" />,
      ),
      renderToStaticMarkup(<Markdown content={table} />),
    );
});
