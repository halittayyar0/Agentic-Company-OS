import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type OpenAI from "openai";
import type { WorkspaceLocale } from "../workspace-locale";

const text = z.string().max(48_000);
const schemas = {
  calculate: z
    .object({
      operation: z.enum([
        "add",
        "subtract",
        "multiply",
        "divide",
        "mean",
        "min",
        "max",
        "percentage",
      ]),
      values: z.array(z.number().finite()).min(1).max(1_000),
    })
    .strict(),
  analyze_text: z.object({ text }).strict(),
  compare_text: z.object({ before: text, after: text }).strict(),
  inspect_json: z
    .object({ text, pointer: z.string().max(1_024).optional() })
    .strict(),
  profile_csv: z
    .object({ text, delimiter: z.enum([",", ";", "\t"]).optional() })
    .strict(),
  convert_datetime: z
    .object({ iso: z.string().max(40), timeZone: z.string().min(1).max(100) })
    .strict(),
  inspect_url: z.object({ url: z.string().min(1).max(4_096) }).strict(),
  hash_text: z.object({ text }).strict(),
};
export type UtilityName = keyof typeof schemas;
export const UTILITY_NAMES = Object.keys(schemas) as UtilityName[];
export function isUtilityName(name: string): name is UtilityName {
  return Object.hasOwn(schemas, name);
}
export function validateUtilityArgs(name: string, args: unknown): boolean {
  return isUtilityName(name) && schemas[name].safeParse(args).success;
}

const descriptions: Record<UtilityName, string> = {
  calculate:
    "Compute bounded finite numbers. subtract/divide use left-to-right order; percentage requires exactly [part, whole]. No expression evaluation. Floating-point results are approximate.",
  analyze_text:
    "Count UTF-8 bytes, Unicode code points, graphemes, words and lines in supplied text. Word segmentation follows the execution locale. Does not read files.",
  compare_text:
    "Compare supplied text by line position (not a minimal diff); return at most 100 changed line positions with bounded excerpts and explicit truncation.",
  inspect_json:
    "Parse supplied JSON and inspect an optional RFC 6901 JSON Pointer. Reject numeric tokens whose decimal value or negative-zero sign would change on output. Return a bounded preview; no code execution or path access.",
  profile_csv:
    "Profile supplied CSV: at most 2000 data rows and 128 columns, comma/semicolon/tab delimiter, first row header, quoted multiline cells. Report ragged rows and per-column quality. unrepresentableNumeric counts numeric cells excluded for overflow, underflow or rounding; sumOverflow marks a nonfinite sum. Aggregates use approximate IEEE-754 arithmetic. Never evaluates formulas.",
  convert_datetime:
    "Convert an ISO timestamp with explicit Z or numeric offset to an IANA time zone. Does not infer a local time or current date.",
  inspect_url:
    "Parse an HTTP(S) URL into components and query entries. Does not fetch the URL or establish availability or safety. Embedded credentials are rejected.",
  hash_text:
    "Compute a SHA-256 fingerprint of exact supplied UTF-8 text. This is a checksum, not encryption, a signature or proof of origin.",
};
export const utilityToolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] =
  UTILITY_NAMES.map((name) => ({
    type: "function",
    function: {
      name,
      description: descriptions[name],
      parameters: z.toJSONSchema(schemas[name]),
    },
  }));

function fail(): never {
  throw new Error("INVALID_UTILITY_INPUT");
}
function finite(value: number): number {
  return Number.isFinite(value) ? value : fail();
}

/** Compare decimal values without rounding the source through Number first. */
function decimalIdentity(source: string): string {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/u.exec(source);
  if (!match || !(match[2] || match[3])) return fail();
  const digits = `${match[2]}${match[3] ?? ""}`.replace(/^0+/u, "");
  // Keep negative zero distinct: JSON.stringify would erase its sign.
  const sign = match[1] === "-" ? "-" : "";
  if (!digits) return `${sign}0`;
  const significant = digits.replace(/0+$/u, "");
  const exponent =
    Number(match[4] ?? "0") -
    (match[3]?.length ?? 0) +
    digits.length -
    significant.length;
  if (!Number.isSafeInteger(exponent)) return fail();
  return `${sign}${significant}e${exponent}`;
}

function numericRoundTripPreservesSource(
  source: string,
  value: number,
): boolean {
  if (!Number.isFinite(value)) return false;
  try {
    return decimalIdentity(source) === decimalIdentity(JSON.stringify(value));
  } catch {
    return false;
  }
}

