export type TaskResultFormatCheck =
  | {
      status:
        | "not_requested"
        | "invalid_contract"
        | "invalid_result"
        | "missing_table"
        | "invalid_table";
    }
  | { status: "satisfied"; rows: number; columns: number };

function cells(line: string): string[] {
  let source = line.trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|")) {
    let escapes = 0;
    for (
      let index = source.length - 2;
      index >= 0 && source[index] === "\\";
      index--
    )
      escapes++;
    if (escapes % 2 === 0) source = source.slice(0, -1);
  }
  const result: string[] = [];
  let current = "";
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === "\\" && ["|", "\\"].includes(source[index + 1])) {
      current += source[++index];
    } else if (char === "|") {
      result.push(current.trim());
      current = "";
    } else current += char;
  }
  result.push(current.trim());
  return result;
}

/** Bounded layout validation only: no rewriting, execution or factual verdict. */
export function checkTaskResultFormat(
  format: unknown,
  result: unknown,
): TaskResultFormatCheck {
  let contract;
  try {
    contract = parseTaskResultFormat(format);
  } catch {
    return { status: "invalid_contract" };
  }
  if (!contract) return { status: "not_requested" };
  if (
    typeof result !== "string" ||
    !result.trim() ||
    result.length > 65_536 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(result)
  )
    return { status: "invalid_result" };
  const normalized = result.replaceAll("\r\n", "\n");
  if (normalized.includes("\r")) return { status: "invalid_result" };
  const lines = normalized.split("\n");
  let fence: { marker: string; length: number } | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence.marker &&
        marker[1].length >= fence.length &&
        !line.slice(marker[0].length).trim()
      )
        fence = null;
      continue;
    }
    if (marker) {
      fence = { marker: marker[1][0], length: marker[1].length };
      continue;
    }
    if (/^(?: {4}|\t)/u.test(line)) continue;
    const headings = cells(line);
    if (
      headings.length !== contract.columns.length ||
      headings.some((value, slot) => value !== contract.columns[slot])
    )
      continue;
    const separator = cells(lines[index + 1] ?? "");
    if (
      separator.length !== headings.length ||
      separator.some((value) => !/^:?-{3,}:?$/u.test(value))
    )
      return { status: "invalid_table" };
    let rows = 0;
    for (let row = index + 2; row < lines.length && lines[row].trim(); row++) {
      const values = cells(lines[row]);
      if (
        /^(?: {4}|\t)/u.test(lines[row]) ||
        values.length !== headings.length ||
        !values.some(Boolean) ||
        ++rows > 200
      )
        return { status: "invalid_table" };
    }
    return rows
      ? { status: "satisfied", rows, columns: headings.length }
      : { status: "invalid_table" };
  }
  return { status: "missing_table" };
}
import { parseTaskResultFormat } from "@workspace/db/task-result-format";
