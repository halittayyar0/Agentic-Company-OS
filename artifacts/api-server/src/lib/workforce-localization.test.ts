import assert from "node:assert/strict";
import test from "node:test";
import { WORKFORCE_BLUEPRINTS } from "./workforce-blueprints";
import { WORKSPACE_LOCALES } from "./workspace-locale";
import { localizeWorkforceBlueprint } from "./workforce-localization";

test("all seven workforce catalogs preserve identity, permissions, hierarchy and handoff semantics", () => {
  const original = JSON.stringify(WORKFORCE_BLUEPRINTS);
  for (const locale of WORKSPACE_LOCALES)
    for (const source of WORKFORCE_BLUEPRINTS) {
      const translated = localizeWorkforceBlueprint(source, locale);
      assert.equal(translated.key, source.key);
      assert.equal(translated.version, source.version);
      assert.equal(translated.orchestration, source.orchestration);
      for (const text of [
        translated.name,
        translated.tagline,
        translated.description,
        ...translated.recommendedFor,
        ...translated.triggerLabels,
      ])
        assert.ok(text.trim());
      assert.equal(translated.members.length, source.members.length);
      translated.members.forEach((member, index) => {
        const { name, role, mission, capabilities, ...structure } = member;
        const {
          name: _name,
          role: _role,
          mission: _mission,
          capabilities: _capabilities,
          ...canonical
        } = source.members[index];
        assert.deepEqual(structure, canonical);
        for (const text of [name, role, mission, ...capabilities])
          assert.ok(text.trim());
        if (locale !== "tr")
          assert.notEqual(mission, source.members[index].mission);
      });
      translated.handoffs.forEach((handoff, index) => {
        const { instruction, ...structure } = handoff;
        const { instruction: _instruction, ...canonical } =
          source.handoffs[index];
        assert.deepEqual(structure, canonical);
        assert.ok(instruction.trim());
        if (locale !== "tr")
          assert.notEqual(instruction, source.handoffs[index].instruction);
      });
    }
  assert.equal(JSON.stringify(WORKFORCE_BLUEPRINTS), original);
});
