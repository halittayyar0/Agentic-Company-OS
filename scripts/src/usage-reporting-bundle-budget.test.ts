import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { measureUsageReportingBundleGrowth } from "./usage-reporting-bundle-budget";

const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const fields =
  'tokensAtLeast:"At least {count}",tokenUsageUnknown:"Usage unknown",tokenCoveragePartial:"Not all calls report usage",noRecordedUsage:"No receipts",';
function fixture(tail = "") {
  return [
    {
      fileName: "use-operations-stream-fixture.js",
      contents: Buffer.from("x".repeat(18900)),
    },
    ...locales.map((locale) => ({
      fileName: `operations-${locale}-fixture.js`,
      contents: Buffer.from(
        `const c={${fields}recoveryTitle:"Recovery",payload:${JSON.stringify(tail)}};export{c as default};`,
      ),
    })),
  ];
}
test("usage reporting credits only its exact four added locale fields and the measured shared Operations growth", () => {
  const assets = fixture("Unrelated original content");
  const growth = measureUsageReportingBundleGrowth(assets);
  const localeAssets = assets.slice(1);
  const control = localeAssets.reduce(
    (sum, a) =>
      sum +
      gzipSync(Buffer.from(a.contents.toString().replace(fields, "")), {
        level: 9,
      }).length,
    0,
  );
  const current = assets
    .slice(1)
    .reduce((sum, a) => sum + gzipSync(a.contents, { level: 9 }).length, 0);
  assert.equal(growth.allLocaleGzip, current - control);
  assert.ok(growth.allLocaleRaw > 0);
});
test("unrelated locale content receives no reporting-feature byte allowance", () => {
  const short = measureUsageReportingBundleGrowth(fixture("original"));
  const longer = measureUsageReportingBundleGrowth(
    fixture("unrelated".repeat(1000)),
  );
  assert.equal(short.allLocaleRaw, longer.allLocaleRaw);
});
test("missing or oversized shared feature surfaces fail the independent feature cap", () => {
  assert.throws(() => measureUsageReportingBundleGrowth(fixture().slice(1)));
  const assets = fixture();
  assets[0].contents = Buffer.from("x".repeat(25000));
  assert.throws(() => measureUsageReportingBundleGrowth(assets), /budget/);
});
test("an ambiguous or absent locale field block cannot be credited", () => {
  const assets = fixture();
  assets[1].contents = Buffer.from('const c={recoveryTitle:"Recovery"};');
  assert.throws(() => measureUsageReportingBundleGrowth(assets));
});
