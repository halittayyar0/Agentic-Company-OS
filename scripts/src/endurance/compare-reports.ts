import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArguments(argv: string[]): {
  left: string;
  right: string;
  ignored: Set<string>;
} {
  const positional: string[] = [];
  const ignored = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--ignore") {
      const value = argv[index + 1];
      if (!value)
        throw new TypeError("--ignore requires a comma-separated value");
      for (const field of value.split(",")) {
        const trimmed = field.trim();
        if (trimmed) ignored.add(trimmed);
      }
      index += 1;
      continue;
    }
    if (argument.startsWith("--")) {
      throw new TypeError(`Unknown argument: ${argument}`);
    }
    positional.push(path.resolve(argument));
  }
  if (positional.length !== 2) {
    throw new TypeError("compare-reports requires exactly two report paths");
  }
  return { left: positional[0], right: positional[1], ignored };
}

function stableValue(value: unknown, ignored: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item, ignored));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !ignored.has(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item, ignored)]),
    );
  }
  return value;
}

async function main(): Promise<void> {
  const { left, right, ignored } = parseArguments(process.argv.slice(2));
  const [leftDocument, rightDocument] = await Promise.all([
    readFile(left, "utf8").then((value) => JSON.parse(value) as unknown),
    readFile(right, "utf8").then((value) => JSON.parse(value) as unknown),
  ]);
  const leftNormalized = JSON.stringify(stableValue(leftDocument, ignored));
  const rightNormalized = JSON.stringify(stableValue(rightDocument, ignored));
  if (leftNormalized !== rightNormalized) {
    throw new Error("Normalized endurance reports differ");
  }
  process.stdout.write("Normalized endurance reports match.\n");
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`compare-reports failed: ${message}\n`);
    process.exitCode = 1;
  });
}
