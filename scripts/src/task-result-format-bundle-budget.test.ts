import assert from "node:assert/strict";
import test from "node:test";
import {
  resultFormatDraftControl,
  measureResultFormatAssets,
  resultTableDeliveryControl,
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
      modules: [
        root + "lib/task-result-format-input.ts",
        root + "components/tasks/result-table.tsx",
        root + "lib/task-result-table.ts",
      ],
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
  for (const f of [fixture("x".repeat(7600)), fixture("", "x".repeat(1000))])
    assert.throws(() => measureResultFormatAssets(f.assets, f.manifest, []));
  const f = fixture();
  assert.throws(() =>
    measureResultFormatAssets(f.assets, f.manifest, [{ raw: 9800, gzip: 0 }]),
  );
});

const delivery =
  'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/result-table-fixture.js","assets/input-fixture.js","assets/legacy.js"])))=>i.map(i=>d[i]);\nconst oldBefore=1,Table=R.lazy(()=>L(()=>import("./result-table-fixture.js"),__vite__mapDeps([0,1,2]))),oldAfter=2;function render(p,s,c){const legacy="keep";return p.resultFormat?J.jsx(R.Suspense,{fallback:J.jsx(Markdown,{content:s}),children:J.jsx(Table,{content:s,format:p.resultFormat,label:c.deliverySummary})}):J.jsx(Markdown,{content:s})}';
test("saved-result delivery credit reconstructs the exact original Markdown and preserves adjacent legacy code", () => {
  const result = resultTableDeliveryControl(
    asset(delivery),
    "result-table-fixture.js",
    "input-fixture.js",
  );
  const text = result.contents.toString();
  assert.ok(text.includes("return J.jsx(Markdown,{content:s})"));
  assert.ok(
    text.includes("oldBefore=1") &&
      text.includes("oldAfter=2") &&
      text.includes('const legacy="keep"'),
  );
  assert.ok(
    text.includes("assets/legacy.js") &&
      !text.includes("result-table-fixture.js") &&
      !text.includes("resultFormat"),
  );
  const larger = resultTableDeliveryControl(
    asset(delivery + 'const oldFeature="' + "x".repeat(4000) + '";'),
    "result-table-fixture.js",
    "input-fixture.js",
  );
  assert.equal(larger.raw, result.raw);
  assert.ok(larger.contents.includes("oldFeature="));
});
test("changed delivery fallback, result bindings or preload paths earn no table integration credit", () => {
  for (const changed of [
    delivery.replace(
      "fallback:J.jsx(Markdown,{content:s})",
      "fallback:J.jsx(Markdown,{content:other})",
    ),
    delivery.replace("format:p.resultFormat", "format:other.resultFormat"),
    delivery.replace("assets/input-fixture.js", "assets/old-feature.js"),
    delivery.replace("label:c.deliverySummary", "label:other()"),
  ])
    assert.throws(() =>
      resultTableDeliveryControl(
        asset(changed),
        "result-table-fixture.js",
        "input-fixture.js",
      ),
    );
});
