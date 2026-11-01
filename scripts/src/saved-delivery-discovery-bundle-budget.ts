import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import ts from "typescript";
import { createHash } from "node:crypto";
import {
  resolveBundleModuleAsset,
  resolveExclusiveBundleAssets,
  type BundleAsset,
} from "./bundle-source-map";

const root = "artifacts/agentic-company-os/src/";
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const gzip = (contents: Buffer) => gzipSync(contents, { level: 9 }).length;

/** A new source-exclusive, conditional behavior adapter, never shared React,
 * Button, Markdown, route, CSS or locale code. The frozen implementation is
 * below 1.8 KB raw / 1 KB gzip; growth must fit that independent ceiling. */
export function measureSavedDeliveryLogic(
  assets: readonly BundleAsset[],
  manifest: unknown,
) {
  const module = root + "components/studio/project-delivery-jump.tsx";
  const logic = resolveExclusiveBundleAssets(
    assets,
    manifest,
    [module],
    [module],
  );
  assert.equal(
    logic.length,
    1,
    "Expected one exclusive delivery navigation asset",
  );
  const raw = logic[0].contents.length,
    compressed = gzip(logic[0].contents);
  assert.ok(
    raw <= 1800 && compressed <= 1000,
    "Saved delivery logic exceeds its independent cap",
  );
  return { raw, gzip: compressed, asset: logic[0] };
}

/** Reconstruct exactly one new authored string in each existing studio pack.
 * Transfer totals select one language, so credit is max(current)-max(control),
 * not the largest individual delta and never all seven packs. The controls also
 * keep these same bytes out of the older budget-resume locale-growth credit. */
