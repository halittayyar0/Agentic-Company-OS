import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import * as graph from "./bundle-source-map";
import { resolveExclusiveBundleAssets } from "./bundle-source-map";
const root = "artifacts/agentic-company-os/src/";
const required = [root + "lib/project-preparation.ts"];
const allowed = [...required, root + "lib/reusable-work-copy.ts"];
function fixture() {
  const assets = [
    {
      fileName: "feature-hash.js",
      contents: Buffer.from('const exact="brief";'),
    },
    {
      fileName: "vendor-hash.js",
      contents: Buffer.from('const vendor="old";'),
    },
  ];
  const manifest = {
    schemaVersion: 1,
    chunks: assets.map((asset, i) => ({
      fileName: "assets/" + asset.fileName,
      sha256: createHash("sha256").update(asset.contents).digest("hex"),
      modules: i === 0 ? [...allowed] : [],
    })),
  };
  return { assets, manifest };
}
test("CSS-excluded TypeScript and JavaScript cannot enter the actual runtime graph", () => {
  for (const extension of [".ts", ".tsx", ".js"]) {
    const f = fixture(),
      excluded = root + "lib/example.test" + extension;
    f.manifest.chunks[0].modules.push(excluded);
    assert.throws(
      () =>
        graph.assertNoExcludedBundleModules(f.assets, f.manifest, [excluded]),
      /CSS-excluded/,
    );
    assert.doesNotThrow(() =>
      graph.assertNoExcludedBundleModules(f.assets, f.manifest, [
        root + "lib/other.test" + extension,
      ]),
    );
  }
});
test("source ownership deduplicates one shared feature chunk and excludes unrelated vendor bytes", () => {
  const f = fixture();
  assert.deepEqual(
    resolveExclusiveBundleAssets(f.assets, f.manifest, allowed, allowed),
    [f.assets[0]],
  );
  f.assets[1].contents = Buffer.from("unrelated".repeat(20000));
  f.manifest.chunks[1].sha256 = createHash("sha256")
    .update(f.assets[1].contents)
    .digest("hex");
  assert.deepEqual(
    resolveExclusiveBundleAssets(f.assets, f.manifest, required, allowed),
    [f.assets[0]],
  );
});
test("missing or ambiguously mapped source modules cannot earn exclusive credit", () => {
  const missing = fixture();
  missing.manifest.chunks[0].modules = [allowed[1]];
  assert.throws(() =>
    resolveExclusiveBundleAssets(
      missing.assets,
      missing.manifest,
      required,
      allowed,
    ),
  );
  const duplicate = fixture();
  duplicate.manifest.chunks[1].modules = required;
  assert.throws(() =>
    resolveExclusiveBundleAssets(
      duplicate.assets,
      duplicate.manifest,
      required,
      allowed,
    ),
  );
});
test("old route code sharing a feature chunk cannot be excluded as exclusive feature bytes", () => {
  const f = fixture();
  f.manifest.chunks[0].modules.push(root + "pages/tasks/detail.tsx");
  assert.throws(() =>
    resolveExclusiveBundleAssets(f.assets, f.manifest, required, allowed),
  );
});
test("stale output hashes and duplicate assets cannot receive credit based on filenames", () => {
  const f = fixture();
  f.assets[0].contents = Buffer.from('const changed="unrelated";');
  assert.throws(() =>
    resolveExclusiveBundleAssets(f.assets, f.manifest, required, allowed),
  );
  const duplicate = fixture();
  duplicate.assets.push(duplicate.assets[0]);
  assert.throws(() =>
    resolveExclusiveBundleAssets(
      duplicate.assets,
      duplicate.manifest,
      required,
      allowed,
    ),
  );
});
test("absolute, traversing, duplicate and foreign module ownership is rejected", () => {
  for (const module of [
    "C:/Users/HP/private.ts",
    "../outside.ts",
    root + "../outside.ts",
    "node_modules/feature.ts",
  ]) {
    const f = fixture();
    f.manifest.chunks[0].modules.push(module);
    assert.throws(() =>
      resolveExclusiveBundleAssets(f.assets, f.manifest, required, allowed),
    );
  }
  const duplicate = fixture();
  duplicate.manifest.chunks[0].modules.push(required[0]);
  assert.throws(() =>
    resolveExclusiveBundleAssets(
      duplicate.assets,
      duplicate.manifest,
      required,
      allowed,
    ),
  );
});
