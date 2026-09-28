import assert from "node:assert/strict";
import test from "node:test";
import { loadHomeCopy } from "./home-copy";
import { LOCALES } from "./i18n";
import { composeProjectBrief, splitProjectBrief } from "./project-brief";

test("the home journey has complete localized copy and editable examples", async () => {
  const turkish = await loadHomeCopy("tr");
  const keys = Object.keys(turkish).sort();
  for (const locale of LOCALES) {
    const copy = await loadHomeCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), keys, locale);
    assert.equal(copy.guideSteps.length, 3, locale);
    assert.equal(copy.examples.length, 3, locale);
    assert.deepEqual(
      Object.keys(copy.modes).sort(),
      ["compare", "engineer", "research", "team"],
      locale,
    );
    assert.match(copy.meetExperts, /\{count\}/u, locale);
    assert.match(copy.activeTeamMembers, /\{count\}/u, locale);
    for (const example of copy.examples) {
      assert.ok(example.label.trim(), locale);
      assert.ok(example.prompt.length >= 10, locale);
      assert.ok(copy.modes[example.mode], locale);
    }
    for (const mode of Object.values(copy.modes)) {
      assert.ok(mode.label.trim(), locale);
      assert.ok(mode.hint.trim(), locale);
      assert.ok(mode.instruction.length > 30, locale);
    }
    const brief = composeProjectBrief(
      "An operator's original goal",
      locale,
      copy.modes.engineer.label,
      copy.modes.engineer.instruction,
    );
    assert.deepEqual(splitProjectBrief(brief), {
      outcome: "An operator's original goal",
      approach: copy.modes.engineer.label,
    });
  }
  assert.notEqual((await loadHomeCopy("en")).heroTitle, turkish.heroTitle);
  assert.notEqual((await loadHomeCopy("ar")).heroTitle, turkish.heroTitle);
});

test("existing Turkish project briefs remain readable", () => {
  const legacy =
    "Original goal\n\nÇalışma yaklaşımı — Ekip: Existing instruction";
  assert.deepEqual(splitProjectBrief(legacy), {
    outcome: "Original goal",
    approach: "Ekip",
  });
  assert.deepEqual(splitProjectBrief("Hand-written goal"), {
    outcome: "Hand-written goal",
    approach: null,
  });
});
