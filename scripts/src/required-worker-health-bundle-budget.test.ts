import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { measureRequiredWorkerHealthCopy } from "./required-worker-health-bundle-budget";

const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const field = 'capacityDeficitTruth:"{ready} ready, {required} required",';
const gzip = (value: Buffer) => gzipSync(value, { level: 9 }).length;
const fixture = (tail = "original") =>
  locales.map((locale, index) => ({
    fileName: `operations-${locale}-fixture.js`,
    contents: Buffer.from(
      `const c={${field}other:${JSON.stringify(tail + index)}};`,
    ),
  }));

test("required worker copy credits only its exact field and reconstructs selected transfer", () => {
  const assets = fixture();
  const measured = measureRequiredWorkerHealthCopy(assets);
  const controls = assets.map((asset) =>
    Buffer.from(asset.contents.toString().replace(field, "")),
  );
  assert.equal(
    measured.raw,
    Math.max(...assets.map((asset) => asset.contents.length)) -
      Math.max(...controls.map((control) => control.length)),
  );
  assert.equal(
    measured.gzip,
    Math.max(...assets.map((asset) => gzip(asset.contents))) -
      Math.max(...controls.map(gzip)),
  );
  assert.equal(measured.allRaw, Buffer.byteLength(field) * 7);
  assert.deepEqual(
    measured.controls.map((asset) => asset.contents),
    controls,
  );
});

test("unrelated content and assets receive no worker health copy credit", () => {
  const short = measureRequiredWorkerHealthCopy(fixture());
  const assets = [
    ...fixture("unrelated".repeat(1000)),
    { fileName: "other.js", contents: Buffer.from("unrelated growth") },
  ];
  const long = measureRequiredWorkerHealthCopy(assets);
  assert.equal(long.raw, short.raw);
  assert.equal(long.allRaw, short.allRaw);
  assert.equal(long.controls.at(-1), assets.at(-1));
});

test("worker health copy rejects incomplete, ambiguous or misleading locale fields", () => {
  assert.throws(
    () => measureRequiredWorkerHealthCopy(fixture().slice(1)),
    /one pack/,
  );
  for (const replacement of [
    "",
    field + field,
    'capacityDeficitTruth:"{ready} ready",',
  ]) {
    const assets = fixture();
    assets[0].contents = Buffer.from(
      assets[0].contents.toString().replace(field, replacement),
    );
    assert.throws(() => measureRequiredWorkerHealthCopy(assets), /field/);
  }
});

test("worker health copy enforces its own small cap even for compressible labels", () => {
  const assets = fixture();
  assets[0].contents = Buffer.from(
    `const c={capacityDeficitTruth:"${"x".repeat(200)} {ready} {required}",other:1};`,
  );
  assert.throws(() => measureRequiredWorkerHealthCopy(assets), /budget/);
});
