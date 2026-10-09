import { gzipSync } from "node:zlib";
interface Asset {
  fileName: string;
  contents: Buffer;
}
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const gzip = (contents: Buffer) => gzipSync(contents, { level: 9 }).length;
const identifier = String.raw`[A-Za-z_$][\w$]*`;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Exclusive lazy panel + largest selected pack: 8 KB raw / 3.5 KB gzip.
 * All seven packs: 11 KB / 6 KB on disk. Exact lazy declarations and JSX
 * mounts: at most 1 KB / 500 bytes across both readers. Remove those exact
 * fragments before measuring older overlapping recovery/Keeper features.
 * The agent reader's sole new preload table is also wiring; verify its five
 * panel/shell paths and that it has no other consumer before removing it.
 * Project dependency arrays, unrelated route code, shared SDK, CSS and vendor
 * code earn no credit. Existing base, total and route ceilings stay fixed.
 * Unknown compiler shapes fail closed, rather than crediting whole routes. */
export function measureInferenceAccountingBundle(assets: readonly Asset[]) {
  const one = (prefix: string) => {
    const matches = assets.filter(
      (a) => a.fileName.startsWith(`${prefix}-`) && a.fileName.endsWith(".js"),
    );
    if (matches.length !== 1) throw new Error(`Expected one ${prefix} asset`);
    return matches[0];
  };
  const logic = one("inference-accounting-panel");
  const packs = locales.map((locale) => one(`inference-copy-${locale}`));
  const readers = assets.filter(
    (a) =>
      /^detail-[^/]+\.js$/u.test(a.fileName) &&
      a.contents.includes('import("./inference-accounting-panel-'),
  );
  if (readers.length !== 2)
    throw new Error("Expected two inference accounting readers");
  const scopes = new Set<string>();
  const routes = readers.map((asset) => {
    const text = asset.contents.toString("utf8");
    const declaration = new RegExp(
      String.raw`(?<binding>${identifier})=(?<react>${identifier})\.lazy\(\(\)=>${identifier}\(\(\)=>import\("\./inference-accounting-panel-[^"/]+\.js"\),__vite__mapDeps\(\[[\d,]+\]\)\)\)`,
      "gu",
    );
    const declarations = [...text.matchAll(declaration)];
    if (declarations.length !== 1)
      throw new Error("Accounting lazy declaration cannot be verified");
    const { binding, react } = declarations[0].groups!;
    const mount = new RegExp(
      String.raw`(?<jsx>${identifier})\.jsx\(${escape(react)}\.Suspense,\{fallback:null,children:\k<jsx>\.jsx\(${escape(binding)},\{scopeType:"(?<scope>task|agent)",scopeId:(?<id>${identifier})\},\k<id>\)\}\)`,
      "gu",
    );
    const mounts = [...text.matchAll(mount)];
    if (mounts.length !== 1 || scopes.has(mounts[0].groups!.scope))
      throw new Error("Accounting reader mount cannot be verified");
    scopes.add(mounts[0].groups!.scope);
    let control = text
      .replace(mount, "null")
      .replace(declaration, `${binding}=null`);
    if (mounts[0].groups!.scope === "agent") {
      const prefix = "const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=";
      const suffix = ")))=>i.map(i=>d[i]);";
      const header = control.slice(0, control.indexOf("\n"));
      if (!header.startsWith(prefix) || !header.endsWith(suffix))
        throw new Error("Accounting agent preload metadata cannot be verified");
      const paths: unknown = JSON.parse(
        header.slice(prefix.length, -suffix.length),
      );
      if (
        !Array.isArray(paths) ||
        paths.length !== 5 ||
        new Set(paths).size !== 5 ||
        paths[0] !== `assets/${logic.fileName}` ||
        ![
          /^assets\/vendor-core-[^/]+\.js$/u,
          /^assets\/index-[^/]+\.js$/u,
          /^assets\/vendor-ui-[^/]+\.js$/u,
          /^assets\/index-[^/]+\.css$/u,
        ].every(
          (pattern) =>
            paths.filter(
              (path) => typeof path === "string" && pattern.test(path),
            ).length === 1,
        )
      )
        throw new Error("Accounting agent preload paths cannot be verified");
      control = control.slice(header.length + 1);
      if (control.includes("__vite__mapDeps"))
        throw new Error(
          "Accounting cannot credit preload metadata shared with other readers",
        );
    }
    const contents = Buffer.from(control);
    return {
      fileName: asset.fileName,
      contents,
      raw: asset.contents.length - contents.length,
      gzip: Math.max(0, gzip(asset.contents) - gzip(contents)),
    };
  });
  const integrationRaw = routes.reduce((n, r) => n + r.raw, 0),
    integrationGzip = routes.reduce((n, r) => n + r.gzip, 0);
  if (integrationRaw > 1000 || integrationGzip > 500)
    throw new Error("Accounting reader wiring exceeds its independent cap");
  const raw =
    logic.contents.length +
    Math.max(...packs.map((a) => a.contents.length)) +
    integrationRaw;
  const compressed =
    gzip(logic.contents) +
    Math.max(...packs.map((a) => gzip(a.contents))) +
    integrationGzip;
  const allLocaleRaw = packs.reduce((n, a) => n + a.contents.length, 0),
    allLocaleGzip = packs.reduce((n, a) => n + gzip(a.contents), 0);
  if (
    raw > 8000 ||
    compressed > 3500 ||
    allLocaleRaw > 11000 ||
    allLocaleGzip > 6000
  )
    throw new Error(
      "Inference accounting exceeds its independent feature budget",
    );
  return {
    raw,
    gzip: compressed,
    integrationRaw,
    integrationGzip,
    allLocaleRaw,
    allLocaleGzip,
    routes,
  };
}
