import * as z from "zod/v4-mini";
import { resultFormatDraftSchema } from "./task-result-format-draft";
export type { ResultFormat } from "./task-result-format-draft";
export const resultFormatInputSchema = resultFormatDraftSchema.check(
  z.refine(
    (value) =>
      value === null ||
      (new Set(value.columns).size === value.columns.length &&
        value.columns.every(
          (heading) =>
            !!heading &&
            heading.trim() === heading &&
            !/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(heading),
        )),
  ),
);
