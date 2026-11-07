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

function aliasFixture(target: "Ml" | "Bl" | "Bc") {
  const dependency = target === "Ml" ? "Ls" : "Ks";
  const helper = `function ${target}(e,t){const r=${dependency}(e,t),s=E(r);return O(s,r.queryKey)}`;
  const baselineBody =
    'import{aY as j}from"./index-aaaaaaaa.js";' +
    body +
    'function query(){return j({locale:"en"})}';
  const current =
    header(["assets/library-bbbbbbbb.js"]) +
    baselineBody
      .replace("aY as j", "aZ as j")
      .replace("index-aaaaaaaa", "index-bbbbbbbb");
  const assets = [
    { fileName: "skills-fixture.js", contents: Buffer.from(current) },
    {
      fileName: "index-bbbbbbbb.js",
      contents: Buffer.from(helper + `export{${target} as aZ};`),
    },
  ];
  const manifest = {
    schemaVersion: 1,
    chunks: assets.map((a, i) => ({
      fileName: "assets/" + a.fileName,
      sha256: hash(a.contents.toString()),
      modules: [
        i === 0
          ? "artifacts/agentic-company-os/src/pages/skills.tsx"
          : "lib/api-client-react/src/generated/api.ts",
      ],
    })),
  };
  const aliasControl = {
    ...control,
    bodySha: hash(
      baselineBody
        .replace(/-[A-Za-z0-9_-]{8}\.js/gu, "-HASH.js")
        .replace(/__vite__mapDeps\(\[[\d,]+\]\)/gu, "__vite__mapDeps([])"),
    ),
  };
  const update = (i: number, text: string) => {
    assets[i].contents = Buffer.from(text);
    manifest.chunks[i].sha256 = hash(text);
  };
  return { assets, manifest, current, aliasControl, update };
}

test("generated export alias changes require a hash-owned unique frozen API helper and keep actual transfer measurements", () => {
  for (const target of ["Ml", "Bl", "Bc"] as const) {
    const f = aliasFixture(target);
    const result = measureReaderMetadataGrowth(
      Buffer.from(f.current),
      source,
      f.aliasControl,
      { assets: f.assets, manifest: f.manifest },
    );
    assert.equal(
      result.raw,
      Math.max(0, Buffer.byteLength(f.current) - f.aliasControl.raw),
    );
    assert.equal(
      result.gzip,
      Math.max(
        0,
        gzipSync(f.current, { level: 9 }).length - f.aliasControl.gzip,
      ),
    );
  }
});

test("export alias normalization cannot hide a different target, helper body, local binding, runtime expression or changed manifest bytes", () => {
  for (const target of ["Ml", "Bl", "Bc"] as const) {
    for (const tamper of [
      "target",
      "body",
      "local",
      "runtime",
      "hash",
    ] as const) {
      const f = aliasFixture(target);
      if (tamper === "target")
        f.update(
          1,
          f.assets[1].contents
            .toString()
            .replace(`${target} as aZ`, "Other as aZ"),
        );
      if (tamper === "body")
        f.update(
          1,
          f.assets[1].contents
            .toString()
            .replace("return O(s,r.queryKey)", "return O(s,[] )"),
        );
      if (tamper === "local")
        f.update(
          0,
          f.current
            .replaceAll("as j", "as k")
            .replace("return j(", "return k("),
        );
      if (tamper === "runtime")
        f.update(0, f.current.replace("return j(", "return other("));
      if (tamper === "hash") f.assets[1].contents = Buffer.from("changed");
      assert.throws(
        () =>
          measureReaderMetadataGrowth(
            f.assets[0].contents,
            source,
            f.aliasControl,
            { assets: f.assets, manifest: f.manifest },
          ),
        tamper,
      );
    }
  }
});
