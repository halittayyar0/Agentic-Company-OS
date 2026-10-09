import { gzipSync } from "node:zlib";
interface Asset {
  fileName: string;
  contents: Buffer;
}
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const gzip = (asset: Asset) => gzipSync(asset.contents, { level: 9 }).length;
/** The new conditional recovery surface has its own 12 KB raw / 4.5 KB gzip
 * ceiling (final measured feature: 11,310 raw / 4,124 gzip bytes). Charge only its
 * exclusive chunk and largest selected language. Only the project detail
 * wiring gets raw credit, capped at 500 bytes against the aabb02e Task3 build's
 * conservative 120400-byte baseline (recorded 120.41 kB; only this feature's
 * lazy import, boundary and JSX were added to that route). No compressed route,
 * entry, generated API, vendor or CSS credit. All packs also have a disk cap.
 * Prior base and total transfer ceilings remain unchanged. */
export function measureCodingRecoveryBundle(assets: readonly Asset[]) {
  const logic = assets.filter((asset) =>
    /^coding-session-recovery-[^/]+\.js$/u.test(asset.fileName),
  );
  if (logic.length !== 1)
    throw new Error("Expected one coding recovery logic asset");
  const packs = locales.map((locale) => {
    const matches = assets.filter(
      (asset) =>
        asset.fileName.startsWith(`coding-recovery-${locale}-`) &&
        asset.fileName.endsWith(".js"),
    );
    if (matches.length !== 1)
      throw new Error("Expected one coding recovery asset per language");
    return matches[0];
  });
  const routes = assets.filter(
    (asset) =>
      /^detail-[^/]+\.js$/u.test(asset.fileName) &&
      asset.contents.includes("budget-task-resume-") &&
      asset.contents.includes("coding-session-recovery-"),
  );
  if (routes.length !== 1)
    throw new Error("Expected one measured project recovery integration route");
  const integrationRaw = Math.max(0, routes[0].contents.length - 120400);
  if (integrationRaw > 500)
    throw new Error("Coding recovery project wiring exceeds 500 raw bytes");
  const raw =
    integrationRaw +
    logic[0].contents.length +
    Math.max(...packs.map((asset) => asset.contents.length));
  const compressed = gzip(logic[0]) + Math.max(...packs.map(gzip));
  const allLocaleRaw = packs.reduce(
    (sum, asset) => sum + asset.contents.length,
    0,
  );
  const allLocaleGzip = packs.reduce((sum, asset) => sum + gzip(asset), 0);
  if (
    raw > 12000 ||
    compressed > 4500 ||
    allLocaleRaw > 18000 ||
    allLocaleGzip > 8000
  )
    throw new Error("Coding recovery exceeds its independent feature budget");
  return { raw, gzip: compressed, integrationRaw, allLocaleRaw, allLocaleGzip };
}
