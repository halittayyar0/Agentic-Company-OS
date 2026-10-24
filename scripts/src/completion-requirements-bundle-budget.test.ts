import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  measureCompletionRequirementsBundle,
  resultFormatChoiceControl,
} from "./completion-requirements-bundle-budget";
import { measureComposerDraftBundle } from "./composer-draft-bundle-budget";
import type { BundleAsset } from "./bundle-source-map";

const root = "artifacts/agentic-company-os/src/";
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const excluded = [
  "complete_task",
  "request_approval",
  "request_user_input",
  "delegate_task",
  "create_sub_agent",
  "update_task_progress",
  "load_tools",
  "list_skills",
  "read_skill",
  "list_extensions",
  "log_note",
  "post_company_message",
  "vm_codex_task",
];
const schema =
  'array(strict({kind:literal("tool_succeeded"),tool:string().check(regex(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/u),refine(e=>!excluded.has(e)))})).check(max(8),refine(e=>new Set(e.map(t=>t.tool)).size===e.length))';
const entry = `const excluded=new Set(${JSON.stringify(excluded)}),requirements=${schema};function canonical(e){return requirements.parse(e).sort((t,r)=>t.tool<r.tool?-1:t.tool>r.tool?1:0)}const project=strict({version:literal(1),kind:literal("project"),title:string(),brief:string(),priority:string(),autonomyMode:string(),cadenceSeconds:literal(3600),completionRequirements:optional(requirements)});function hasInput(e){return e.title.length>0||(e.completionRequirements?.length??0)>0}`;
const metadata = (names: string[]) =>
  `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=${JSON.stringify(names)})))=>i.map(i=>d[i]);\n`;
const choiceName = "completion-requirements-choice-fixture.js";
const viewName = "completion-requirements-view-fixture.js";
const panelName = "completion-requirements-panel-fixture.js";
const chooser =
  metadata([
    `assets/${choiceName}`,
    `assets/${viewName}`,
    "assets/legacy-fixture.js",
  ]) +
  `const choice=R.lazy(()=>L(()=>import("./${choiceName}"),__vite__mapDeps([0,1,2])));function form(){const [blocked,setBlocked]=R.useState(!0);const legacy="new-project-en cadenceSeconds";if(condition||blocked||other){}const body=J.jsx(R.Suspense,{fallback:null,children:J.jsx(choice,{value:draft.value.completionRequirements??[],onChange:t=>draft.change({...draft.current.current,completionRequirements:t}),onBlockedChange:setBlocked,onReload:()=>{draft.change(draft.current.current)&&window.location.reload()}})});return J.jsx("button",{disabled:condition||blocked||other,children:body})}`;
const status =
  metadata([
    `assets/${panelName}`,
    `assets/${viewName}`,
    "assets/legacy-fixture.js",
  ]) +
  `const panel=R.lazy(()=>L(()=>import("./${panelName}"),__vite__mapDeps([0,1,2])));function status(){return J.jsxs("section",{children:["legacy remains",!!task.completionRequirements?.length&&J.jsx(Boundary,{resetKey:id,children:J.jsx(R.Suspense,{fallback:null,children:J.jsx(panel,{taskId:id,requirements:task.completionRequirements},id)})}),"legacy remains after"]})}`;
