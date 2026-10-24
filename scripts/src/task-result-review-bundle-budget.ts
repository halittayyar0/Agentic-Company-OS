import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import ts from "typescript";
import {
  resolveBundleModuleAsset,
  resolveExclusiveBundleAssets,
  type BundleAsset,
} from "./bundle-source-map";
const root = "artifacts/agentic-company-os/src/";
const sources = [
  "components/tasks/operator-result-review.tsx",
  "components/tasks/operator-result-provenance.tsx",
  "lib/task-result-review-input.ts",
  "lib/task-result-review-copy.ts",
].map((file) => root + file);
const gzip = (asset: BundleAsset) =>
  gzipSync(asset.contents, { level: 9 }).length;
/** Dedicated new sources and separately reconstructed new GET/AST integration
 * fragments receive credit. Shared table/Markdown/auth/vendor code and every
 * pre-existing adjacent API, route and export byte keep their original budgets.
 * All module ownership and hashes are compiler-verified. */
export function measureTaskResultReviewBundle(
  assets: readonly BundleAsset[],
  manifest: unknown,
  integration: { raw: number; gzip: number } = { raw: 0, gzip: 0 },
) {
  const logic = resolveExclusiveBundleAssets(
    assets,
    manifest,
    sources,
    sources,
  );
  const packs = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"].map(
    (locale) => {
      const own = [
        root + `lib/task-result-review-copy/result-review-${locale}.ts`,
      ];
      const matches = resolveExclusiveBundleAssets(assets, manifest, own, own);
      assert.equal(matches.length, 1);
      assert.ok(
        matches[0].contents.length <= 4000 && gzip(matches[0]) <= 2000,
        "Result review selected language exceeds its independent cap",
      );
      return matches[0];
    },
  );
  assert.equal(new Set(packs.map((p) => p.fileName)).size, 7);
  const exclusiveLogicRaw = logic.reduce((n, a) => n + a.contents.length, 0),
    exclusiveLogicGzip = logic.reduce((n, a) => n + gzip(a), 0);
  const logicRaw = exclusiveLogicRaw + integration.raw,
    logicGzip = exclusiveLogicGzip + integration.gzip;
  const allLocaleRaw = packs.reduce((n, a) => n + a.contents.length, 0),
    allLocaleGzip = packs.reduce((n, a) => n + gzip(a), 0);
  const raw = logicRaw + Math.max(...packs.map((a) => a.contents.length)),
    compressed = logicGzip + Math.max(...packs.map(gzip));
  const globalRaw = logicRaw + allLocaleRaw,
    globalGzip = logicGzip + allLocaleGzip;
  assert.ok(
    exclusiveLogicRaw <= 11000 &&
      exclusiveLogicGzip <= 4500 &&
      raw <= 15000 &&
      compressed <= 6500 &&
      allLocaleRaw <= 24000 &&
      allLocaleGzip <= 12000 &&
      globalRaw <= 35000 &&
      globalGzip <= 16500,
    "Operator result review exceeds its independent budget",
  );
  return { raw, gzip: compressed, globalRaw, globalGzip, packs };
}

/** Reconstruct only the newly generated GET URL and GET wrapper. Adjacent
 * legacy API functions, export metadata and all pre-existing bytes remain. */
