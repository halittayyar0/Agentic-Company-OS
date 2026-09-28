import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_TEMPLATES } from "../../../api-server/src/lib/agent-templates";
import { LOCALES } from "./i18n";
import { expertTemplateName, loadNewAgentCopy } from "./new-agent-copy";
import {
  directoryDepartment,
  loadAgentDirectoryCopy,
} from "./agent-directory-copy";

function checkCopy(actual: object, reference: object, path: string) {
  assert.deepEqual(
    Object.keys(actual).sort(),
    Object.keys(reference).sort(),
    path,
  );
  for (const [key, value] of Object.entries(actual)) {
    if (typeof value === "string")
      assert.ok(value.trim().length > 0, `${path}.${key}`);
    else
      checkCopy(
        value,
        (reference as Record<string, object>)[key],
        `${path}.${key}`,
      );
  }
}

test("every new-expert language covers the form, permission decisions, catalog and current server roles", async () => {
  const reference = await loadNewAgentCopy("en");
  const roleKeys = AGENT_TEMPLATES.filter((template) => template.key !== "ceo")
    .map((template) => template.key)
    .sort();
  for (const locale of LOCALES) {
    const copy = await loadNewAgentCopy(locale);
    checkCopy(copy, reference, locale);
    assert.deepEqual(Object.keys(copy.templates).sort(), roleKeys);
    assert.ok(!Object.hasOwn(copy.permissions, "canUseSudo"));
    const directory = await loadAgentDirectoryCopy(locale);
    assert.equal(
      directoryDepartment("customer_support", directory),
      directory.departments.support,
    );
    for (const template of AGENT_TEMPLATES.filter(
      (template) => template.key !== "ceo",
    )) {
      assert.equal(
        expertTemplateName(template, copy),
        copy.templates[template.key as keyof typeof copy.templates],
      );
    }
  }
});

test("unknown server roles keep their authored name without reading prototype properties", async () => {
  const copy = await loadNewAgentCopy("ar");
  for (const key of ["user-role", "toString", "__proto__"]) {
    assert.equal(
      expertTemplateName({ key, name: "فريق Deniz" }, copy),
      "فريق Deniz",
    );
  }
});
