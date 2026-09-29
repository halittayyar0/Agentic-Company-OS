import assert from "node:assert/strict";
import test from "node:test";
import { getCapabilityCatalog, skillProjectDraft } from "./catalog";
import { WORKSPACE_LOCALES } from "../workspace-locale";
import { capabilityResult } from "./capability-tools";
import { CAPABILITY_TOOL_NAMES } from "./names";
import { ADVANCED_GUIDES } from "./advanced-guides";
import { guide } from "./advanced-guide-text";

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

test("50 versioned skills and all real tool entries exist in every locale", () => {
  let canonicalIds: string[] | undefined;
  for (const locale of WORKSPACE_LOCALES) {
    const catalog = getCapabilityCatalog(locale);
    assert.equal(catalog.locale, locale);
    assert.equal(catalog.version, 2);
    assert.equal(catalog.skills.length, 50);
    assert.equal(catalog.tools.length, CAPABILITY_TOOL_NAMES.length);
    const ids = catalog.skills.map((skill) => skill.id);
    assert.equal(new Set(ids).size, 50);
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

test("advanced guides retain specific localized instructions through discovery, read and project draft", () => {
  const builtinTools = [
    "browser_open",
    "browser_extract_text",
    "inspect_url",
    "log_note",
    "vm_list_files",
    "vm_read_file",
    "request_user_input",
  ];
  const available = [...CAPABILITY_TOOL_NAMES, ...builtinTools];
  const english = getCapabilityCatalog("en");
  for (const locale of WORKSPACE_LOCALES) {
    const catalog = getCapabilityCatalog(locale);
    assert.deepEqual(
      catalog.skills.slice(30).map((skill) => skill.id),
      Object.keys(ADVANCED_GUIDES),
    );
    for (const group of catalog.groups) {
      assert.equal(
        catalog.skills.filter((skill) => skill.group === group.id).length,
        10,
      );
    }
    for (const skill of catalog.skills.slice(30)) {
      for (const tool of skill.tools)
        assert.ok(
          available.includes(tool),
          `Unknown tool ${tool} in ${skill.id}`,
        );
      assert.deepEqual(
        skill.permissions,
        skill.tools.includes("browser_open")
          ? ["canBrowse"]
          : skill.tools.includes("vm_read_file")
            ? ["canUseTerminal"]
            : [],
      );
      const englishSkill = english.skills.find(
        (candidate) => candidate.id === skill.id,
      )!;
      if (locale !== "en") {
        assert.notEqual(skill.title, englishSkill.title);
        assert.notEqual(skill.deliverable, englishSkill.deliverable);
        assert.notDeepEqual(skill.steps, englishSkill.steps);
        assert.notDeepEqual(skill.inputs, englishSkill.inputs);
        assert.notDeepEqual(skill.checks, englishSkill.checks);
      }
      const listed = capabilityResult(
        "list_skills",
        { query: ` ${skill.id.toUpperCase()} ` },
        locale,
        available,
      );
      assert.deepEqual(
        JSON.parse(listed.content).data.map(
          (entry: { id: string }) => entry.id,
        ),
        [skill.id],
      );
      const localized = capabilityResult(
        "list_skills",
        { query: skill.title, group: skill.group },
        locale,
        available,
      );
      assert.ok(
        JSON.parse(localized.content).data.some(
          (entry: { id: string }) => entry.id === skill.id,
        ),
      );
      const read = capabilityResult(
        "read_skill",
        { id: skill.id },
        locale,
        available,
      );
      const detail = JSON.parse(read.content).data;
      assert.deepEqual(detail.steps, skill.steps);
      assert.deepEqual(detail.inputs, skill.inputs);
      assert.deepEqual(detail.checks, skill.checks);
      const draft = skillProjectDraft(skill, catalog.copy);
      for (const line of [...skill.inputs, ...skill.steps, ...skill.checks])
        assert.ok(draft.brief.includes(line));
    }
    assert.equal(
      new Set(catalog.skills.slice(30).map((skill) => skill.steps.join("\n")))
        .size,
      20,
    );
    // Consumers may edit draft instructions without mutating shared translations.
    catalog.skills[30].steps[0] = "edited locally";
    assert.notEqual(
      getCapabilityCatalog(locale).skills[30].steps[0],
      "edited locally",
    );
  }
});

test("guide authoring rejects missing sections and blank list items", () => {
  assert.throws(() => guide("title; output; one|two; one|two|three|four"));
  assert.throws(() =>
    guide("title; output; one| ; one|two|three|four; one|two"),
  );
  assert.throws(() => guide("title; output; one|two; one|two| |four; one|two"));
});

test("existing guide identities and access reporting remain compatible", () => {
  const catalog = getCapabilityCatalog("en");
  assert.deepEqual(
    catalog.skills.slice(0, 30).map((skill) => skill.id),
    [
      "source-brief",
      "competitor-map",
      "claim-check",
      "product-comparison",
      "literature-map",
      "interview-plan",
      "code-review",
      "bug-triage",
      "test-plan",
      "api-contract",
      "release-readiness",
      "dependency-review",
      "csv-quality",
      "json-audit",
      "metric-report",
      "data-dictionary",
      "reconciliation",
      "experiment-analysis",
      "document-outline",
      "edit-copy",
      "translation-review",
      "faq-draft",
      "changelog",
      "meeting-actions",
      "project-plan",
      "incident-review",
      "runbook",
      "risk-register",
      "process-map",
      "handoff",
    ],
  );
  for (const locale of WORKSPACE_LOCALES) {
    const result = capabilityResult(
      "read_skill",
      { id: "procurement-scorecard" },
      locale,
      [],
    );
    const skill = JSON.parse(result.content).data;
    assert.deepEqual(skill.unavailableTools, skill.tools);
    assert.deepEqual(skill.permissions, ["canBrowse"]);
    assert.deepEqual(result.createdAgents, []);
    assert.deepEqual(result.createdTasks, []);
    const disabled = capabilityResult(
      "read_skill",
      { id: "procurement-scorecard" },
      locale,
      [],
      [],
      ["data"],
    );
    assert.equal(disabled.toolOutcome, "rejected");
  }
});
