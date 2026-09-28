import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_TEMPLATES } from "./agent-templates";
import { WORKSPACE_LOCALES } from "./workspace-locale";
import {
  getLocalizedAgentTemplate,
  getLocalizedAgentTemplates,
  getLocalizedHandoffCopy,
} from "./agent-template-localization";
import {
  WORKFORCE_BLUEPRINTS,
  blueprintSystemPrompt,
  getBlueprintMemberTemplate,
} from "./workforce-blueprints";
import { localizeWorkforceBlueprint } from "./workforce-localization";
import { workspaceLanguageContract } from "./workspace-locale";

test("all seven authored catalogs preserve all fifteen role identities and authority without shared mutation", () => {
  assert.equal(AGENT_TEMPLATES.length, 15);
  const original = structuredClone(AGENT_TEMPLATES);
  for (const locale of WORKSPACE_LOCALES) {
    const catalog = getLocalizedAgentTemplates(locale);
    assert.equal(catalog.length, 15);
    assert.deepEqual(
      catalog.map((item) => item.key),
      original.map((item) => item.key),
    );
    for (const entry of catalog) {
      const source = original.find((item) => item.key === entry.key)!;
      const {
        name,
        defaultRole,
        description,
        defaultSystemPrompt,
        ...structure
      } = entry;
      const {
        name: _n,
        defaultRole: _r,
        description: _d,
        defaultSystemPrompt: _p,
        ...sourceStructure
      } = source;
      assert.deepEqual(structure, sourceStructure);
      for (const value of [name, defaultRole, description, defaultSystemPrompt])
        assert.ok(value.trim().length > 0);
      assert.equal(
        (defaultSystemPrompt.match(/^\d+\. /gm) ?? []).length,
        (source.defaultSystemPrompt.match(/^\d+\. /gm) ?? []).length,
        `${locale}/${entry.key}: numbered steps`,
      );
      if (locale === "tr") assert.deepEqual(entry, source);
      else {
        assert.notEqual(defaultSystemPrompt, source.defaultSystemPrompt);
        assert.ok(!defaultSystemPrompt.includes("Misyonun:"));
        assert.ok(!/TODO|TBD|placeholder/i.test(defaultSystemPrompt));
      }
    }
    catalog[0].defaultPermissions.canUseSudo = false;
    catalog[0].defaultSystemPrompt = "mutated return value";
    assert.equal(
      getLocalizedAgentTemplate("ceo", locale)!.defaultPermissions.canUseSudo,
      true,
    );
    assert.notEqual(
      getLocalizedAgentTemplate("ceo", locale)!.defaultSystemPrompt,
      "mutated return value",
    );
  }
  assert.deepEqual(AGENT_TEMPLATES, original);
  assert.notEqual(
    getLocalizedAgentTemplate("ceo", "zh-CN")!.defaultSystemPrompt,
    getLocalizedAgentTemplate("ceo", "zh-TW")!.defaultSystemPrompt,
  );
});

test("every installed role retains its complete playbook and human approval contract within the runtime bound in every language", () => {
  for (const locale of WORKSPACE_LOCALES) {
    const handoff = getLocalizedHandoffCopy(locale);
    for (const source of WORKFORCE_BLUEPRINTS) {
      const blueprint = localizeWorkforceBlueprint(source, locale);
      for (const member of blueprint.members) {
        const prompt = blueprintSystemPrompt(
          blueprint,
          member,
          getBlueprintMemberTemplate(member),
          locale,
        );
        const playbook = getLocalizedAgentTemplate(
          member.templateKey,
          locale,
        )!.defaultSystemPrompt;
        assert.ok(prompt.startsWith(playbook + "\n\n"));
        assert.ok(prompt.endsWith(handoff.finalRule));
        assert.ok(prompt.includes(member.mission));
        assert.ok(
          (prompt + "\n\n" + workspaceLanguageContract(locale)).length <= 9000,
          `${locale}/${member.key}: runtime must retain the approval contract`,
        );
        if (locale !== "tr")
          assert.ok(
            !/Misyonun:|Hazır ekip çalışma sözleşmesi|Giden devir sözleşmesi/.test(
              prompt,
            ),
          );
        else
          assert.ok(
            prompt.includes(
              `v${blueprint.version}, ${blueprint.orchestration}`,
            ),
          );
      }
    }
  }
});

test("unknown role and invalid locale never select a different stock authority", () => {
  assert.equal(getLocalizedAgentTemplate("missing-role", "en"), undefined);
  assert.equal(getLocalizedAgentTemplate("constructor", "ar"), undefined);
  assert.throws(() => getLocalizedAgentTemplates("fr" as never));
});
