import assert from "node:assert/strict";
import test from "node:test";
import {
  resultFormatDraftControl,
  measureResultFormatAssets,
} from "./task-result-format-bundle-budget";
import { createHash } from "node:crypto";
const text =
  'const fmt=nullable(strict({kind:literal("table"),columns:array(string().check(max(80))).check(min(2),max(8))}));const draft=strict({version:literal(1),title:string(),resultFormat:optional(fmt)});function input(e){return e.title.length>0||e.resultFormat!=null}const unrelated="KEEP";';
const asset = (contents: string) => ({
  fileName: "index-fixture.js",
  contents: Buffer.from(contents),
});
test("layout draft credit retains unrelated code and removes only its exact new schema, field and input check", () => {
  const r = resultFormatDraftControl(asset(text));
  assert.ok(r.raw <= 350 && r.gzip <= 200);
  assert.ok(r.contents.includes('const unrelated="KEEP"'));
  assert.ok(r.contents.includes("title:string()"));
  assert.ok(!r.contents.includes("resultFormat"));
  const larger = resultFormatDraftControl(
    asset(text + 'const oldFeature="' + "x".repeat(4000) + '";'),
  );
  assert.equal(larger.raw, r.raw);
  assert.ok(larger.contents.includes("oldFeature="));
});
test("changed format shape, duplicate input fragments or missing saved-field bindings earn no byte credit", () => {
  for (const changed of [
    text.replace("max(80)", "max(81)"),
    text.replace('"table"', '"anything"'),
    text.replace("columns:array", "permissions:array"),
    text.replace("optional(fmt)", "optional(other)"),
    text + "function other(e){return false||e.resultFormat!=null}",
  ])
    assert.throws(() => resultFormatDraftControl(asset(changed)));
});

function fixture(extraLogic = "", extraPack = "", borrowed = false) {
  const root = "artifacts/agentic-company-os/src/";
  const rows = [
    {
      name: "logic.js",
      text: "const newLayout=true;" + extraLogic,
      modules: [
        root + "components/tasks/result-format-choice.tsx",
        root + "lib/task-result-format-copy.ts",
        ...(borrowed ? [root + "lib/utils.ts"] : []),
      ],
    },
    {
      name: "input.js",
      text: "const validate=true;",
      modules: [root + "lib/task-result-format-input.ts"],
    },
    ...["en", "tr", "de", "ru", "zh-CN", "zh-TW", "ar"].map((locale) => ({
      name: `result-format-${locale}.js`,
      text: `const copy="${locale}${extraPack}";`,
      modules: [
        root + `lib/task-result-format-copy/result-format-${locale}.ts`,
      ],
    })),
  ];
  return {
    assets: rows.map((row) => ({
      fileName: row.name,
      contents: Buffer.from(row.text),
    })),
    manifest: {
      schemaVersion: 1,
      chunks: rows.map((row) => ({
        fileName: "assets/" + row.name,
        sha256: createHash("sha256").update(row.text).digest("hex"),
        modules: row.modules,
      })),
    },
  };
}
test("layout budgets distinguish one selected language from seven disk packs without borrowing an old module", () => {
  const f = fixture();
  const measured = measureResultFormatAssets(f.assets, f.manifest, [
    { raw: 20, gzip: 10 },
  ]);
  assert.ok(
    measured.globalRaw > measured.raw && measured.globalGzip > measured.gzip,
  );
  const borrowed = fixture("", "", true);
  assert.throws(() =>
    measureResultFormatAssets(borrowed.assets, borrowed.manifest, []),
  );
  f.assets[0].contents = Buffer.from("changed unbound bytes");
  assert.throws(() => measureResultFormatAssets(f.assets, f.manifest, []));
});
test("oversized new logic, a language pack or integration cannot escape the separate layout limits", () => {
  for (const f of [fixture("x".repeat(4500)), fixture("", "x".repeat(1000))])
    assert.throws(() => measureResultFormatAssets(f.assets, f.manifest, []));
  const f = fixture();
  assert.throws(() =>
    measureResultFormatAssets(f.assets, f.manifest, [{ raw: 6500, gzip: 0 }]),
  );
});
