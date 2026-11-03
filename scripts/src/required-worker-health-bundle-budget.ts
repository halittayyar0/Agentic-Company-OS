import { gzipSync } from "node:zlib";

interface Asset {
  fileName: string;
  contents: Buffer;
}

const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const field = /\bcapacityDeficitTruth:"(?:\\.|[^"\\])*",/gu;
const gzip = (value: Buffer) => gzipSync(value, { level: 9 }).length;

/** Only the new ready/required label receives this independent allowance.
 * Reconstruct the same built packs with that one field removed, then pass
 * those controls to older accounting so compressed bytes are never credited
 * twice. Other fields, shared code and vendors receive no allowance here. */
export function measureRequiredWorkerHealthCopy(assets: readonly Asset[]) {
  const controls = [...assets];
  const currentPacks: Buffer[] = [],
    controlPacks: Buffer[] = [];
  let allRaw = 0,
    allGzip = 0;
  for (const locale of locales) {
    const matches = assets.filter(
      (asset) =>
        asset.fileName.startsWith(`operations-${locale}-`) &&
        asset.fileName.endsWith(".js"),
    );
    if (matches.length !== 1)
      throw new Error("Worker health copy requires one pack per locale");
    const asset = matches[0],
      text = asset.contents.toString("utf8");
    const fields = [...text.matchAll(field)];
    if (
      fields.length !== 1 ||
      [...fields[0][0].matchAll(/\{(\w+)\}/gu)]
        .map((match) => match[1])
        .sort()
        .join(",") !== "ready,required"
    ) {
      throw new Error("Worker health copy field cannot be verified");
    }
    const match = fields[0];
    const contents = Buffer.from(
      text.slice(0, match.index) + text.slice(match.index + match[0].length),
    );
    const raw = asset.contents.length - contents.length;
    const compressed = Math.max(0, gzip(asset.contents) - gzip(contents));
    if (raw > 160 || compressed > 96)
      throw new Error("Worker health copy exceeds its per-pack budget");
    allRaw += raw;
    allGzip += compressed;
    currentPacks.push(asset.contents);
    controlPacks.push(contents);
    controls[assets.indexOf(asset)] = { ...asset, contents };
  }
  const raw =
    Math.max(...currentPacks.map((pack) => pack.length)) -
    Math.max(...controlPacks.map((pack) => pack.length));
  const compressed = Math.max(
    0,
    Math.max(...currentPacks.map(gzip)) - Math.max(...controlPacks.map(gzip)),
  );
  if (raw > 160 || compressed > 96 || allRaw > 960 || allGzip > 480)
    throw new Error("Worker health copy exceeds its independent budget");
  return { raw, gzip: compressed, allRaw, allGzip, controls };
}
