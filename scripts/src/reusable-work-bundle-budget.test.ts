import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { measureReusableWorkBundle } from "./reusable-work-bundle-budget";
const root = "artifacts/agentic-company-os/src/";
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const reuseFields = [
  "incomingTitle",
  "incomingHelp",
  "keepCurrent",
  "useIncoming",
  "choiceError",
  "preparationOnly",
  "savedBrief",
  "useBrief",
  "prepareGuide",
  "sourceHelp",
  "guideSource",
  "preparedGuide",
  "guideTitleHelp",
  "prepareProject",
  "disabledGuideHelp",
  "runtimeHelp",
  "waitingGuide",
];
const editorFields = [
  "storageError",
  "pendingTitle",
  "uncertain",
  "rejected",
  "check",
  "retry",
  "continue",
  "matching",
  "missing",
  "changed",
  "invalid",
  "validation",
  "availability",
  "incomingHelp",
  "keep",
  "use",
  "reviewCurrent",
  "storedVersion",
  "storedAvailability",
  "reviewHelp",
];
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-reuse-budget-"));
  const sourceDirectory = path.join(directory, "src");
  mkdirSync(path.join(directory, "dist"));
  const assets: { fileName: string; contents: Buffer }[] = [];
  const chunks: { fileName: string; sha256: string; modules: string[] }[] = [];
  function add(name: string, code: string, modules: string[]) {
    assets.push({ fileName: name, contents: Buffer.from(code) });
    chunks.push({
      fileName: "assets/" + name,
      modules: modules.map((file) => root + file),
      sha256: "",
    });
  }
  add(
    "project-preparation-fixture.js",
    'export const draft="acosSkillDraft";',
    ["lib/project-preparation.ts", "lib/reusable-work-copy.ts"],
  );
  add(
    "project-preparation-choice-fixture.js",
    'export const choice="review";',
    ["components/studio/project-preparation-choice.tsx"],
  );
  add(
    "project-reuse-actions-fixture.js",
    'export const guide="acosGuideDraft";',
    ["components/studio/project-reuse-actions.tsx"],
  );
  add("project-reuse-fixture.js", 'export const source="saved";', [
    "lib/project-reuse.ts",
    "lib/extension-editor-draft.ts",
  ]);
  add("extension-library-fixture.js", "x".repeat(7942), [
    "components/extension-library.tsx",
    "hooks/use-extension-editor.ts",
    "lib/extension-editor-copy.ts",
  ]);
  add(
    "detail-fixture.js",
    'const oldView=jsx(React.Suspense,{fallback:null,children:jsx(Legacy,{project:task,sourceUnavailable:error||fetching})});const UI=React.lazy(()=>load(()=>import("./project-reuse-actions-fixture.js"),__vite__mapDeps([0])));const view=task.parentTaskId===null&&jsx(React.Suspense,{fallback:null,children:jsx(UI,{project:task,sourceUnavailable:error||fetching})});',
    ["pages/tasks/detail.tsx"],
  );
  const copies = new Map<string, Record<string, string>>();
  function setCopy(
    family: "reuse" | "editor",
    locale: string,
    values: Record<string, string>,
    prefix = "",
  ) {
    const folder =
      family === "reuse" ? "reusable-work-copy" : "extension-editor-copy";
    const module = `lib/${folder}/${family}-${locale}.ts`;
    const file = path.join(sourceDirectory, module);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `export default ${JSON.stringify(values)};`);
    const name = `${family}-${locale}-fixture.js`;
    const code = `${prefix}const c=${JSON.stringify(values)};export{c as default};`;
    const old = assets.find((asset) => asset.fileName === name);
    if (old) old.contents = Buffer.from(code);
    else add(name, code, [module]);
    copies.set(family + "-" + locale, values);
  }
  for (const locale of locales) {
    setCopy(
      "reuse",
      locale,
      Object.fromEntries(
        reuseFields.map((key) => [key, `Review ${key} ${locale}`]),
      ),
    );
    setCopy(
      "editor",
      locale,
      Object.fromEntries(
        editorFields.map((key) => [key, `Review ${key} ${locale}`]),
      ),
    );
  }
  function refresh() {
    for (const chunk of chunks)
      chunk.sha256 = createHash("sha256")
        .update(
          assets.find((asset) => "assets/" + asset.fileName === chunk.fileName)!
            .contents,
        )
        .digest("hex");
    writeFileSync(
      path.join(directory, "dist/bundle-budget-manifest.json"),
      JSON.stringify({ schemaVersion: 1, chunks }),
    );
  }
  refresh();
  return { assets, chunks, sourceDirectory, setCopy, copies, refresh };
}
test("reuse accounting includes exclusive code and two selected authored packs without crediting unrelated old code", () => {
  const f = fixture();
  const a = measureReusableWorkBundle(f.assets, f.sourceDirectory);
  assert.equal(a.exclusive.length, 4);
  assert.equal(a.families.length, 2);
  assert.equal(a.libraryRaw, 0);
  assert.ok(a.integrationRaw > 0);
  assert.ok(a.routes[0].contents.includes("UI=null"));
  assert.ok(
    !a.routes[0].contents.includes("jsx(UI,{project:task,sourceUnavailable:"),
  );
  assert.ok(
    a.routes[0].contents.includes(
      "jsx(Legacy,{project:task,sourceUnavailable:error||fetching})",
    ),
  );
  f.assets.push({
    fileName: "vendor-extra.js",
    contents: Buffer.from("unrelated".repeat(15000)),
  });
  f.chunks.push({
    fileName: "assets/vendor-extra.js",
    sha256: "",
    modules: [],
  });
  f.refresh();
  assert.deepEqual(measureReusableWorkBundle(f.assets, f.sourceDirectory), a);
});
test("aggregate copy credit uses independent current and control peaks, never a sum of language additions", () => {
  const f = fixture();
  f.setCopy(
    "reuse",
    "en",
    { ...f.copies.get("reuse-en")!, incomingTitle: "A".repeat(100) },
    `const existing=${JSON.stringify("Existing ".repeat(220))};`,
  );
  f.setCopy("reuse", "ru", {
    ...f.copies.get("reuse-ru")!,
    incomingTitle: "B".repeat(1600),
  });
  f.refresh();
  const a = measureReusableWorkBundle(f.assets, f.sourceDirectory);
  const family = a.families.find((row) => row.name === "reuse")!;
  const current = family.packs.map(
    (pack) =>
      f.assets.find((asset) => asset.fileName === pack.fileName)!.contents,
  );
  assert.equal(
    family.globalRaw,
    Math.max(...current.map((bytes) => bytes.length)) -
      Math.max(...family.packs.map((pack) => pack.contents.length)),
  );
  assert.equal(
    family.globalGzip,
    Math.max(...current.map((bytes) => gzipSync(bytes, { level: 9 }).length)) -
      Math.max(
        ...family.packs.map(
          (pack) => gzipSync(pack.contents, { level: 9 }).length,
        ),
      ),
  );
  assert.ok(
    family.globalRaw < Math.max(...family.packs.map((pack) => pack.raw)),
  );
});
test("a sole authored copy export includes its new compiler wrapper, while extra old statements remain in control", () => {
  const f = fixture();
  let a = measureReusableWorkBundle(f.assets, f.sourceDirectory);
  assert.ok(
    a.families.every((family) => family.globalRaw === family.selectedRaw),
  );
  assert.ok(
    a.families.every((family) => family.globalGzip === family.selectedGzip),
  );
  f.setCopy(
    "reuse",
    "en",
    f.copies.get("reuse-en")!,
    'const existing="legacy";',
  );
  f.refresh();
  a = measureReusableWorkBundle(f.assets, f.sourceDirectory);
  const control = a.families[0].packs
    .find((pack) => pack.fileName === "reuse-en-fixture.js")!
    .contents.toString();
  assert.ok(control.includes('const existing="legacy";'));
  assert.ok(control.includes("export{c as default}"));
});
test("missing or mixed source ownership and changed compiler output fail instead of broadening old-route credit", () => {
  for (const mutation of ["missing", "mixed", "stale"] as const) {
    const f = fixture();
    if (mutation === "missing") f.chunks[0].modules = [];
    if (mutation === "mixed")
      f.chunks[0].modules.push(root + "pages/tasks/new.tsx");
    if (mutation === "stale") f.assets[0].contents = Buffer.from("changed");
    else f.refresh();
    assert.throws(() => measureReusableWorkBundle(f.assets, f.sourceDirectory));
  }
});
test("unauthored or extended copy cannot silently earn seven-language credit", () => {
  for (const mutation of ["changed", "extra"] as const) {
    const f = fixture();
    const asset = f.assets.find(
      (row) => row.fileName === "reuse-en-fixture.js",
    )!;
    if (mutation === "changed")
      asset.contents = Buffer.from(
        asset.contents
          .toString()
          .replace("Review incomingTitle en", "Different text"),
      );
    else
      asset.contents = Buffer.from(
        asset.contents
          .toString()
          .replace("const c={", 'const c={unrelated:"foreign",'),
      );
    f.refresh();
    assert.throws(() => measureReusableWorkBundle(f.assets, f.sourceDirectory));
  }
});
test("reader changes beyond the exact lazy declaration and root-only mount receive no guessed wiring allowance", () => {
  const f = fixture();
  const asset = f.assets.find((row) => row.fileName === "detail-fixture.js")!;
  asset.contents = Buffer.from(
    asset.contents
      .toString()
      .replace(
        "jsx(UI,{project:task,sourceUnavailable:error||fetching})",
        "jsx(UI,{project:task,sourceUnavailable:true})",
      ),
  );
  f.refresh();
  assert.throws(() => measureReusableWorkBundle(f.assets, f.sourceDirectory));
});

