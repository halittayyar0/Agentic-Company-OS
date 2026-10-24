import assert from "node:assert/strict";
import test from "node:test";
import { zodResolver } from "@hookform/resolvers/zod";
import { loadNewAgentCopy } from "./new-agent-copy";
import { formResolver } from "./form-resolver";
import {
  makeNewAgentSchema,
  newAgentResolver,
  type NewAgentFormValues,
} from "./new-agent-schema";

test("new-agent standard resolver preserves parsed values and visible field errors in all seven languages", async () => {
  const valid: NewAgentFormValues = {
    name: "  Researcher  ",
    role: "  Research assistant  ",
    department: "  Product  ",
    parentAgentId: "",
    templateKey: "researcher",
    isCustom: false,
    systemPrompt: "",
    modelMode: "auto",
    modelId: "",
  };
  const cases: NewAgentFormValues[] = [
    valid,
    { ...valid, name: " a ", role: " b ", templateKey: "" },
    {
      ...valid,
      name: "a".repeat(81),
      role: "a".repeat(121),
      department: "a".repeat(121),
    },
    { ...valid, isCustom: true, templateKey: "", systemPrompt: " ".repeat(20) },
    {
      ...valid,
      isCustom: true,
      templateKey: "",
      systemPrompt: "A useful custom instruction for the assistant.",
    },
    {
      ...valid,
      systemPrompt: "a".repeat(65537),
      modelMode: "manual",
      modelId: "",
    },
    { ...valid, modelMode: "manual", modelId: "local-model" },
  ];
  const options = { fields: {}, shouldUseNativeValidation: false };
  for (const locale of [
    "tr",
    "en",
    "de",
    "ru",
    "zh-CN",
    "zh-TW",
    "ar",
  ] as const) {
    const copy = await loadNewAgentCopy(locale);
    const schema = makeNewAgentSchema(copy);
    const before = zodResolver(schema);
    const after = newAgentResolver(copy);
    assert.deepEqual(
      await formResolver(schema)(valid, undefined, options),
      await after(valid, undefined, options),
    );
    for (const values of cases) {
      const expected = await before(values, undefined, options);
      const actual = await after(values, undefined, options);
      assert.deepEqual(actual.values, expected.values, locale);
      // RHF displays the first field message, not the adapter's error-code metadata.
      const messages = (errors: typeof actual.errors) =>
        Object.fromEntries(
          Object.entries(errors).map(([field, error]) => [
            field,
            error?.message,
          ]),
        );
      assert.deepEqual(
        messages(actual.errors),
        messages(expected.errors),
        locale,
      );
    }
    const accepted = await after(valid, undefined, options);
    assert.deepEqual(accepted.errors, {});
    assert.deepEqual(accepted.values, {
      ...valid,
      name: "Researcher",
      role: "Research assistant",
      department: "Product",
    });
    const refused = await after(cases[1], undefined, options);
    assert.equal(refused.errors.name?.message, copy.validation.nameShort);
    assert.equal(refused.errors.role?.message, copy.validation.roleShort);
    assert.equal(refused.errors.templateKey?.message, copy.validation.template);
  }
});
