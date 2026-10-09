import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { measureCodingRecoveryBundle } from "./coding-recovery-bundle-budget";
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const asset = (fileName: string, contents: string | Buffer) => ({
  fileName,
  contents: Buffer.from(contents),
});
function fixture() {
  return [
    asset(
      "detail-project.js",
      "budget-task-resume-coding-session-recovery-".padEnd(120600, "x"),
    ),
    asset("coding-session-recovery-fixture.js", "x".repeat(7000)),
    ...locales.map((locale) =>
      asset(`coding-recovery-${locale}-fixture.js`, "x".repeat(2000)),
    ),
  ];
}
test("recovery transfer charges its exclusive logic and largest selected pack, with no credit for unrelated routes", () => {
  const assets = fixture();
  const measured = measureCodingRecoveryBundle(assets);
  assert.equal(measured.raw, 9200);
  assert.equal(measured.integrationRaw, 200);
  assert.equal(measured.allLocaleRaw, 14000);
  assert.deepEqual(
    measureCodingRecoveryBundle([
      ...assets,
      asset("detail-fixture.js", "y".repeat(100000)),
    ]),
    measured,
  );
});
test("missing or duplicate packs, unrelated project growth, oversized logic and expensive compression cannot earn recovery credit", () => {
  const assets = fixture();
  assert.throws(() => measureCodingRecoveryBundle(assets.slice(0, -1)));
  assert.throws(() => measureCodingRecoveryBundle([...assets, assets[1]]));
  assert.throws(() =>
    measureCodingRecoveryBundle([
      asset(
        assets[0].fileName,
        "budget-task-resume-coding-session-recovery-".padEnd(120901, "x"),
      ),
      ...assets.slice(1),
    ]),
  );
  assert.throws(() =>
    measureCodingRecoveryBundle([
      assets[0],
      asset(assets[1].fileName, "x".repeat(11000)),
      ...assets.slice(2),
    ]),
  );
  const random = Buffer.concat(
    Array.from({ length: 270 }, (_, i) =>
      createHash("sha256").update(String(i)).digest(),
    ),
  );
  assert.throws(() =>
    measureCodingRecoveryBundle([
      assets[0],
      asset(assets[1].fileName, random),
      ...assets.slice(2),
    ]),
  );
});
