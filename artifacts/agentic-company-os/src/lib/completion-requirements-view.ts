import { safeInteger, stringChoices } from "./schema-primitives";
import * as z from "zod/v4-mini";
import { completionRequirementsSchema } from "./completion-requirements-input";

const id = safeInteger.check(z.minimum(1), z.maximum(2147483647));
const tool = z.string().check(
  z.regex(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/u),
  z.refine(
    (name) =>
      completionRequirementsSchema.safeParse([
        { kind: "tool_succeeded", tool: name },
      ]).success,
  ),
);
const catalog = z.strictObject({
  ownerAgentId: id,
  tools: z.array(tool).check(
    z.maxLength(512),
    z.refine((names) => new Set(names).size === names.length),
  ),
});
const snapshot = z.strictObject({
  source: z.literal("persisted_current_cycle"),
  taskId: id,
  cycleNumber: safeInteger.check(z.minimum(0)),
  taskStatus: stringChoices([
    "pending",
    "planning",
    "in_progress",
    "awaiting_approval",
    "blocked",
    "completed",
    "failed",
    "cancelled",
  ]),
  observedAt: z.string().check(
    z.iso.datetime({ offset: true }),
    z.refine((value) => Number.isFinite(Date.parse(value))),
  ),
  requirements: z
    .array(
      z.strictObject({
        kind: z.literal("tool_succeeded"),
        tool,
        satisfied: z.boolean(),
        available: z.boolean(),
      }),
    )
    .check(
      z.maxLength(8),
      z.refine(
        (rows) => new Set(rows.map((row) => row.tool)).size === rows.length,
      ),
    ),
});
export function completionSnapshotView(
  value: unknown,
  taskId: number,
): z.infer<typeof snapshot> | null {
  const parsed = snapshot.safeParse(value);
  return parsed.success && parsed.data.taskId === taskId ? parsed.data : null;
}
export function completionCatalogView(
  value: unknown,
): z.infer<typeof catalog> | null {
  const parsed = catalog.safeParse(value);
  return parsed.success ? parsed.data : null;
}
