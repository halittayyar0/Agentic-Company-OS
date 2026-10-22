import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { measureDeliveryDownloadBundle } from "./delivery-download-bundle-budget";

function fixture() {
  const root = "artifacts/agentic-company-os/src/";
  const modules = [
    "components/studio/project-delivery-download.tsx",
    "lib/project-delivery-export.ts",
    "lib/delivery-download-copy.ts",
  ].map((x) => root + x);
  const assets = [
    {
      fileName: "delivery-download-aabbccdd.js",
      contents: Buffer.from("new feature only".repeat(80)),
    },
    ...["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"].map((locale) => ({
      fileName: `delivery-copy-${locale}-aabbccdd.js`,
      contents: Buffer.from(`export default {label:"${locale}"}`),
    })),
  ];
  const manifest = {
    schemaVersion: 1,
    chunks: assets.map((a, index) => ({
      fileName: "assets/" + a.fileName,
      sha256: createHash("sha256").update(a.contents).digest("hex"),
      modules:
        index === 0
          ? modules
          : [
              root +
                `lib/delivery-download-copy/delivery-copy-${["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"][index - 1]}.ts`,
            ],
    })),
  };
  return { assets, manifest };
}
test("delivery transfer counts only exclusive implementation and largest selected pack, with all packs bounded on disk", () => {
  const { assets, manifest } = fixture();
  const result = measureDeliveryDownloadBundle(assets, manifest);
  assert.equal(
    result.raw,
    assets[0].contents.length +
      Math.max(...assets.slice(1).map((a) => a.contents.length)),
  );
  assert.equal(
    result.allLocaleRaw,
    assets.slice(1).reduce((n, a) => n + a.contents.length, 0),
  );
  assert.equal(result.packs.length, 7);
});
test("delivery credit rejects a shared legacy module and changed compiler-owned output bytes", () => {
  const { assets, manifest } = fixture();
  manifest.chunks[0].modules.push(
    "artifacts/agentic-company-os/src/lib/markdown.tsx",
  );
  assert.throws(
    () => measureDeliveryDownloadBundle(assets, manifest),
    /unrelated source/,
  );
  const clean = fixture();
  clean.assets[0].contents = Buffer.from("changed output");
  assert.throws(
    () => measureDeliveryDownloadBundle(clean.assets, clean.manifest),
    /hash mismatch/,
  );
});
test("delivery transfer cannot hide a missing language or exceed the independent feature cap", () => {
  const missing = fixture();
  missing.assets.pop();
  missing.manifest.chunks.pop();
  assert.throws(() =>
    measureDeliveryDownloadBundle(missing.assets, missing.manifest),
  );
  const large = fixture();
  large.assets[0].contents = Buffer.alloc(6001, 120);
  large.manifest.chunks[0].sha256 = createHash("sha256")
    .update(large.assets[0].contents)
    .digest("hex");
  assert.throws(
    () => measureDeliveryDownloadBundle(large.assets, large.manifest),
    /independent feature budget/,
  );
});
