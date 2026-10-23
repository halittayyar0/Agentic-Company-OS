import * as z from "zod/v4-mini";

// Incomplete user edits survive locally. Only the stricter submission schema
// can authorize a request; the server independently enforces its own parser.
export const resultFormatDraftSchema = z.nullable(
  z.strictObject({
    kind: z.literal("table"),
    columns: z
      .array(z.string().check(z.maxLength(80)))
      .check(z.minLength(2), z.maxLength(8)),
  }),
);
export type ResultFormat = z.infer<typeof resultFormatDraftSchema>;
