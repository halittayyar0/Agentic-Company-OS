import assert from "node:assert/strict";
import ts from "typescript";
import { gzipSync } from "node:zlib";
import {
  resolveBundleModuleAsset,
  resolveExclusiveBundleAssets,
  type BundleAsset,
} from "./bundle-source-map";

const root = "artifacts/agentic-company-os/src/";
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const identifier = String.raw`[A-Za-z_$][\w$]*`;
const excluded = [
  "complete_task",
  "request_approval",
  "request_user_input",
  "delegate_task",
  "create_sub_agent",
  "update_task_progress",
  "load_tools",
  "list_skills",
  "read_skill",
  "list_extensions",
  "log_note",
  "post_company_message",
  "vm_codex_task",
];
const gzip = (bytes: Buffer) => gzipSync(bytes, { level: 9 }).length;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const parse = (asset: BundleAsset) =>
  ts.createSourceFile(
    asset.fileName,
    asset.contents.toString("utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
const name = (node: ts.PropertyName | ts.BindingName) =>
  ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : "";
const all = <T extends ts.Node>(
  source: ts.Node,
  predicate: (node: ts.Node) => node is T,
): T[] => {
  const found: T[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};
const printer = ts.createPrinter({
  removeComments: true,
  newLine: ts.NewLineKind.LineFeed,
});
// Ignore compiler-chosen local names, while preserving properties, operations,
// literals and structure. This is a byte attribution check, not a model verdict.
function normalized(node: ts.Node, source: ts.SourceFile) {
  const transformed = ts.transform(node, [
    (context) => {
      const visit: ts.Visitor = (current) => {
        if (
          ts.isIdentifier(current) &&
          !(
            (ts.isPropertyAccessExpression(current.parent) &&
              current.parent.name === current) ||
            (ts.isPropertyAssignment(current.parent) &&
              current.parent.name === current) ||
            current.text === "Set"
          )
        )
          return ts.factory.createIdentifier("_");
        return ts.visitEachChild(current, visit, context);
      };
      return (current) => ts.visitNode(current, visit) as ts.Node;
    },
  ]);
  try {
    return printer
      .printNode(ts.EmitHint.Unspecified, transformed.transformed[0], source)
      .replace(/\s+/gu, "");
  } finally {
    transformed.dispose();
  }
}
type Part = { start: number; end: number; replacement: string };
function control(asset: BundleAsset, parts: Part[]) {
  const original = asset.contents.toString("utf8");
  parts.sort((a, b) => a.start - b.start);
  for (let index = 0; index < parts.length; index++) {
    const p = parts[index];
    assert.ok(p.start >= 0 && p.end > p.start && p.end <= original.length);
    assert.ok(
      index === 0 || parts[index - 1].end <= p.start,
      "Overlapping condition credit",
    );
  }
  let text = original;
  for (const p of [...parts].reverse())
    text = text.slice(0, p.start) + p.replacement + text.slice(p.end);
  const contents = Buffer.from(text);
  return {
    fileName: asset.fileName,
    contents,
    raw: asset.contents.length - contents.length,
    gzip: Math.max(0, gzip(asset.contents) - gzip(contents)),
  };
}
function only<T>(values: T[], message: string): T {
  assert.equal(values.length, 1, message);
  return values[0];
}
function entryControl(asset: BundleAsset) {
  assert.match(asset.fileName, /^index-[^/]+\.js$/u);
  const source = parse(asset),
    text = asset.contents.toString("utf8"),
    parts: Part[] = [];
  const declarations = all(source, ts.isVariableDeclaration);
  const exclusion = only(
    declarations.filter(
      (d) =>
        d.initializer &&
        ts.isNewExpression(d.initializer) &&
        d.initializer.expression.getText(source) === "Set" &&
        d.initializer.arguments?.length === 1 &&
        ts.isArrayLiteralExpression(d.initializer.arguments[0]) &&
        d.initializer.arguments[0].elements.some(
          (e) => ts.isStringLiteral(e) && e.text === "complete_task",
        ),
    ),
    "Expected one condition exclusion set",
  );
  assert.ok(exclusion.initializer && ts.isNewExpression(exclusion.initializer));
  const items = exclusion.initializer
    .arguments![0] as ts.ArrayLiteralExpression;
  assert.ok(items.elements.every(ts.isStringLiteral));
  assert.deepEqual(
    items.elements.map((e) => (e as ts.StringLiteral).text),
    excluded,
  );
  const schema = only(
    declarations.filter((d) =>
      d.initializer?.getText(source).includes('"tool_succeeded"'),
    ),
    "Expected one condition schema",
  );
  assert.ok(schema.initializer && name(schema.name));
  assert.equal(
    normalized(schema.initializer, source),
    String.raw`_(_({kind:_("tool_succeeded"),tool:_().check(_(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/u),_(_=>!_.has(_)))})).check(_(8),_(_=>newSet(_.map(_=>_.tool)).size===_.length))`,
    "Condition schema shape changed",
  );
  assert.ok(
    schema.initializer
      .getText(source)
      .includes("!" + name(exclusion.name) + ".has("),
  );
  const canonical = only(
    all(source, ts.isFunctionDeclaration).filter(
      (f) =>
        f.body?.getText(source).includes(name(schema.name) + ".parse(") &&
        f.body.getText(source).includes(".sort("),
    ),
    "Expected one condition canonicalizer",
  );
  assert.ok(canonical.body);
  assert.equal(
    normalized(canonical.body, source),
    "{return_.parse(_).sort((_,_)=>_.tool<_.tool?-1:_.tool>_.tool?1:0);}",
    "Condition canonicalizer shape changed",
  );
  for (const initializer of [exclusion.initializer, schema.initializer])
    parts.push({
      start: initializer.getStart(source),
      end: initializer.end,
      replacement: "null",
    });
  parts.push({
    start: canonical.body.getStart(source),
    end: canonical.body.end,
    replacement: "{}",
  });
  const field = only(
    all(source, ts.isPropertyAssignment).filter(
      (p) => name(p.name) === "completionRequirements",
    ),
    "Expected one optional project criterion field",
  );
  assert.ok(
    ts.isCallExpression(field.initializer) &&
      field.initializer.arguments.length === 1 &&
      field.initializer.arguments[0].getText(source) === name(schema.name),
  );
  assert.ok(ts.isObjectLiteralExpression(field.parent));
  assert.deepEqual(
    field.parent.properties.map((p) =>
      ts.isPropertyAssignment(p) ? name(p.name) : "",
    ),
    [
      "version",
      "kind",
      "title",
      "brief",
      "priority",
      "autonomyMode",
      "cadenceSeconds",
      "completionRequirements",
    ],
  );
  assert.equal(text[field.getStart(source) - 1], ",");
  parts.push({
    start: field.getStart(source) - 1,
    end: field.end,
    replacement: "",
  });
  const nonempty = only(
    [
      ...text.matchAll(
        new RegExp(
          String.raw`\|\|\(${identifier}\.completionRequirements\?\.length\?\?0\)>0`,
          "gu",
        ),
      ),
    ],
    "Expected one condition-only draft input check",
  );
  parts.push({
    start: nonempty.index,
    end: nonempty.index + nonempty[0].length,
    replacement: "",
  });
  const result = control(asset, parts);
  assert.ok(
    result.raw <= 1000 && result.gzip <= 500,
    "Condition entry wiring exceeds its independent cap",
  );
  return result;
}
function routeControl(
  asset: BundleAsset,
  logic: BundleAsset,
  view: BundleAsset,
  kind: "choice" | "panel",
) {
  const source = parse(asset),
    text = asset.contents.toString("utf8"),
    parts: Part[] = [];
  const declaration = only(
    all(source, ts.isVariableDeclaration).filter((d) =>
      d.initializer
        ?.getText(source)
        .includes('import("./' + logic.fileName + '")'),
    ),
    "Expected one condition lazy declaration",
  );
  assert.ok(declaration.initializer && name(declaration.name));
  const lazy = declaration.initializer
    .getText(source)
    .match(
      new RegExp(
        String.raw`^(${identifier})\.lazy\(\(\)=>${identifier}\(\(\)=>import\("\./${escape(logic.fileName)}"\),__vite__mapDeps\(\[[\d,]+\]\)\)\)$`,
        "u",
      ),
    );
  assert.ok(lazy, "Unknown condition lazy declaration");
  const react = escape(lazy[1]),
    binding = escape(name(declaration.name));
  parts.push({
    start: declaration.initializer.getStart(source),
    end: declaration.initializer.end,
    replacement: "null",
  });
  const pattern =
    kind === "choice"
      ? new RegExp(
          String.raw`(?<jsx>${identifier})\.jsx\(${react}\.Suspense,\{fallback:null,children:\k<jsx>\.jsx\(${binding},\{value:(?<draft>${identifier})\.value\.completionRequirements\?\?\[\],onChange:(?<next>${identifier})=>\k<draft>\.change\(\{\.\.\.\k<draft>\.current\.current,completionRequirements:\k<next>\}\),onBlockedChange:(?<setter>${identifier}),onReload:\(\)=>\{\k<draft>\.change\(\k<draft>\.current\.current\)&&window\.location\.reload\(\)\}\}\)\}\)`,
          "gu",
        )
      : new RegExp(
          String.raw`!!(?<task>${identifier})\.completionRequirements\?\.length&&(?<jsx>${identifier})\.jsx\(${identifier},\{resetKey:(?<taskId>${identifier}),children:\k<jsx>\.jsx\(${react}\.Suspense,\{fallback:null,children:\k<jsx>\.jsx\(${binding},\{taskId:\k<taskId>,requirements:\k<task>\.completionRequirements\},\k<taskId>\)\}\)\}\)`,
          "gu",
        );
  const mount = only(
    [...text.matchAll(pattern)],
    "Unknown condition reader mount",
  );
  parts.push({
    start: mount.index,
    end: mount.index + mount[0].length,
    replacement: "null",
  });
  if (kind === "choice") {
    const enclosing = all(source, ts.isFunctionDeclaration)
      .filter(
        (f) =>
          f.body &&
          f.body.getStart(source) <= mount.index &&
          f.body.end >= mount.index + mount[0].length,
      )
      .sort((a, b) => a.end - a.pos - (b.end - b.pos))[0];
    assert.ok(enclosing?.body, "Condition chooser scope missing");
    const setter = mount.groups!.setter;
    const state = only(
      all(enclosing.body, ts.isVariableDeclaration).filter(
        (d) =>
          ts.isArrayBindingPattern(d.name) &&
          d.name.elements.length === 2 &&
          d.name.elements[1].getText(source) === setter,
      ),
      "Expected one condition state binding",
    );
    assert.ok(ts.isArrayBindingPattern(state.name) && state.initializer);
    assert.equal(state.initializer.getText(source), lazy[1] + ".useState(!0)");
    const blocked = state.name.elements[0].getText(source),
      body = enclosing.body.getText(source);
    assert.equal(
      [...body.matchAll(new RegExp(String.raw`\b${escape(blocked)}\b`, "gu"))]
        .length,
      3,
      "Unexpected condition state use",
    );
    parts.push({
      start: state.initializer.getStart(source),
      end: state.initializer.end,
      replacement: "null",
    });
    const guards = [
      ...body.matchAll(
        new RegExp(String.raw`\|\|${escape(blocked)}(?=\|\||[,;)])`, "gu"),
      ),
    ];
    assert.equal(guards.length, 2, "Condition submission guards changed");
    for (const guard of guards) {
      const start = enclosing.body.getStart(source) + guard.index;
      parts.push({ start, end: start + guard[0].length, replacement: "" });
    }
  }
  // Only these two new, compiler-mapped paths are reconstructed. Existing
  // dependency paths and every legacy runtime byte remain in the old budgets.
  for (const own of [logic, view]) {
    const path = JSON.stringify("assets/" + own.fileName);
    const matches = [...text.matchAll(new RegExp(escape(path), "gu"))];
    assert.equal(matches.length, 1, "Condition preload path is ambiguous");
    parts.push({
      start: matches[0].index,
      end: matches[0].index + path.length,
      replacement: '""',
    });
  }
  const result = control(asset, parts);
  assert.ok(
    result.raw <= 1000 && result.gzip <= 500,
    "Condition reader wiring exceeds its independent cap",
  );
  return result;
}

export function measureCompletionRequirementsBundle(
  assets: readonly BundleAsset[],
  manifest: unknown,
  previousControls: readonly BundleAsset[] = [],
): {
  raw: number;
  gzip: number;
  integrationRaw: number;
  integrationGzip: number;
  allLocaleRaw: number;
  allLocaleGzip: number;
  packs: BundleAsset[];
  controls: Array<BundleAsset & { raw: number; gzip: number }>;
} {
  const own = [
    "components/tasks/completion-requirements-choice.tsx",
    "components/tasks/completion-requirements-panel.tsx",
    "lib/completion-requirements-copy.ts",
    "lib/completion-requirements-view.ts",
  ].map((module) => root + module);
  const logic = resolveExclusiveBundleAssets(assets, manifest, own, own);
  const owned = (module: string) =>
    resolveBundleModuleAsset(assets, manifest, root + module);
  const choice = owned("components/tasks/completion-requirements-choice.tsx"),
    panel = owned("components/tasks/completion-requirements-panel.tsx"),
    view = owned("lib/completion-requirements-view.ts");
  assert.ok(choice !== panel && choice !== view && panel !== view);
  const packs = locales.map((locale) => {
    const module =
      root + "lib/completion-requirements-copy/requirements-" + locale + ".ts";
    const pack = only(
      resolveExclusiveBundleAssets(assets, manifest, [module], [module]),
      "Expected one condition language pack",
    );
    assert.ok(pack.fileName.startsWith("requirements-" + locale + "-"));
    assert.ok(
      pack.contents.length <= 4000 && gzip(pack.contents) <= 1600,
      "Condition language pack exceeds its cap",
    );
    return pack;
  });
  assert.equal(new Set(packs.map((p) => p.fileName)).size, 7);
  // Earlier source-aware feature measurements supply their reconstructed
  // readers. Measure only our following change, rather than crediting their
  // removed bytes a second time. Original manifest hashes are still checked
  // above; these controls are tooling outputs, never app/user input.
  assert.equal(
    new Set(previousControls.map((a) => a.fileName)).size,
    previousControls.length,
  );
  assert.ok(
    previousControls.every((a) =>
      assets.some((original) => original.fileName === a.fileName),
    ),
  );
  const controlled = (module: string) => {
    const original = owned(module);
    return (
      previousControls.find((a) => a.fileName === original.fileName) ?? original
    );
  };
  const controls = [
    entryControl(controlled("lib/completion-requirements-input.ts")),
    routeControl(controlled("pages/tasks/new.tsx"), choice, view, "choice"),
    routeControl(controlled("pages/tasks/detail.tsx"), panel, view, "panel"),
  ];
  assert.equal(new Set(controls.map((c) => c.fileName)).size, 3);
  const integrationRaw = controls.reduce((n, c) => n + c.raw, 0),
    integrationGzip = controls.reduce((n, c) => n + c.gzip, 0);
  const raw =
    logic.reduce((n, a) => n + a.contents.length, 0) +
    Math.max(...packs.map((a) => a.contents.length)) +
    integrationRaw;
  const compressed =
    logic.reduce((n, a) => n + gzip(a.contents), 0) +
    Math.max(...packs.map((a) => gzip(a.contents))) +
    integrationGzip;
  const allLocaleRaw = packs.reduce((n, a) => n + a.contents.length, 0),
    allLocaleGzip = packs.reduce((n, a) => n + gzip(a.contents), 0);
  assert.ok(
    integrationRaw <= 2000 && integrationGzip <= 1000,
    "Condition integration exceeds its cap",
  );
  assert.ok(
    raw <= 16000 &&
      compressed <= 7000 &&
      allLocaleRaw <= 18000 &&
      allLocaleGzip <= 9000,
    "Completion conditions exceed their independent transfer budget",
  );
  return {
    raw,
    gzip: compressed,
    integrationRaw,
    integrationGzip,
    allLocaleRaw,
    allLocaleGzip,
    packs,
    controls,
  };
}