/** All processors are bounded, in-process transformations of explicitly supplied data. */
export function runUtility(
  name: UtilityName,
  args: unknown,
  locale: WorkspaceLocale = "tr",
): Record<string, unknown> {
  // The same strict schema protects direct internal callers and production dispatch.
  const parsed = schemas[name].safeParse(args);
  if (!parsed.success) return fail();
  const input = parsed.data as Record<string, any>;
  switch (name) {
    case "calculate": {
      const values: number[] = input.values;
      let value: number;
      switch (input.operation) {
        case "add":
          value = values.reduce((a, b) => finite(a + b), 0);
          break;
        case "subtract":
          value = values.reduce((a, b) => finite(a - b));
          break;
        case "multiply":
          value = values.reduce((a, b) => finite(a * b), 1);
          break;
        case "divide":
          value = values.reduce((a, b) => (b === 0 ? fail() : finite(a / b)));
          break;
        case "mean":
          value = values.reduce((a, b) => finite(a + b / values.length), 0);
          break;
        case "min":
          value = Math.min(...values);
          break;
        case "max":
          value = Math.max(...values);
          break;
        case "percentage":
          value =
            values.length === 2 && values[1] !== 0
              ? finite((values[0] / values[1]) * 100)
              : fail();
          break;
        default:
          return fail();
      }
      return { operation: input.operation, value, arithmetic: "IEEE-754" };
    }
    case "hash_text":
      return {
        encoding: "UTF-8",
        bytes: Buffer.byteLength(input.text),
        sha256: createHash("sha256").update(input.text, "utf8").digest("hex"),
      };
    case "analyze_text": {
      const source: string = input.text;
      return {
        bytes: Buffer.byteLength(source),
        codePoints: [...source].length,
        graphemes: [
          ...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(
            source,
          ),
        ].length,
        words: [
          ...new Intl.Segmenter(locale, { granularity: "word" }).segment(
            source,
          ),
        ].filter((item) => item.isWordLike).length,
        lines: source ? source.split(/\r\n|\r|\n/u).length : 0,
        segmentationLocale: locale,
      };
    }
    case "compare_text": {
      const before: string[] = input.before.split(/\r\n|\r|\n/u);
      const after: string[] = input.after.split(/\r\n|\r|\n/u);
      const changes: Record<string, unknown>[] = [];
      let changedPositions = 0;
      for (
        let index = 0;
        index < Math.max(before.length, after.length);
        index++
      ) {
        if (before[index] === after[index]) continue;
        changedPositions++;
        if (changes.length < 100)
          changes.push({
            line: index + 1,
            before: before[index]?.slice(0, 80) ?? null,
            after: after[index]?.slice(0, 80) ?? null,
            excerptTruncated:
              (before[index]?.length ?? 0) > 80 ||
              (after[index]?.length ?? 0) > 80,
          });
      }
      return {
        equal: input.before === input.after,
        comparison: "line-position",
        lineEndingsOnly: input.before !== input.after && changedPositions === 0,
        changedPositions,
        truncated: changedPositions > changes.length,
        changes,
      };
    }
    case "inspect_json": {
      let value: unknown;
      try {
        value = JSON.parse(
          input.text,
          (_key, parsedValue, context?: { source?: string }) => {
            // Node 24 supplies each primitive's original token. Fail closed on
            // older runtimes rather than claiming rounded source data is exact.
            if (
              typeof parsedValue === "number" &&
              (typeof context?.source !== "string" ||
                !numericRoundTripPreservesSource(context.source, parsedValue))
            )
              return fail();
            return parsedValue;
          },
        );
      } catch {
        return fail();
      }
      const pointer: string = input.pointer ?? "";
      if (pointer !== "" && !pointer.startsWith("/")) return fail();
      for (const token of pointer === "" ? [] : pointer.slice(1).split("/")) {
        if (/~(?:[^01]|$)/u.test(token)) return fail();
        const key = token.replace(/~1/gu, "/").replace(/~0/gu, "~");
        if (
          value === null ||
          typeof value !== "object" ||
          !Object.hasOwn(value, key)
        )
          return fail();
        if (Array.isArray(value) && !/^(?:0|[1-9]\d*)$/u.test(key))
          return fail();
        value = (value as Record<string, unknown>)[key];
      }
      const encoded = JSON.stringify(value);
      const kind =
        value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
      const size =
        kind === "array"
          ? (value as unknown[]).length
          : kind === "object"
            ? Object.keys(value as object).length
            : null;
      return {
        pointer,
        kind,
        size,
        ...(encoded.length <= 8_000
          ? { value }
          : { preview: encoded.slice(0, 8_000) }),
        truncated: encoded.length > 8_000,
      };
    }
    case "profile_csv":
      return profileCsv(input.text, input.delimiter ?? ",");
    case "convert_datetime": {
      const iso: string = input.iso;
      const match =
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/u.exec(
          iso,
        );
      if (!match) return fail();
      const [, year, month, day, hour, minute, second, offset] = match;
      const daysInMonth = new Date(
        Date.UTC(Number(year), Number(month), 0),
      ).getUTCDate();
      if (
        +year < 100 ||
        +month < 1 ||
        +month > 12 ||
        +day < 1 ||
        +day > daysInMonth ||
        +hour > 23 ||
        +minute > 59 ||
        +second > 59 ||
        (offset !== "Z" && (+offset.slice(1, 3) > 23 || +offset.slice(4) > 59))
      )
        return fail();
      const date = new Date(iso);
      if (!Number.isFinite(date.getTime())) return fail();
      let display: string;
      try {
        display = new Intl.DateTimeFormat(locale, {
          timeZone: input.timeZone,
          dateStyle: "full",
          timeStyle: "long",
        }).format(date);
      } catch {
        return fail();
      }
      return {
        iso: date.toISOString(),
        epochMilliseconds: date.getTime(),
        timeZone: input.timeZone,
        display,
      };
    }
    case "inspect_url": {
      let url: URL;
      try {
        url = new URL(input.url);
      } catch {
        return fail();
      }
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return fail();
      return {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || null,
        pathname: url.pathname,
        query: [...url.searchParams.entries()],
        fragment: url.hash,
        networkRequest: false,
      };
    }
  }
}

