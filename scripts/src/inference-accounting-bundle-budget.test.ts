import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { measureInferenceAccountingBundle } from "./inference-accounting-bundle-budget";

const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const asset = (fileName: string, contents: string | Buffer) => ({
  fileName,
  contents: Buffer.from(contents),
});
const gzip = (contents: Buffer) => gzipSync(contents, { level: 9 }).length;
function route(scope: string, suffix = "") {
  const header =
    scope === "agent"
      ? 'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/inference-accounting-panel-test.js","assets/vendor-core-test.js","assets/index-test.js","assets/vendor-ui-test.js","assets/index-test.css"])))=>i.map(i=>d[i]);\n'
      : "";
  return asset(
    `detail-${scope}.js`,
    header +
      `const Panel=r.lazy(()=>preload(()=>import("./inference-accounting-panel-test.js"),__vite__mapDeps([0,1])));render(e.jsx(r.Suspense,{fallback:null,children:e.jsx(Panel,{scopeType:"${scope}",scopeId:id},id)}));${suffix}`,
  );
}
function fixture() {
  return [
    asset("inference-accounting-panel-test.js", "x".repeat(4500)),
    ...locales.map((locale, i) =>
      asset(`inference-copy-${locale}-test.js`, "x".repeat(1000 + i * 10)),
    ),
    route("task"),
    route("agent"),
  ];
}
test("only the exclusive panel, largest selected language and exact lazy mounts receive credit", () => {
  const assets = fixture(),
    measured = measureInferenceAccountingBundle(assets);
  assert.equal(measured.raw, 5560 + measured.integrationRaw);
  assert.equal(measured.allLocaleRaw, 7210);
  assert.equal(measured.routes.length, 2);
  for (const r of measured.routes) {
    assert.equal(r.contents.toString(), "const Panel=null;render(null);");
    const original = assets.find((a) => a.fileName === r.fileName)!;
    assert.equal(r.raw, original.contents.length - r.contents.length);
    assert.equal(
      r.gzip,
      Math.max(0, gzip(original.contents) - gzip(r.contents)),
    );
  }
  assert.deepEqual(
    measureInferenceAccountingBundle([
      ...assets,
      asset("vendor-unrelated.js", "x".repeat(99999)),
      asset("index-extra.css", "x".repeat(99999)),
    ]),
    measured,
  );
});
test("unrelated route content stays in the counterfactual and is not credited as panel code", () => {
  const assets = fixture(),
    extra = "otherWork();".repeat(400);
  assets[assets.length - 2] = route("task", extra);
  const measured = measureInferenceAccountingBundle(assets);
  const task = measured.routes.find(
    (r: { fileName: string }) => r.fileName === "detail-task.js",
  )!;
  assert.equal(
    task.contents.toString(),
    "const Panel=null;render(null);" + extra,
  );
  assert.equal(
    task.raw,
    measureInferenceAccountingBundle(fixture()).routes[0].raw,
  );
});
test("missing/duplicate packs, missing/duplicate mounts and changed wiring fail closed", () => {
  const assets = fixture();
  for (const invalid of [
    assets.filter((a) => a.fileName !== "inference-copy-ar-test.js"),
    [...assets, assets[1]],
    [...assets, assets[0]],
    assets.slice(0, -1),
    [
      ...assets.slice(0, -1),
      route(
        "agent",
        'render(e.jsx(r.Suspense,{fallback:null,children:e.jsx(Panel,{scopeType:"agent",scopeId:id},id)}));',
      ),
    ],
    [
      ...assets.slice(0, -1),
      asset(
        "detail-agent.js",
        route("agent")
          .contents.toString()
          .replace("fallback:null", "fallback:otherWork()"),
      ),
    ],
    [
      ...assets.slice(0, -1),
      route("agent", "otherWork(__vite__mapDeps([1]));"),
    ],
    [
      ...assets.slice(0, -1),
      asset(
        "detail-agent.js",
        route("agent")
          .contents.toString()
          .replace("vendor-core-test.js", "unrelated-test.js"),
      ),
    ],
  ])
    assert.throws(() => measureInferenceAccountingBundle(invalid));
});
test("independent caps reject large panel logic, aggregate locales and expensive compression", () => {
  const assets = fixture();
  assert.throws(() =>
    measureInferenceAccountingBundle([
      asset(assets[0].fileName, "x".repeat(8500)),
      ...assets.slice(1),
    ]),
  );
  assert.throws(() =>
    measureInferenceAccountingBundle(
      assets.map((a) =>
        a.fileName.startsWith("inference-copy-")
          ? asset(a.fileName, "x".repeat(2000))
          : a,
      ),
    ),
  );
  const random = Buffer.concat(
    Array.from({ length: 150 }, (_, i) =>
      createHash("sha256").update(String(i)).digest(),
    ),
  );
  assert.throws(() =>
    measureInferenceAccountingBundle([
      asset(assets[0].fileName, random),
      ...assets.slice(1),
    ]),
  );
});