test("shared legacy readers keep their old code and existing root guard while only the new mount earns credit", () => {
  const f = fixture();
  const asset = f.assets.find((row) => row.fileName === "detail-fixture.js")!;
  asset.contents = Buffer.from(
    asset.contents
      .toString()
      .replace(
        "const view=task.parentTaskId===null&&",
        "const isRoot=task.parentTaskId===null;const view=isRoot&&",
      ) +
      "function unrelated(){const isRoot=false;return isRoot;}" +
      `const oldReader=${JSON.stringify("legacy".repeat(1000))};`,
  );
  f.chunks
    .find((row) => row.fileName === "assets/detail-fixture.js")!
    .modules.push(root + "components/studio/project-workbench.tsx");
  f.refresh();
  const a = measureReusableWorkBundle(f.assets, f.sourceDirectory);
  assert.ok(
    a.routes[0].contents.includes("const isRoot=task.parentTaskId===null"),
  );
  assert.ok(a.routes[0].contents.includes("legacy".repeat(1000)));
  assert.ok(a.integrationRaw < 600);
});

test("independent feature limits cannot be replaced by unused aggregate headroom", () => {
  for (const kind of ["exclusive", "legacy", "all-copy"] as const) {
    const f = fixture();
    if (kind === "exclusive")
      f.assets[0].contents = Buffer.from("x".repeat(14001));
    if (kind === "legacy")
      f.assets.find(
        (asset) => asset.fileName === "extension-library-fixture.js",
      )!.contents = Buffer.from("x".repeat(7942 + 11001));
    if (kind === "all-copy")
      for (const locale of locales)
        f.setCopy("reuse", locale, {
          ...f.copies.get("reuse-" + locale)!,
          incomingTitle: "A".repeat(3000),
        });
    f.refresh();
    assert.throws(() => measureReusableWorkBundle(f.assets, f.sourceDirectory));
  }
});
test("only preload suffix paths solely used by the verified new reader receive metadata credit", () => {
  for (const shared of [false, true]) {
    const f = fixture();
    const asset = f.assets.find((row) => row.fileName === "detail-fixture.js")!;
    asset.contents = Buffer.from(
      'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/project-preparation-fixture.js","assets/project-reuse-actions-fixture.js"])))=>i.map(i=>d[i]);\n' +
        asset.contents
          .toString()
          .replace("__vite__mapDeps([0])", "__vite__mapDeps([1])") +
        "const old=()=>__vite__mapDeps([0]);" +
        (shared ? "const other=()=>__vite__mapDeps([1]);" : ""),
    );
    f.refresh();
    const a = measureReusableWorkBundle(f.assets, f.sourceDirectory);
    assert.equal(a.metadataRaw > 0, !shared);
    assert.equal(
      a.routes[0].contents.includes(
        '"assets/project-reuse-actions-fixture.js"',
      ),
      shared,
    );
    assert.ok(
      a.routes[0].contents.includes('"assets/project-preparation-fixture.js"'),
    );
    assert.ok(
      a.routes[0].contents.includes("const old=()=>__vite__mapDeps([0]);"),
    );
  }
});
