import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import ts from "typescript";
import {
  resolveBundleModuleAsset,
  type BundleAsset,
} from "./bundle-source-map";

export function measureBoundedAuthRead(
  assets: readonly BundleAsset[],
  manifest: unknown,
  preceding: readonly BundleAsset[] = [],
) {
  const entry = resolveBundleModuleAsset(
    assets,
    manifest,
    "artifacts/agentic-company-os/src/lib/auth.ts",
  );
  const source = ts.createSourceFile(
    entry.fileName,
    entry.contents.toString("utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const reads = source.statements
    .filter(ts.isFunctionDeclaration)
    .filter((node) => node.getText(source).includes('"/api/auth/status"'));
  assert.equal(reads.length, 1, "Unique owned authentication read required");
  const body = reads[0].getText(source);
  const match =
    /^async function ([\w$]+)\(([\w$]+)\)\{const ([\w$]+)=AbortSignal.timeout\(15e3\),([\w$]+)=\2\?AbortSignal.any\(\[\2,\3\]\):\3,([\w$]+)=await ([\w$]+)\("\/api\/auth\/status",\{signal:\4\}\);return \4.throwIfAborted\(\),([\w$]+)\(\5\),\5\}$/u.exec(
      body,
    );
  assert.ok(match, "Bounded authentication read shape changed");
  const queries: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer) &&
      node.getText(source).includes('queryKey:["auth-status"]')
    )
      queries.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(queries.length, 1, "Unique owned authentication query required");
  const query = queries[0].getText(source);
  const queryMatch =
    /^([\w$]+)=\{queryKey:\["auth-status"\],queryFn:\(\{signal:([\w$]+)\}\)=>([\w$]+)\(\2\),networkMode:"always",refetchOnReconnect:!0,retry:!1\}$/u.exec(
      query,
    );
  assert.ok(queryMatch, "Bounded authentication query shape changed");
  assert.equal(
    queryMatch[3],
    match[1],
    "Authentication query changed its read owner",
  );
  assert.ok(preceding.length <= 1, "Ambiguous authentication read predecessor");
  const input = preceding[0] ?? entry;
  assert.equal(input.fileName, entry.fileName, "Authentication owner changed");
  const text = input.contents.toString("utf8");
  assert.equal(
    text.split(body).length,
    2,
    "Prior controls changed the owned read",
  );
  assert.equal(
    text.split(query).length,
    2,
    "Prior controls changed the owned query",
  );
  // Reconstruct only the read before its deadline/cancellation additions. Keep
  // its parameter and every surrounding byte; login/logout and all other code
  // stay charged. Reconstruct this read and its connectivity options before
  // older composer accounting. The checker excludes the same measured growth
  // from Keeper/resume before applying ONE bounded global credit. No route,
  // language, vendor, media, mutation or duplicate feature credit.
  const replacement = `async function ${match[1]}(${match[2]}){const ${match[5]}=await ${match[6]}("/api/auth/status");return ${match[7]}(${match[5]}),${match[5]}}`;
  const contents = Buffer.from(
    text
      .replace(body, replacement)
      .replace(
        query,
        query.replace('networkMode:"always",refetchOnReconnect:!0,', ""),
      ),
  );
  const raw = input.contents.length - contents.length;
  const gzip = Math.max(
    0,
    gzipSync(input.contents, { level: 9 }).length -
      gzipSync(contents, { level: 9 }).length,
  );
  assert.ok(
    raw > 0 && raw <= 256 && gzip <= 128,
    "Authentication read allocation exceeds its independent cap",
  );
  return { control: { fileName: entry.fileName, contents }, raw, gzip };
}
