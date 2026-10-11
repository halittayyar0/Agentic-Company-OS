import assert from "node:assert/strict";
import { resolveExclusiveBundleAssets } from "./bundle-source-map";
import { gzipSync } from "node:zlib";
interface Asset {
  fileName: string;
  contents: Buffer;
}
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const gzip = (asset: Asset) => gzipSync(asset.contents, { level: 9 }).length;
/** The user-requested in-place connection flow is loaded on demand. Charge
 * its source-owned UI/transport chunks and the existing shared copy loader plus the largest selected pack;
 * bound all seven authored packs on disk independently. No entry, existing
 * notice, Settings, generated SDK, vendor or CSS growth receives credit.
 * Existing numeric base/total/route budgets stay unchanged. */
export function measureConnectionBundle(
  assets: readonly Asset[],
  manifest: unknown,
) {
  const one = (prefix: string) => {
    const matches = assets.filter(
      (a) => a.fileName.startsWith(`${prefix}-`) && a.fileName.endsWith(".js"),
    );
    if (matches.length !== 1)
      throw new Error(`Connection requires one exclusive ${prefix} asset`);
    return matches[0];
  };
  const prefix = "artifacts/agentic-company-os/src/";
  const ownedModules = [
    "components/studio/guided-model-connection.tsx",
    "components/studio/guided-chatgpt-connection.tsx",
    "components/studio/model-connection-launcher.tsx",
    "lib/connection-api.ts",
    "lib/chatgpt-connection-api.ts",
    "lib/connection-copy.ts",
  ].map((module) => prefix + module);
  // The pre-existing copy loader was embedded in guided-model-connection.
  // Count the same owned scope when it is split, once, within the same caps.
  const logic = resolveExclusiveBundleAssets(
    assets,
    manifest,
    ownedModules,
    ownedModules,
  );
  for (const name of [
    "guided-model-connection",
    "guided-chatgpt-connection",
    "model-connection-launcher",
  ])
    assert.ok(
      logic.some((asset) => asset.fileName === one(name).fileName),
      "Connection name/source ownership mismatch",
    );
  const packs = locales.map((locale) => {
    const module = prefix + "lib/connection-copy/connection-" + locale + ".ts";
    const selected = resolveExclusiveBundleAssets(
      assets,
      manifest,
      [module],
      [module],
    );
    assert.equal(selected.length, 1);
    assert.equal(
      selected[0].fileName,
      one("connection-" + locale).fileName,
      "Connection pack ownership mismatch",
    );
    return selected[0];
  });
  const raw =
    logic.reduce((sum, a) => sum + a.contents.length, 0) +
    Math.max(...packs.map((a) => a.contents.length));
  const compressed =
    logic.reduce((sum, a) => sum + gzip(a), 0) + Math.max(...packs.map(gzip));
  const allLocaleRaw = packs.reduce((sum, a) => sum + a.contents.length, 0),
    allLocaleGzip = packs.reduce((sum, a) => sum + gzip(a), 0);
  if (
    raw > 28000 ||
    compressed > 10500 ||
    allLocaleRaw > 40000 ||
    allLocaleGzip > 16000
  )
    throw new Error("Guided connection exceeds its independent feature budget");
  return { raw, gzip: compressed, allLocaleRaw, allLocaleGzip };
}
