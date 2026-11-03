import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { measureBoundedAuthRead } from "./bounded-auth-read-bundle-budget";

const read =
  'async function status(e){const t=AbortSignal.timeout(15e3),r=e?AbortSignal.any([e,t]):t,s=await fetchControl("/api/auth/status",{signal:r});return r.throwIfAborted(),validate(s),s}';
const surrounding = 'const unchanged="keep permissions and login writes";';
const query =
  'const auth={queryKey:["auth-status"],queryFn:({signal:e})=>status(e),networkMode:"always",refetchOnReconnect:!0,retry:!1};';
const oldQuery = query.replace(
  'networkMode:"always",refetchOnReconnect:!0,',
  "",
);
function fixture(body = read) {
  const asset = {
    fileName: "index-fixture.js",
    contents: Buffer.from(
      surrounding + query + body + "function login(){return dispatchOnce()}",
    ),
  };
  const manifest = {
    schemaVersion: 1,
    chunks: [
      {
        fileName: "assets/" + asset.fileName,
        sha256: createHash("sha256").update(asset.contents).digest("hex"),
        modules: ["artifacts/agentic-company-os/src/lib/auth.ts"],
      },
    ],
  };
  return { asset, manifest };
}
test("auth read allocation removes only bounded-read additions and retains mutations, unrelated bytes and preceding controls", () => {
  const f = fixture(),
    result = measureBoundedAuthRead([f.asset], f.manifest);
  const control =
    'async function status(e){const s=await fetchControl("/api/auth/status");return validate(s),s}';
  assert.equal(
    result.control.contents.toString(),
    surrounding +
      oldQuery +
      control +
      "function login(){return dispatchOnce()}",
  );
  assert.ok(result.raw > 0 && result.raw <= 256);
  assert.ok(result.gzip <= 128);
  const preceding = {
    ...f.asset,
    contents: Buffer.from(
      f.asset.contents
        .toString()
        .replace(
          surrounding,
          'const unchanged="prior measured reconstruction";',
        ),
    ),
  };
  const composed = measureBoundedAuthRead([f.asset], f.manifest, [preceding]);
  assert.equal(
    composed.control.contents.toString(),
    preceding.contents
      .toString()
      .replace(read, control)
      .replace(query, oldQuery),
  );
});
test("auth read allocation rejects changed deadlines, body handling, ambiguous reads, altered predecessors and unowned compiler bytes", () => {
  for (const text of [
    read.replace("15e3", "30e3"),
    read.replace("r.throwIfAborted(),", ""),
    read + read.replace("status(e)", "second(e)"),
    read.replace('"/api/auth/status"', '"/api/auth/login"'),
  ]) {
    const f = fixture(text);
    assert.throws(() => measureBoundedAuthRead([f.asset], f.manifest));
  }
  const f = fixture();
  for (const changed of [
    query.replace('"always"', '"online"'),
    query.replace("refetchOnReconnect:!0", "refetchOnReconnect:!1"),
    query.replace("=>status(e)", "=>other(e)"),
    query + query.replace("const auth=", "const duplicate="),
  ]) {
    const modified = {
      ...f.asset,
      contents: Buffer.from(
        f.asset.contents.toString().replace(query, changed),
      ),
    };
    const manifest = {
      ...f.manifest,
      chunks: [
        {
          ...f.manifest.chunks[0],
          sha256: createHash("sha256").update(modified.contents).digest("hex"),
        },
      ],
    };
    assert.throws(() => measureBoundedAuthRead([modified], manifest));
  }
  assert.throws(() =>
    measureBoundedAuthRead(
      [
        {
          ...f.asset,
          contents: Buffer.from(f.asset.contents.toString() + "changed"),
        },
      ],
      f.manifest,
    ),
  );
  assert.throws(() =>
    measureBoundedAuthRead([f.asset], {
      ...f.manifest,
      chunks: [{ ...f.manifest.chunks[0], modules: ["unrelated.ts"] }],
    }),
  );
  assert.throws(() =>
    measureBoundedAuthRead([f.asset], f.manifest, [
      { ...f.asset, contents: Buffer.from("missing the owned read") },
    ]),
  );
  assert.throws(() =>
    measureBoundedAuthRead([f.asset], f.manifest, [f.asset, f.asset]),
  );
});
