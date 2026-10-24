import * as z from "zod/v4-mini";
import { formResolver } from "./form-resolver";
import { stringChoices } from "./schema-primitives";
import type { NewAgentCopy } from "./new-agent-copy";

export const makeNewAgentSchema = (copy: NewAgentCopy) =>
  z
    .object({
      name: z
        .string()
        .check(
          z.trim(),
          z.minLength(2, copy.validation.nameShort),
          z.maxLength(80, copy.validation.nameLong),
        ),
      role: z
        .string()
        .check(
          z.trim(),
          z.minLength(2, copy.validation.roleShort),
          z.maxLength(120, copy.validation.roleLong),
        ),
      department: z
        .string()
        .check(z.trim(), z.maxLength(120, copy.validation.departmentLong)),
      parentAgentId: z.string(),
      templateKey: z.string(),
      isCustom: z.boolean(),
      systemPrompt: z
        .string()
        .check(z.maxLength(65536, copy.validation.promptLong)),
      modelMode: stringChoices(["auto", "manual"]),
      modelId: z.string(),
    })
    .check((context) => {
      const values = context.value;
      if (!values.isCustom && !values.templateKey)
        context.issues.push({
          code: "custom",
          input: values,
          path: ["templateKey"],
          message: copy.validation.template,
        });
      if (values.isCustom && values.systemPrompt.trim().length < 20)
        context.issues.push({
          code: "custom",
          input: values,
          path: ["systemPrompt"],
          message: copy.validation.promptShort,
        });
      if (values.modelMode === "manual" && !values.modelId)
        context.issues.push({
          code: "custom",
          input: values,
          path: ["modelId"],
          message: copy.validation.model,
        });
    });
export type NewAgentFormValues = z.infer<ReturnType<typeof makeNewAgentSchema>>;

/** Use the schema's standard interface without bundling the unused legacy adapter. */
export const newAgentResolver = (copy: NewAgentCopy) =>
  formResolver(makeNewAgentSchema(copy));