export function parseBoundedCsv(source: string, delimiter: string): string[][] {
  if (source.length > 48_000 || ![",", ";", "\t"].includes(delimiter))
    return fail();
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const pushCell = () => {
    if (row.length >= 128) fail();
    row.push(cell);
    cell = "";
    closed = false;
  };
  const pushRow = () => {
    pushCell();
    if (rows.length >= 2_001) fail();
    rows.push(row);
    row = [];
  };
  // Strip only the optional transport BOM, not cell whitespace.
  source = source.replace(/^\uFEFF/u, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
      continue;
    }
    if (char === delimiter) {
      pushCell();
      continue;
    }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      pushRow();
      continue;
    }
    if (closed) return fail();
    if (char === '"') {
      if (cell !== "") return fail();
      quoted = true;
    } else cell += char;
  }
  if (quoted) return fail();
  if (cell || row.length || closed) pushRow();
  return rows;
}

function profileCsv(
  source: string,
  delimiter: string,
): Record<string, unknown> {
  const rows = parseBoundedCsv(source, delimiter);
  const header = rows.shift() ?? [];
  const columns = header.map((name, index) => {
    const values = rows.map((cells) => cells[index] ?? "");
    const numericSources = values
      .filter((value) =>
        /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(value.trim()),
      )
      .map((value) => value.trim());
    const representable = numericSources.filter((value) =>
      numericRoundTripPreservesSource(value, Number(value)),
    );
    const numeric = representable.map(Number);
    const sum = numeric.reduce((a, b) => a + b, 0);
    return {
      index,
      name: name.slice(0, 120),
      empty: values.filter((value) => value === "").length,
      distinct: new Set(values).size,
      numeric: numeric.length,
      unrepresentableNumeric: numericSources.length - numeric.length,
      min: numeric.length ? Math.min(...numeric) : null,
      max: numeric.length ? Math.max(...numeric) : null,
      sum: numeric.length && Number.isFinite(sum) ? sum : null,
      sumOverflow: numeric.length > 0 && !Number.isFinite(sum),
    };
  });
  return {
    arithmetic: "IEEE-754",
    rows: rows.length,
    headerColumns: header.length,
    duplicateHeaders: new Set(header).size !== header.length,
    raggedRows: rows.filter((cells) => cells.length !== header.length).length,
    headerNamesTruncated: header.some((name) => name.length > 120),
    columns,
  };
}
