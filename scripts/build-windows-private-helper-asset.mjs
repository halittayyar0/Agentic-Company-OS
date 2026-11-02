/** Package the reviewed asset; never compile or download on an end-user host. */
import { createHash } from "node:crypto";
import { copyFile, lstat, readFile, realpath } from "node:fs/promises";
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
  const metadata = await lstat(executable);
  const bytes = await readFile(executable);
  const provenanceBytes = await readFile(provenance);
  const record = JSON.parse(provenanceBytes.toString("utf8"));
  if (
    manifest.protocol !== 1 ||
    manifest.target !== "win32-x64" ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (process.platform === "win32"
      ? (await realpath(executable)).toLowerCase()
      : await realpath(executable)) !==
      (process.platform === "win32" ? executable.toLowerCase() : executable) ||
    metadata.size !== manifest.bytes ||
    bytes.length !== manifest.bytes ||
    digest(bytes) !== manifest.sha256 ||
    digest(await readFile(source)) !== manifest.sourceSha256 ||
    digest(await readFile(notice)) !== manifest.noticeSha256 ||
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
  await copyFile(executable, target);
  if (digest(await readFile(target)) !== manifest.sha256)
    throw new Error(
      "Copied Windows private checker differs from its pinned manifest",
    );
  const noticeTarget = path.join(
    destination,
    "windows-private-helper-NOTICE.txt",
  );
  await copyFile(notice, noticeTarget);
  if (digest(await readFile(noticeTarget)) !== manifest.noticeSha256)
    throw new Error(
      "Copied Windows private checker notice differs from its pinned manifest",
    );
  const provenanceTarget = path.join(
    destination,
    "windows-private-helper.provenance.json",
  );
  await copyFile(provenance, provenanceTarget);
  if (
    digest(await readFile(provenanceTarget)) !== manifest.buildProvenanceSha256
  )
    throw new Error(
      "Copied Windows private checker provenance differs from its pinned manifest",
    );
}
