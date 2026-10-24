import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// Resolve the actual parser used by Orval/Ajv, rather than an unrelated direct
// dependency that could leave code generation on a vulnerable transitive copy.
const orval = createRequire(require.resolve("orval"));
const parser = createRequire(orval.resolve("@scalar/openapi-parser"));
const ajv = createRequire(parser.resolve("ajv"));
const uri = ajv("fast-uri");

test("code-generation URI parsing preserves relative identity and refuses encoded scheme and host confusion", () => {
  assert.equal(
    uri.normalize("https://example.test/a"),
    "https://example.test/a",
  );
  assert.equal(
    uri.resolve("https://example.test/a/", "b"),
    "https://example.test/a/b",
  );
  for (const value of ["%6Aavascript:alert(1)", "%u006Aavascript:alert(1)"]) {
    assert.notEqual(uri.parse(value).scheme, "javascript");
    assert.doesNotMatch(uri.normalize(value), /^javascript:/iu);
  }
  assert.equal(uri.equal("%68ttp://a/", "http://a/"), false);
  for (const reference of ["a/../b", "../x"]) {
    const base = "https://example.test/private/child/";
    assert.equal(
      uri.resolve(base, uri.normalize(reference)),
      uri.resolve(base, reference),
    );
  }
  for (const value of ["http://a@b@evil.example/", "http://exa\tmple.test/"]) {
    assert.ok(uri.parse(value).error, "malformed authority must be explicit");
  }
  for (const scheme of ["javascript", "data", "vbscript"]) {
    assert.doesNotMatch(
      uri.serialize({ path: `${scheme}:payload` }, { reference: "suffix" }),
      /^(?:javascript|data|vbscript):/iu,
    );
  }
});