export function measureSavedDeliveryLocales(
  assets: readonly BundleAsset[],
  manifest: unknown,
) {
  const controls = locales.map((locale) => {
    const asset = resolveBundleModuleAsset(
      assets,
      manifest,
      root + `lib/project-studio-copy/studio-${locale}.ts`,
    );
    const text = asset.contents.toString("utf8");
    const source = ts.createSourceFile(
      asset.fileName,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const matches: ts.PropertyAssignment[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(source) === "viewSavedDelivery"
      )
        matches.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.equal(
      matches.length,
      1,
      "Expected one saved delivery label per language",
    );
    const field = matches[0];
    assert.ok(
      ts.isStringLiteral(field.initializer) &&
        field.initializer.text.trim().length > 0,
      "Saved delivery label must be an authored string",
    );
    assert.equal(
      text[field.end],
      ",",
      "Saved delivery label separator required",
    );
    const contents = Buffer.from(
      text.slice(0, field.getStart(source)) + text.slice(field.end + 1),
    );
    const raw = asset.contents.length - contents.length;
    const compressed = Math.max(0, gzip(asset.contents) - gzip(contents));
    assert.ok(
      raw <= 100 && compressed <= 80,
      "Saved delivery label exceeds its independent cap",
    );
    return {
      fileName: asset.fileName,
      contents,
      raw,
      gzip: compressed,
      originalRaw: asset.contents.length,
      originalGzip: gzip(asset.contents),
    };
  });
  assert.equal(
    new Set(controls.map((asset) => asset.fileName)).size,
    7,
    "Delivery labels must have distinct language owners",
  );
  const allRaw = controls.reduce((sum, asset) => sum + asset.raw, 0);
  const allGzip = controls.reduce((sum, asset) => sum + asset.gzip, 0);
  assert.ok(
    allRaw <= 500 && allGzip <= 350,
    "Saved delivery labels exceed their aggregate independent cap",
  );
  return {
    controls,
    raw: Math.max(
      0,
      Math.max(...controls.map((asset) => asset.originalRaw)) -
        Math.max(...controls.map((asset) => asset.contents.length)),
    ),
    gzip: Math.max(
      0,
      Math.max(...controls.map((asset) => asset.originalGzip)) -
        Math.max(...controls.map((asset) => gzip(asset.contents))),
    ),
    allRaw,
    allGzip,
  };
}

/** Reconstruct the old reader while preserving every adjacent expression and
 * class. Compiler/source ownership is checked by the caller; these exact AST
 * shapes authorize only new navigation glue, not arbitrary route growth. */
export function savedDeliveryRouteControl(
  asset: BundleAsset,
  logicName: string,
) {
  const text = asset.contents.toString("utf8");
  const source = ts.createSourceFile(
    asset.fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const only = <T>(matches: T[]): T => {
    assert.equal(matches.length, 1, "Ambiguous saved delivery integration");
    return matches[0];
  };
  const edits: { start: number; end: number; replacement: string }[] = [];
  const removeElement = (node: ts.Node, elements: readonly ts.Node[]) => {
    const index = elements.indexOf(node);
    assert.ok(index >= 0 && elements.length > 1);
    const start =
      index === 0 ? node.getStart(source) : node.getStart(source) - 1;
    const end = node.end + (index === 0 ? 1 : 0);
    assert.equal(text[index === 0 ? node.end : node.getStart(source) - 1], ",");
    edits.push({ start, end, replacement: "" });
  };
  const removeDeclaration = (node: ts.VariableDeclaration) => {
    assert.ok(ts.isVariableDeclarationList(node.parent));
    if (node.parent.declarations.length === 1) {
      assert.ok(ts.isVariableStatement(node.parent.parent));
      edits.push({
        start: node.parent.parent.getStart(source),
        end: node.parent.parent.end,
        replacement: "",
      });
    } else if (text[node.getStart(source) - 1] === ",") {
      edits.push({
        start: node.getStart(source) - 1,
        end: node.end,
        replacement: "",
      });
    } else {
      assert.equal(text[node.end], ",");
      edits.push({
        start: node.getStart(source),
        end: node.end + 1,
        replacement: "",
      });
    }
  };
  const declarations = nodes.filter(ts.isVariableDeclaration);
  const lazy = only(
    declarations.filter((node) =>
      node.initializer
        ?.getText(source)
        .includes('import("./' + logicName + '")'),
    ),
  );
  assert.ok(ts.isIdentifier(lazy.name) && lazy.initializer);
  assert.match(
    lazy.initializer.getText(source),
    /^[\w$]+\.lazy\(\(\)=>[\w$]+\(\(\)=>import\("\.\/[^"/]+\.js"\),__vite__mapDeps\(\[[\d,]+\]\)\)\)$/u,
  );
  removeDeclaration(lazy);
  const anchor = only(
    declarations.filter(
      (node) =>
        node.initializer
          ?.getText(source)
          .includes('href:"#project-delivery-heading"') &&
        node.initializer.getText(source).includes(".viewSavedDelivery"),
    ),
  );
  assert.ok(ts.isIdentifier(anchor.name));
  const id = "[\\w$]+";
  assert.ok(anchor.initializer && ts.isCallExpression(anchor.initializer));
  const anchorCall = anchor.initializer;
  assert.match(anchorCall.expression.getText(source), /^[\w$]+\.jsx$/u);
  assert.equal(anchorCall.arguments.length, 2);
  assert.equal(anchorCall.arguments[0].getText(source), '"a"');
  const anchorProps = anchorCall.arguments[1];
  assert.ok(ts.isObjectLiteralExpression(anchorProps));
  assert.equal(anchorProps.properties.length, 5);
  const anchorField = (name: string) =>
    only(
      anchorProps.properties
        .filter(ts.isPropertyAssignment)
        .filter((node) => node.name.getText(source) === name),
    ).initializer;
  assert.equal(anchorField("id").getText(source), '"project-delivery-link"');
  assert.equal(
    anchorField("href").getText(source),
    '"#project-delivery-heading"',
  );
  assert.match(
    anchorField("children").getText(source),
    /^[\w$]+\.viewSavedDelivery$/u,
  );
  assert.match(
    anchorField("className").getText(source),
    /^[\w$]+\(\{variant:"outline",size:"touch",className:"mt-3"\}\)$/u,
  );
  // The first native click must capture origin before optional behavior loads.
  // Bind all local identifiers, then require the exact read-only handler. Extra
  // work, missing native-click guards or unrelated expressions earn no credit.
  const click = anchorField("onClick");
  assert.ok(ts.isArrowFunction(click) && ts.isBlock(click.body));
  assert.equal(click.parameters.length, 1);
  assert.ok(ts.isIdentifier(click.parameters[0].name));
  const event = click.parameters[0].name.text;
  const statements = click.body.statements;
  assert.equal(statements.length, 4, "Exact eager delivery capture required");
  assert.ok(ts.isVariableStatement(statements[1]));
  const scrollDeclarations = statements[1].declarationList.declarations;
  assert.equal(scrollDeclarations.length, 1);
  assert.ok(ts.isIdentifier(scrollDeclarations[0].name));
  const scroll = scrollDeclarations[0].name.text;
  assert.ok(ts.isForStatement(statements[2]));
  const loop = statements[2].initializer;
  assert.ok(loop && ts.isVariableDeclarationList(loop));
  assert.equal(loop.declarations.length, 1);
  assert.ok(ts.isIdentifier(loop.declarations[0].name));
  const element = loop.declarations[0].name.text;
  assert.ok(
    ts.isExpressionStatement(statements[3]) &&
      ts.isBinaryExpression(statements[3].expression),
  );
  const target = statements[3].expression.left;
  assert.ok(
    ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression),
  );
  const origin = target.expression.text;
  assert.equal(
    new Set([event, scroll, element, origin]).size,
    4,
    "Eager delivery capture must retain its outer origin ref",
  );
  assert.equal(
    click.getText(source),
    `${event}=>{if(${event}.defaultPrevented||${event}.button!==0||${event}.altKey||${event}.ctrlKey||${event}.metaKey||${event}.shiftKey||window.location.hash==="#project-delivery-heading")return;const ${scroll}=[];for(let ${element}=${event}.currentTarget.parentElement;${element};${element}=${element}.parentElement)(${element}.scrollHeight>${element}.clientHeight||${element}.scrollWidth>${element}.clientWidth)&&${scroll}.push({node:${element},top:${element}.scrollTop,left:${element}.scrollLeft});${origin}.current={url:window.location.href,scroll:${scroll}}}`,
    "Only exact eager URL/ancestor-offset capture receives integration credit",
  );
  const factoryLocal = anchorField("className").getText(source).split("(")[0];
  const imported = only(
    nodes
      .filter(ts.isImportSpecifier)
      .filter((node) => node.name.text === factoryLocal),
  );
  const importDeclaration = imported.parent.parent.parent;
  assert.ok(
    ts.isImportDeclaration(importDeclaration) &&
      ts.isStringLiteral(importDeclaration.moduleSpecifier),
  );
  assert.match(
    importDeclaration.moduleSpecifier.text,
    /^\.\/index-[^/]+\.js$/u,
  );
  removeElement(imported, [...imported.parent.elements]);
  removeDeclaration(anchor);
  const scope = (node: ts.Node) => {
    let current: ts.Node | undefined = node;
    while (
      current &&
      !ts.isFunctionDeclaration(current) &&
      !ts.isArrowFunction(current) &&
      !ts.isFunctionExpression(current)
    )
      current = current.parent;
    return current;
  };
  const ref = only(
    declarations.filter(
      (node) =>
        node.name.getText(source) === origin && scope(node) === scope(anchor),
    ),
  );
  assert.match(
    ref.initializer?.getText(source) ?? "",
    /^[\w$]+\.useRef\(null\)$/u,
  );
  removeDeclaration(ref);
  const escaped = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const mount = only(
    nodes
      .filter(ts.isConditionalExpression)
      .filter((node) =>
        node.whenTrue
          .getText(source)
          .includes(
            ".jsx(" + lazy.name.getText(source) + ",{origin:" + origin + "})",
          ),
      ),
  );
  assert.match(
    mount.condition.getText(source),
    /^[\w$]+\.resultSummary\?\.trim\(\)$/u,
  );
  assert.equal(mount.whenFalse.getText(source), "null");
  assert.match(
    mount.whenTrue.getText(source),
    new RegExp(
      "^" +
        id +
        "\\.jsxs\\(" +
        id +
        "\\.Fragment,\\{children:\\[" +
        escaped(anchor.name.text) +
        "," +
        id +
        "\\.jsx\\(" +
        id +
        ",\\{resetKey:" +
        id +
        ",FallbackComponent:\\(\\)=>null,children:" +
        id +
        "\\.jsx\\(" +
        id +
        "\\.Suspense,\\{fallback:null,children:" +
        id +
        "\\.jsx\\(" +
        escaped(lazy.name.text) +
        ",\\{origin:" +
        escaped(origin) +
        "\\}\\)\\}\\)\\}\\)\\]\\}\\)$",
      "u",
    ),
  );
  assert.ok(ts.isArrayLiteralExpression(mount.parent));
  removeElement(mount, [...mount.parent.elements]);
  const headingId = only(
    nodes
      .filter(ts.isPropertyAssignment)
      .filter(
        (node) =>
          node.name.getText(source) === "id" &&
          node.initializer.getText(source) === '"project-delivery-heading"',
      ),
  );
  assert.ok(ts.isObjectLiteralExpression(headingId.parent));
  const heading = headingId.parent;
  assert.ok(
    ts.isCallExpression(heading.parent) &&
      heading.parent.arguments[0].getText(source) === '"h2"',
  );
  const props = heading.properties.filter(ts.isPropertyAssignment);
  const tab = only(
    props.filter((node) => node.name.getText(source) === "tabIndex"),
  );
  assert.equal(tab.initializer.getText(source), "-1");
  assert.equal(text[tab.end], ",");
  edits.push({
    start: tab.getStart(source),
    end: tab.end + 1,
    replacement: "",
  });
  const style = only(
    props.filter((node) => node.name.getText(source) === "className"),
  );
  assert.equal(
    style.initializer.getText(source),
    '"flex scroll-mt-20 items-center gap-2 rounded-control text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"',
  );
  edits.push({
    start: style.initializer.getStart(source),
    end: style.initializer.end,
    replacement: '"flex items-center gap-2 text-base font-semibold"',
  });
  const metadata = JSON.stringify("assets/" + logicName);
  const positions = [...text.matchAll(new RegExp(escaped(metadata), "gu"))];
  assert.equal(
    positions.length,
    1,
    "Unique saved delivery preload metadata required",
  );
  const path = only(
    nodes
      .filter(ts.isStringLiteral)
      .filter((node) => node.getText(source) === metadata),
  );
  assert.ok(ts.isArrayLiteralExpression(path.parent));
  const slot = path.parent.elements.indexOf(path);
  assert.equal(
    slot,
    path.parent.elements.length - 1,
    "New delivery preload must be the final slot; never rebase old indexes",
  );
  let container: ts.Node | undefined = path;
  while (container && !ts.isVariableDeclaration(container))
    container = container.parent;
  assert.ok(
    container && container.name.getText(source) === "__vite__mapDeps",
    "Owned delivery preload table required",
  );
  const consumers = nodes
    .filter(ts.isCallExpression)
    .filter(
      (node) =>
        node.expression.getText(source) === "__vite__mapDeps" &&
        node.arguments.length === 1 &&
        ts.isArrayLiteralExpression(node.arguments[0]) &&
        node.arguments[0].elements.some(
          (element) => element.getText(source) === String(slot),
        ),
    );
  assert.equal(
    consumers.length,
    1,
    "Only the new lazy delivery mount may consume its preload slot",
  );
  assert.ok(
    consumers[0].getStart(source) >= lazy.initializer!.getStart(source) &&
      consumers[0].end <= lazy.initializer!.end,
  );
  removeElement(path, [...path.parent.elements]);
  let control = text,
    boundary = text.length;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    assert.ok(edit.end <= boundary, "Overlapping saved delivery fragments");
    control =
      control.slice(0, edit.start) + edit.replacement + control.slice(edit.end);
    boundary = edit.start;
  }
  const contents = Buffer.from(control),
    raw = asset.contents.length - contents.length;
  const compressed = Math.max(0, gzip(asset.contents) - gzip(contents));
  assert.ok(
    raw > 0 && raw <= 1200 && compressed <= 600,
    "Saved delivery integration exceeds its independent cap",
  );
  return {
    fileName: asset.fileName,
    contents,
    raw,
    gzip: compressed,
    factoryLocal,
  };
}

/** The canonical style factory already existed in main N. Only its new export
 * specifier (9 raw bytes in this build) belongs to navigation. Keep the frozen
 * factory body and every adjacent entry byte; never excuse entry-size growth. */
export function measureSavedDeliveryEntryExport(
  assets: readonly BundleAsset[],
  manifest: unknown,
  preceding: readonly BundleAsset[] = [],
) {
  const entry = resolveBundleModuleAsset(
    assets,
    manifest,
    root + "components/ui/button.tsx",
  );
  const route = resolveBundleModuleAsset(
    assets,
    manifest,
    root + "pages/tasks/detail.tsx",
  );
  const logic = measureSavedDeliveryLogic(assets, manifest);
  const routeControl = savedDeliveryRouteControl(route, logic.asset.fileName);
  const parsed = ts.createSourceFile(
    route.fileName,
    route.contents.toString("utf8"),
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
  assert.equal(
    imports.length,
    1,
    "Unique saved delivery style import required",
  );
  const names = imports[0].importClause?.namedBindings;
  assert.ok(names && ts.isNamedImports(names));
  const imported = names.elements.filter(
    (spec) => spec.name.text === routeControl.factoryLocal,
  );
  assert.equal(
    imported.length,
    1,
    "Unique saved delivery style factory import required",
  );
  assert.ok(imported[0].propertyName);
  const prior = preceding.filter((asset) => asset.fileName === entry.fileName);
  assert.ok(prior.length <= 1, "Ambiguous preceding style export control");
  const input = prior[0] ?? entry,
    text = input.contents.toString("utf8");
  const source = ts.createSourceFile(
    entry.fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const exports = source.statements
    .filter(ts.isExportDeclaration)
    .flatMap((node) =>
      !node.moduleSpecifier &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
        ? [...node.exportClause.elements]
        : [],
    );
  const specs = exports.filter(
    (spec) => spec.name.text === imported[0].propertyName!.text,
  );
  assert.equal(
    specs.length,
    1,
    "Unique saved delivery style factory export required",
  );
  assert.equal(
    specs[0].propertyName?.text,
    "Ue",
    "Frozen style factory export target changed",
  );
  const declarations: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "Ue")
      declarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(declarations.length, 1, "Unique frozen style factory required");
  assert.equal(
    createHash("sha256").update(declarations[0].getText(source)).digest("hex"),
    "3d0ce16ad23ccade05c34cf60bce6ab05e435a735a89773e019f98d4a3323f45",
    "Frozen style factory body changed",
  );
  const spec = specs[0],
    list = [...spec.parent.elements],
    index = list.indexOf(spec);
  assert.ok(list.length > 1);
  const start = index === 0 ? spec.getStart(source) : spec.getStart(source) - 1,
    end = spec.end + (index === 0 ? 1 : 0);
  assert.equal(text[index === 0 ? spec.end : spec.getStart(source) - 1], ",");
  const contents = Buffer.from(text.slice(0, start) + text.slice(end));
  const raw = input.contents.length - contents.length,
    compressed = Math.max(0, gzip(input.contents) - gzip(contents));
  assert.ok(
    raw > 0 && raw <= 20 && compressed <= 30,
    "Saved delivery style export exceeds its independent cap",
  );
  return { fileName: entry.fileName, contents, raw, gzip: compressed };
}

export function measureSavedDeliveryDiscovery(
  assets: readonly BundleAsset[],
  manifest: unknown,
  preceding: readonly BundleAsset[] = assets,
  entry?: ReturnType<typeof measureSavedDeliveryEntryExport>,
) {
  const logic = measureSavedDeliveryLogic(assets, manifest);
  const labels = measureSavedDeliveryLocales(assets, manifest);
  const route = resolveBundleModuleAsset(
    assets,
    manifest,
    root + "pages/tasks/detail.tsx",
  );
  const heading = resolveBundleModuleAsset(
    assets,
    manifest,
    root + "components/studio/project-delivery-summary.tsx",
  );
  assert.equal(
    heading.fileName,
    route.fileName,
    "Expected source-owned delivery heading and route together",
  );
  const input = preceding.filter((asset) => asset.fileName === route.fileName);
  assert.equal(input.length, 1, "Ambiguous preceding delivery route control");
  const control = savedDeliveryRouteControl(input[0], logic.asset.fileName);
  const raw = logic.raw + labels.raw + control.raw + (entry?.raw ?? 0);
  const compressed =
    logic.gzip + labels.gzip + control.gzip + (entry?.gzip ?? 0);
  // A measured optional adapter + exact stable-anchor/focus glue + one label.
  // No fixed allowance or whole-route growth. Existing base/total/route caps
  // remain unchanged. These controls remove overlap with older feature credit.
  assert.ok(
    raw <= 3000 && compressed <= 1500,
    "Saved delivery discovery exceeds its independent cap",
  );
  return { raw, gzip: compressed, logic, labels, route: control, entry };
}
