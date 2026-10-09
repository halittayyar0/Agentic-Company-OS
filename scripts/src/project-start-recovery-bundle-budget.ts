import ts from "typescript";
import { gzipSync } from "node:zlib";
interface Asset {
  fileName: string;
  contents: Buffer;
}
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const fields = [
  "title",
  "uncertain",
  "missing",
  "created",
  "rejected",
  "checking",
  "check",
  "open",
  "retry",
  "prepare",
  "stored",
  "storageError",
  "noTokens",
  "reasons",
];
const reasons = [
  "EMERGENCY_STOP_ACTIVE",
  "AGENT_UNAVAILABLE",
  "RUNTIME_CAPACITY_EXCEEDED",
  "EXECUTION_POLICY_DENIED",
];
const gzip = (contents: Buffer) => gzipSync(contents, { level: 9 }).length;
const name = (property: ts.PropertyAssignment) =>
  ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
    ? property.name.text
    : "";
function requireFields(
  value: ts.ObjectLiteralExpression,
  expected: string[],
  nested = false,
) {
  const properties = value.properties;
  if (
    properties.length !== expected.length ||
    properties.some((p) => !ts.isPropertyAssignment(p)) ||
    new Set(properties.map((p) => name(p as ts.PropertyAssignment))).size !==
      expected.length
  )
    throw Error("Recovery copy structure cannot be verified");
  for (const p of properties) {
    const property = p as ts.PropertyAssignment,
      key = name(property);
    if (!expected.includes(key)) throw Error("Unknown recovery copy field");
    if (nested && key === "reasons") {
      if (!ts.isObjectLiteralExpression(property.initializer))
        throw Error("Recovery reasons cannot be verified");
      requireFields(property.initializer, reasons);
    } else if (!ts.isStringLiteral(property.initializer))
      throw Error("Recovery copy must contain authored strings");
  }
}
/** Only this exclusive, New-project-only chunk and exact recovery fields earn
 * credit. Bound selected transfer to12KB/5KB and all seven copy additions to
 *14KB/7KB. Aggregate totals count one locale peak, so their credit uses
 * max(current packs) minus max(control packs), independently for raw/gzip.
 * No route, API, vendor, CSS or old draft credit. */
export function measureProjectStartRecoveryBundle(assets: readonly Asset[]) {
  const one = (prefix: string) => {
    const hits = assets.filter(
      (a) => a.fileName.startsWith(prefix + "-") && a.fileName.endsWith(".js"),
    );
    if (hits.length !== 1)
      throw Error("Expected one exclusive " + prefix + " asset");
    return hits[0];
  };
  const logic = one("project-start-recovery");
  if (
    !logic.contents.includes("acos.project-start.v1") ||
    !logic.contents.includes("invalid_receipt")
  )
    throw Error("Recovery logic identity cannot be verified");
  const packs = locales.map((locale) => {
    const asset = one("new-project-" + locale),
      text = asset.contents.toString("utf8"),
      source = ts.createSourceFile(
        asset.fileName,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      ),
      matches: ts.PropertyAssignment[] = [];
    function visit(node: ts.Node) {
      if (ts.isPropertyAssignment(node) && name(node) === "recovery")
        matches.push(node);
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (
      matches.length !== 1 ||
      !ts.isObjectLiteralExpression(matches[0].initializer)
    )
      throw Error("Expected one authored recovery object");
    const property = matches[0];
    requireFields(
      property.initializer as ts.ObjectLiteralExpression,
      fields,
      true,
    );
    let end = property.end;
    if (text[end] === ",") end++;
    else throw Error("Recovery field separator cannot be verified");
    const control = Buffer.from(
      text.slice(0, property.getStart(source)) + text.slice(end),
    );
    return {
      fileName: asset.fileName,
      contents: control,
      raw: asset.contents.length - control.length,
      gzip: Math.max(0, gzip(asset.contents) - gzip(control)),
    };
  });
  const allLocaleRaw = packs.reduce((n, p) => n + p.raw, 0),
    allLocaleGzip = packs.reduce((n, p) => n + p.gzip, 0);
  const raw = logic.contents.length + Math.max(...packs.map((p) => p.raw)),
    compressed = gzip(logic.contents) + Math.max(...packs.map((p) => p.gzip));
  const globalRaw =
    logic.contents.length +
    Math.max(
      ...locales.map((locale) => one("new-project-" + locale).contents.length),
    ) -
    Math.max(...packs.map((p) => p.contents.length));
  const globalGzip =
    gzip(logic.contents) +
    Math.max(
      ...locales.map((locale) => gzip(one("new-project-" + locale).contents)),
    ) -
    Math.max(...packs.map((p) => gzip(p.contents)));
  if (
    raw > 12000 ||
    compressed > 5000 ||
    allLocaleRaw > 14000 ||
    allLocaleGzip > 7000
  )
    throw Error("Project start recovery exceeds its independent budget");
  return {
    raw,
    gzip: compressed,
    allLocaleRaw,
    allLocaleGzip,
    globalRaw,
    globalGzip,
    packs,
  };
}
