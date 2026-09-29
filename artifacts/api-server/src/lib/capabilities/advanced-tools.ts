import { z } from "zod/v4";
import { parseBoundedCsv, runUtility } from "./utility-tools";

const text = z.string().max(48_000);
// In Unicode mode a valid surrogate pair is one astral code point, so this
// range matches only unpaired surrogates. Literal matching must never split one.
const wellFormedUnicode = (value: string) => !/[\uD800-\uDFFF]/u.test(value);
const key = z
  .string()
  .min(1)
  .max(128)
  .refine((v) => !["__proto__", "constructor", "prototype"].includes(v));
const columns = z
  .array(key)
  .min(1)
  .max(128)
  .refine((v) => new Set(v).size === v.length);
const csv = { text, delimiter: z.enum([",", ";", "\t"]).default(",") };
const decimal = z
  .string()
  .max(100)
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u);
const units = z.enum([
  "mm",
  "cm",
  "m",
  "km",
  "mg",
  "g",
  "kg",
  "ms",
  "s",
  "min",
  "h",
  "B",
  "KiB",
  "MiB",
  "GiB",
]);
export const advancedSchemas = {
  csv_select: z.object({ ...csv, columns }).strict(),
  csv_group: z
    .object({
      ...csv,
      keys: columns,
      column: key,
      operation: z.enum(["sum", "min", "max", "count"]),
    })
    .strict(),
  json_select: z
    .object({ text, paths: z.array(z.string().max(2000)).min(1).max(100) })
    .strict(),
  json_flatten: z.object({ text }).strict(),
  compare_lists: z
    .object({
      left: z.array(z.string().max(1000)).max(2000),
      right: z.array(z.string().max(1000)).max(2000),
      mode: z.enum(["set", "multiset"]),
    })
    .strict(),
  text_find: z
    .object({
      text: text.refine(wellFormedUnicode),
      query: z.string().min(1).max(1000).refine(wellFormedUnicode),
    })
    .strict(),
  text_replace: z
    .object({
      text: text.refine(wellFormedUnicode),
      search: z.string().min(1).max(1000).refine(wellFormedUnicode),
      replacement: z.string().max(8000).refine(wellFormedUnicode),
    })
    .strict(),
  markdown_table: z
    .object({
      headers: z.array(z.string().max(200)).min(1).max(32),
      rows: z.array(z.array(z.string().max(2000)).max(32)).max(500),
    })
    .strict(),
  convert_units: z.object({ value: decimal, from: units, to: units }).strict(),
  date_interval: z
    .object({
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
      end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    })
    .strict(),
};
export type AdvancedToolName = keyof typeof advancedSchemas;
export const advancedDescriptions: Record<AdvancedToolName, string> = {
  csv_select:
    "Select and reorder unique CSV columns. Preserve original string values and row order.",
  csv_group:
    "Group CSV by exact key strings in first-seen order. Count rows or sum/min/max a strict decimal column (no exponent or blanks). Values are exact decimal strings, never rounded.",
  json_select:
    "Select up to 100 RFC 6901 JSON pointers. Return found:false for missing paths, distinguish null. Reject lossy JSON numbers and malformed array indices.",
  json_flatten:
    "Flatten JSON to leaf entries with RFC 6901 paths, preserving empty containers. Maximum depth 32 and 2000 nodes; reject lossy numbers.",
  compare_lists:
    "Compare supplied string lists with explicit set or multiset semantics, preserving first appearance order. Return common and unmatched values, case sensitive.",
  text_find:
    "Find literal, case-sensitive nonoverlapping text matches. Return zero-based Unicode code-point offset and one-based line/column (LF lines). Maximum 1000 matches; no regex.",
  text_replace:
    "Replace all literal case-sensitive nonoverlapping matches. Replacement is literal including dollar signs. Return text and replacement count.",
  markdown_table:
    "Render rectangular string cells as a Markdown table. Escape HTML and Markdown punctuation; normalize cell line breaks to spaces. Maximum 32 columns and 500 rows.",
  convert_units:
    "Convert exact decimal strings within length mm/cm/m/km, mass mg/g/kg, time ms/s/min/h, or binary storage B/KiB/MiB/GiB. Reject nonterminating decimal results and cross-dimension conversions; never round.",
  date_interval:
    "Return signed elapsed calendar days from start to end for valid YYYY-MM-DD Gregorian dates (years 0001–9999). Excludes the starting day; no timezone or timestamps.",
};
function reject(): never {
  throw new Error("INVALID_PACK_INPUT");
}
function table(source: string, delimiter: string) {
  const [header = [], ...rows] = parseBoundedCsv(source, delimiter);
  if (
    !header.length ||
    new Set(header).size !== header.length ||
    header.some((k) => !key.safeParse(k).success) ||
    rows.some((r) => r.length !== header.length)
  )
    reject();
  return { header, rows };
}
// Fixed decimal scale supports all accepted input digits without IEEE-754 arithmetic.
const decimalPlaces = 140;
const scale = 10n ** BigInt(decimalPlaces);
function number(value: string): bigint {
  decimal.parse(value);
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return (
    (BigInt(whole) * scale +
      BigInt((fraction + "0".repeat(decimalPlaces)).slice(0, decimalPlaces))) *
    (value.startsWith("-") ? -1n : 1n)
  );
}
function formatted(value: bigint): string {
  const sign = value < 0n ? "-" : "",
    digits = (value < 0n ? -value : value)
      .toString()
      .padStart(decimalPlaces + 1, "0");
  const fraction = digits.slice(-decimalPlaces).replace(/0+$/u, "");
  return (
    sign + digits.slice(0, -decimalPlaces) + (fraction ? "." + fraction : "")
  );
}
function json(source: string): unknown {
  runUtility("inspect_json", { text: source }, "en");
  const value: unknown = JSON.parse(source);
  let nodes = 0;
  function check(v: unknown, depth: number) {
    if (++nodes > 2000 || depth > 32) reject();
    if (v && typeof v === "object")
      for (const child of Object.values(v)) check(child, depth + 1);
  }
  check(value, 0);
  return value;
}
export function isAdvancedTool(name: string): name is AdvancedToolName {
  return Object.hasOwn(advancedSchemas, name);
}
export function runAdvancedTool(
  name: AdvancedToolName,
  args: unknown,
): Record<string, unknown> {
  if (JSON.stringify(args).length > 48000) reject();
  let result: Record<string, unknown>;
  switch (name) {
    case "csv_select": {
      const a = advancedSchemas[name].parse(args),
        t = table(a.text, a.delimiter),
        indices = a.columns.map((k) => t.header.indexOf(k));
      if (indices.some((i) => i < 0)) reject();
      const quote = (v: string) =>
        v.includes(a.delimiter) || /["\r\n]/u.test(v)
          ? `"${v.replaceAll('"', '""')}"`
          : v;
      result = {
        text:
          [a.columns, ...t.rows.map((r) => indices.map((i) => r[i]))]
            .map((r) => r.map(quote).join(a.delimiter))
            .join("\r\n") + "\r\n",
        rows: t.rows.length,
        columns: a.columns.length,
      };
      break;
    }
    case "csv_group": {
      const a = advancedSchemas[name].parse(args),
        t = table(a.text, a.delimiter),
        indices = a.keys.map((k) => t.header.indexOf(k)),
        ci = t.header.indexOf(a.column);
      if (ci < 0 || indices.some((i) => i < 0)) reject();
      const groups = new Map<
        string,
        { keys: string[]; value: bigint; count: number }
      >();
      for (const row of t.rows) {
        const keys = indices.map((i) => row[i]),
          id = JSON.stringify(keys),
          n = a.operation === "count" ? scale : number(row[ci]),
          old = groups.get(id);
        if (!old) groups.set(id, { keys, value: n, count: 1 });
        else {
          old.count++;
          old.value =
            a.operation === "min"
              ? old.value < n
                ? old.value
                : n
              : a.operation === "max"
                ? old.value > n
                  ? old.value
                  : n
                : old.value + n;
        }
      }
      result = {
        groups: [...groups.values()].map((g) => ({
          ...g,
          value: formatted(g.value),
        })),
      };
      break;
    }
    case "json_select": {
      const a = advancedSchemas[name].parse(args),
        root = json(a.text);
      result = {
        selections: a.paths.map((path) => {
          if (path !== "" && !path.startsWith("/")) reject();
          const tokens =
            path === ""
              ? []
              : path
                  .slice(1)
                  .split("/")
                  .map((token) => {
                    if (/~(?:[^01]|$)/u.test(token)) reject();
                    return token.replaceAll("~1", "/").replaceAll("~0", "~");
                  });
          let value = root;
          for (const token of tokens) {
            if (Array.isArray(value) && !/^(?:0|[1-9]\d*)$/u.test(token))
              reject();
            if (
              !value ||
              typeof value !== "object" ||
              !Object.hasOwn(value, token)
            )
              return { path, found: false };
            value = (value as Record<string, unknown>)[token];
          }
          return { path, found: true, value };
        }),
      };
      break;
    }
    case "json_flatten": {
      const a = advancedSchemas[name].parse(args),
        entries: Array<{ path: string; value: unknown }> = [];
      function walk(value: unknown, path: string) {
        if (value && typeof value === "object" && Object.keys(value).length)
          for (const [k, v] of Object.entries(value))
            walk(v, path + "/" + k.replaceAll("~", "~0").replaceAll("/", "~1"));
        else entries.push({ path, value });
      }
      walk(json(a.text), "");
      result = { entries };
      break;
    }
    case "compare_lists": {
      const a = advancedSchemas[name].parse(args),
        left = a.mode === "set" ? [...new Set(a.left)] : a.left,
        right = a.mode === "set" ? [...new Set(a.right)] : a.right;
      const remaining = new Map<string, number>();
      for (const v of right) remaining.set(v, (remaining.get(v) ?? 0) + 1);
      const common: string[] = [],
        onlyLeft: string[] = [],
        onlyRight: string[] = [];
      for (const v of left) {
        const n = remaining.get(v) ?? 0;
        if (n) {
          common.push(v);
          remaining.set(v, n - 1);
        } else onlyLeft.push(v);
      }
      for (const v of right) {
        const n = remaining.get(v) ?? 0;
        if (n) {
          onlyRight.push(v);
          remaining.set(v, n - 1);
        }
      }
      result = { onlyLeft, onlyRight, common };
      break;
    }
    case "text_find": {
      const a = advancedSchemas[name].parse(args),
        matches: Array<{ offset: number; line: number; column: number }> = [];
      let pos = 0,
        offset = 0,
        line = 1,
        column = 1;
      while (pos < a.text.length) {
        const next = a.text.indexOf(a.query, pos);
        if (next < 0) break;
        for (const c of a.text.slice(pos, next)) {
          offset++;
          if (c === "\n") {
            line++;
            column = 1;
          } else column++;
        }
        if (matches.length >= 1000) reject();
        matches.push({ offset, line, column });
        for (const c of a.query) {
          offset++;
          if (c === "\n") {
            line++;
            column = 1;
          } else column++;
        }
        pos = next + a.query.length;
      }
      result = { matches };
      break;
    }
    case "text_replace": {
      const a = advancedSchemas[name].parse(args),
        parts = a.text.split(a.search),
        replacements = parts.length - 1;
      if (
        a.text.length -
          replacements * a.search.length +
          replacements * a.replacement.length >
        64000
      )
        reject();
      result = { text: parts.join(a.replacement), replacements };
      break;
    }
    case "markdown_table": {
      const a = advancedSchemas[name].parse(args);
      if (a.rows.some((r) => r.length !== a.headers.length)) reject();
      const escape = (s: string) =>
        s
          .replace(/&/gu, "&amp;")
          .replace(/</gu, "&lt;")
          .replace(/>/gu, "&gt;")
          .replace(/[\r\n]+/gu, " ")
          .replace(/[\\|`*_\[\]~]/gu, (c) => `&#${c.codePointAt(0)};`);
      const row = (r: string[]) => "| " + r.map(escape).join(" | ") + " |\n";
      result = {
        text:
          row(a.headers) +
          row(a.headers.map(() => "---")) +
          a.rows.map(row).join(""),
      };
      break;
    }
    case "convert_units": {
      const a = advancedSchemas[name].parse(args);
      const factors: Record<z.infer<typeof units>, [string, bigint]> = {
        mm: ["length", 1n],
        cm: ["length", 10n],
        m: ["length", 1000n],
        km: ["length", 1000000n],
        mg: ["mass", 1n],
        g: ["mass", 1000n],
        kg: ["mass", 1000000n],
        ms: ["time", 1n],
        s: ["time", 1000n],
        min: ["time", 60000n],
        h: ["time", 3600000n],
        B: ["storage", 1n],
        KiB: ["storage", 1024n],
        MiB: ["storage", 1048576n],
        GiB: ["storage", 1073741824n],
      };
      const from = factors[a.from],
        to = factors[a.to],
        numerator = number(a.value) * from[1];
      if (from[0] !== to[0] || numerator % to[1] !== 0n) reject();
      result = { value: formatted(numerator / to[1]), from: a.from, to: a.to };
      break;
    }
    case "date_interval": {
      const a = advancedSchemas[name].parse(args);
      const date = (s: string) => {
        const d = new Date(s + "T00:00:00.000Z");
        if (
          s.startsWith("0000") ||
          !Number.isFinite(d.getTime()) ||
          d.toISOString().slice(0, 10) !== s
        )
          reject();
        return d.getTime();
      };
      result = { days: (date(a.end) - date(a.start)) / 86400000 };
      break;
    }
  }
  if (JSON.stringify(result).length > 64000) reject();
  return result;
}
