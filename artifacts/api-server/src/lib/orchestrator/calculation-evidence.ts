import { z } from "zod/v4";
import { runUtility } from "../capabilities/utility-tools";

const operands = z.array(z.number().finite()).min(1).max(8);
const operation = z.enum([
  "add",
  "subtract",
  "multiply",
  "divide",
  "mean",
  "min",
  "max",
  "percentage",
]);
const inputSchema = z.object({ operation, values: operands }).strict();
const evidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    operation,
    values: operands,
    value: z.number().finite(),
    arithmetic: z.literal("IEEE-754"),
  })
  .strict();

/** Deliberately retained numeric inputs/results, never arbitrary read-only output. */
export function readCalculationEvidence(value: unknown) {
  const parsed = evidenceSchema.safeParse(value);
  if (!parsed.success) return null;
  const evidence = parsed.data;
  try {
    const checked = runUtility("calculate", {
      operation: evidence.operation,
      values: evidence.values,
    });
    if (checked.value !== evidence.value) return null;
    return evidence;
  } catch {
    return null;
  }
}

export function prepareCalculationEvidence(args: unknown, content: string) {
  if (content.length > 4096) return null;
  const input = inputSchema.safeParse(args);
  if (!input.success) return null;
  try {
    const envelope: unknown = JSON.parse(content);
    const result = z
      .object({
        data: z
          .object({
            operation,
            value: z.number().finite(),
            arithmetic: z.literal("IEEE-754"),
          })
          .strict(),
      })
      .passthrough()
      .safeParse(envelope);
    if (!result.success || result.data.data.operation !== input.data.operation)
      return null;
    return readCalculationEvidence({
      schemaVersion: 1,
      ...input.data,
      value: result.data.data.value,
      arithmetic: result.data.data.arithmetic,
    });
  } catch {
    return null;
  }
}
