import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { gzipSync } from "node:zlib";
import {
  resolveExclusiveBundleAssets,
  resolveBundleModuleAsset,
  type BundleAsset,
} from "./bundle-source-map";
const root = "artifacts/agentic-company-os/src/";
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const reuseFields = [
  "incomingTitle",
  "incomingHelp",
  "keepCurrent",
  "useIncoming",
  "choiceError",
  "preparationOnly",
  "savedBrief",
  "useBrief",
  "prepareGuide",
  "sourceHelp",
  "guideSource",
  "preparedGuide",
  "guideTitleHelp",
  "prepareProject",
  "disabledGuideHelp",
  "runtimeHelp",
  "waitingGuide",
];
const editorFields = [
  "storageError",
  "pendingTitle",
  "uncertain",
  "rejected",
  "check",
  "retry",
  "continue",
  "matching",
  "missing",
  "changed",
  "invalid",
  "validation",
  "availability",
  "incomingHelp",
  "keep",
  "use",
  "reviewCurrent",
  "storedVersion",
  "storedAvailability",
  "reviewHelp",
];
const exclusiveModules = [
  "components/studio/project-preparation-choice.tsx",
  "components/studio/project-reuse-actions.tsx",
  "lib/project-preparation.ts",
  "lib/reusable-work-copy.ts",
  "lib/project-reuse.ts",
  "lib/extension-editor-draft.ts",
].map((file) => root + file);
const libraryModules = [
  "components/extension-library.tsx",
  "hooks/use-extension-editor.ts",
  "lib/extension-editor-copy.ts",
].map((file) => root + file);
const gzip = (bytes: Buffer) =>
  bytes.length ? gzipSync(bytes, { level: 9 }).length : 0;
const parsed = (fileName: string, text: string) =>
  ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
