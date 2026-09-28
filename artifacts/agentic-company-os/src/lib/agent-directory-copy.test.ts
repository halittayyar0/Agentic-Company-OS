import assert from "node:assert/strict";
import test from "node:test";
import {
  directoryDepartment,
  directorySummary,
  loadAgentDirectoryCopy,
} from "./agent-directory-copy";
import { normalizeDirectoryQuery } from "./agent-presentation";
import { LOCALES } from "./i18n";

test("every directory locale covers the same controls, departments, roles, and states", async () => {
  const reference = await loadAgentDirectoryCopy("en");
  for (const locale of LOCALES) {
    const copy = await loadAgentDirectoryCopy(locale);
    assert.deepEqual(
      Object.keys(copy).sort(),
      Object.keys(reference).sort(),
      locale,
    );
    for (const group of ["departments", "summaries", "statuses"] as const) {
      assert.deepEqual(
        Object.keys(copy[group]).sort(),
        Object.keys(reference[group]).sort(),
        `${locale}.${group}`,
      );
      for (const value of Object.values(copy[group]))
        assert.ok(value.trim(), locale);
    }
    for (const value of Object.values(copy))
      if (typeof value === "string") assert.ok(value.trim(), locale);
    assert.ok(copy.count("5", "14", true).includes("14"));
    assert.ok(copy.page("2", "3").includes("3"));
  }
});

test("directory presentation preserves custom values without claiming the template's abilities", async () => {
  const copy = await loadAgentDirectoryCopy("en");
  assert.equal(directoryDepartment(null, copy), "General");
  assert.equal(directoryDepartment("design", copy), "Design");
  for (const department of [
    "Bespoke field",
    "__proto__",
    "constructor",
    "toString",
  ])
    assert.equal(directoryDepartment(department, copy), department);
  const agent = {
    templateKey: "ceo",
    role: "İstanbul / فريق",
    isCustomPrompt: false,
  };
  assert.equal(directorySummary(agent, copy), copy.summaries.ceo);
  assert.equal(
    directorySummary({ ...agent, isCustomPrompt: true }, copy),
    copy.customSummary(agent.role),
  );
  assert.equal(
    directorySummary({ ...agent, templateKey: "toString" }, copy),
    copy.customSummary(agent.role),
  );
});

test("directory search normalizes supported scripts without changing their displayed values", () => {
  assert.equal(normalizeDirectoryQuery("İŞ AKIŞI", "tr"), "is akisi");
  assert.equal(normalizeDirectoryQuery("Données", "de"), "donnees");
  assert.equal(
    normalizeDirectoryQuery("التَّصْـمِيم", "ar"),
    normalizeDirectoryQuery("التصميم", "ar"),
  );
  assert.equal(normalizeDirectoryQuery("КАЧЕСТВО", "ru"), "качество");
  assert.equal(normalizeDirectoryQuery("設計", "zh-TW"), "設計");
});
