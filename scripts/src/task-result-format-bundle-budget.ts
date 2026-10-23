import assert from "node:assert/strict";
import ts from "typescript";
import { gzipSync } from "node:zlib";
import {
  resolveBundleModuleAsset,
  resolveExclusiveBundleAssets,
  type BundleAsset,
} from "./bundle-source-map";
import { resultFormatChoiceControl } from "./completion-requirements-bundle-budget";

/** Strip only the new draft boundary from the preceding verified control.
 * Other layout UI, validators and language packs retain the base budget. */
export function resultFormatDraftControl(asset: BundleAsset) {
  const text = asset.contents.toString("utf8");
  const source = ts.createSourceFile(
    asset.fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const fields: ts.PropertyAssignment[] = [],
    declarations: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === "resultFormat"
    )
      fields.push(node);
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(fields.length, 1, "Expected one explicit format draft field");
  const field = fields[0];
  assert.ok(
    ts.isCallExpression(field.initializer) &&
      field.initializer.arguments.length === 1 &&
      ts.isIdentifier(field.initializer.arguments[0]),
  );
  const binding = field.initializer.arguments[0].text;
  const matches = declarations.filter(
    (d) => d.name.getText(source) === binding,
  );
  assert.equal(matches.length, 1);
  const initializer = matches[0].initializer;
  assert.ok(initializer);
  const id = "[$A-Z_a-z][$\\w]*";
  assert.match(
    initializer.getText(source),
    new RegExp(
      `^${id}\\(${id}\\(\\{kind:${id}\\("table"\\),columns:${id}\\(${id}\\(\\)\\.check\\(${id}\\(80\\)\\)\\)\\.check\\(${id}\\(2\\),${id}\\(8\\)\\)\\}\\)\\)$`,
      "u",
    ),
    "Draft format shape changed",
  );
  const checks = [
    ...text.matchAll(new RegExp(`\\|\\|${id}\\.resultFormat!=null`, "gu")),
  ];
  assert.equal(
    checks.length,
    1,
    "Expected one explicit format draft input check",
  );
  assert.equal(text[field.getStart(source) - 1], ",");
  const parts = [
    {
      start: initializer.getStart(source),
      end: initializer.end,
      replacement: "null",
    },
    { start: field.getStart(source) - 1, end: field.end, replacement: "" },
    {
      start: checks[0].index!,
      end: checks[0].index! + checks[0][0].length,
      replacement: "",
    },
  ].sort((a, b) => b.start - a.start);
  let control = text,
    boundary = text.length;
  for (const part of parts) {
    assert.ok(part.end <= boundary);
    control =
      control.slice(0, part.start) + part.replacement + control.slice(part.end);
    boundary = part.start;
  }
  const contents = Buffer.from(control);
  const raw = asset.contents.length - contents.length;
  const gzip = Math.max(
    0,
    gzipSync(asset.contents, { level: 9 }).length -
      gzipSync(contents, { level: 9 }).length,
  );
  assert.ok(
    raw > 0 && raw <= 350 && gzip <= 200,
    "Result-format draft integration exceeds its independent cap",
  );
  return { fileName: asset.fileName, contents, raw, gzip };
}

export function measureResultFormatDraft(
  assets: readonly BundleAsset[],
  manifest: unknown,
  preceding: readonly BundleAsset[],
) {
  const owner = resolveBundleModuleAsset(
    assets,
    manifest,
    "artifacts/agentic-company-os/src/lib/task-result-format-draft.ts",
  );
  assert.match(owner.fileName, /^index-[^/]+\.js$/u);
  const control = preceding.filter((a) => a.fileName === owner.fileName);
  assert.equal(control.length, 1);
  return resultFormatDraftControl(control[0]);
}

export function measureResultFormatChoice(
  assets: readonly BundleAsset[],
  manifest: unknown,
  preceding: readonly BundleAsset[],
  panel = false,
) {
  const root = "artifacts/agentic-company-os/src/";
  const owner = resolveBundleModuleAsset(
    assets,
    manifest,
    root + (panel ? "pages/tasks/detail.tsx" : "pages/tasks/new.tsx"),
  );
  const logic = resolveBundleModuleAsset(
    assets,
    manifest,
    root + "components/tasks/result-format-choice.tsx",
  );
  const view = resolveBundleModuleAsset(
    assets,
    manifest,
    root + "lib/task-result-format-input.ts",
  );
  const control = preceding.filter((a) => a.fileName === owner.fileName);
  assert.equal(control.length, 1);
  return resultFormatChoiceControl(control[0], logic, view, panel);
}

export function measureResultFormatAssets(
  assets: readonly BundleAsset[],
  manifest: unknown,
  integration: { raw: number; gzip: number }[],
) {
  const root = "artifacts/agentic-company-os/src/";
  const modules = [
    "components/tasks/result-format-choice.tsx",
    "lib/task-result-format-copy.ts",
    "lib/task-result-format-input.ts",
  ].map((name) => root + name);
  const logic = resolveExclusiveBundleAssets(
    assets,
    manifest,
    modules,
    modules,
  );
  const packs = ["en", "tr", "de", "ru", "zh-CN", "zh-TW", "ar"].map(
    (locale) => {
      const own = [
        root + `lib/task-result-format-copy/result-format-${locale}.ts`,
      ];
      const [pack] = resolveExclusiveBundleAssets(assets, manifest, own, own);
      return {
        raw: pack.contents.length,
        gzip: gzipSync(pack.contents, { level: 9 }).length,
      };
    },
  );
  assert.equal(new Set(logic.map((row) => row.fileName)).size, logic.length);
  const logicRaw = logic.reduce((n, a) => n + a.contents.length, 0),
    logicGzip = logic.reduce(
      (n, a) => n + gzipSync(a.contents, { level: 9 }).length,
      0,
    );
  const allRaw = packs.reduce((n, a) => n + a.raw, 0),
    allGzip = packs.reduce((n, a) => n + a.gzip, 0);
  assert.ok(
    logicRaw <= 4500 && logicGzip <= 1900,
    "Result-format logic exceeds its independent cap",
  );
  assert.ok(
    allRaw <= 5000 && allGzip <= 3500,
    "Result-format language disk budget exceeded",
  );
  assert.ok(
    packs.every((p) => p.raw <= 1000 && p.gzip <= 550),
    "Selected result-format language exceeds its independent cap",
  );
  const commonRaw = logicRaw + integration.reduce((n, a) => n + a.raw, 0),
    commonGzip = logicGzip + integration.reduce((n, a) => n + a.gzip, 0);
  const raw = commonRaw + Math.max(...packs.map((p) => p.raw)),
    gzip = commonGzip + Math.max(...packs.map((p) => p.gzip));
  const globalRaw = commonRaw + allRaw,
    globalGzip = commonGzip + allGzip;
  assert.ok(
    raw <= 6500 && gzip <= 3000 && globalRaw <= 10000 && globalGzip <= 5500,
    "Result-format transfer exceeds its independent cap",
  );
  return {
    raw,
    gzip,
    globalRaw,
    globalGzip,
    logicRaw,
    logicGzip,
    allRaw,
    allGzip,
  };
}
