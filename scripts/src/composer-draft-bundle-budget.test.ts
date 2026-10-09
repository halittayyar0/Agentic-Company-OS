import assert from "node:assert/strict";
import test from "node:test";
import { measureComposerDraftBundle } from "./composer-draft-bundle-budget";
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
