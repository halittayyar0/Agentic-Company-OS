import assert from "node:assert/strict";
import test from "node:test";
import { measureResponseRetryRepairBundle as measure } from "./response-retry-repair-bundle-budget";
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
function assets(growth = 100) {
  const identity =
    "acos.response-retry.v1. response-retry-repair-copy Current task scope unavailable";
  return [
    {
      fileName: "response-task-retry-hash.js",
      contents: Buffer.from(identity.padEnd(4790 + growth)),
    },
    ...locales.map((locale) => ({
      fileName: "retry-repair-" + locale + "-hash.js",
      contents: Buffer.from(
        'const c=["storage","help","action","repaired","changed","failed"];export{c as default};',
      ),
    })),
  ];
}
test("repair accounting credits only reader growth and one selected language", () => {
  const files = assets(),
    result = measure(files),
    pack = files[1].contents.length;
  assert.equal(result.logicRaw, 100);
  assert.equal(result.raw, 100 + pack);
  assert.equal(result.allLocaleRaw, 7 * pack);
  assert.equal(measure(assets(0)).logicRaw, 0);
});
test("repair accounting fails closed for missing or duplicated language chunks", () => {
  const files = assets();
  assert.throws(() => measure(files.slice(0, -1)));
  assert.throws(() => measure([...files, files[1]]));
});
test("repair accounting cannot grant language credit to executable or unrelated pack data", () => {
  for (const code of [
    'const c=["one","two","three","four","five",run()];export{c as default};',
    'const c=["one","two","three","four","five","six"];run();export{c as default};',
    'const c=["one","two","three","four","five","six"];export{c as something};',
    'const c=["one","two","three","four","five"];export{c as default};',
  ]) {
    const files = assets();
    files[1] = { ...files[1], contents: Buffer.from(code) };
    assert.throws(() => measure(files));
  }
});
test("repair accounting retains a strict bound on logic growth", () => {
  assert.throws(() => measure(assets(4000)));
});
test("repair accounting bounds all installed languages separately from selected transfer", () => {
  const files = assets();
  for (const file of files.slice(1))
    file.contents = Buffer.from(
      "const c=" +
        JSON.stringify(Array(6).fill("a".repeat(150))) +
        ";export{c as default};",
    );
  assert.throws(() => measure(files));
});
