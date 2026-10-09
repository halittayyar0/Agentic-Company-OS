import { gzipSync } from "node:zlib";
interface Asset {
  fileName: string;
  contents: Buffer;
}
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const gzip = (asset: Asset) => gzipSync(asset.contents, { level: 9 }).length;
/** The user-requested in-place connection flow is loaded on demand. Charge
 * its three exclusive UI/transport chunks plus the largest selected pack;
 * bound all seven authored packs on disk independently. No entry, existing
 * notice, Settings, generated SDK, vendor or CSS growth receives credit.
 * Existing numeric base/total/route budgets stay unchanged. */
export function measureConnectionBundle(assets: readonly Asset[]) {
  const one = (prefix: string) => {
    const matches = assets.filter(
      (a) => a.fileName.startsWith(`${prefix}-`) && a.fileName.endsWith(".js"),
    );
    if (matches.length !== 1)
      throw new Error(`Connection requires one exclusive ${prefix} asset`);
    return matches[0];
  };
  const logic = [
    "guided-model-connection",
    "guided-chatgpt-connection",
    "model-connection-launcher",
  ].map(one);
  const packs = locales.map((locale) => one(`connection-${locale}`));
  const raw =
    logic.reduce((sum, a) => sum + a.contents.length, 0) +
    Math.max(...packs.map((a) => a.contents.length));
  const compressed =
    logic.reduce((sum, a) => sum + gzip(a), 0) + Math.max(...packs.map(gzip));
  const allLocaleRaw = packs.reduce((sum, a) => sum + a.contents.length, 0),
    allLocaleGzip = packs.reduce((sum, a) => sum + gzip(a), 0);
  if (
    raw > 28000 ||
    compressed > 10500 ||
    allLocaleRaw > 40000 ||
    allLocaleGzip > 16000
  )
    throw new Error("Guided connection exceeds its independent feature budget");
  return { raw, gzip: compressed, allLocaleRaw, allLocaleGzip };
}