function collect(
  node: ts.Node,
  predicate: (node: ts.Node) => boolean,
): ts.Node[] {
  const found: ts.Node[] = [];
  function visit(current: ts.Node) {
    if (predicate(current)) found.push(current);
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}
function key(property: ts.ObjectLiteralElementLike) {
  return ts.isPropertyAssignment(property) &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ? property.name.text
    : "";
}
function values(object: ts.ObjectLiteralExpression, fields: readonly string[]) {
  assert.equal(
    object.properties.length,
    fields.length,
    "Copy field count changed",
  );
  const entries = object.properties.map((property) => {
    assert.ok(
      ts.isPropertyAssignment(property) &&
        ts.isStringLiteral(property.initializer),
      "Copy must contain authored strings",
    );
    const name = key(property);
    assert.ok(fields.includes(name), "Unknown copy field");
    return [name, property.initializer.text] as const;
  });
  assert.equal(
    new Set(entries.map(([name]) => name)).size,
    fields.length,
    "Duplicate copy field",
  );
  return Object.fromEntries(entries);
}
function copyObject(source: ts.SourceFile, fields: readonly string[]) {
  const matches = collect(
    source,
    (node) =>
      ts.isObjectLiteralExpression(node) &&
      node.properties.some((property) => key(property) === fields[0]),
  );
  assert.equal(
    matches.length,
    1,
    "Authored copy object is missing or ambiguous",
  );
  return matches[0] as ts.ObjectLiteralExpression;
}
function soleCopyExport(
  source: ts.SourceFile,
  object: ts.ObjectLiteralExpression,
  authored: ts.SourceFile,
  authoredObject: ts.ObjectLiteralExpression,
) {
  const authoredStatements = authored.statements.filter(
    (statement) =>
      !(
        ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly
      ),
  );
  if (
    authoredStatements.length !== 1 ||
    !ts.isExportAssignment(authoredStatements[0])
  )
    return false;
  const expression = authoredStatements[0].expression;
  if (
    expression !== authoredObject &&
    !(
      ts.isSatisfiesExpression(expression) &&
      expression.expression === authoredObject
    )
  )
    return false;
  if (source.statements.length !== 2) return false;
  const [declaration, exported] = source.statements;
  if (
    !ts.isVariableStatement(declaration) ||
    declaration.declarationList.declarations.length !== 1 ||
    !ts.isExportDeclaration(exported) ||
    exported.moduleSpecifier ||
    !exported.exportClause ||
    !ts.isNamedExports(exported.exportClause) ||
    exported.exportClause.elements.length !== 1
  )
    return false;
  const binding = declaration.declarationList.declarations[0],
    element = exported.exportClause.elements[0];
  return (
    ts.isIdentifier(binding.name) &&
    binding.initializer === object &&
    element.propertyName?.text === binding.name.text &&
    element.name.text === "default"
  );
}
function dependencyIndexes(source: ts.SourceFile) {
  return collect(
    source,
    (node) =>
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "__vite__mapDeps",
  )
    .map((node) => {
      const call = node as ts.CallExpression;
      assert.ok(
        call.arguments.length === 1 &&
          ts.isArrayLiteralExpression(call.arguments[0]),
        "Unknown preload index call",
      );
      return call.arguments[0].elements.map((element) => {
        assert.ok(
          ts.isNumericLiteral(element) && /^\d+$/u.test(element.text),
          "Unknown preload index",
        );
        return Number(element.text);
      });
    })
    .flat();
}
function preloadControl(
  text: string,
  newIndexes: readonly number[],
  assets: readonly BundleAsset[],
  actionFileName: string,
) {
  const prefix = "const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=";
  const suffix = ")))=>i.map(i=>d[i]);";
  if (!text.startsWith("const __vite__mapDeps="))
    return { text, raw: 0, gzip: 0 };
  const newline = text.indexOf("\n"),
    header = text.slice(0, newline);
  assert.ok(
    newline > 0 && header.startsWith(prefix) && header.endsWith(suffix),
    "Unknown preload metadata shape",
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
          name.startsWith("assets/") &&
          assets.some((asset) => name === "assets/" + asset.fileName),
      ),
    "Unknown preload metadata paths",
  );
  assert.ok(
    newIndexes.some((index) => paths[index] === "assets/" + actionFileName),
    "Reuse preload must include its action",
  );
  const body = text.slice(newline + 1),
    source = parsed("control.js", body);
  const references = dependencyIndexes(source);
  for (const node of collect(
    source,
    (node) => ts.isIdentifier(node) && node.text === "__vite__mapDeps",
  ))
    assert.ok(
      ts.isCallExpression(node.parent) && node.parent.expression === node,
      "Unknown shared preload consumer",
    );
  assert.ok(
    [...references, ...newIndexes].every((index) => index < paths.length),
    "Preload index exceeds metadata",
  );
  let retained = paths.length;
  while (
    retained > 0 &&
    newIndexes.includes(retained - 1) &&
    !references.includes(retained - 1)
  )
    retained--;
  if (retained === paths.length) return { text, raw: 0, gzip: 0 };
  // Only a suffix solely used by the removed new lazy call can disappear.
  // Existing path order, all other consumers and their indexes stay identical.
  const control =
    prefix + JSON.stringify(paths.slice(0, retained)) + suffix + "\n" + body;
  return {
    text: control,
    raw: Buffer.byteLength(text) - Buffer.byteLength(control),
    gzip: Math.max(0, gzip(Buffer.from(text)) - gzip(Buffer.from(control))),
  };
}
function readerControl(
  asset: BundleAsset,
  actionFileName: string,
  assets: readonly BundleAsset[],
) {
  const text = asset.contents.toString("utf8"),
    source = parsed(asset.fileName, text);
  const declarations = collect(
    source,
    (node) =>
      ts.isVariableDeclaration(node) &&
      !!node.initializer &&
      collect(
        node.initializer,
        (child) =>
          ts.isCallExpression(child) &&
          child.expression.kind === ts.SyntaxKind.ImportKeyword &&
          child.arguments.length === 1 &&
          ts.isStringLiteral(child.arguments[0]) &&
          child.arguments[0].text === "./" + actionFileName,
      ).length > 0,
  ) as ts.VariableDeclaration[];
  assert.equal(
    declarations.length,
    1,
    "Reuse lazy declaration is missing or ambiguous",
  );
  const declaration = declarations[0],
    initializer = declaration.initializer!;
  assert.ok(
    ts.isIdentifier(declaration.name) &&
      ts.isCallExpression(initializer) &&
      ts.isPropertyAccessExpression(initializer.expression) &&
      initializer.expression.name.text === "lazy" &&
      initializer.arguments.length === 1 &&
      ts.isArrowFunction(initializer.arguments[0]),
    "Reuse lazy declaration shape changed",
  );
  const binding = declaration.name.text;
  const newIndexes = dependencyIndexes(
    parsed("lazy.js", initializer.getText(source)),
  );
  const calls = collect(
    source,
    (node) =>
      ts.isCallExpression(node) &&
      node.arguments.length === 2 &&
      ts.isIdentifier(node.arguments[0]) &&
      node.arguments[0].text === binding,
  ) as ts.CallExpression[];
  assert.equal(calls.length, 1, "Reuse mount is missing or ambiguous");
  const inner = calls[0],
    props = inner.arguments[1];
  assert.ok(
    ts.isObjectLiteralExpression(props) &&
      props.properties.length === 2 &&
      props.properties.every(ts.isPropertyAssignment),
  );
  const project = props.properties.find(
    (property) => key(property) === "project",
  ) as ts.PropertyAssignment | undefined;
  const unavailable = props.properties.find(
    (property) => key(property) === "sourceUnavailable",
  ) as ts.PropertyAssignment | undefined;
  assert.ok(
    project &&
      ts.isIdentifier(project.initializer) &&
      unavailable &&
      ts.isBinaryExpression(unavailable.initializer) &&
      unavailable.initializer.operatorToken.kind ===
        ts.SyntaxKind.BarBarToken &&
      ts.isIdentifier(unavailable.initializer.left) &&
      ts.isIdentifier(unavailable.initializer.right),
    "Reuse mount includes unverified props",
  );
  const child = inner.parent,
    outerProps = child.parent,
    outer = outerProps.parent;
  assert.ok(
    ts.isPropertyAssignment(child) &&
      key(child) === "children" &&
      ts.isObjectLiteralExpression(outerProps) &&
      outerProps.properties.length === 2 &&
      ts.isCallExpression(outer) &&
      outer.arguments.length === 2 &&
      outer.arguments[1] === outerProps &&
      ts.isPropertyAccessExpression(outer.arguments[0]) &&
      outer.arguments[0].name.text === "Suspense",
  );
  const fallback = outerProps.properties.find(
    (property) => key(property) === "fallback",
  ) as ts.PropertyAssignment | undefined;
  assert.ok(
    fallback && fallback.initializer.kind === ts.SyntaxKind.NullKeyword,
  );
  const condition = outer.parent;
  assert.ok(
    ts.isBinaryExpression(condition) &&
      condition.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      condition.right === outer,
    "Reuse root-only condition changed",
  );
  let guard = condition.left;
  if (ts.isIdentifier(guard)) {
    const guardName = guard.text;
    let scope: ts.Node = condition;
    while (!ts.isFunctionLike(scope) && !ts.isSourceFile(scope))
      scope = scope.parent;
    const definitions: ts.VariableDeclaration[] = [];
    function visitScope(node: ts.Node) {
      // Minifiers reuse local names across older components and callbacks.
      // Never resolve a guard through another function's binding.
      if (ts.isFunctionLike(node) && node !== scope) return;
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === guardName
      )
        definitions.push(node);
      ts.forEachChild(node, visitScope);
    }
    visitScope(scope);
    assert.equal(definitions.length, 1, "Root guard binding is ambiguous");
    assert.ok(definitions[0].initializer, "Root guard is missing");
    guard = definitions[0].initializer;
  }
  assert.ok(
    ts.isBinaryExpression(guard) &&
      guard.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      guard.right.kind === ts.SyntaxKind.NullKeyword &&
      ts.isPropertyAccessExpression(guard.left) &&
      guard.left.name.text === "parentTaskId" &&
      ts.isIdentifier(guard.left.expression) &&
      guard.left.expression.text === project.initializer.text,
    "Reuse root-only condition changed",
  );
  const ranges = [initializer, condition]
    .map((node) => ({ start: node.getStart(source), end: node.end }))
    .sort((a, b) => b.start - a.start);
  let control = text;
  for (const range of ranges)
    control = control.slice(0, range.start) + "null" + control.slice(range.end);
  const metadata = preloadControl(control, newIndexes, assets, actionFileName);
  const contents = Buffer.from(metadata.text);
  return {
    fileName: asset.fileName,
    contents,
    raw: asset.contents.length - contents.length,
    gzip: Math.max(0, gzip(asset.contents) - gzip(contents)),
    metadataRaw: metadata.raw,
    metadataGzip: metadata.gzip,
  };
}
/** Credits only compiler-owned new chunks, exact reader fragments, exact
 * authored strings and the separately bounded legacy editor delta. */
