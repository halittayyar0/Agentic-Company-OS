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
      // Zod 4's generic maxLength counts code points. Credit only the exact
      // persisted UTF-16 predicate, including its bound parameter identity.
      `^${id}\\(${id}\\(\\{kind:${id}\\("table"\\),columns:${id}\\(${id}\\(\\)\\.check\\(${id}\\((?<heading>${id})=>\\k<heading>\\.length<=80\\)\\)\\)\\.check\\(${id}\\(2\\),${id}\\(8\\)\\)\\}\\)\\)$`,
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

export function resultTableDeliveryControl(
  asset: BundleAsset,
  logicName: string,
  inputName: string,
) {
  const text = asset.contents.toString("utf8"),
    source = ts.createSourceFile(
      asset.fileName,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
  const conditionals: ts.ConditionalExpression[] = [],
    declarations: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isConditionalExpression(node) &&
      ts.isPropertyAccessExpression(node.condition) &&
      node.condition.name.text === "resultFormat"
    )
      conditionals.push(node);
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(
    conditionals.length,
    1,
    "Expected one saved-format delivery mount",
  );
  const mount = conditionals[0],
    plain = mount.whenFalse.getText(source),
    id = "[$A-Z_a-z][$\\w]*";
  const original = new RegExp(
    `^(${id})\\.jsx\\((${id}),\\{content:(${id})\\}\\)$`,
    "u",
  ).exec(plain);
  assert.ok(original, "Unknown original plain-text delivery");
  const project = (
    mount.condition as ts.PropertyAccessExpression
  ).expression.getText(source);
  const escaped = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matching = new RegExp(
    `^${escaped(original[1])}\\.jsx\\((${id})\\.Suspense,\\{fallback:${escaped(plain)},children:${escaped(original[1])}\\.jsx\\((${id}),\\{content:${escaped(original[3])},format:${escaped(project)}\\.resultFormat,label:${id}\\.deliverySummary\\}\\)\\}\\)$`,
    "u",
  ).exec(mount.whenTrue.getText(source));
  assert.ok(matching, "Unknown saved-format delivery or fallback");
  const lazy = declarations.filter(
    (node) => node.name.getText(source) === matching[2],
  );
  assert.equal(lazy.length, 1);
  const declaration = lazy[0];
  assert.ok(
    declaration.initializer && ts.isVariableDeclarationList(declaration.parent),
  );
  assert.match(
    declaration.initializer.getText(source),
    new RegExp(
      `^${escaped(matching[1])}\\.lazy\\(\\(\\)=>${id}\\(\\(\\)=>import\\("\\./${escaped(logicName)}"\\),__vite__mapDeps\\(\\[[\\d,]+\\]\\)\\)\\)$`,
      "u",
    ),
  );
  const parts = [
    { start: mount.getStart(source), end: mount.end, replacement: plain },
  ];
  if (declaration.parent.declarations.length === 1) {
    assert.ok(ts.isVariableStatement(declaration.parent.parent));
    parts.push({
      start: declaration.parent.parent.getStart(source),
      end: declaration.parent.parent.end,
      replacement: "",
    });
  } else if (text[declaration.getStart(source) - 1] === ",")
    parts.push({
      start: declaration.getStart(source) - 1,
      end: declaration.end,
      replacement: "",
    });
  else {
    assert.equal(text[declaration.end], ",");
    parts.push({
      start: declaration.getStart(source),
      end: declaration.end + 1,
      replacement: "",
    });
  }
  for (const name of [logicName, inputName]) {
    const path = JSON.stringify("assets/" + name),
      paths = [...text.matchAll(new RegExp(escaped(path), "gu"))];
    assert.equal(paths.length, 1, "Ambiguous result-table preload path");
    parts.push({
      start: paths[0].index!,
      end: paths[0].index! + path.length,
      replacement: '""',
    });
  }
  let control = text,
    boundary = text.length;
  for (const part of parts.sort((a, b) => b.start - a.start)) {
    assert.ok(part.end <= boundary);
    control =
      control.slice(0, part.start) + part.replacement + control.slice(part.end);
    boundary = part.start;
  }
  const contents = Buffer.from(control),
    raw = asset.contents.length - contents.length,
    gzip = Math.max(
      0,
      gzipSync(asset.contents, { level: 9 }).length -
        gzipSync(contents, { level: 9 }).length,
    );
  assert.ok(
    raw > 0 && raw <= 800 && gzip <= 350,
    "Result-table delivery wiring exceeds its independent cap",
  );
  return { fileName: asset.fileName, contents, raw, gzip };
}

export function measureResultTableDelivery(
  assets: readonly BundleAsset[],
  manifest: unknown,
) {
  const root = "artifacts/agentic-company-os/src/";
  const owner = resolveBundleModuleAsset(
    assets,
    manifest,
    root + "components/studio/project-delivery-summary.tsx",
  );
  const logic = resolveBundleModuleAsset(
    assets,
    manifest,
    root + "components/tasks/result-table.tsx",
  );
  const input = resolveBundleModuleAsset(
    assets,
    manifest,
    root + "lib/task-result-format-input.ts",
  );
  return resultTableDeliveryControl(owner, logic.fileName, input.fileName);
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
    "components/tasks/result-table.tsx",
    "lib/task-result-table.ts",
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
    logicRaw <= 7600 && logicGzip <= 3500,
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
    raw <= 9800 && gzip <= 4300 && globalRaw <= 13500 && globalGzip <= 7200,
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
