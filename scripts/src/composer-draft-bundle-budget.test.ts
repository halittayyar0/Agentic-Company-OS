import assert from "node:assert/strict";
import test from "node:test";
import {
  measureComposerDraftBundle,
  resolveComposerDraftScope,
} from "./composer-draft-bundle-budget";
import { createHash } from "node:crypto";
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const asset = (fileName: string, contents: string) => ({
  fileName,
  contents: Buffer.from(contents),
});
function fixture() {
  return [
    asset("index-fixture.js", "x".repeat(121000)),
    asset("new-fixture.js", "new-project-en cadenceSeconds".padEnd(12500, "x")),
    ...["", "new-project-"].flatMap((prefix) =>
      locales.map((locale) =>
        asset(
          `${prefix}${locale}-fixture.js`,
          'const c={draftStorageError:"Keep your text",title:"Existing copy"};export{c as default};',
        ),
      ),
    ),
  ];
}

test("route and split loader credit reject unrelated source even with valid output hashes", () => {
  const route = asset("new-fixture.js", "cadenceSeconds");
  const loader = asset("shared-copy-fixture.js", "new-project-en");
  const sources = [
    "artifacts/agentic-company-os/src/pages/tasks/new.tsx",
    "artifacts/agentic-company-os/src/lib/new-project-copy.ts",
  ];
  const assets = [route, loader];
  const manifest = {
    schemaVersion: 1,
    chunks: assets.map((a, i) => ({
      fileName: "assets/" + a.fileName,
      modules: [sources[i]],
      sha256: createHash("sha256").update(a.contents).digest("hex"),
    })),
  };
  assert.deepEqual(resolveComposerDraftScope(assets, manifest), {
    route: route.fileName,
    loader: loader.fileName,
  });
  const shared = asset(
    route.fileName,
    route.contents.toString() + loader.contents.toString(),
  );
  assert.deepEqual(
    resolveComposerDraftScope([shared], {
      schemaVersion: 1,
      chunks: [
        {
          fileName: "assets/" + shared.fileName,
          modules: sources,
          sha256: createHash("sha256").update(shared.contents).digest("hex"),
        },
      ],
    }),
    { route: shared.fileName, loader: shared.fileName },
  );
  for (const i of [0, 1]) {
    const bad = structuredClone(manifest);
    bad.chunks[i].modules.push(
      "artifacts/agentic-company-os/src/pages/settings.tsx",
    );
    assert.throws(
      () => resolveComposerDraftScope(assets, bad),
      /unrelated source/u,
    );
  }
  assert.throws(
    () =>
      resolveComposerDraftScope(
        [route, asset(loader.fileName, "altered")],
        manifest,
      ),
    /hash mismatch/u,
  );
});

test("source-identified project routes can share the language loader without changing any numeric cap", () => {
  const original = fixture();
  const shared = original.map((item, index) =>
    index === 1
      ? asset(
          item.fileName,
          "cadenceSeconds shared-copy-loader".padEnd(12500, "x"),
        )
      : item,
  );
  assert.throws(() => measureComposerDraftBundle(shared));
  assert.deepEqual(
    measureComposerDraftBundle(shared, original[1].fileName),
    measureComposerDraftBundle(original),
  );
  assert.throws(() => measureComposerDraftBundle(shared, "new-missing.js"));
  assert.throws(() =>
    measureComposerDraftBundle([...shared, shared[1]], original[1].fileName),
  );
  assert.throws(() =>
    measureComposerDraftBundle(
      [
        shared[0],
        asset(shared[1].fileName, "cadenceSeconds".padEnd(14000, "x")),
        ...shared.slice(2),
      ],
      original[1].fileName,
    ),
  );
});

test("a split pre-existing copy loader stays in the same measured route scope once", () => {
  const original = fixture();
  const split = [
    original[0],
    asset(original[1].fileName, "cadenceSeconds".padEnd(12000, "x")),
    asset("shared-copy-fixture.js", "new-project-en".padEnd(500, "x")),
    ...original.slice(2),
  ];
  const measured = measureComposerDraftBundle(
    split,
    original[1].fileName,
    "shared-copy-fixture.js",
  );
  assert.equal(
    measured.integrationRaw,
    measureComposerDraftBundle(original).integrationRaw,
  );
  assert.deepEqual(
    measureComposerDraftBundle(
      original,
      original[1].fileName,
      original[1].fileName,
    ),
    measureComposerDraftBundle(original),
  );
  assert.throws(() =>
    measureComposerDraftBundle(split, original[1].fileName, "absent.js"),
  );
  assert.throws(() =>
    measureComposerDraftBundle(
      [...split, split[2]],
      original[1].fileName,
      split[2].fileName,
    ),
  );
  assert.throws(() =>
    measureComposerDraftBundle(
      [
        split[0],
        split[1],
        asset(split[2].fileName, "x".repeat(2000)),
        ...split.slice(3),
      ],
      original[1].fileName,
      split[2].fileName,
    ),
  );
});
test("draft credit includes only exclusive logic, bounded project wiring and reconstructed selected warning fields", () => {
  const assets = fixture(),
    measured = measureComposerDraftBundle(assets);
  assert.equal(measured.integrationRaw, 474);
  assert.equal(
    measured.allLocaleRaw,
    14 * 'draftStorageError:"Keep your text",'.length,
  );
  assert.equal(measured.entryRaw, 1682);
  assert.deepEqual(
    measureComposerDraftBundle([
      ...assets,
      asset("vendor-fixture.js", "x".repeat(100000)),
    ]),
    measured,
  );
});
test("extra project growth, missing warning vocabulary, duplicate language assets and oversized logic cannot earn draft credit", () => {
  const assets = fixture();
  assert.throws(() =>
    measureComposerDraftBundle([
      asset(assets[0].fileName, "x".repeat(123000)),
      ...assets.slice(1),
    ]),
  );
  assert.throws(() =>
    measureComposerDraftBundle([
      assets[0],
      asset(
        assets[1].fileName,
        "new-project-en cadenceSeconds".padEnd(14000, "x"),
      ),
      ...assets.slice(2),
    ]),
  );
  assert.throws(() => measureComposerDraftBundle(assets.slice(0, -1)));
  assert.throws(() => measureComposerDraftBundle([...assets, assets[2]]));
  assert.throws(() =>
    measureComposerDraftBundle([
      ...assets.slice(0, -1),
      asset(assets.at(-1)!.fileName, 'const c={title:"No draft vocabulary"};'),
    ]),
  );
});
