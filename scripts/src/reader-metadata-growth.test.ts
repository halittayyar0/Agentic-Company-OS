import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { measureReaderMetadataGrowth } from "./reader-metadata-growth";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const header = (paths: string[]) =>
  `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=${JSON.stringify(paths)})))=>i.map(i=>d[i]);\n`;
const source = 'export default function Skills(){return "unchanged";}';
const body =
  'const old=()=>load(()=>import("./library-aaaaaaaa.js"),__vite__mapDeps([0]));';
const old = header(["assets/library-aaaaaaaa.js"]) + body;
const control = {
  sourceSha: hash(source),
  bodySha: hash(
    'const old=()=>load(()=>import("./library-HASH.js"),__vite__mapDeps([]));',
  ),
  consumers: 1,
  raw: Buffer.byteLength(old),
  gzip: gzipSync(old, { level: 9 }).length,
  rawCap: 200,
  gzipCap: 100,
};
test("unchanged source and reader body earn only their measured generated-metadata growth", () => {
  const current =
    header(["assets/library-bbbbbbbb.js", "assets/new-reader-cccccccc.js"]) +
    body.replace("aaaaaaaa", "bbbbbbbb").replace("[0]", "[0,1]");
  const a = measureReaderMetadataGrowth(Buffer.from(current), source, control);
  assert.equal(a.raw, Buffer.byteLength(current) - control.raw);
  assert.equal(
    a.gzip,
    Math.max(0, gzipSync(current, { level: 9 }).length - control.gzip),
  );
});
test("changed old source, old runtime code, unknown metadata and extra consumers cannot earn metadata growth credit", () => {
  for (const [bytes, authored] of [
    [old, source + "changed"],
    [old.replace("const old", "const changed"), source],
    [old.replace("assets/", "../"), source],
    [old + "const extra=()=>__vite__mapDeps([0]);", source],
  ])
    assert.throws(() =>
      measureReaderMetadataGrowth(Buffer.from(bytes), authored, control),
    );
});
test("metadata growth keeps its own limit even when total transfer has spare room", () => {
  const current =
    header(["assets/library-aaaaaaaa.js", `assets/${"a".repeat(250)}.js`]) +
    body;
  assert.throws(() =>
    measureReaderMetadataGrowth(Buffer.from(current), source, control),
  );
});
