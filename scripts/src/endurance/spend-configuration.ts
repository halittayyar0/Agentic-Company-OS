/** Pin the production spend defaults explicitly in synthetic evidence runs.
 * Otherwise Compose .env and native workspace settings can silently disagree
 * with the report. This module has no database or provider side effects. */
const DEFAULTS = {
  MAX_TASK_STEPS: 0,
  MAX_TASK_TOKENS: 100_000,
  MAX_TASK_REPORTED_COST_USD: 1,
  MAX_RECURRING_DAILY_TOKENS: 250_000,
  MAX_RECURRING_DAILY_REPORTED_COST_USD: 5,
  MAX_TASK_FAMILY_TOKENS: 250_000,
  MAX_TASK_FAMILY_REPORTED_COST_USD: 3,
  MAX_RECURRING_FAMILY_DAILY_TOKENS: 500_000,
  MAX_RECURRING_FAMILY_DAILY_REPORTED_COST_USD: 8,
} as const;

type SpendKey = keyof typeof DEFAULTS;
export type EnduranceSpendValues = Record<SpendKey, number>;
export interface EnduranceSpendConfiguration {
  environment: Record<SpendKey, string>;
  provenance: EnduranceSpendValues;
}

export function createEnduranceSpendConfiguration(
  source: NodeJS.ProcessEnv,
): EnduranceSpendConfiguration {
  const environment = {} as Record<SpendKey, string>;
  const provenance = {} as Record<SpendKey, number>;
  for (const key of Object.keys(DEFAULTS) as SpendKey[]) {
    const raw = source[key];
    const value = raw === undefined ? DEFAULTS[key] : Number(raw);
    const integer = key === "MAX_TASK_STEPS" || key.endsWith("_TOKENS");
    const valid =
      (raw === undefined || raw.trim().length > 0) &&
      Number.isFinite(value) &&
      value <= Number.MAX_SAFE_INTEGER &&
      (key === "MAX_TASK_STEPS" ? value <= 10_000 : true) &&
      (key === "MAX_TASK_TOKENS"
        ? value >= 1_000 && value <= 100_000_000
        : true) &&
      (integer ? Number.isSafeInteger(value) : true) &&
      (key === "MAX_TASK_STEPS" ? value >= 0 : value > 0);
    if (!valid) {
      // Never reflect an invalid environment value: it may contain a secret.
      throw new TypeError(`Invalid endurance spend setting: ${key}`);
    }
    environment[key] = String(value);
    provenance[key] = value;
  }
  return { environment, provenance };
}

/** Accept only the complete numeric contract, never raw environment values. */
export function validateEnduranceSpendProvenance(
  value: unknown,
): EnduranceSpendValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid wall-clock spend configuration");
  }
  const values = value as Record<string, unknown>;
  const keys = Object.keys(DEFAULTS) as SpendKey[];
  if (
    JSON.stringify(Object.keys(values).sort()) !==
      JSON.stringify([...keys].sort()) ||
    keys.some((key) => typeof values[key] !== "number")
  ) {
    throw new TypeError("Invalid wall-clock spend configuration");
  }
  try {
    return createEnduranceSpendConfiguration(
      Object.fromEntries(keys.map((key) => [key, String(values[key])])),
    ).provenance;
  } catch {
    throw new TypeError("Invalid wall-clock spend configuration");
  }
}
