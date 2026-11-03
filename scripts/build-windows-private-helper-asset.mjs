/** Package the reviewed asset; never compile or download on an end-user host. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../artifacts/api-server/node_modules/esbuild/lib/main.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = path.join(root, "lib/ai-server/native/windows-private-helper.c");
const executable = path.join(
  root,
  "lib/ai-server/src/windows-private-helper.exe",
);
const notice = path.join(
  root,
  "deploy/native-attribution/WINDOWS-PRIVATE-HELPER-NOTICE.txt",
);
const provenance = path.join(
  root,
  "lib/ai-server/native/windows-private-helper-provenance.json",
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function readExecutableSnapshot(manifest) {
  const handle = await open(
    executable,
    process.platform === "win32"
      ? constants.O_RDONLY
      : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const metadata = await handle.stat({ bigint: true });
    if (
      !metadata.isFile() ||
      metadata.size !== BigInt(manifest.bytes) ||
      metadata.size <= 0n ||
      metadata.size > 1024n * 1024n
    )
      throw new Error("Invalid Windows private checker asset");
    const bytes = Buffer.alloc(manifest.bytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const chunk = await handle.read(
        bytes,
        length,
        bytes.length - length,
        length,
      );
      if (!chunk.bytesRead) break;
      length += chunk.bytesRead;
    }
    const unchanged = (other) =>
      other.isFile() &&
      !other.isSymbolicLink() &&
      other.dev === metadata.dev &&
      other.ino === metadata.ino &&
      other.size === metadata.size &&
      other.mtimeNs === metadata.mtimeNs &&
      other.ctimeNs === metadata.ctimeNs;
    const actual = await realpath(executable);
    if (
      length !== manifest.bytes ||
      !unchanged(await handle.stat({ bigint: true })) ||
      !unchanged(await lstat(executable, { bigint: true })) ||
      (process.platform === "win32" ? actual.toLowerCase() : actual) !==
        (process.platform === "win32" ? executable.toLowerCase() : executable)
    )
      throw new Error("Windows private checker changed while being read");
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

export async function copyWindowsPrivateHelper(destination) {
  // Load the same immutable manifest the runtime bundles, without a TS runtime
  // dependency in the distribution or a separately maintained digest list.
  const result = await build({
    entryPoints: [
      path.join(root, "lib/ai-server/src/windows-private-helper-manifest.ts"),
    ],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const { WINDOWS_PRIVATE_HELPER: manifest } = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`
  );
  const bytes = await readExecutableSnapshot(manifest);
  const noticeBytes = await readFile(notice);
  const provenanceBytes = await readFile(provenance);
  const record = JSON.parse(provenanceBytes.toString("utf8"));
  if (
    manifest.protocol !== 1 ||
    manifest.target !== "win32-x64" ||
    bytes.length !== manifest.bytes ||
    digest(bytes) !== manifest.sha256 ||
    digest(await readFile(source)) !== manifest.sourceSha256 ||
    digest(noticeBytes) !== manifest.noticeSha256 ||
    digest(provenanceBytes) !== manifest.buildProvenanceSha256 ||
    record.schema !==
      "agentic-company-os/windows-private-helper-pinned-provenance@1" ||
    record.sourceSha256 !== manifest.sourceSha256 ||
    record.executableSha256 !== manifest.sha256 ||
    record.executableBytes !== manifest.bytes ||
    record.producer?.originalImmutableComponentAccepted !== true ||
    record.producer?.attempt !== 1
  )
    throw new Error(
      "Windows private checker source or asset differs from its pinned manifest",
    );
  const target = path.join(destination, "windows-private-helper.exe");
  await writeFile(target, bytes);
  if (digest(await readFile(target)) !== manifest.sha256)
    throw new Error(
      "Copied Windows private checker differs from its pinned manifest",
    );
  const noticeTarget = path.join(
    destination,
    "windows-private-helper-NOTICE.txt",
  );
  await writeFile(noticeTarget, noticeBytes);
  if (digest(await readFile(noticeTarget)) !== manifest.noticeSha256)
    throw new Error(
      "Copied Windows private checker notice differs from its pinned manifest",
    );
  const provenanceTarget = path.join(
    destination,
    "windows-private-helper.provenance.json",
  );
  await writeFile(provenanceTarget, provenanceBytes);
  if (
    digest(await readFile(provenanceTarget)) !== manifest.buildProvenanceSha256
  )
    throw new Error(
      "Copied Windows private checker provenance differs from its pinned manifest",
    );
}
