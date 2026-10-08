import { gzipSync } from "node:zlib";

interface Asset {
  fileName: string;
  contents: Buffer;
}
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const literal = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')`;
const keys = [
  "tokensAtLeast",
  "tokenUsageUnknown",
  "tokenCoveragePartial",
  "noRecordedUsage",
];
const block = new RegExp(
  keys.map((key) => `${key}:${literal},`).join(""),
  "gu",
);
const gzip = (bytes: Buffer) => gzipSync(bytes, { level: 9 }).length;

/** Charge only the approved reporting disclosure, not arbitrary route growth.
 * Existing total/language ceilings stay unchanged. The aabb02e Task3 production
 * build recorded its shared stream asset at 18.91 KB raw / 6.5 KiB gzip (level9).
 * Lower rounded bounds of 18900/6600 are conservative; the independent feature
 * cap is 1500 raw / 600 gzip. Locale credits reconstruct the same built chunks
 * with only the four added fields removed, capped separately at 4 KB / 1.5 KB. */
export function measureUsageReportingBundleGrowth(assets: readonly Asset[]) {
  const shared = assets.filter((asset) =>
    /^use-operations-stream-[^/]+\.js$/u.test(asset.fileName),
  );
  if (shared.length !== 1)
    throw new Error("Usage reporting requires one shared Operations surface");
  let allLocaleRaw = 0,
    allLocaleGzip = 0,
    currentMaxRaw = 0,
    controlMaxRaw = 0,
    currentMaxGzip = 0,
    controlMaxGzip = 0;
  for (const locale of locales) {
    const matches = assets.filter(
      (asset) =>
        asset.fileName.startsWith(`operations-${locale}-`) &&
        asset.fileName.endsWith(".js"),
    );
    if (matches.length !== 1)
      throw new Error("Usage reporting requires one pack per locale");
    const asset = matches[0],
      text = asset.contents.toString("utf8"),
      blocks = [...text.matchAll(block)];
    if (blocks.length !== 1)
      throw new Error("Usage reporting field block cannot be verified");
    const control = Buffer.from(
      text.slice(0, blocks[0].index) +
        text.slice(blocks[0].index + blocks[0][0].length),
    );
    const currentGzip = gzip(asset.contents),
      controlGzip = gzip(control);
    allLocaleRaw += asset.contents.length - control.length;
    allLocaleGzip += Math.max(0, currentGzip - controlGzip);
    currentMaxRaw = Math.max(currentMaxRaw, asset.contents.length);
    controlMaxRaw = Math.max(controlMaxRaw, control.length);
    currentMaxGzip = Math.max(currentMaxGzip, currentGzip);
    controlMaxGzip = Math.max(controlMaxGzip, controlGzip);
  }
  const raw =
    Math.max(0, shared[0].contents.length - 18900) +
    Math.max(0, currentMaxRaw - controlMaxRaw);
  const compressed =
    Math.max(0, gzip(shared[0].contents) - 6600) +
    Math.max(0, currentMaxGzip - controlMaxGzip);
  if (
    raw > 1500 ||
    compressed > 600 ||
    allLocaleRaw > 4000 ||
    allLocaleGzip > 1500
  )
    throw new Error("Usage reporting exceeds its independent feature budget");
  return { raw, gzip: compressed, allLocaleRaw, allLocaleGzip };
}
