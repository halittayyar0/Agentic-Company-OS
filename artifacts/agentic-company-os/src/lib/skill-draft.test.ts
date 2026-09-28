import assert from "node:assert/strict";
import test from "node:test";
import { buildSkillDraft, readSkillDraft } from "./skill-draft";
import {
  getCapabilityCatalog,
  skillProjectDraft,
} from "../../../api-server/src/lib/capabilities/catalog";
import { WORKSPACE_LOCALES } from "../../../api-server/src/lib/workspace-locale";

test("browser draft handoff matches the authored guide in every language and rejects malformed state", () => {
  for (const locale of WORKSPACE_LOCALES) {
    const catalog = getCapabilityCatalog(locale);
    for (const skill of catalog.skills) {
      const draft = buildSkillDraft(skill, catalog.copy);
      assert.deepEqual(draft, skillProjectDraft(skill, catalog.copy));
      assert.deepEqual(readSkillDraft({ acosSkillDraft: draft }), draft);
    }
  }
  for (const state of [
    null,
    {},
    { acosSkillDraft: { title: "x", brief: "" } },
    { acosSkillDraft: { title: "x", brief: "x".repeat(8_001) } },
  ])
    assert.equal(readSkillDraft(state), null);
});
