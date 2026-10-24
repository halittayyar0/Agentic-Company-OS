import assert from "node:assert/strict";
import test from "node:test";
import { checkTaskResultFormat } from "./task-result-format";

const format = { kind: "table", columns: ["Owner", "Action", "Due"] };
const header = "| Owner | Action | Due |\n| --- | --- | --- |";
const row = "| Mira | Review accessibility | 2026-10-26 |";

test("plain legacy results receive no invented format requirement", () => {
  assert.deepEqual(checkTaskResultFormat(null, "A normal summary."), {
    status: "not_requested",
  });
  assert.deepEqual(checkTaskResultFormat(undefined, "A normal summary."), {
    status: "not_requested",
  });
});

test("a table contract accepts the actual table and a separate unresolved-decision footer", () => {
  const result = `${header}\n${row}\n| Deniz | Draft FAQ | 2026-10-27 |\n| Omar | Check backup | 2026-10-28 |\n\nLaunch date is not decided.`;
  assert.deepEqual(checkTaskResultFormat(format, result), {
    status: "satisfied",
    rows: 3,
    columns: 3,
  });
});

test("the genuine failed bullet result cannot satisfy a table contract", () => {
  const result =
    "Meeting notes extracted:\n- Mira will review accessibility checklist by 2026-10-26\n- Deniz will draft FAQ by 2026-10-27\n- Omar will check backup restoration by 2026-10-28\nLaunch date has not been decided.";
  assert.equal(checkTaskResultFormat(format, result).status, "missing_table");
});

test("headings and their requested order must match", () => {
  for (const result of [
    header.replace("Owner | Action", "Action | Owner"),
    header.replace("Owner", "Someone"),
  ])
    assert.equal(
      checkTaskResultFormat(format, `${result}\n${row}`).status,
      "missing_table",
    );
});

test("missing and extra table cells never silently disappear", () => {
  for (const result of [
    "| Mira | Review |",
    "| Mira | Review | 2026-10-26 | hidden |",
    "| | | |",
  ])
    assert.equal(
      checkTaskResultFormat(format, `${header}\n${result}`).status,
      "invalid_table",
    );
});

test("a header without separator or data rows is incomplete", () => {
  for (const result of [
    "Owner | Action | Due",
    header,
    header.replace("---", "-") + "\n" + row,
  ])
    assert.equal(checkTaskResultFormat(format, result).status, "invalid_table");
});

test("a narrative footer needs a blank boundary from the requested table", () => {
  assert.equal(
    checkTaskResultFormat(
      format,
      `${header}\n${row}\nLaunch date is undecided.`,
    ).status,
    "invalid_table",
  );
});

test("fenced examples and indented code cannot impersonate the requested table", () => {
  for (const result of [
    `\`\`\`markdown\n${header}\n${row}\n\`\`\``,
    `~~~\n${header}\n${row}\n~~~`,
    `${header}\n${row}`
      .split("\n")
      .map((x) => "    " + x)
      .join("\n"),
  ])
    assert.equal(checkTaskResultFormat(format, result).status, "missing_table");
});

test("outer pipes are optional and CRLF leaves the source untouched", () => {
  const result =
    "Owner | Action | Due\r\n:--- | ---: | :---:\r\nMira | Review | 2026-10-26";
  assert.deepEqual(checkTaskResultFormat(format, result), {
    status: "satisfied",
    rows: 1,
    columns: 3,
  });
  assert.ok(result.includes("\r\n"));
});

test("escaped literal pipes and backslashes preserve cell boundaries", () => {
  const contract = { kind: "table", columns: ["Work | item", "Path"] };
  const result = String.raw`| Work \| item | Path |
| --- | --- |
| Review A \| B | C:\\Temp |`;
  assert.deepEqual(checkTaskResultFormat(contract, result), {
    status: "satisfied",
    rows: 1,
    columns: 2,
  });
});

for (const headings of [
  ["Sahip", "İş", "Tarih"],
  ["Owner", "Action", "Due"],
  ["Person", "Aufgabe", "Datum"],
  ["Ответственный", "Действие", "Срок"],
  ["负责人", "事项", "日期"],
  ["負責人", "事項", "日期"],
  ["المسؤول", "الإجراء", "التاريخ"],
])
  test(`literal table headings remain valid: ${headings.join(" / ")}`, () => {
    const result =
      headings.join(" | ") + "\n--- | --- | ---\nMira | Review | 2026-10-26";
    assert.deepEqual(
      checkTaskResultFormat({ kind: "table", columns: headings }, result),
      { status: "satisfied", rows: 1, columns: 3 },
    );
  });

test("malformed contracts and result types fail closed", () => {
  assert.equal(
    checkTaskResultFormat({ kind: "table", columns: [] }, row).status,
    "invalid_contract",
  );
  for (const result of [
    null,
    {},
    5,
    [row],
    "\0",
    `${header}\n| Mira | Bad \ud800 | 2026-10-26 |`,
    "x".repeat(65_537),
  ])
    assert.equal(
      checkTaskResultFormat(format, result).status,
      "invalid_result",
    );
});

test("table verification has a fixed row bound", () => {
  assert.equal(
    checkTaskResultFormat(
      format,
      header + "\n" + Array(200).fill(row).join("\n"),
    ).status,
    "satisfied",
  );
  assert.equal(
    checkTaskResultFormat(
      format,
      header + "\n" + Array(201).fill(row).join("\n"),
    ).status,
    "invalid_table",
  );
});
