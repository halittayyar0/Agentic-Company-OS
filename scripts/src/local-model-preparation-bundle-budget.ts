import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  resolveExclusiveBundleAssets,
  type BundleAsset,
} from "./bundle-source-map";
const root = "artifacts/agentic-company-os/src/";
const sources = [
  "components/studio/local-model-preparation-slot.tsx",
  "components/studio/local-model-preparation.tsx",
  "lib/local-model-preparation-api.ts",
  "lib/local-model-preparation-copy.ts",
].map((file) => root + file);
const locales = ["en", "tr", "de", "ru", "zh-CN", "zh-TW", "ar"];
const gzip = (asset: BundleAsset) =>
  gzipSync(asset.contents, { level: 9 }).length;

/** Exclusive new setup logic and one selected language only; all seven packs
 * have a separate disk ceiling. No shared connection, route, UI, generated
 * SDK, vendor, theme or existing language code receives this feature credit. */
export function measureLocalModelPreparationBundle(
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
    const source =
      root + `lib/local-model-preparation-copy/preparation-${locale}.ts`;
    const selected = resolveExclusiveBundleAssets(
      assets,
      manifest,
      [source],
      [source],
    );
    assert.equal(
      selected.length,
      1,
      "Expected one exclusive local preparation pack per language",
    );
    return selected[0];
  });
  const raw =
    logic.reduce((total, asset) => total + asset.contents.length, 0) +
    Math.max(...packs.map((asset) => asset.contents.length));
  const compressed =
    logic.reduce((total, asset) => total + gzip(asset), 0) +
    Math.max(...packs.map(gzip));
  const allLocaleRaw = packs.reduce(
    (total, asset) => total + asset.contents.length,
    0,
  );
  const allLocaleGzip = packs.reduce((total, asset) => total + gzip(asset), 0);
  assert.ok(
    raw <= 12 * 1024 &&
      compressed <= 4 * 1024 &&
      allLocaleRaw <= 32 * 1024 &&
      allLocaleGzip <= 16 * 1024,
    `Local model preparation exceeds its independent feature budget (${raw} raw / ${compressed} gzip; packs ${allLocaleRaw} raw / ${allLocaleGzip} gzip)`,
  );
  return { raw, gzip: compressed, allLocaleRaw, allLocaleGzip, packs };
}
