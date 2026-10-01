import path from "node:path";
import { readBoundedRegularFile } from "./resume";

const integerLimits = new Set([
  "MAX_TASK_STEPS",
  "MAX_TASK_TOKENS",
  "MAX_RECURRING_DAILY_TOKENS",
  "MAX_TASK_FAMILY_TOKENS",
  "MAX_RECURRING_FAMILY_DAILY_TOKENS",
  "MAX_TASK_FAMILY_ACTIVE",
  "MAX_TASK_FAMILY_TOTAL",
  "MAX_AUTOMATIC_DIRECT_REPORTS",
]);
const costLimits = new Set([
  "MAX_TASK_REPORTED_COST_USD",
  "MAX_RECURRING_DAILY_REPORTED_COST_USD",
  "MAX_TASK_FAMILY_REPORTED_COST_USD",
  "MAX_RECURRING_FAMILY_DAILY_REPORTED_COST_USD",
]);
/** Preserve only recognized positive budget overrides, never arbitrary secrets
 * or execution/host settings from an old environment file. */
export function parseBudgetOverrides(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const key = trimmed.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)/)?.[1];
    if (!key || (!integerLimits.has(key) && !costLimits.has(key))) continue;
    const match = trimmed.match(
      /^(?:export\s+)?[A-Z][A-Z0-9_]*\s*=\s*(.*?)\s*$/,
    );
    let value = match?.[1]?.replace(/\s+#.*$/, "").trim();
    if (
      value &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    )
      value = value.slice(1, -1);
    const number = Number(value);
    if (
      result[key] !== undefined ||
      !value ||
      !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ||
      !Number.isFinite(number) ||
      number <= 0 ||
      number > Number.MAX_SAFE_INTEGER ||
      (integerLimits.has(key) && !Number.isSafeInteger(number))
    )
      throw new Error(`Invalid or duplicate budget setting: ${key}`);
    result[key] = String(number);
  }
  return result;
}
export async function readInstallationBudgetOverrides(directory: string) {
  try {
    return parseBudgetOverrides(
      await readBoundedRegularFile(
        path.join(directory, "compose.env"),
        64_000,
        { rejectSymlinks: true },
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