export function resultReviewApiControl(asset: BundleAsset) {
  const text = asset.contents.toString("utf8"),
    source = ts.createSourceFile(
      asset.fileName,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
  const declarations: ts.VariableDeclaration[] = [],
    exports: ts.ExportSpecifier[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    if (ts.isExportSpecifier(node)) exports.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const urls = declarations.filter((node) =>
    node.initializer?.getText(source).includes("/result-review"),
  );
  assert.equal(urls.length, 1, "Expected one generated result review URL");
  const url = urls[0],
    id = "[$A-Z_a-z][$\\w]*";
  assert.match(
    url.initializer!.getText(source),
    new RegExp(
      "^" + id + "=>`/api/approvals/\\$\\{" + id + "\\}/result-review`$",
      "u",
    ),
  );
  assert.ok(
    ts.isIdentifier(url.name) && ts.isVariableDeclarationList(url.parent),
  );
  const escaped = url.name.text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const calls = declarations.filter(
    (node) =>
      node.initializer &&
      new RegExp(
        "^async\\((?<arg>" +
          id +
          "),(?<options>" +
          id +
          ")\\)=>" +
          id +
          "\\(" +
          escaped +
          '\\(\\k<arg>\\),\\{\\.\\.\\.\\k<options>,method:"GET"\\}\\)$',
        "u",
      ).test(node.initializer.getText(source)),
  );
  assert.equal(
    calls.length,
    1,
    "Expected the exact generated result review GET wrapper",
  );
  const call = calls[0];
  assert.equal(call.parent, url.parent);
  const list = Array.from(url.parent.declarations),
    index = list.indexOf(url);
  assert.equal(
    list[index + 1],
    call,
    "Generated review bindings must be adjacent",
  );
  assert.ok(list.length > 2, "Never remove another API declaration");
  const start = index === 0 ? url.getStart(source) : url.getStart(source) - 1;
  const end = call.end + (index === 0 ? 1 : 0);
  assert.equal(text[index === 0 ? call.end : url.getStart(source) - 1], ",");
  assert.ok(ts.isIdentifier(call.name));
  const exported = exports.filter(
    (node) =>
      (node.propertyName ?? node.name).text === call.name.getText(source),
  );
  assert.equal(exported.length, 1, "Expected one new GET export binding");
  const spec = exported[0],
    specs = Array.from(spec.parent.elements),
    position = specs.indexOf(spec);
  assert.ok(specs.length > 1, "Never remove an existing export list");
  const exportStart =
      position === 0 ? spec.getStart(source) : spec.getStart(source) - 1,
    exportEnd = spec.end + (position === 0 ? 1 : 0);
  assert.equal(
    text[position === 0 ? spec.end : spec.getStart(source) - 1],
    ",",
  );
  const parts = [
    { start, end },
    { start: exportStart, end: exportEnd },
  ].sort((a, b) => b.start - a.start);
  let control = text,
    boundary = text.length;
  for (const part of parts) {
    assert.ok(part.end <= boundary);
    control = control.slice(0, part.start) + control.slice(part.end);
    boundary = part.start;
  }
  const contents = Buffer.from(control),
    raw = asset.contents.length - contents.length;
  const compressed = Math.max(
    0,
    gzip(asset) - gzip({ fileName: asset.fileName, contents }),
  );
  assert.ok(
    raw > 0 && raw <= 300 && compressed <= 200,
    "New review API integration exceeds its independent cap",
  );
  return { fileName: asset.fileName, contents, raw, gzip: compressed };
}
export function measureResultReviewApi(
  assets: readonly BundleAsset[],
  manifest: unknown,
  preceding: readonly BundleAsset[],
) {
  const owner = resolveBundleModuleAsset(
    assets,
    manifest,
    "lib/api-client-react/src/generated/api.ts",
  );
  const control = preceding.filter(
    (asset) => asset.fileName === owner.fileName,
  );
  assert.equal(control.length, 1);
  return resultReviewApiControl(control[0]);
}

/** New mounts/states only; never strip an existing route or component body. */
export function resultReviewRouteControl(
  asset: BundleAsset,
  logicName: string,
  panel = false,
) {
  const text = asset.contents.toString("utf8"),
    source = ts.createSourceFile(
      asset.fileName,
      text,
      ts.ScriptTarget.Latest,
      true,
    ),
    nodes: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const parts: { start: number; end: number; replacement: string }[] = [];
  const only = <T>(values: T[]) => {
    assert.equal(values.length, 1, "Ambiguous new result review integration");
    return values[0];
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
  const removeDeclaration = (node: ts.VariableDeclaration) => {
    assert.ok(ts.isVariableDeclarationList(node.parent));
    if (node.parent.declarations.length === 1) {
      assert.ok(ts.isVariableStatement(node.parent.parent));
      parts.push({
        start: node.parent.parent.getStart(source),
        end: node.parent.parent.end,
        replacement: "",
      });
    } else if (text[node.getStart(source) - 1] === ",")
      parts.push({
        start: node.getStart(source) - 1,
        end: node.end,
        replacement: "",
      });
    else {
      assert.equal(text[node.end], ",");
      parts.push({
        start: node.getStart(source),
        end: node.end + 1,
        replacement: "",
      });
    }
  };
  removeDeclaration(lazy);
  const binding = lazy.name.text;
  if (!panel) {
    const mount = only(
      nodes
        .filter(ts.isConditionalExpression)
        .filter(
          (node) =>
            /^[\w$]+===[\w$]+\.id$/u.test(node.condition.getText(source)) &&
            node.whenTrue
              .getText(source)
              .includes(".jsx(" + binding + ",{approval:"),
        ),
    );
    const opening = mount.condition.getText(source).split("===")[0];
    let top: ts.Node = mount;
    while (
      ts.isParenthesizedExpression(top.parent) ||
      (ts.isBinaryExpression(top.parent) &&
        top.parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
    )
      top = top.parent;
    assert.match(
      top.getText(source),
      /^[\w$]+&&[\w$]+\.status==="pending"&&\(/u,
    );
    assert.ok(
      mount.whenTrue.getText(source).includes("onBusyChange:") &&
        mount.whenTrue.getText(source).includes("onRefresh:") &&
        mount.whenTrue.getText(source).includes("onResolved:") &&
        mount.whenFalse.getText(source).includes(".reviewResult"),
    );
    parts.push({
      start: top.getStart(source),
      end: top.end,
      replacement: "null",
    });
    const state = (name: string) =>
      only(
        declarations.filter(
          (node) =>
            ts.isArrayBindingPattern(node.name) &&
            node.name.elements[0].getText(source) === name,
        ),
      );
    const opened = state(opening);
    assert.match(
      opened.initializer!.getText(source),
      /^[\w$]+\.useState\(null\)$/u,
    );
    removeDeclaration(opened);
    const message = only(
      nodes
        .filter(ts.isBinaryExpression)
        .filter(
          (node) =>
            ts.isIdentifier(node.left) &&
            node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
            node.right
              .getText(source)
              .includes(
                'role:"status",className:"rounded-xl border bg-card p-4",children:' +
                  node.left.getText(source) +
                  "}",
              ),
        ),
    );
    const messageState = state(message.left.getText(source));
    assert.match(
      messageState.initializer!.getText(source),
      /^[\w$]+\.useState\(null\)$/u,
    );
    removeDeclaration(messageState);
    parts.push({
      start: message.getStart(source),
      end: message.end,
      replacement: "null",
    });
    const marker = only(
      nodes
        .filter(ts.isFunctionDeclaration)
        .filter((node) =>
          /^\{return (?<arg>[\w$]+)\.scope\?\.toolName==="operator_confirm_task_result"\|\|\k<arg>\.resultReview!==void 0\}$/u.test(
            node.body?.getText(source) ?? "",
          ),
        ),
    );
    assert.equal(marker.parameters.length, 1);
    parts.push({
      start: marker.getStart(source),
      end: marker.end,
      replacement: "",
    });
  } else {
    const mount = only(
      nodes
        .filter(ts.isBinaryExpression)
        .filter(
          (node) =>
            node
              .getText(source)
              .includes('.completionAuthority==="operator"') &&
            ts.isCallExpression(node.right) &&
            node.right.getText(source).includes(".jsx(" + binding + ",{})"),
        ),
    );
    assert.match(
      mount.getText(source),
      /^[\w$]+\.completionAuthority==="operator"&&[\w$]+&&[\w$]+\.jsx\([\w$]+\.Suspense,\{fallback:null,children:[\w$]+\.jsx\([\w$]+,\{\}\)\}\)$/u,
    );
    parts.push({
      start: mount.getStart(source),
      end: mount.end,
      replacement: "null",
    });
  }
  const path = JSON.stringify("assets/" + logicName),
    matches = [
      ...text.matchAll(
        new RegExp(path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu"),
      ),
    ];
  assert.equal(matches.length, 1, "New review preload metadata must be unique");
  parts.push({
    start: matches[0].index!,
    end: matches[0].index! + path.length,
    replacement: '""',
  });
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
    compressed = Math.max(
      0,
      gzip(asset) - gzip({ fileName: asset.fileName, contents }),
    );
  assert.ok(
    raw > 0 &&
      raw <= (panel ? 500 : 2400) &&
      compressed <= (panel ? 250 : 1000),
    "New review route integration exceeds its independent cap",
  );
  return { raw, gzip: compressed, contents };
}

export function measureResultReviewIntegration(
  assets: readonly BundleAsset[],
  manifest: unknown,
) {
  const owner = (path: string) =>
    resolveBundleModuleAsset(assets, manifest, root + path);
  const routes = [
    resultReviewRouteControl(
      owner("pages/approvals.tsx"),
      owner("components/tasks/operator-result-review.tsx").fileName,
    ),
    resultReviewRouteControl(
      owner("components/studio/project-delivery-summary.tsx"),
      owner("components/tasks/operator-result-provenance.tsx").fileName,
      true,
    ),
  ];
  const labels = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"].map(
    (locale) => {
      const asset = owner(`lib/approval-copy/approval-${locale}.ts`),
        text = asset.contents.toString("utf8");
      const matches = [...text.matchAll(/reviewResult:"(?:[^"\\]|\\.)*",/gu)];
      assert.equal(
        matches.length,
        1,
        "Expected exactly the new result review entry label",
      );
      const m = matches[0],
        contents = Buffer.from(
          text.slice(0, m.index) + text.slice(m.index! + m[0].length),
        );
      const raw = asset.contents.length - contents.length,
        compressed = Math.max(
          0,
          gzip(asset) - gzip({ fileName: asset.fileName, contents }),
        );
      assert.ok(raw <= 120 && compressed <= 110);
      return { raw, gzip: compressed };
    },
  );
  const download = resultReviewDownloadControl(
    owner("components/studio/project-delivery-download.tsx"),
    owner("lib/task-result-review-copy.ts").fileName,
  );
  return [...routes, ...labels, download].reduce(
    (sum, row) => ({ raw: sum.raw + row.raw, gzip: sum.gzip + row.gzip }),
    { raw: 0, gzip: 0 },
  );
}

export function resultReviewDownloadControl(
  asset: BundleAsset,
  copyName: string,
) {
  const text = asset.contents.toString("utf8"),
    source = ts.createSourceFile(
      asset.fileName,
      text,
      ts.ScriptTarget.Latest,
      true,
    ),
    declarations: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const matches = declarations.filter((node) =>
    node.initializer
      ?.getText(source)
      .includes('queryKey:["task-result-review-copy"'),
  );
  assert.equal(
    matches.length,
    1,
    "Expected exactly the new provenance copy query",
  );
  const node = matches[0];
  assert.ok(
    ts.isCallExpression(node.initializer!) &&
      node.initializer.arguments.length === 1 &&
      ts.isObjectLiteralExpression(node.initializer.arguments[0]) &&
      ts.isVariableDeclarationList(node.parent),
  );
  const fields = node.initializer.arguments[0].properties;
  assert.deepEqual(
    fields.map((p) => p.name?.getText(source)),
    ["queryKey", "queryFn", "enabled", "staleTime", "retry"],
  );
  const values = fields.map((p) => {
    assert.ok(ts.isPropertyAssignment(p));
    return p.initializer.getText(source);
  });
  const locale = /^\["task-result-review-copy",([\w$]+)\]$/u.exec(values[0]);
  assert.ok(locale);
  assert.match(values[2], /^[\w$]+\.completionAuthority==="operator"$/u);
  assert.equal(values[3], "1/0");
  assert.equal(values[4], "!1");
  const escaped = copyName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
    id = "[$A-Z_a-z][$\\w]*";
  assert.match(
    values[1],
    new RegExp(
      "^async\\(\\)=>\\(await " +
        id +
        "\\(async\\(\\)=>\\{const\\{loadTaskResultReviewCopy:(?<load>" +
        id +
        ')\\}=await import\\("\\./' +
        escaped +
        '"\\);return\\{loadTaskResultReviewCopy:\\k<load>\\}\\},__vite__mapDeps\\(\\[[\\d,]+\\]\\)\\)\\)\\.loadTaskResultReviewCopy\\(' +
        locale[1] +
        "\\)$",
      "u",
    ),
  );
  let start = node.getStart(source),
    end = node.end;
  assert.ok(node.parent.declarations.length > 1);
  if (text[start - 1] === ",") start--;
  else {
    assert.equal(text[end], ",");
    end++;
  }
  const contents = Buffer.from(text.slice(0, start) + text.slice(end)),
    raw = asset.contents.length - contents.length,
    compressed = Math.max(
      0,
      gzip(asset) - gzip({ fileName: asset.fileName, contents }),
    );
  assert.ok(
    raw > 0 && raw <= 500 && compressed <= 250,
    "New provenance query exceeds its independent cap",
  );
  return { raw, gzip: compressed, contents };
}
