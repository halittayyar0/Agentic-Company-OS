import { resultFormatInputSchema } from "./task-result-format-input";
export type ResultTable = {
  columns: string[];
  rows: string[][];
  before: string;
  after: string;
};

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

/** Display-only parser. The server independently verifies completion. */
export function parseResultTable(
  format: unknown,
  content: unknown,
): ResultTable | null {
  const selected = resultFormatInputSchema.safeParse(format);
  if (
    !selected.success ||
    !selected.data ||
    typeof content !== "string" ||
    !content.trim() ||
    content.length > 65_536 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(content)
  )
    return null;
  const normalized = content.replaceAll("\r\n", "\n");
  if (normalized.includes("\r")) return null;
  const lines = normalized.split("\n");
  let fence: { marker: string; length: number } | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index],
      marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
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
      headings.length !== selected.data.columns.length ||
      headings.some(
        (cell, position) => cell !== selected.data!.columns[position],
      )
    )
      continue;
    const separator = cells(lines[index + 1] ?? "");
    if (
      separator.length !== headings.length ||
      separator.some((cell) => !/^:?-{3,}:?$/u.test(cell))
    )
      return null;
    const rows: string[][] = [];
    let row = index + 2;
    for (; row < lines.length && lines[row].trim(); row++) {
      const values = cells(lines[row]);
      if (
        /^(?: {4}|\t)/u.test(lines[row]) ||
        values.length !== headings.length ||
        !values.some(Boolean) ||
        rows.length >= 200
      )
        return null;
      rows.push(values);
    }
    return rows.length
      ? {
          columns: headings,
          rows,
          before: lines.slice(0, index).join("\n"),
          after: lines.slice(row).join("\n"),
        }
      : null;
  }
  return null;
}
