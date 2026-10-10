import { gzipSync } from "node:zlib";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  measureOllamaPrivacyBundle,
  OLLAMA_PRIVACY_SOURCES,
} from "./ollama-privacy-bundle-budget";
const prefix = "artifacts/agentic-company-os/src/";
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const sources = () =>
  Object.fromEntries(
    OLLAMA_PRIVACY_SOURCES.map((module) => [
      module,
      readFileSync(module, "utf8"),
    ]),
  );
function fixture() {
  const groups = [
    {
      fileName: "new-agent-copy-fixture.js",
      size: 5803,
      modules: [
        prefix + "components/agent/agent-model-picker.tsx",
        prefix + "components/i18n/language-select.tsx",
        prefix + "lib/new-agent-copy.ts",
      ],
    },
    {
      fileName: "ollama-model-location-fixture.js",
      size: 1378,
      modules: [
        prefix + "components/agent/ollama-model-location.tsx",
        prefix + "lib/model-search.ts",
      ],
    },
    {
      fileName: "settings-fixture.js",
      size: 16043,
      modules: [prefix + "lib/settings-copy.ts", prefix + "pages/settings.tsx"],
    },
  ];
  const assets = groups.map((g) => ({
    fileName: g.fileName,
    contents: Buffer.from("x".repeat(g.size)),
  }));
  const manifest = {
    schemaVersion: 1,
    chunks: groups.map((g, i) => ({
      fileName: "assets/" + g.fileName,
      modules: g.modules,
      sha256: hash(assets[i].contents),
    })),
  };
  return { assets, manifest, source: sources() };
}
test("privacy accounting credits only measured new growth, never legacy model choices", () => {
  const f = fixture(),
    measured = measureOllamaPrivacyBundle(f.assets, f.manifest, f.source);
  assert.deepEqual(measured, {
    raw: 1617,
    gzip: 0,
    settingsRaw: 484,
    settingsGzip: 0,
  });
});
test("privacy accounting rejects an unrelated source hidden in its owned group", () => {
  const f = fixture();
  f.manifest.chunks[1].modules.push(prefix + "lib/unrelated.ts");
  assert.throws(() =>
    measureOllamaPrivacyBundle(f.assets, f.manifest, f.source),
  );
});
test("privacy accounting rejects tampered compiled bytes and missing ownership", () => {
  const f = fixture();
  f.assets[0].contents[0] = 121;
  assert.throws(() =>
    measureOllamaPrivacyBundle(f.assets, f.manifest, f.source),
  );
  const missing = fixture();
  missing.manifest.chunks[1].modules.pop();
  assert.throws(() =>
    measureOllamaPrivacyBundle(
      missing.assets,
      missing.manifest,
      missing.source,
    ),
  );
});
test("privacy accounting freezes old companion and current privacy source identities", () => {
  const f = fixture();
  f.source[prefix + "lib/new-agent-copy.ts"] += "\n// changed old runtime";
  assert.throws(() =>
    measureOllamaPrivacyBundle(f.assets, f.manifest, f.source),
  );
  const changed = fixture();
  changed.source[prefix + "lib/model-search.ts"] += "\n// unrelated change";
  assert.throws(() =>
    measureOllamaPrivacyBundle(
      changed.assets,
      changed.manifest,
      changed.source,
    ),
  );
});
test("privacy accounting caps new global and Settings costs independently", () => {
  const f = fixture();
  f.assets[0].contents = Buffer.from("x".repeat(6500));
  f.manifest.chunks[0].sha256 = hash(f.assets[0].contents);
  assert.throws(() =>
    measureOllamaPrivacyBundle(f.assets, f.manifest, f.source),
  );
  const settings = fixture();
  settings.assets[2].contents = Buffer.from("x".repeat(16200));
  settings.manifest.chunks[2].sha256 = hash(settings.assets[2].contents);
  assert.throws(() =>
    measureOllamaPrivacyBundle(
      settings.assets,
      settings.manifest,
      settings.source,
    ),
  );
});
test("privacy accounting never credits unrelated entry, vendor, SDK, CSS or locale bytes", () => {
  const f = fixture(),
    expected = measureOllamaPrivacyBundle(f.assets, f.manifest, f.source);
  for (const fileName of [
    "index-other.js",
    "vendor-other.js",
    "sdk-other.js",
    "connection-en-other.js",
  ]) {
    const asset = { fileName, contents: Buffer.from("other code") };
    f.assets.push(asset);
    f.manifest.chunks.push({
      fileName: "assets/" + fileName,
      sha256: hash(asset.contents),
      modules: [],
    });
  }
  f.assets.push({
    fileName: "index-other.css",
    contents: Buffer.from("other CSS"),
  });
  assert.deepEqual(
    measureOllamaPrivacyBundle(f.assets, f.manifest, f.source),
    expected,
  );
});

test("privacy source fingerprints allow only equivalent Windows line endings", () => {
  const f = fixture(),
    expected = measureOllamaPrivacyBundle(f.assets, f.manifest, f.source);
  for (const key of Object.keys(f.source))
    f.source[key] = f.source[key]
      .replace(/\r\n/gu, "\n")
      .replace(/\n/gu, "\r\n");
  assert.deepEqual(
    measureOllamaPrivacyBundle(f.assets, f.manifest, f.source),
    expected,
  );
});

function entropyContent(size: number, entropy: number) {
  const bytes = Buffer.alloc(size, "x");
  for (let offset = 0; offset < entropy; offset += 32) {
    const digest = createHash("sha256")
      .update("owned-byte-fixture:" + offset)
      .digest();
    digest.copy(bytes, offset, 0, Math.min(32, entropy - offset));
  }
  return bytes;
}
const compressed = (bytes: Buffer) => gzipSync(bytes, { level: 9 }).length;
function replaceContent(
  f: ReturnType<typeof fixture>,
  index: number,
  entropy: number,
) {
  f.assets[index].contents = entropyContent(
    f.assets[index].contents.length,
    entropy,
  );
  f.manifest.chunks[index].sha256 = hash(f.assets[index].contents);
}
test("privacy compressed total rejects entropy growth within every raw ceiling", () => {
  const f = fixture();
  replaceContent(f, 0, 4100);
  replaceContent(f, 1, 1100);
  replaceContent(f, 2, 4950);
  assert.ok(compressed(f.assets[2].contents) - 4950 <= 200);
  assert.ok(
    f.assets.reduce((n, a) => n + compressed(a.contents), 0) - 7493 > 900,
  );
  assert.throws(
    () => measureOllamaPrivacyBundle(f.assets, f.manifest, f.source),
    /privacy growth exceeds/u,
  );
});
test("privacy compressed Settings ceiling cannot borrow unused total or raw allowance", () => {
  const f = fixture();
  replaceContent(f, 0, 2100);
  replaceContent(f, 1, 450);
  replaceContent(f, 2, 5300);
  const settingGrowth = compressed(f.assets[2].contents) - 4950;
  const allGrowth =
    f.assets.reduce((n, a) => n + compressed(a.contents), 0) - 7493;
  assert.ok(
    settingGrowth > 200 && allGrowth <= 900 && allGrowth >= settingGrowth,
  );
  assert.throws(
    () => measureOllamaPrivacyBundle(f.assets, f.manifest, f.source),
    /Settings growth exceeds/u,
  );
});
