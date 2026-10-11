import assert from "node:assert/strict";
import test from "node:test";
import { measureConnectionBundle as measureOriginal } from "./connection-bundle-budget";
import { createHash } from "node:crypto";
const prefix = "artifacts/agentic-company-os/src/";
function manifest(assets: readonly { fileName: string; contents: Buffer }[]) {
  return {
    schemaVersion: 1,
    chunks: assets
      .filter((a) => a.fileName.endsWith(".js"))
      .map((a) => {
        const modules = a.fileName.startsWith("guided-model-connection-")
          ? [
              prefix + "components/studio/guided-model-connection.tsx",
              prefix + "lib/connection-api.ts",
              ...(assets.some((a) => a.fileName.startsWith("connection-copy-"))
                ? []
                : [prefix + "lib/connection-copy.ts"]),
            ]
          : a.fileName.startsWith("guided-chatgpt-connection-")
            ? [
                prefix + "components/studio/guided-chatgpt-connection.tsx",
                prefix + "lib/chatgpt-connection-api.ts",
              ]
            : a.fileName.startsWith("model-connection-launcher-")
              ? [prefix + "components/studio/model-connection-launcher.tsx"]
              : a.fileName.startsWith("connection-copy-")
                ? [prefix + "lib/connection-copy.ts"]
                : /^connection-(tr|en|de|ru|zh-CN|zh-TW|ar)-/u.test(a.fileName)
                  ? [
                      prefix +
                        "lib/connection-copy/connection-" +
                        a.fileName.match(
                          /^connection-(tr|en|de|ru|zh-CN|zh-TW|ar)-/u,
                        )![1] +
                        ".ts",
                    ]
                  : [];
        return {
          fileName: "assets/" + a.fileName,
          modules,
          sha256: createHash("sha256").update(a.contents).digest("hex"),
        };
      }),
  };
}
const measureConnectionBundle = (
  assets: readonly { fileName: string; contents: Buffer }[],
) => measureOriginal(assets, manifest(assets));
const asset = (fileName: string, size: number) => ({
  fileName,
  contents: Buffer.from("x".repeat(size)),
});
const fixture = () => [
  asset("guided-model-connection-test.js", 8000),
  asset("guided-chatgpt-connection-test.js", 9000),
  asset("model-connection-launcher-test.js", 1500),
  ...["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"].map((locale) =>
    asset(`connection-${locale}-test.js`, 3000),
  ),
];
test("connection credit includes only exclusive UI and one selected language", () => {
  const current = fixture();
  const result = measureConnectionBundle(current);
  assert.equal(result.raw, 21500);
  assert.equal(result.allLocaleRaw, 21000);
  assert.deepEqual(
    measureConnectionBundle([
      ...current,
      asset("index-other.js", 300000),
      asset("settings-route.js", 30000),
    ]),
    result,
  );
});
test("missing, duplicate and overgrown connection assets or locale packs fail their own ceiling", () => {
  const current = fixture();
  assert.throws(() => measureConnectionBundle(current.slice(0, -1)));
  assert.throws(() => measureConnectionBundle([...current, current[0]]));
  assert.throws(() => measureConnectionBundle([...current, current[3]]));
  assert.throws(() =>
    measureConnectionBundle([
      asset(current[0].fileName, 25000),
      ...current.slice(1),
    ]),
  );
  assert.throws(() =>
    measureConnectionBundle(
      current.map((a) =>
        a.fileName.startsWith("connection-") ? asset(a.fileName, 6500) : a,
      ),
    ),
  );
});

test("connection accounting retains its same scope when the existing copy loader splits", () => {
  const old = fixture(),
    split = [
      asset(old[0].fileName, 7489),
      ...old.slice(1),
      asset("connection-copy-fixture.js", 511),
    ];
  assert.equal(
    measureConnectionBundle(split).raw,
    measureConnectionBundle(old).raw,
  );
  assert.equal(measureConnectionBundle(split).raw, 21500);
});
test("connection accounting rejects foreign runtime from a connection-named asset", () => {
  const assets = fixture(),
    map = manifest(assets);
  map.chunks[0].modules.push(prefix + "lib/unrelated.ts");
  assert.throws(() => measureOriginal(assets, map));
});
test("connection accounting requires byte-bound compiler ownership for the old copy loader", () => {
  const assets = fixture(),
    map = manifest(assets);
  map.chunks[0].modules.pop();
  assert.throws(() => measureOriginal(assets, map));
  const tampered = manifest(assets);
  tampered.chunks[0].sha256 = "0".repeat(64);
  assert.throws(() => measureOriginal(assets, tampered));
});
test("connection accounting rejects foreign or missing authored pack ownership", () => {
  const assets = fixture(),
    map = manifest(assets);
  map.chunks[3].modules = [prefix + "lib/unrelated.ts"];
  assert.throws(() => measureOriginal(assets, map));
});
