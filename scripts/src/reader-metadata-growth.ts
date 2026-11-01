import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import ts from "typescript";
import {
  resolveBundleModuleAsset,
  type BundleAsset,
} from "./bundle-source-map";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Source 5bf1403a9d1134c2d0ee4bb0676eede6022f6e78's qualified win32 archive,
 * SHA256 80660fcd0a4b134fdaf74fe698d360333d133608c0d9698b23db1b0879700653:
 * skills-f22adcab.js SHA256 1a47c9475b9ca036e9ab94a0ead2d282c9bab7b850dbc247d45c30aac1897a9b
 * and index-417632c9.js SHA256 f23391c2593b3ad8c112373d4bdd8eed82625394b778038ccf070f7eee621435.
 * The reader pins the original normalized body digest below. Adding the canonical
 * buttonVariants export changes only its catalog import aY->aZ in Rollup.
 * Normalize that generated external alias only after verifying BOTH compiler
 * output hashes/owners, a unique export target, and the exact frozen API helper.
 * Local bindings, calls and every other body byte still face the original hash.
 * Actual contents, not the normalized spelling, determine transfer credit. */
function normalizeSkillsCatalogAlias(
  contents: Buffer,
  body: string,
  bundle: { assets: readonly BundleAsset[]; manifest: unknown },
) {
  const owner = (module: string) =>
    resolveBundleModuleAsset(bundle.assets, bundle.manifest, module);
  const reader = owner("artifacts/agentic-company-os/src/pages/skills.tsx");
  assert.deepEqual(
    reader.contents,
    contents,
    "Reader alias proof does not match owned output",
  );
  const entry = owner("lib/api-client-react/src/generated/api.ts");
  const parsed = ts.createSourceFile(
    reader.fileName,
    body,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const imports = parsed.statements
    .filter(ts.isImportDeclaration)
    .filter(
      (node) =>
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === "./" + entry.fileName,
    );
  assert.equal(imports.length, 1, "Unique owned reader API import required");
  const names = imports[0].importClause?.namedBindings;
  assert.ok(names && ts.isNamedImports(names));
  const specs = names.elements.filter((spec) => spec.name.text === "j");
  assert.equal(specs.length, 1, "Frozen reader local import binding changed");
  const external = specs[0].propertyName;
  assert.ok(external && ts.isIdentifier(external));
  const module = ts.createSourceFile(
    entry.fileName,
    entry.contents.toString("utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const exports = module.statements
    .filter(ts.isExportDeclaration)
    .flatMap((node) =>
      !node.moduleSpecifier &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
        ? [...node.exportClause.elements]
        : [],
    );
  const targets = exports.filter((spec) => spec.name.text === external.text);
  assert.equal(targets.length, 1, "Unique owned reader API export required");
  assert.equal(
    targets[0].propertyName?.text,
    "Ml",
    "Frozen reader API export target changed",
  );
  const helpers = module.statements
    .filter(ts.isFunctionDeclaration)
    .filter((node) => node.name?.text === "Ml");
  assert.equal(helpers.length, 1, "Unique frozen reader API helper required");
  assert.equal(
    hash(helpers[0].getText(module)),
    "0cc6d1a02a15efc88959250799602ff5cd3feb106c9d6f8a9498784a66ea3d1a",
    "Frozen reader API helper changed",
  );
  return (
    body.slice(0, external.getStart(parsed)) + "aY" + body.slice(external.end)
  );
}
/** Existing source and compiled runtime must remain identical to the frozen
 * control. Only generated hashes/preload indexes and a proven export alias may differ. */
export function measureReaderMetadataGrowth(
  contents: Buffer,
  source: string,
  control: {
    sourceSha: string;
    bodySha: string;
    consumers: number;
    raw: number;
    gzip: number;
    rawCap: number;
    gzipCap: number;
  },
  bundle?: { assets: readonly BundleAsset[]; manifest: unknown },
) {
  assert.equal(
    hash(source.replace(/\r\n/gu, "\n")),
    control.sourceSha,
    "Existing reader source changed",
  );
  const text = contents.toString("utf8"),
    newline = text.indexOf("\n"),
    header = text.slice(0, newline);
  const prefix = "const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=",
    suffix = ")))=>i.map(i=>d[i]);";
  assert.ok(
    newline > 0 && header.startsWith(prefix) && header.endsWith(suffix),
    "Unknown reader metadata header",
  );
  const paths: unknown = JSON.parse(
    header.slice(prefix.length, -suffix.length),
  );
  assert.ok(
    Array.isArray(paths) &&
      new Set(paths).size === paths.length &&
      paths.every(
        (name) =>
          typeof name === "string" &&
          /^assets\/[\w.$-]+\.(?:js|css)$/u.test(name),
      ),
    "Unsafe reader metadata paths",
  );
  const body = text.slice(newline + 1),
    calls = [...body.matchAll(/__vite__mapDeps\(\[([\d,]+)\]\)/gu)];
  assert.equal(
    calls.length,
    control.consumers,
    "Reader preload consumer count changed",
  );
  assert.ok(
    calls.every((call) =>
      call[1]
        .split(",")
        .every((index) => /^\d+$/u.test(index) && Number(index) < paths.length),
    ),
    "Unknown reader preload indexes",
  );
  const normalized = (
    bundle ? normalizeSkillsCatalogAlias(contents, body, bundle) : body
  )
    .replace(/-[A-Za-z0-9_-]{8}\.(js|css)/gu, "-HASH.$1")
    .replace(/__vite__mapDeps\(\[[\d,]+\]\)/gu, "__vite__mapDeps([])");
  assert.equal(
    hash(normalized),
    control.bodySha,
    "Existing reader runtime changed",
  );
  const raw = Math.max(0, contents.length - control.raw),
    gzip = Math.max(0, gzipSync(contents, { level: 9 }).length - control.gzip);
  assert.ok(
    raw <= control.rawCap && gzip <= control.gzipCap,
    "Reader metadata growth exceeds its independent cap",
  );
  return { raw, gzip };
}
