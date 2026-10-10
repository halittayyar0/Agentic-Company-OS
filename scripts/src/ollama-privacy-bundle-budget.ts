import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  resolveExclusiveBundleAssets,
  type BundleAsset,
} from "./bundle-source-map";
const fingerprints: Readonly<Record<string, string>> = {
  "artifacts/agentic-company-os/src/components/agent/agent-model-picker.tsx":
    "1b659ab102c401390b5af6496d8203d7c705134c40c04c5d84efa73973320f91",
  "artifacts/agentic-company-os/src/components/agent/ollama-model-location.tsx":
    "70a8f7232bd8ff4960f7e92a23933f8abc4a6c28a6761983a976b82034c6a336",
  "artifacts/agentic-company-os/src/components/i18n/language-select.tsx":
    "90b39a1405618610edbbcf9c09028bbc655ef1f303265beec04107d5c00709cd",
  "artifacts/agentic-company-os/src/lib/model-search.ts":
    "7e67d42fb1d38b312eb9a8a48f906c391e0b3068ecefd9a25e55485be6a10ab5",
  "artifacts/agentic-company-os/src/lib/new-agent-copy.ts":
    "c5831b32192fc10c587fbbfd6a4ac9dbf2ea9185fb3e7049dafd4346df4630a7",
  "artifacts/agentic-company-os/src/lib/settings-copy.ts":
    "46c96546518e195b5a7dc2039d0a0bea3c413fdcb4c726d6698c35dfcfb942ef",
  "artifacts/agentic-company-os/src/pages/settings.tsx":
    "ce91dcb57186533ea8edf3d7670ee7759309fc16c098f6243996fe67a0b41e5a",
};
export const OLLAMA_PRIVACY_SOURCES = Object.freeze(
  Object.keys(fingerprints).sort(),
);
/** Charge only measured new model privacy code, not whole legacy chunks.
 * The same-compiler control uses the UI sources from025309ee with the current
 * lockfile and authored packs:21607raw/7493gzip; Settings15559raw/4950gzip.
 * Bound the new scope to2KBraw/900gzip and its Settings share to600raw/200gzip.
 * Existing caps stay fixed. Remove that Settings share from old first-task
 * accounting to avoid duplicate credit. All seven current source identities
 * and compiler-owned outputs are checked, including unchanged companions.
 * Entry, SDK, vendor, CSS, locale and connection assets receive no credit.
 * See docs/bundle-performance.md for the frozen control and update policy.
 */
export function measureOllamaPrivacyBundle(
  assets: readonly BundleAsset[],
  manifest: unknown,
  sources: Readonly<Record<string, string>>,
) {
  assert.deepEqual(
    Object.keys(sources).sort(),
    OLLAMA_PRIVACY_SOURCES,
    "Privacy source inventory changed",
  );
  for (const module of OLLAMA_PRIVACY_SOURCES)
    assert.equal(
      createHash("sha256")
        .update(sources[module].replace(/\r\n/gu, "\n"))
        .digest("hex"),
      fingerprints[module],
      "Privacy or old companion source changed",
    );
  const selected = resolveExclusiveBundleAssets(
    assets,
    manifest,
    OLLAMA_PRIVACY_SOURCES,
    OLLAMA_PRIVACY_SOURCES,
  );
  const compressed = (contents: Buffer) =>
    gzipSync(contents, { level: 9 }).length;
  const raw = Math.max(
    0,
    selected.reduce((n, a) => n + a.contents.length, 0) - 21607,
  );
  const gzip = Math.max(
    0,
    selected.reduce((n, a) => n + compressed(a.contents), 0) - 7493,
  );
  const settings = resolveExclusiveBundleAssets(
    assets,
    manifest,
    ["artifacts/agentic-company-os/src/pages/settings.tsx"],
    [
      "artifacts/agentic-company-os/src/pages/settings.tsx",
      "artifacts/agentic-company-os/src/lib/settings-copy.ts",
    ],
  );
  assert.equal(settings.length, 1, "Settings ownership changed");
  const settingsRaw = Math.max(0, settings[0].contents.length - 15559);
  const settingsGzip = Math.max(0, compressed(settings[0].contents) - 4950);
  assert.ok(
    raw <= 2000 && gzip <= 900,
    "Ollama privacy growth exceeds its independent cap",
  );
  assert.ok(
    settingsRaw <= 600 && settingsGzip <= 200,
    "Ollama privacy Settings growth exceeds its independent cap",
  );
  assert.ok(
    settingsRaw <= raw && settingsGzip <= gzip,
    "Privacy delta cannot double-credit older Settings code",
  );
  return { raw, gzip, settingsRaw, settingsGzip };
}
