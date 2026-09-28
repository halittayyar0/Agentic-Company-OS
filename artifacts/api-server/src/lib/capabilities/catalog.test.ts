import assert from "node:assert/strict";
import test from "node:test";
import { getCapabilityCatalog, skillProjectDraft } from "./catalog";
import { WORKSPACE_LOCALES } from "../workspace-locale";
import { capabilityResult } from "./capability-tools";

test("stable skill IDs remain case-insensitive in Turkish and surrounding query whitespace is ignored", () => {
  const result = capabilityResult(
    "list_skills",
    { query: " CODE-REVIEW " },
    "tr",
    [],
  );
  const data = JSON.parse(result.content).data;
  assert.equal(data.length, 1);
  assert.equal(data[0].id, "code-review");
});

test("30 versioned skills and ten real tool entries exist in every locale", () => {
  let canonicalIds: string[] | undefined;
  for (const locale of WORKSPACE_LOCALES) {
    const catalog = getCapabilityCatalog(locale);
    assert.equal(catalog.locale, locale);
    assert.equal(catalog.skills.length, 30);
    assert.equal(catalog.tools.length, 10);
    const ids = catalog.skills.map((skill) => skill.id);
    assert.equal(new Set(ids).size, 30);
    if (canonicalIds) assert.deepEqual(ids, canonicalIds);
    canonicalIds = ids;
    for (const skill of catalog.skills) {
      assert.equal(skill.version, 1);
      assert.ok(skill.steps.length >= 4);
      assert.ok(skill.checks.length >= 2);
      assert.ok(skill.inputs.length >= 2);
      assert.ok(skill.deliverable.length > 25);
      assert.ok(skill.title.length > 3);
      const draft = skillProjectDraft(skill, catalog.copy);
      assert.ok(draft.brief.includes(skill.deliverable));
      assert.ok(draft.brief.includes(catalog.copy.boundary));
      assert.ok(draft.brief.length < 8_000);
    }
  }
  assert.throws(() => getCapabilityCatalog("invalid" as any));
});
