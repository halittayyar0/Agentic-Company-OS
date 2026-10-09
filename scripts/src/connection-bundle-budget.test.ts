import assert from "node:assert/strict";
import test from "node:test";
import { measureConnectionBundle } from "./connection-bundle-budget";
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
