import {
  advancedSchemas,
  advancedDescriptions,
  isAdvancedTool,
  runAdvancedTool,
} from "./advanced-tools";
import { z } from "zod/v4";
import type OpenAI from "openai";
import { parseBoundedCsv, runUtility } from "./utility-tools";
import { PACK_TOOL_NAMES } from "./names";
export { PACK_TOOL_NAMES } from "./names";

const text = z.string().max(48_000);
const key = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (value) => !["__proto__", "constructor", "prototype"].includes(value),
  );
const csv = { text, delimiter: z.enum([",", ";", "\t"]).default(",") };
export const packSchemas = {
  ...advancedSchemas,
  csv_filter: z
    .object({
      ...csv,
      column: key,
      operator: z.enum(["equals", "contains", "not_empty"]),
      value: z.string().max(1000).default(""),
    })
    .strict(),
  csv_sort: z
    .object({ ...csv, column: key, direction: z.enum(["asc", "desc"]) })
    .strict(),
  csv_dedupe: z.object({ ...csv, keys: z.array(key).min(1).max(128) }).strict(),
  csv_join: z
    .object({ left: text, right: text, key, kind: z.enum(["inner", "left"]) })
    .strict(),
  csv_to_json: z.object(csv).strict(),
  json_to_csv: z.object({ text }).strict(),
  json_diff: z.object({ before: text, after: text }).strict(),
  json_format: z
    .object({
      text,
      indent: z.union([z.literal(0), z.literal(2), z.literal(4)]).default(2),
    })
    .strict(),
  render_report: z
    .object({
      title: z.string().max(200),
      sections: z
        .array(
          z
            .object({
              heading: z.string().max(200),
              body: z.string().max(8000),
            })
            .strict(),
        )
        .max(20),
    })
    .strict(),
  fill_template: z
    .object({ template: text, values: z.record(key, z.string().max(8000)) })
    .strict(),
  markdown_outline: z.object({ text }).strict(),
  compare_page_text: z.object({ before: text, after: text }).strict(),
};
export type PackToolName = keyof typeof packSchemas;
export function isPackTool(name: string): name is PackToolName {
  return Object.hasOwn(packSchemas, name);
}
const descriptions: Record<PackToolName, string> = {
  ...advancedDescriptions,
  csv_filter:
    "Filter supplied CSV by exact text, substring, or nonempty column. Strings remain strings.",
  csv_sort:
    "Stable sort supplied CSV by Unicode string order, ascending or descending. Does not infer numeric types.",
  csv_dedupe:
    "Remove duplicate CSV rows by selected columns, preserving the first occurrence and original order.",
  csv_join:
    "Join supplied comma-separated CSV by an exact key, inner or left. Preserve all matches; reject more than 2000 output rows.",
  csv_to_json:
    "Convert supplied rectangular CSV with unique headers to JSON records. Cell values remain strings.",
  json_to_csv:
    "Convert a supplied JSON array of scalar records to CSV. Missing fields become empty cells; null is empty. Formula-like values remain data; output must not be blindly executed in spreadsheets.",
  json_diff:
    "Compare top-level keys of supplied JSON objects. Return added, removed and changed values; nested values are compared structurally.",
  json_format:
    "Validate and format supplied JSON without rounding numeric values. Does not evaluate code.",
  render_report:
    "Render a standalone HTML report from title and plain-text sections. All content is HTML-escaped; no scripts or remote resources.",
  fill_template:
    "Fill {{name}} placeholders using explicit string values. Reject missing or unused values. Plain text output, no code evaluation.",
  markdown_outline:
    "Extract ATX headings outside fenced code blocks from supplied Markdown, with line numbers.",
  compare_page_text:
    "Compare supplied page text after normalizing whitespace; return changed state, word counts and bounded positional line differences. Does not fetch URLs.",
};
export const packToolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] =
  PACK_TOOL_NAMES.map((name) => ({
    type: "function",
    function: {
      name,
      description:
        descriptions[name] +
        " Input and output are bounded; no filesystem, process or network access.",
      parameters: z.toJSONSchema(packSchemas[name]),
    },
  }));
