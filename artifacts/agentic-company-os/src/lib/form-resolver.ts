import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import type { FieldValues } from "react-hook-form";
import type { ZodMiniType } from "zod/v4-mini";

/** All browser forms use Zod Mini's standard interface. Explicit input/output
 * types preserve RHF inference without shipping a second, legacy adapter. */
export function formResolver<Input extends FieldValues, Output>(
  schema: ZodMiniType<Output, Input>,
) {
  return standardSchemaResolver<Input, unknown, Output>(schema);
}