const asset = (fileName: string, text: string): BundleAsset => ({
  fileName,
  contents: Buffer.from(text),
});
test("layout integration removes only its new bindings and retains neighboring legacy declarations and guards", () => {
  const logic = asset(choiceName, "new logic"),
    view = asset(viewName, "new view");
  const layout = chooser
    .replaceAll("completionRequirements", "resultFormat")
    .replaceAll("??[]", "??null");
  for (const text of [
    layout,
    layout.replace(
      "const [blocked,setBlocked]=R.useState(!0);",
      "const before=1,[blocked,setBlocked]=R.useState(!0),after=2;",
    ),
    layout
      .replace("const choice=", "const before=1,choice=")
      .replace(";function form()", ",after=2;function form()"),
  ]) {
    const result = resultFormatChoiceControl(
      asset("new-layout.js", text),
      logic,
      view,
    );
    assert.ok(!result.contents.includes("resultFormat"));
    assert.ok(result.contents.includes("condition||other"));
    assert.ok(
      result.contents.includes('const legacy="new-project-en cadenceSeconds"'),
    );
    if (text.includes("before=1")) {
      assert.ok(result.contents.includes("before=1"));
      assert.ok(result.contents.includes("after=2"));
    }
  }
  for (const changed of [
    layout.replace("resultFormat:t", "resultFormat:other"),
    layout.replace("condition||blocked||other", "condition||other"),
  ])
    assert.throws(() =>
      resultFormatChoiceControl(asset("new-layout.js", changed), logic, view),
    );
});
function fixture() {
  const assets: BundleAsset[] = [];
  const chunks: Array<{ fileName: string; modules: string[]; sha256: string }> =
    [];
  function add(name: string, text: string, modules: string[]) {
    const value = asset(name, text);
    assets.push(value);
    chunks.push({
      fileName: "assets/" + name,
      modules: modules.map((m) => root + m),
      sha256: createHash("sha256").update(value.contents).digest("hex"),
    });
  }
  add(
    "index-fixture.js",
    entry + ';const oldEntry="' + "x".repeat(120800 - entry.length) + '";',
    [
      "lib/completion-requirements-input.ts",
      "lib/composer-draft.ts",
      "App.tsx",
    ],
  );
  add(
    "new-fixture.js",
    chooser + ';const oldRoute="' + "x".repeat(12500 - chooser.length) + '";',
    ["pages/tasks/new.tsx"],
  );
  add("detail-fixture.js", status, ["pages/tasks/detail.tsx"]);
  add(choiceName, 'export default "optional chooser"', [
    "components/tasks/completion-requirements-choice.tsx",
  ]);
  add(panelName, 'export default "current cycle panel"', [
    "components/tasks/completion-requirements-panel.tsx",
  ]);
  add(viewName, 'export const view="strict saved receipts";', [
    "lib/completion-requirements-copy.ts",
    "lib/completion-requirements-view.ts",
  ]);
  for (const locale of locales)
    add(
      `requirements-${locale}-fixture.js`,
      `export default {title:"${locale} condition",optional:"Optional"};`,
      [`lib/completion-requirements-copy/requirements-${locale}.ts`],
    );
  for (const prefix of ["", "new-project-"])
    for (const locale of locales)
      add(
        `${prefix}${locale}-fixture.js`,
        'const c={draftStorageError:"Keep your text",title:"Existing copy"};export{c as default};',
        [`lib/${prefix || "home-"}copy/${locale}.ts`],
      );
  return { assets, manifest: { schemaVersion: 1, chunks } };
}
function mutate(
  f: ReturnType<typeof fixture>,
  name: string,
  change: (text: string) => string,
) {
  const selected = f.assets.find((a) => a.fileName === name)!;
  selected.contents = Buffer.from(change(selected.contents.toString()));
  f.manifest.chunks.find((c) => c.fileName === "assets/" + name)!.sha256 =
    createHash("sha256").update(selected.contents).digest("hex");
  return f;
}
test("condition transfer credits only source-owned lazy logic, one selected language and exact integration fragments", () => {
  const f = fixture(),
    r = measureCompletionRequirementsBundle(f.assets, f.manifest);
  assert.equal(r.packs.length, 7);
  assert.equal(r.controls.length, 3);
  assert.ok(r.integrationRaw > 500 && r.integrationRaw < 2000);
  const index = r.controls
    .find((a) => a.fileName === "index-fixture.js")!
    .contents.toString();
  assert.ok(index.includes('const oldEntry="'));
  assert.ok(index.includes('kind:literal("project")'));
  assert.ok(!index.includes("tool_succeeded"));
  assert.ok(!index.includes("completionRequirements"));
  const chooserControl = r.controls
    .find((a) => a.fileName === "new-fixture.js")!
    .contents.toString();
  assert.ok(chooserControl.includes('const oldRoute="'));
  assert.ok(chooserControl.includes("new-project-en cadenceSeconds"));
  assert.ok(chooserControl.includes("assets/legacy-fixture.js"));
  assert.ok(
    r.controls
      .find((a) => a.fileName === "detail-fixture.js")!
      .contents.includes("legacy remains after"),
  );
  const oldDraft = measureComposerDraftBundle(
    f.assets.map((a) => r.controls.find((c) => c.fileName === a.fileName) ?? a),
  );
  assert.ok(oldDraft.entryRaw <= 3000);
  assert.ok(oldDraft.integrationRaw <= 1200);
});