export function measureReusableWorkBundle(
  assets: readonly BundleAsset[],
  sourceDirectory: string,
) {
  const manifest = JSON.parse(
    readFileSync(
      path.resolve(sourceDirectory, "../dist/bundle-budget-manifest.json"),
      "utf8",
    ),
  );
  const exclusive = resolveExclusiveBundleAssets(
    assets,
    manifest,
    exclusiveModules,
    exclusiveModules,
  );
  const [library] = resolveExclusiveBundleAssets(
    assets,
    manifest,
    libraryModules,
    libraryModules,
  );
  assert.ok(
    library &&
      resolveExclusiveBundleAssets(
        assets,
        manifest,
        libraryModules,
        libraryModules,
      ).length === 1,
    "Editor source must have one shared owner",
  );
  // Frozen pre-feature control2db64b5: identical base editor SHA11fdaf809f...,
  // asset SHA11adf42ea9..., lock SHA08d3add3f7...; full proof retained in ledger.
  // Shared legacy code receives no exclusive credit. Bound only measured growth.
  const libraryRaw = Math.max(0, library.contents.length - 7942);
  const libraryGzip = Math.max(0, gzip(library.contents) - 2874);
  const reader = resolveBundleModuleAsset(
    assets,
    manifest,
    root + "pages/tasks/detail.tsx",
  );
  const [actions] = resolveExclusiveBundleAssets(
    assets,
    manifest,
    [root + "components/studio/project-reuse-actions.tsx"],
    exclusiveModules,
  );
  const routes = [readerControl(reader, actions.fileName, assets)];
  const families = (
    [
      { name: "reuse", folder: "reusable-work-copy", fields: reuseFields },
      { name: "editor", folder: "extension-editor-copy", fields: editorFields },
    ] as const
  ).map((family) => {
    const packs = locales.map((locale) => {
      const module = `lib/${family.folder}/${family.name}-${locale}.ts`;
      const [asset] = resolveExclusiveBundleAssets(
        assets,
        manifest,
        [root + module],
        [root + module],
      );
      const text = asset.contents.toString("utf8"),
        source = parsed(asset.fileName, text);
      const object = copyObject(source, family.fields),
        compiled = values(object, family.fields);
      const authoredSource = parsed(
        module,
        readFileSync(path.join(sourceDirectory, module), "utf8"),
      );
      assert.deepEqual(
        compiled,
        values(copyObject(authoredSource, family.fields), family.fields),
        "Compiled copy differs from authored source",
      );
      // Both the data and wrapper are new when the entire authored runtime and
      // compiler output are exactly this one default export. Retain the wrapper
      // and unrelated statements in all other controls; ownership alone is not
      // enough to exempt old code. An absent chunk has zero transfer, not a gzip
      // encoding of an empty file.
      const contents = soleCopyExport(
        source,
        object,
        authoredSource,
        copyObject(authoredSource, family.fields),
      )
        ? Buffer.alloc(0)
        : Buffer.from(
            text.slice(0, object.getStart(source)) +
              "{}" +
              text.slice(object.end),
          );
      return {
        fileName: asset.fileName,
        contents,
        raw: asset.contents.length - contents.length,
        gzip: Math.max(0, gzip(asset.contents) - gzip(contents)),
        currentRaw: asset.contents.length,
        currentGzip: gzip(asset.contents),
      };
    });
    const selectedRaw = Math.max(...packs.map((pack) => pack.currentRaw)),
      selectedGzip = Math.max(...packs.map((pack) => pack.currentGzip));
    return {
      name: family.name,
      packs,
      selectedRaw,
      selectedGzip,
      allRaw: packs.reduce((n, pack) => n + pack.currentRaw, 0),
      allGzip: packs.reduce((n, pack) => n + pack.currentGzip, 0),
      globalRaw: Math.max(
        0,
        selectedRaw - Math.max(...packs.map((pack) => pack.contents.length)),
      ),
      globalGzip: Math.max(
        0,
        selectedGzip - Math.max(...packs.map((pack) => gzip(pack.contents))),
      ),
    };
  });
  const exclusiveRaw = exclusive.reduce(
      (n, asset) => n + asset.contents.length,
      0,
    ),
    exclusiveGzip = exclusive.reduce((n, asset) => n + gzip(asset.contents), 0);
  const metadataRaw = routes.reduce((n, route) => n + route.metadataRaw, 0),
    metadataGzip = routes.reduce((n, route) => n + route.metadataGzip, 0);
  const integrationRaw =
      routes.reduce((n, route) => n + route.raw, 0) - metadataRaw,
    integrationGzip =
      routes.reduce((n, route) => n + route.gzip, 0) - metadataGzip;
  const commonRaw = exclusiveRaw + libraryRaw + integrationRaw + metadataRaw,
    commonGzip = exclusiveGzip + libraryGzip + integrationGzip + metadataGzip;
  const raw =
    commonRaw + families.reduce((n, family) => n + family.selectedRaw, 0);
  const compressed =
    commonGzip + families.reduce((n, family) => n + family.selectedGzip, 0);
  // Original source-identified measurement: selected29260raw/10400gzip,
  // exclusive12808/5337, legacy-editor growth10142/2663, exact reader188/59.
  // Later measured sole-reader metadata152raw/57gzip has its own180/80 cap;
  // verified sole-copy export wrappers receive only their actual new bytes.
  // Separate caps retain every older aggregate, route, vendor and media limit.
  assert.ok(
    exclusiveRaw <= 14000 && exclusiveGzip <= 6000,
    "Exclusive reusable-work code exceeds its independent cap",
  );
  assert.ok(
    libraryRaw <= 11000 && libraryGzip <= 3000,
    "Legacy-editor growth exceeds its independent cap",
  );
  assert.ok(
    integrationRaw <= 250 && integrationGzip <= 125,
    "Exact reuse wiring exceeds its independent cap",
  );
  assert.ok(
    metadataRaw <= 180 && metadataGzip <= 80,
    "Sole reuse preload metadata exceeds its independent cap",
  );
  for (const family of families)
    assert.ok(
      family.allRaw <= (family.name === "reuse" ? 14000 : 18000) &&
        family.allGzip <= (family.name === "reuse" ? 7000 : 9000),
      "Reusable-work language family exceeds its independent disk cap",
    );
  assert.ok(
    raw <= 32000 && compressed <= 11500,
    "Selected reusable-work transfer exceeds its independent cap",
  );
  return {
    exclusive,
    exclusiveRaw,
    exclusiveGzip,
    families,
    libraryRaw,
    libraryGzip,
    integrationRaw,
    integrationGzip,
    metadataRaw,
    metadataGzip,
    routes,
    raw,
    gzip: compressed,
    globalRaw:
      commonRaw + families.reduce((n, family) => n + family.globalRaw, 0),
    globalGzip:
      commonGzip + families.reduce((n, family) => n + family.globalGzip, 0),
  };
}
