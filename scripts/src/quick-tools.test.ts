import assert from "node:assert/strict";
import test from "node:test";
import {
  auditCsv,
  auditJson,
  compareLists,
  quickToolTranslations,
} from "../../site/quick-tools.mjs";

test("all seven locales cover every quick-tool message", () => {
  const keys = Object.keys(quickToolTranslations.en);
  assert.equal(keys.length > 40, true);
  for (const locale of ["en", "tr", "de", "ru", "zh-CN", "zh-TW", "ar"]) {
    for (const key of keys)
      assert.ok(quickToolTranslations[locale]?.[key], `${locale}: ${key}`);
  }
});

test("CSV audit handles quoted commas, embedded newlines and duplicates", () => {
  const result = auditCsv(
    '\uFEFFname,score\r\n"Ada, Jr",10\r\n"Line\none",\r\n"Ada, Jr",10',
  );
  assert.equal(result.rows, 3);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.missing, [0, 1]);
  assert.equal(result.widthErrors, 0);
});

test("CSV audit reports malformed data and limits", () => {
  assert.equal(auditCsv("a,b\n1\n2,3").widthErrors, 1);
  assert.throws(() => auditCsv('a\n"unfinished'), /csvSyntax/);
  assert.throws(() => auditCsv("a\n" + "x\n".repeat(2001)), /rows/);
  assert.throws(() => auditCsv("x".repeat(256 * 1024 + 1)), /size/);
});

test("JSON audit summarizes structure without values", () => {
  const result = auditJson('{"secret":"never show","tasks":[true,null]}');
  assert.deepEqual(result.keys, ["secret", "tasks"]);
  assert.equal(result.maxDepth, 2);
  assert.equal(result.types.string, 1);
  assert.equal(JSON.stringify(result).includes("never show"), false);
  assert.throws(() => auditJson("{bad}"), /jsonSyntax/);
});

test("list comparison trims boundaries, keeps case and deduplicates", () => {
  const result = compareLists(" Ada \nAda\nbeta", "ada\nbeta\ngamma");
  assert.deepEqual(result.onlyA, ["Ada"]);
  assert.deepEqual(result.onlyB, ["ada", "gamma"]);
  assert.deepEqual(result.common, ["beta"]);
});
