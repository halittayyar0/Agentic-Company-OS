import * as z from "zod/v4-mini";

// These browser DTO checks use finite string sets and safe integers only.
// Reuse those exact predicates without retaining numeric-format or TS-enum
// machinery in the shared client bundle.
export const safeInteger = z.number().check(z.refine(Number.isSafeInteger));

export function stringChoices<const T extends readonly [string, ...string[]]>(
  values: T,
) {
  return z.literal(values);
}
