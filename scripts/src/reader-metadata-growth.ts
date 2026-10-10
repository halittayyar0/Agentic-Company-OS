import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
/** Existing source and compiled runtime must remain identical to the frozen
 * control. Only generated asset hashes and preload indexes may differ. */
export function measureReaderMetadataGrowth(
  contents: Buffer,
  source: string,
  control: {
    sourceSha: string;
    bodySha: string;
    consumers: number;
    raw: number;
    gzip: number;
    rawCap: number;
    gzipCap: number;
  },
) {
  assert.equal(
    hash(source.replace(/\r\n/gu, "\n")),
    control.sourceSha,
    "Existing reader source changed",
  );
  const text = contents.toString("utf8"),
    newline = text.indexOf("\n"),
    header = text.slice(0, newline);
  const prefix = "const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=",
    suffix = ")))=>i.map(i=>d[i]);";
  assert.ok(
    newline > 0 && header.startsWith(prefix) && header.endsWith(suffix),
    "Unknown reader metadata header",
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
          /^assets\/[\w.$-]+\.(?:js|css)$/u.test(name),
      ),
    "Unsafe reader metadata paths",
  );
  const body = text.slice(newline + 1),
    calls = [...body.matchAll(/__vite__mapDeps\(\[([\d,]+)\]\)/gu)];
  assert.equal(
    calls.length,
    control.consumers,
    "Reader preload consumer count changed",
  );
  assert.ok(
    calls.every((call) =>
      call[1]
        .split(",")
        .every((index) => /^\d+$/u.test(index) && Number(index) < paths.length),
    ),
    "Unknown reader preload indexes",
  );
  const normalized = body
    .replace(/-[A-Za-z0-9_-]{8}\.(js|css)/gu, "-HASH.$1")
    .replace(/__vite__mapDeps\(\[[\d,]+\]\)/gu, "__vite__mapDeps([])");
  assert.equal(
    hash(normalized),
    control.bodySha,
    "Existing reader runtime changed",
  );
  const raw = Math.max(0, contents.length - control.raw),
    gzip = Math.max(0, gzipSync(contents, { level: 9 }).length - control.gzip);
  assert.ok(
    raw <= control.rawCap && gzip <= control.gzipCap,
    "Reader metadata growth exceeds its independent cap",
  );
  return { raw, gzip };
}
