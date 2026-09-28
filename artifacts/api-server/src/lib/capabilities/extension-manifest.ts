import { z } from "zod/v4";
import { UTILITY_NAMES } from "./utility-tools";
import { PACK_TOOL_NAMES } from "./names";

export const extensionId = z.string().regex(/^user-[a-z0-9][a-z0-9-]{0,59}$/u);
const base = {
  schemaVersion: z.literal(1),
  id: extensionId,
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
};
const schema = z.discriminatedUnion("kind", [
  z
    .object({
      ...base,
      kind: z.literal("skill"),
      instructions: z.string().min(1).max(8000),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("tool"),
      tool: z.enum([...UTILITY_NAMES, ...PACK_TOOL_NAMES]),
      defaults: z.record(z.string().max(100), z.json()).default({}),
    })
    .strict(),
]);
export type ExtensionManifest = z.infer<typeof schema>;
export function validateExtensionPackage(value: unknown): ExtensionManifest {
  if (JSON.stringify(value)?.length > 16000)
    throw new Error("EXTENSION_TOO_LARGE");
  return schema.parse(value);
}
