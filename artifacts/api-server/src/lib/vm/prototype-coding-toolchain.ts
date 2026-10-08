// Separate, nonrelease admission. Original Codex archive/component pins remain
// untouched. Modified helpers require these exact observed bytes on fixed paths.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export const PROTOTYPE_OUTER =
  "d614afff26b5f4f2250f432876399dc95ed2e8c04dbf6dbece3a067d9c7cacb7";
export const PROTOTYPE_INNER =
  "9f5789651eb95860fe3242745513a177029983e7a208854529ae7dc23aaf0eb9";
const fail = () => new Error("prototype_coding_toolchain_identity_invalid");
const execute = promisify(execFile);
export async function verifyPrototypeCodingToolchain() {
  if (process.platform !== "linux" || process.arch !== "x64") throw fail();
  const expected = {
    kind: "nonrelease-distinct-coding-helpers",
    outerSha256: PROTOTYPE_OUTER,
    innerSha256: PROTOTYPE_INNER,
    archiveSha256:
      "d038cebff7a83e2ea0039f652e19b18f708e99b93ab2372341d488c393fc1a5a",
    changedSourceSha256:
      "a2378ba1043fb9821310453db3c3988e84f194a66e8bc526f502deffc0340f27",
    filteredSourceSha256:
      "dcf9f8da4dce7cd5acf7b1e209eb14094a2cdf8613dc40f3caa3d13265ca909e",
    commandFilterSha256:
      "43da5df160b438feb7796814c88d81393ca618d67911e210858727f4e59faeac",
    procInformationGuardSha256:
      "e2fa084e91751700b4bf1c89c25d427a62a2025af72306735c946c92c52d415d",
  };
  const files = [
    "/usr/bin/bwrap",
    "/opt/agentic-inner/bwrap",
    "/usr/share/doc/acos-proc-vendor-probe/helpers.json",
  ];
  for (const file of files) {
    const stat = await lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (await realpath(file)) !== file ||
      stat.uid !== 0 ||
      (stat.mode & 0o6022) !== 0 ||
      stat.size <= 0 ||
      stat.size > 32 * 1024 * 1024
    )
      throw fail();
    for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
      const info = await lstat(dir);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        info.uid !== 0 ||
        (info.mode & 0o022) !== 0
      )
        throw fail();
      if (dir === "/") break;
    }
  }
  for (const [file, sha] of [
    [files[0], PROTOTYPE_OUTER],
    [files[1], PROTOTYPE_INNER],
  ])
    if (
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex") !== sha
    )
      throw fail();
  if ((await lstat(files[2])).size > 4096) throw fail();
  const manifest = JSON.parse(await readFile(files[2], "utf8"));
  if (
    Object.keys(manifest).length !== Object.keys(expected).length ||
    Object.entries(expected).some(([key, value]) => manifest[key] !== value)
  )
    throw fail();
  const python = await realpath("/usr/bin/python3");
  const py = await lstat(python);
  if (!py.isFile() || py.uid !== 0 || (py.mode & 0o6022) !== 0) throw fail();
  for (let dir = path.dirname(python); ; dir = path.dirname(dir)) {
    const info = await lstat(dir);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== 0 ||
      (info.mode & 0o022) !== 0
    )
      throw fail();
    if (dir === "/") break;
  }
  const capabilityCheck =
    "import os,errno\nfor f in ['/usr/bin/bwrap','/opt/agentic-inner/bwrap']:\n try: os.getxattr(f,'security.capability');raise RuntimeError('unexpected_capability')\n except OSError as e: assert e.errno==errno.ENODATA\nprint('NO_FILE_CAPABILITIES')";
  const cap = await execute(python, ["-I", "-S", "-c", capabilityCheck], {
    env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
    timeout: 5000,
    maxBuffer: 4096,
  });
  if (cap.stdout.trim() !== "NO_FILE_CAPABILITIES" || cap.stderr) throw fail();
  for (const file of files.slice(0, 2)) {
    const help = await execute(file, ["--help"], {
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
      timeout: 5000,
      maxBuffer: 32768,
    });
    if (
      help.stderr ||
      !["--argv0", "--as-pid-1", "--perms", "--ro-bind-fd"].every((flag) =>
        help.stdout.includes(flag),
      )
    )
      throw fail();
  }
  return expected;
}
