import { gzipSync } from "node:zlib";
import {
  resolveBundleModuleAsset,
  resolveExclusiveBundleAssets,
} from "./bundle-source-map";
interface Asset {
  fileName: string;
  contents: Buffer;
}
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const gzip = (contents: Buffer) => gzipSync(contents, { level: 9 }).length;
const literal = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')`;
const field = new RegExp(`draftStorageError:${literal},`, "gu");
export function resolveComposerDraftScope(
  assets: readonly Asset[],
  manifest: unknown,
): { route: string; loader: string } {
  const sources = [
    "artifacts/agentic-company-os/src/pages/tasks/new.tsx",
    "artifacts/agentic-company-os/src/lib/new-project-copy.ts",
  ];
  resolveExclusiveBundleAssets(assets, manifest, sources, sources);
  return {
    route: resolveBundleModuleAsset(assets, manifest, sources[0]).fileName,
    loader: resolveBundleModuleAsset(assets, manifest, sources[1]).fileName,
  };
}
/** Only measured composer entry/project growth and two selected warning fields
 * receive credit. Control build uses HEAD
 * aabb02e's two composer consumers with current dependencies: project route
 * 12026 raw / 3986 gzip, entry 119318 / 35571. Entry growth is removed from
 * both Keeper integration and its overlap with resume before credits apply.
 * No vendor/CSS/API credit and no duplicate entry credit.
 * Independent limits: 5 KB raw / 2 KB gzip; project wiring 1200 / 500 bytes;
 * entry integration 3000 / 1200 bytes;
 * all fourteen warning additions 4 KB / 2 KB. Prior base totals stay fixed. */
export function measureComposerDraftBundle(
  assets: readonly Asset[],
  projectRouteFileName?: string,
  projectCopyLoaderFileName?: string,
) {
  const entries = assets.filter((asset) =>
    /^index-[^/]+\.js$/u.test(asset.fileName),
  );
  const routes = assets.filter(
    (asset) =>
      /^new-[^/]+\.js$/u.test(asset.fileName) &&
      (projectRouteFileName
        ? asset.fileName === projectRouteFileName
        : asset.contents.includes("new-project-en")) &&
      asset.contents.includes("cadenceSeconds"),
  );
  if (entries.length !== 1 || routes.length !== 1)
    throw new Error(
      "Draft bundle requires one entry and one project route asset",
    );
  const routeScope = [routes[0]];
  // Both names come from hash-validated compiler source ownership. The same
  // pre-existing loader was previously embedded in this route; count it once
  // when sharing splits it into a separate chunk. No new numeric allowance.
  if (
    projectCopyLoaderFileName &&
    projectCopyLoaderFileName !== routes[0].fileName
  ) {
    const loaders = assets.filter(
      (a) => a.fileName === projectCopyLoaderFileName,
    );
    if (loaders.length !== 1) throw new Error("Ambiguous project copy loader");
    routeScope.push(loaders[0]);
  }
  const integrationRaw = Math.max(
      0,
      routeScope.reduce((n, a) => n + a.contents.length, 0) - 12026,
    ),
    integrationGzip = Math.max(
      0,
      routeScope.reduce((n, a) => n + gzip(a.contents), 0) - 3986,
    );
  const entryRaw = Math.max(0, entries[0].contents.length - 119318),
    entryGzip = Math.max(0, gzip(entries[0].contents) - 35571);
  if (entryRaw > 3000 || entryGzip > 1200)
    throw new Error("Draft entry integration exceeds its independent cap");
  if (integrationRaw > 1200 || integrationGzip > 500)
    throw new Error("Draft project wiring exceeds its independent cap");
  let selectedRaw = 0,
    selectedGzip = 0,
    allLocaleRaw = 0,
    allLocaleGzip = 0;
  for (const prefix of ["", "new-project-"]) {
    let currentRaw = 0,
      controlRaw = 0,
      currentGzip = 0,
      controlGzip = 0;
    for (const locale of locales) {
      const matches = assets.filter(
        (asset) =>
          asset.fileName.startsWith(`${prefix}${locale}-`) &&
          asset.fileName.endsWith(".js"),
      );
      if (matches.length !== 1)
        throw new Error(
          "Draft bundle requires one pack per language and surface",
        );
      const asset = matches[0],
        text = asset.contents.toString("utf8"),
        fields = [...text.matchAll(field)];
      if (fields.length !== 1)
        throw new Error("Draft warning field cannot be verified");
      const control = Buffer.from(
        text.slice(0, fields[0].index) +
          text.slice(fields[0].index + fields[0][0].length),
      );
      const currentCompressed = gzip(asset.contents),
        controlCompressed = gzip(control);
      allLocaleRaw += asset.contents.length - control.length;
      allLocaleGzip += Math.max(0, currentCompressed - controlCompressed);
      currentRaw = Math.max(currentRaw, asset.contents.length);
      controlRaw = Math.max(controlRaw, control.length);
      currentGzip = Math.max(currentGzip, currentCompressed);
      controlGzip = Math.max(controlGzip, controlCompressed);
    }
    selectedRaw += Math.max(0, currentRaw - controlRaw);
    selectedGzip += Math.max(0, currentGzip - controlGzip);
  }
  const raw = entryRaw + integrationRaw + selectedRaw,
    compressed = entryGzip + integrationGzip + selectedGzip;
  if (
    raw > 5000 ||
    compressed > 2000 ||
    allLocaleRaw > 4000 ||
    allLocaleGzip > 2000
  )
    throw new Error("Composer draft exceeds its independent feature budget");
  return {
    raw,
    gzip: compressed,
    integrationRaw,
    integrationGzip,
    entryRaw,
    entryGzip,
    allLocaleRaw,
    allLocaleGzip,
  };
}
