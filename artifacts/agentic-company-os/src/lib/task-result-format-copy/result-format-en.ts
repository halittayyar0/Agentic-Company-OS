import type { ResultFormatCopy } from "../task-result-format-copy";
export default {
  title: "Result format",
  plain: "Free text",
  table: "Table",
  columns: "Column headings",
  help: "Optional. Table results must include these columns in order before a cycle can finish. This checks structure, not factual accuracy, and grants no permissions.",
  add: "Add column",
  remove: "Remove column",
  invalid:
    "Use 2–8 different headings, each 1–80 characters, without surrounding spaces or control characters.",
  saved: "Saved result format",
  defaults: ["Owner", "Action", "Date"],
} satisfies ResultFormatCopy;