function reject(): never {
  throw new Error("INVALID_PACK_INPUT");
}
function parseJson(source: string): unknown {
  runUtility("inspect_json", { text: source }, "en");
  return JSON.parse(source);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return reject();
  return value as Record<string, unknown>;
}
function table(source: string, delimiter = ",") {
  const [header = [], ...rows] = parseBoundedCsv(source, delimiter);
  if (
    !header.length ||
    new Set(header).size !== header.length ||
    header.some((k) => !key.safeParse(k).success) ||
    rows.some((row) => row.length !== header.length)
  )
    return reject();
  return { header, rows };
}
function emitCsv(header: string[], rows: unknown[][], delimiter = ",") {
  if (rows.length > 2000 || header.length > 128) return reject();
  const quote = (value: unknown) => {
    const s = String(value ?? "");
    return s.includes(delimiter) || /["\r\n]/u.test(s)
      ? `"${s.replaceAll('"', '""')}"`
      : s;
  };
  return {
    text:
      [header, ...rows]
        .map((row) => row.map(quote).join(delimiter))
        .join("\r\n") + "\r\n",
    rows: rows.length,
    columns: header.length,
  };
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          stable((value as Record<string, unknown>)[k]),
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/gu,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
export function runPackTool(
  name: string,
  args: unknown,
): Record<string, unknown> {
  if (!isPackTool(name)) return reject();
  if (isAdvancedTool(name)) return runAdvancedTool(name, args);
  // Each dispatch is parsed by its own strict schema below.
  let result: Record<string, unknown>;
  switch (name) {
    case "csv_filter": {
      const a = packSchemas[name].parse(args),
        t = table(a.text, a.delimiter),
        i = t.header.indexOf(a.column);
      if (i < 0) return reject();
      result = emitCsv(
        t.header,
        t.rows.filter((row) =>
          a.operator === "equals"
            ? row[i] === a.value
            : a.operator === "contains"
              ? row[i].includes(a.value)
              : row[i] !== "",
        ),
        a.delimiter,
      );
      break;
    }
    case "csv_sort": {
      const a = packSchemas[name].parse(args),
        t = table(a.text, a.delimiter),
        i = t.header.indexOf(a.column);
      if (i < 0) return reject();
      // Comparator direction is explicit; JavaScript's stable sort preserves equal keys.
      const rows = table(a.text, a.delimiter).rows.sort(
        (left, right) =>
          (left[i] < right[i] ? -1 : left[i] > right[i] ? 1 : 0) *
          (a.direction === "asc" ? 1 : -1),
      );
      result = emitCsv(t.header, rows, a.delimiter);
      break;
    }
    case "csv_dedupe": {
      const a = packSchemas[name].parse(args),
        t = table(a.text, a.delimiter),
        indices = a.keys.map((k) => t.header.indexOf(k));
      if (indices.some((i) => i < 0)) return reject();
      const seen = new Set<string>();
      result = emitCsv(
        t.header,
        t.rows.filter((row) => {
          const identity = JSON.stringify(indices.map((i) => row[i]));
          if (seen.has(identity)) return false;
          seen.add(identity);
          return true;
        }),
        a.delimiter,
      );
      break;
    }
    case "csv_join": {
      const a = packSchemas[name].parse(args),
        left = table(a.left),
        right = table(a.right),
        li = left.header.indexOf(a.key),
        ri = right.header.indexOf(a.key);
      if (li < 0 || ri < 0) return reject();
      const extra = right.header
        .map((k, i) => ({ k, i }))
        .filter((x) => x.i !== ri);
      if (extra.some((x) => left.header.includes(x.k))) return reject();
      const indexed = new Map<string, string[][]>();
      for (const row of right.rows) {
        const values = indexed.get(row[ri]) ?? [];
        values.push(row);
        indexed.set(row[ri], values);
      }
      const rows: string[][] = [];
      for (const row of left.rows) {
        const matches = indexed.get(row[li]) ?? (a.kind === "left" ? [[]] : []);
        for (const match of matches) {
          if (rows.length >= 2000) return reject();
          rows.push([...row, ...extra.map((x) => match[x.i] ?? "")]);
        }
      }
      result = emitCsv([...left.header, ...extra.map((x) => x.k)], rows);
      break;
    }
    case "csv_to_json": {
      const a = packSchemas[name].parse(args),
        t = table(a.text, a.delimiter);
      result = {
        records: t.rows.map((row) =>
          Object.fromEntries(t.header.map((k, i) => [k, row[i]])),
        ),
      };
      break;
    }
    case "json_to_csv": {
      const a = packSchemas[name].parse(args),
        records = parseJson(a.text);
      if (!Array.isArray(records) || records.length > 2000) return reject();
      const objects = records.map(object),
        header = [...new Set(objects.flatMap((row) => Object.keys(row)))];
      if (header.some((k) => !key.safeParse(k).success)) return reject();
      const rows = objects.map((row) =>
        header.map((k) => {
          const value = Object.hasOwn(row, k) ? row[k] : null;
          if (value !== null && typeof value === "object") return reject();
          return value;
        }),
      );
      result = emitCsv(header, rows);
      break;
    }
    case "json_diff": {
      const a = packSchemas[name].parse(args),
        before = object(parseJson(a.before)),
        after = object(parseJson(a.after));
      const keys = [
        ...new Set([...Object.keys(before), ...Object.keys(after)]),
      ].sort();
      result = {
        changes: keys
          .filter(
            (k) =>
              Object.hasOwn(before, k) !== Object.hasOwn(after, k) ||
              stable(before[k]) !== stable(after[k]),
          )
          .map((k) => ({
            key: k,
            ...(Object.hasOwn(before, k) ? { before: before[k] } : {}),
            ...(Object.hasOwn(after, k) ? { after: after[k] } : {}),
          })),
      };
      break;
    }
    case "json_format": {
      const a = packSchemas[name].parse(args);
      result = { text: JSON.stringify(parseJson(a.text), null, a.indent) };
      break;
    }
    case "render_report": {
      const a = packSchemas[name].parse(args);
      result = {
        html:
          '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
          escapeHtml(a.title) +
          "</title></head><body><main><h1>" +
          escapeHtml(a.title) +
          "</h1>" +
          a.sections
            .map(
              (s) =>
                "<section><h2>" +
                escapeHtml(s.heading) +
                '</h2><pre style="white-space:pre-wrap">' +
                escapeHtml(s.body) +
                "</pre></section>",
            )
            .join("") +
          "</main></body></html>",
      };
      break;
    }
    case "fill_template": {
      const a = packSchemas[name].parse(args),
        used = new Set<string>();
      const output = a.template.replace(
        /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/gu,
        (_all, k: string) => {
          if (!Object.hasOwn(a.values, k)) return reject();
          used.add(k);
          return a.values[k];
        },
      );
      if (Object.keys(a.values).some((k) => !used.has(k))) return reject();
      result = { text: output };
      break;
    }
    case "markdown_outline": {
      const a = packSchemas[name].parse(args);
      let fence: string | null = null;
      const headings: Array<{ level: number; text: string; line: number }> = [];
      a.text.split(/\r?\n/u).forEach((line, i) => {
        const marker = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);
        if (marker) {
          if (!fence) fence = marker[1];
          else if (
            marker[1][0] === fence[0] &&
            marker[1].length >= fence.length
          )
            fence = null;
          return;
        }
        if (fence) return;
        const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
        if (heading)
          headings.push({
            level: heading[1].length,
            text: heading[2],
            line: i + 1,
          });
      });
      result = { headings };
      break;
    }
    case "compare_page_text": {
      const a = packSchemas[name].parse(args),
        normalize = (s: string) =>
          s
            .split(/\r?\n/u)
            .map((line) => line.replace(/\s+/gu, " ").trim())
            .filter(Boolean)
            .join("\n");
      const before = normalize(a.before),
        after = normalize(a.after);
      result = {
        changed: before !== after,
        beforeWordCount: before ? before.split(/\s+/u).length : 0,
        afterWordCount: after ? after.split(/\s+/u).length : 0,
        diff: runUtility("compare_text", { before, after }, "en"),
      };
      break;
    }
  }
  if (JSON.stringify(result).length > 64000) return reject();
  return result;
}
