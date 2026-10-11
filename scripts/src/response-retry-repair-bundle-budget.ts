import ts from "typescript";
import { gzipSync } from "node:zlib";
interface Asset {
  fileName: string;
  contents: Buffer;
}
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const gzip = (b: Buffer) => gzipSync(b, { level: 9 }).length;
/** Control build of fca82d6, CI merge tree 6b2e50b:
 * response-task-retry-74b86409.js, SHA256
 * 3af62f734b2feb04e7a548f31f1ce289baa9427ab5f92109ebb8a895a7c75e29:
 * 4790 raw / 1881 gzip bytes. Credit only growth of that same reader
 * plus its largest new, conditional six-string language pack.
 * Existing retry code, studio strings, route wiring, API, vendors and CSS
 * earn no credit. Existing numeric ceilings remain unchanged.
 * Bound the addition to 4 KB / 1.5 KB and all seven packs to 6 KB / 3 KB. */
export function measureResponseRetryRepairBundle(assets: readonly Asset[]) {
  const one = (prefix: string) => {
    const found = assets.filter(
      (a) => a.fileName.startsWith(prefix + "-") && a.fileName.endsWith(".js"),
    );
    if (found.length !== 1) throw Error("Expected one " + prefix + " asset");
    return found[0];
  };
  const logic = one("response-task-retry");
  for (const identity of [
    "acos.response-retry.v1.",
    "response-retry-repair-copy",
    "Current task scope unavailable",
  ])
    if (!logic.contents.includes(identity))
      throw Error("Retry repair reader identity cannot be verified");
  const packs = locales.map((locale) => {
    const asset = one("retry-repair-" + locale);
    const source = ts.createSourceFile(
      asset.fileName,
      asset.contents.toString("utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const [statement, exported] = source.statements;
    if (
      source.statements.length !== 2 ||
      !ts.isVariableStatement(statement) ||
      statement.declarationList.declarations.length !== 1 ||
      !ts.isExportDeclaration(exported) ||
      !exported.exportClause ||
      !ts.isNamedExports(exported.exportClause)
    )
      throw Error(
        "Repair pack must contain only authored strings and a default export",
      );
    const value = statement.declarationList.declarations[0],
      exports = exported.exportClause.elements;
    if (
      !ts.isIdentifier(value.name) ||
      !value.initializer ||
      !ts.isArrayLiteralExpression(value.initializer) ||
      value.initializer.elements.length !== 6 ||
      value.initializer.elements.some(
        (e) => !ts.isStringLiteral(e) || !e.text.trim(),
      ) ||
      exports.length !== 1 ||
      exports[0].name.text !== "default" ||
      exports[0].propertyName?.text !== value.name.text
    )
      throw Error("Repair pack shape cannot be verified");
    return { ...asset, raw: asset.contents.length, gzip: gzip(asset.contents) };
  });
  const logicRaw = Math.max(0, logic.contents.length - 4790),
    logicGzip = Math.max(0, gzip(logic.contents) - 1881);
  const raw = logicRaw + Math.max(...packs.map((p) => p.raw));
  const compressed = logicGzip + Math.max(...packs.map((p) => p.gzip));
  const allLocaleRaw = packs.reduce((n, p) => n + p.raw, 0),
    allLocaleGzip = packs.reduce((n, p) => n + p.gzip, 0);
  if (
    raw > 4000 ||
    compressed > 1500 ||
    allLocaleRaw > 6000 ||
    allLocaleGzip > 3000
  )
    throw Error("Retry storage repair exceeds its independent feature budget");
  return {
    raw,
    gzip: compressed,
    logicRaw,
    logicGzip,
    allLocaleRaw,
    allLocaleGzip,
  };
}
