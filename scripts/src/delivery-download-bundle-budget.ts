import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  resolveExclusiveBundleAssets,
  type BundleAsset,
} from "./bundle-source-map";
const root = "artifacts/agentic-company-os/src/";
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const sources = [
  "components/studio/project-delivery-download.tsx",
  "lib/project-delivery-export.ts",
  "lib/delivery-download-copy.ts",
].map((file) => root + file);
const gzip = (a: BundleAsset) => gzipSync(a.contents, { level: 9 }).length;
/** Only three new source modules and the largest of seven selected new packs
 * receive credit. Shared report/Markdown/studio/route/vendor/CSS modules are
 * rejected by compiler-owned SHA/source attribution. Existing caps stay fixed.
 * Bound this new download feature to 6 KB raw / 2.5 KB gzip and all seven packs
 * on disk to 6 KB / 3.5 KB, without counting all languages as a user transfer. */
export function measureDeliveryDownloadBundle(
  assets: readonly BundleAsset[],
  manifest: unknown,
) {
  const logic = resolveExclusiveBundleAssets(
    assets,
    manifest,
    sources,
    sources,
  );
  const packs = locales.map((locale) => {
    const module =
      root + `lib/delivery-download-copy/delivery-copy-${locale}.ts`;
    const selected = resolveExclusiveBundleAssets(
      assets,
      manifest,
      [module],
      [module],
    );
    assert.equal(
      selected.length,
      1,
      "Expected one exclusive delivery pack per language",
    );
    return selected[0];
  });
  const raw =
    logic.reduce((n, a) => n + a.contents.length, 0) +
    Math.max(...packs.map((a) => a.contents.length));
  const compressed =
    logic.reduce((n, a) => n + gzip(a), 0) + Math.max(...packs.map(gzip));
  const allLocaleRaw = packs.reduce((n, a) => n + a.contents.length, 0),
    allLocaleGzip = packs.reduce((n, a) => n + gzip(a), 0);
  assert.ok(
    raw <= 6000 &&
      compressed <= 2500 &&
      allLocaleRaw <= 6000 &&
      allLocaleGzip <= 3500,
    "Delivery download exceeds its independent feature budget",
  );
  return { raw, gzip: compressed, allLocaleRaw, allLocaleGzip, packs };
}
