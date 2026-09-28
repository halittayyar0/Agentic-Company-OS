import type { Response } from "express";

export const DEFAULT_PAGE_LIMIT = 100;
export const MAX_PAGE_LIMIT = 200;

export type ParsedValue<T> =
  { ok: true; value: T } | { ok: false; error: string };

function scalarQueryValue(
  value: unknown,
  name: string,
): ParsedValue<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string") {
    return { ok: false, error: `${name} must be a single query value` };
  }
  return { ok: true, value };
}

export function parsePositiveInteger(
  value: unknown,
  name: string,
  options?: { optional?: false; maximum?: number },
): ParsedValue<number>;
export function parsePositiveInteger(
  value: unknown,
  name: string,
  options: { optional: true; maximum?: number },
): ParsedValue<number | undefined>;
export function parsePositiveInteger(
  value: unknown,
  name: string,
  options: { optional?: boolean; maximum?: number } = {},
): ParsedValue<number | undefined> {
  const scalar = scalarQueryValue(value, name);
  if (!scalar.ok) return scalar;
  if (scalar.value === undefined) {
    return options.optional
      ? { ok: true, value: undefined }
      : { ok: false, error: `${name} is required` };
  }
  if (!/^[1-9]\d*$/.test(scalar.value)) {
    return { ok: false, error: `${name} must be a positive integer` };
  }
  const parsed = Number(scalar.value);
  if (!Number.isSafeInteger(parsed)) {
    return { ok: false, error: `${name} is outside the safe integer range` };
  }
  if (options.maximum !== undefined && parsed > options.maximum) {
    return {
      ok: false,
      error: `${name} must be at most ${options.maximum}`,
    };
  }
  return { ok: true, value: parsed };
}

export function parseOptionalBoolean(
  value: unknown,
  name: string,
): ParsedValue<boolean | undefined> {
  const scalar = scalarQueryValue(value, name);
  if (!scalar.ok) return scalar;
  if (scalar.value === undefined) return { ok: true, value: undefined };
  if (scalar.value === "true") return { ok: true, value: true };
  if (scalar.value === "false") return { ok: true, value: false };
  return { ok: false, error: `${name} must be true or false` };
}

export function parseOptionalEnum<const T extends readonly string[]>(
  value: unknown,
  name: string,
  allowed: T,
): ParsedValue<T[number] | undefined> {
  const scalar = scalarQueryValue(value, name);
  if (!scalar.ok) return scalar;
  if (scalar.value === undefined) return { ok: true, value: undefined };
  if (!allowed.includes(scalar.value)) {
    return {
      ok: false,
      error: `${name} must be one of: ${allowed.join(", ")}`,
    };
  }
  return { ok: true, value: scalar.value as T[number] };
}

export function parseOptionalText(
  value: unknown,
  name: string,
  maximumLength: number,
): ParsedValue<string | undefined> {
  const scalar = scalarQueryValue(value, name);
  if (!scalar.ok) return scalar;
  if (scalar.value === undefined) return { ok: true, value: undefined };
  const normalized = scalar.value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength) {
    return {
      ok: false,
      error: `${name} must contain 1-${maximumLength} characters`,
    };
  }
  return { ok: true, value: normalized };
}

export function parseCursorPage(query: {
  limit?: unknown;
  beforeId?: unknown;
}): ParsedValue<{ limit: number; beforeId?: number }> {
  const limit = parsePositiveInteger(query.limit, "limit", {
    optional: true,
    maximum: MAX_PAGE_LIMIT,
  });
  if (!limit.ok) return limit;
  const beforeId = parsePositiveInteger(query.beforeId, "beforeId", {
    optional: true,
  });
  if (!beforeId.ok) return beforeId;
  return {
    ok: true,
    value: {
      limit: limit.value ?? DEFAULT_PAGE_LIMIT,
      ...(beforeId.value === undefined ? {} : { beforeId: beforeId.value }),
    },
  };
}

/**
 * Array response bodies stay backward-compatible. Clients that need older rows
 * follow this exposed cursor until the header disappears.
 */
export function setNextCursor(
  res: Response,
  rows: Array<{ id: number }>,
  hasMore: boolean,
): void {
  if (!hasMore || rows.length === 0) return;
  const oldestId = Math.min(...rows.map((row) => row.id));
  res.setHeader("X-Next-Before-Id", String(oldestId));
}