test("an explicit result-format draft field stays in the older budget control and earns no condition credit", () => {
  const initial = fixture(),
    baseline = measureCompletionRequirementsBundle(
      initial.assets,
      initial.manifest,
    );
  const formatted = mutate(fixture(), "index-fixture.js", (s) =>
    s.replace(
      "completionRequirements:optional(requirements)",
      "completionRequirements:optional(requirements),resultFormat:optional(format)",
    ),
  );
  const measured = measureCompletionRequirementsBundle(
    formatted.assets,
    formatted.manifest,
  );
  const control = measured.controls.find(
    (a) => a.fileName === "index-fixture.js",
  )!;
  assert.ok(control.contents.includes("resultFormat:optional(format)"));
  assert.equal(measured.integrationRaw, baseline.integrationRaw);
  for (const field of ["permissions", "formatBypass"]) {
    const unexpected = mutate(fixture(), "index-fixture.js", (s) =>
      s.replace(
        "completionRequirements:optional(requirements)",
        `completionRequirements:optional(requirements),${field}:optional(format)`,
      ),
    );
    assert.throws(() =>
      measureCompletionRequirementsBundle(
        unexpected.assets,
        unexpected.manifest,
      ),
    );
  }
});
test("unrelated entry and project growth keeps its original independent limits and earns no condition credit", () => {
  const initial = fixture(),
    control = measureCompletionRequirementsBundle(
      initial.assets,
      initial.manifest,
    );
  const f = mutate(
    mutate(
      fixture(),
      "index-fixture.js",
      (s) => s + ';const unrelated="' + "q".repeat(4000) + '";',
    ),
    "new-fixture.js",
    (s) => s + ';const unrelated="' + "q".repeat(4000) + '";',
  );
  const r = measureCompletionRequirementsBundle(f.assets, f.manifest);
  assert.equal(r.integrationRaw, control.integrationRaw);
  assert.ok(
    r.controls.every(
      (a) =>
        a.contents.includes("const unrelated=") ||
        a.fileName === "detail-fixture.js",
    ),
  );
  assert.throws(
    () =>
      measureComposerDraftBundle(
        f.assets.map(
          (a) => r.controls.find((c) => c.fileName === a.fileName) ?? a,
        ),
      ),
    /Draft entry integration exceeds its independent cap/u,
  );
});
test("forged output hashes, unrelated source ownership and duplicate language chunks cannot earn condition credit", () => {
  const altered = fixture();
  altered.assets[0].contents = Buffer.from("changed");
  assert.throws(() =>
    measureCompletionRequirementsBundle(altered.assets, altered.manifest),
  );
  const shared = fixture();
  shared.manifest.chunks
    .find((c) => c.fileName === "assets/" + choiceName)!
    .modules.push(root + "components/legacy.tsx");
  assert.throws(() =>
    measureCompletionRequirementsBundle(shared.assets, shared.manifest),
  );
  const duplicate = fixture();
  duplicate.assets.push(
    duplicate.assets.find((a) => a.fileName.startsWith("requirements-ar-"))!,
  );
  assert.throws(() =>
    measureCompletionRequirementsBundle(duplicate.assets, duplicate.manifest),
  );
});
test("unknown validation, sorting or retry behavior fails closed rather than removing arbitrary entry code", () => {
  for (const change of [
    (s: string) => s.replace("max(8)", "max(9)"),
    (s: string) =>
      s.replace("t.tool<r.tool?-1:t.tool>r.tool?1:0", "Math.random()"),
    (s: string) => s.replace('"vm_codex_task"', '"other_private_tool"'),
  ]) {
    const f = mutate(fixture(), "index-fixture.js", change);
    assert.throws(() =>
      measureCompletionRequirementsBundle(f.assets, f.manifest),
    );
  }
  const f = mutate(fixture(), "new-fixture.js", (s) =>
    s.replace(
      "draft.change(draft.current.current)&&window.location.reload()",
      "window.location.reload()",
    ),
  );
  assert.throws(() =>
    measureCompletionRequirementsBundle(f.assets, f.manifest),
  );
});
test("missing locale, oversized selected logic and unexpected condition state use preserve independent failure", () => {
  const missing = fixture();
  missing.assets = missing.assets.filter(
    (a) => !a.fileName.startsWith("requirements-de-"),
  );
  missing.manifest.chunks = missing.manifest.chunks.filter(
    (a) => !a.fileName.startsWith("assets/requirements-de-"),
  );
  assert.throws(() =>
    measureCompletionRequirementsBundle(missing.assets, missing.manifest),
  );
  const big = mutate(
    fixture(),
    choiceName,
    (s) => s + ';const oversized="' + "z".repeat(18000) + '";',
  );
  assert.throws(() =>
    measureCompletionRequirementsBundle(big.assets, big.manifest),
  );
  const extra = mutate(fixture(), "new-fixture.js", (s) =>
    s.replace("const legacy=", "const extra=blocked;const legacy="),
  );
  assert.throws(() =>
    measureCompletionRequirementsBundle(extra.assets, extra.manifest),
  );
});
test("previous measured readers are reconstructed in order without crediting their removed bytes twice", () => {
  const f = fixture(),
    original = measureCompletionRequirementsBundle(f.assets, f.manifest);
  const detail = f.assets.find((a) => a.fileName === "detail-fixture.js")!;
  const previous = asset(
    detail.fileName,
    detail.contents
      .toString()
      .replace("legacy remains after", "previous feature already measured"),
  );
  const measured = measureCompletionRequirementsBundle(f.assets, f.manifest, [
    previous,
  ]);
  assert.equal(
    measured.controls.find((a) => a.fileName === detail.fileName)!.raw,
    original.controls.find((a) => a.fileName === detail.fileName)!.raw,
  );
  assert.ok(
    measured.controls
      .find((a) => a.fileName === detail.fileName)!
      .contents.includes("previous feature already measured"),
  );
  assert.throws(() =>
    measureCompletionRequirementsBundle(f.assets, f.manifest, [
      previous,
      previous,
    ]),
  );
  assert.throws(() =>
    measureCompletionRequirementsBundle(f.assets, f.manifest, [
      asset("missing-fixture.js", "anything"),
    ]),
  );
});
