import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
const root = "artifacts/agentic-company-os/src/";
const modules = [
  "components/studio/local-model-preparation-slot.tsx",
  "components/studio/local-model-preparation.tsx",
  "lib/local-model-preparation-api.ts",
  "lib/local-model-preparation-copy.ts",
].map((file) => root + file);
const fixture = () => [
  { fileName: "preparation-test.js", contents: Buffer.alloc(100), modules },
  ...["en", "tr", "de", "ru", "zh-CN", "zh-TW", "ar"].map((locale) => ({
    fileName: `preparation-${locale}-test.js`,
    contents: Buffer.alloc(200),
    modules: [
      root + `lib/local-model-preparation-copy/preparation-${locale}.ts`,
    ],
  })),
];
const manifest = (assets: ReturnType<typeof fixture>) => ({
  schemaVersion: 1,
  chunks: assets.map((asset) => ({
    fileName: "assets/" + asset.fileName,
    sha256: createHash("sha256").update(asset.contents).digest("hex"),
    modules: asset.modules,
  })),
});

test("local model setup has source-bound exclusive caps and charges one selected language", async () => {
  const path = "./local-model-preparation-bundle-budget.js";
  const module = await import(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return null;
    throw error;
  });
  assert.ok(
    module,
    "new local preparation needs an independent source-bound budget",
  );
  const original = fixture();
  const measure = (assets: ReturnType<typeof fixture>) =>
    module.measureLocalModelPreparationBundle(assets, manifest(assets));
  const measured = measure(original);
  assert.equal(measured.raw, 300);
  assert.equal(measured.allLocaleRaw, 1400);
  assert.equal(measured.packs.length, 7);
  assert.deepEqual(
    measure([
      ...original,
      {
        fileName: "existing-test.js",
        contents: Buffer.alloc(100_000),
        modules: [root + "pages/settings.tsx"],
      },
    ]),
    measured,
  );
  assert.throws(() => measure(original.slice(0, -1)), /source|Missing|owner/i);
  assert.throws(
    () =>
      measure(
        original.map((asset, i) =>
          i === 0
            ? {
                ...asset,
                modules: [
                  ...asset.modules,
                  root + "components/studio/guided-model-connection.tsx",
                ],
              }
            : asset,
        ),
      ),
    /exclusive|ownership|source/i,
  );
  assert.throws(
    () =>
      measure(
        original.map((asset, i) =>
          i === 0 ? { ...asset, contents: Buffer.alloc(12 * 1024) } : asset,
        ),
      ),
    /budget/,
  );
  assert.throws(
    () =>
      measure(
        original.map((asset, i) =>
          i === 0 ? { ...asset, contents: randomBytes(4500) } : asset,
        ),
      ),
    /budget/,
  );
  assert.throws(
    () =>
      measure(
        original.map((asset, i) =>
          i > 0 ? { ...asset, contents: Buffer.alloc(5000) } : asset,
        ),
      ),
    /budget/,
  );
  assert.throws(
    () =>
      measure(
        original.map((asset, i) =>
          i > 0 ? { ...asset, contents: randomBytes(2500) } : asset,
        ),
      ),
    /budget/,
  );
  assert.throws(
    () =>
      module.measureLocalModelPreparationBundle(original, {
        ...manifest(original),
        chunks: manifest(original).chunks.map((entry, i) =>
          i === 0 ? { ...entry, sha256: "f".repeat(64) } : entry,
        ),
      }),
    /hash/i,
  );
});
