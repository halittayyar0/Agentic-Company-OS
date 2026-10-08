import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export const MANAGED_CODING_COMMAND_PATH = "/opt/agentic-inner:/usr/bin:/bin";
export const MANAGED_CODEX_EXECUTABLE = "/opt/agentic-codex/bin/codex";
export const MANAGED_OUTER_SHA256 =
  "d614afff26b5f4f2250f432876399dc95ed2e8c04dbf6dbece3a067d9c7cacb7";
export const MANAGED_INNER_SHA256 =
  "9f5789651eb95860fe3242745513a177029983e7a208854529ae7dc23aaf0eb9";
export const MANAGED_CODING_MANIFEST_PATH =
  "/usr/share/doc/acos-proc-vendor-probe/helpers.json";
export const MANAGED_CODING_EXPECTED_MANIFEST = Object.freeze({
  kind: "managed-coding-helpers-v1",
  outerSha256: MANAGED_OUTER_SHA256,
  innerSha256: MANAGED_INNER_SHA256,
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
  apparmorSha256:
    "738840b998afef3e2c626751d0fe8ad39b43fb39c39cc5d4627cbdb8365d869a",
});
const OUTER = "/usr/bin/bwrap";
const INNER = "/opt/agentic-inner/bwrap";
const PROFILE = "/usr/share/doc/acos-proc-vendor-probe/agentic-coding.apparmor";
const CODEX_MANIFEST = "/opt/agentic-codex/fixture-owner.json";
const CODEX_LIMIT = 512 * 1024 * 1024;
const ORIGINAL_CODEX_MANIFEST = Object.freeze({
  root: "/opt/agentic-codex",
  executable: MANAGED_CODEX_EXECUTABLE,
  version: "0.159.2",
  archiveSha256:
    "84a6b35fb45bdcb94cef9fcb329438045a8911f53876cc9a9a7e6f9bb1382eba",
  integrity:
    "sha512-RrCZ1X52wpa1lOsXtCtSyhjOFdQPh7LH5Ccv8HsKmd/2UXbUwxXFqWXFK3JzatquUNGtW/TLox5Y7qVOGkV0/Q==",
  bwrapSha256:
    "77360cb751ccedc5971391444ac86a8a33c15b04d6b4a6fe45f5d25496e62c4c",
  imageRuntime: true,
});
const BINARY_LIMIT = 32 * 1024 * 1024;
const STATUS_LIMIT = 64 * 1024;
const MOUNT_LIMIT = 1024 * 1024;
const unsupported = () => new Error("owned_linux_runtime_unsupported");
const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

interface FileIdentity {
  regular: boolean;
  symlink: boolean;
  canonical: boolean;
  uid: number;
  mode: number;
  size: number;
}
type FileDigest = FileIdentity & { sha256: string };
function protectedFile(
  file: FileIdentity,
  maximum: number,
  executable = false,
) {
  return (
    file.regular &&
    !file.symlink &&
    file.canonical &&
    file.uid === 0 &&
    Number.isSafeInteger(file.mode) &&
    (file.mode & 0o6022) === 0 &&
    (!executable || (file.mode & 0o111) !== 0) &&
    Number.isSafeInteger(file.size) &&
    file.size > 0 &&
    file.size <= maximum
  );
}

/** Original archive integrity is established by the immutable image build.
 * This binds its protected manifest and executable, not an invented binary pin.
 * The process caller must retain its before/after executable fingerprint. */
export function hasManagedCodexIdentity(input: {
  manifest: unknown;
  manifestFile: FileIdentity;
  executable: FileIdentity & { path: string };
}): boolean {
  const manifest = input.manifest;
  return (
    typeof manifest === "object" &&
    manifest !== null &&
    !Array.isArray(manifest) &&
    Object.keys(manifest).length ===
      Object.keys(ORIGINAL_CODEX_MANIFEST).length &&
    Object.entries(ORIGINAL_CODEX_MANIFEST).every(
      ([key, value]) => (manifest as Record<string, unknown>)[key] === value,
    ) &&
    protectedFile(input.manifestFile, 4096) &&
    input.executable.path === MANAGED_CODEX_EXECUTABLE &&
    protectedFile(input.executable, CODEX_LIMIT, true)
  );
}

/** Pure validation has no authority to select paths or launch helpers. */
export function hasManagedCodingToolchainIdentity(input: {
  manifest: unknown;
  manifestFile: FileIdentity;
  outer: FileDigest;
  inner: FileDigest;
  profile: FileDigest;
}): boolean {
  const manifest = input.manifest;
  return (
    typeof manifest === "object" &&
    manifest !== null &&
    !Array.isArray(manifest) &&
    Object.keys(manifest).length ===
      Object.keys(MANAGED_CODING_EXPECTED_MANIFEST).length &&
    Object.entries(MANAGED_CODING_EXPECTED_MANIFEST).every(
      ([key, value]) => (manifest as Record<string, unknown>)[key] === value,
    ) &&
    protectedFile(input.manifestFile, 4096) &&
    protectedFile(input.outer, BINARY_LIMIT, true) &&
    protectedFile(input.inner, BINARY_LIMIT, true) &&
    protectedFile(input.profile, STATUS_LIMIT) &&
    input.outer.sha256 === MANAGED_OUTER_SHA256 &&
    input.inner.sha256 === MANAGED_INNER_SHA256 &&
    input.profile.sha256 === MANAGED_CODING_EXPECTED_MANIFEST.apparmorSha256
  );
}

function statusFields(status: string) {
  if (
    status.length > STATUS_LIMIT ||
    !status.endsWith("\n") ||
    status.includes("\0")
  )
    return null;
  const fields = new Map<string, string>();
  for (const line of status.slice(0, -1).split("\n")) {
    const colon = line.indexOf(":");
    const key = line.slice(0, colon);
    if (colon < 1 || !/^[A-Za-z_][A-Za-z_0-9]*$/u.test(key) || fields.has(key))
      return null;
    fields.set(key, line.slice(colon + 1).trim());
  }
  return fields;
}
interface Mount {
  root: string;
  target: string;
  options: Set<string>;
  type: string;
  source: string;
}
function mountPath(value: string) {
  if (/\\(?!040|011|012|134)/u.test(value)) return null;
  const decoded = value.replace(/\\(040|011|012|134)/gu, (_, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  );
  return decoded.startsWith("/") &&
    !/[\u0000-\u001f\u007f]/u.test(decoded) &&
    path.posix.normalize(decoded) === decoded
    ? decoded
    : null;
}
function mountFields(value: string) {
  if (
    value.length > MOUNT_LIMIT ||
    !value.endsWith("\n") ||
    value.includes("\0")
  )
    return null;
  const mounts = new Map<string, Mount>();
  const ids = new Set<string>();
  for (const line of value.slice(0, -1).split("\n")) {
    const parts = line.split(" - ");
    if (parts.length !== 2) return null;
    const before = parts[0].split(" ");
    const after = parts[1].split(" ");
    if (
      before.length < 6 ||
      after.length !== 3 ||
      before.some((part) => !part) ||
      after.some((part) => !part) ||
      !/^[1-9]\d*$/u.test(before[0]) ||
      !/^\d+$/u.test(before[1]) ||
      !/^\d+:\d+$/u.test(before[2]) ||
      ids.has(before[0])
    )
      return null;
    const root = mountPath(before[3]),
      target = mountPath(before[4]);
    const optionList = before[5].split(","),
      options = new Set(optionList);
    if (
      root === null ||
      target === null ||
      mounts.has(target) ||
      options.size !== optionList.length ||
      options.has("ro") === options.has("rw")
    )
      return null;
    ids.add(before[0]);
    mounts.set(target, {
      root,
      target,
      options,
      type: after[0],
      source: after[1],
    });
  }
  return mounts;
}
const PROC_READONLY = ["bus", "fs", "irq", "sys", "sysrq-trigger"] as const;
const PROC_DIRECTORIES = ["acpi", "scsi"] as const;
const PROC_NULL = [
  "interrupts",
  "kcore",
  "keys",
  "latency_stats",
  "timer_list",
] as const;

/** Observed containment only. The label cannot reveal loaded policy bytes:
 * the trusted installer must load this exact protected packaged profile. */
export function hasManagedCodingContainment(input: {
  platform: string;
  architecture: string;
  uid: number;
  gid: number;
  dockerMarker: boolean;
  status: string;
  mounts: string;
  apparmor: string;
}): boolean {
  if (
    input.platform !== "linux" ||
    input.architecture !== "x64" ||
    input.uid !== 1000 ||
    input.gid !== 1000 ||
    !input.dockerMarker ||
    !/^agentic-coding \(enforce\)\n?$/u.test(input.apparmor)
  )
    return false;
  const status = statusFields(input.status),
    mounts = mountFields(input.mounts);
  if (
    !status ||
    !mounts ||
    status.get("NoNewPrivs") !== "1" ||
    status.get("Seccomp") !== "2"
  )
    return false;
  for (const field of ["Uid", "Gid"])
    if (!/^1000[ \t]+1000[ \t]+1000[ \t]+1000$/u.test(status.get(field) ?? ""))
      return false;
  for (const field of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"])
    if (status.get(field) !== "0000000000000000") return false;
  const root = mounts.get("/"),
    proc = mounts.get("/proc"),
    sys = mounts.get("/sys");
  if (
    !root?.options.has("ro") ||
    proc?.type !== "proc" ||
    proc.source !== "proc" ||
    proc.root !== "/" ||
    !["rw", "nosuid", "nodev", "noexec"].every((flag) =>
      proc.options.has(flag),
    ) ||
    sys?.type !== "sysfs" ||
    !sys.options.has("ro")
  )
    return false;
  const requiredProc = new Set(["/proc"]);
  for (const name of PROC_READONLY) {
    const target = `/proc/${name}`,
      mount = mounts.get(target);
    if (
      mount?.type !== "proc" ||
      mount.source !== "proc" ||
      mount.root !== `/${name}` ||
      !["ro", "nosuid", "nodev", "noexec"].every((flag) =>
        mount.options.has(flag),
      )
    )
      return false;
    requiredProc.add(target);
  }
  for (const name of [...PROC_DIRECTORIES, ...PROC_NULL]) {
    const target = `/proc/${name}`,
      mount = mounts.get(target),
      directory = (PROC_DIRECTORIES as readonly string[]).includes(name);
    if (
      mount?.type !== "tmpfs" ||
      mount.source !== "tmpfs" ||
      mount.root !== (directory ? "/" : "/null") ||
      ![directory ? "ro" : "rw", "nosuid", "nodev"].every((flag) =>
        mount.options.has(flag),
      )
    )
      return false;
    requiredProc.add(target);
  }
  for (const target of mounts.keys())
    if (target.startsWith("/proc/") && !requiredProc.has(target)) return false;
  return true;
}

function fileIdentity(stat: Stats, canonical: boolean): FileIdentity {
  return {
    regular: stat.isFile(),
    symlink: stat.isSymbolicLink(),
    canonical,
    uid: stat.uid,
    mode: stat.mode,
    size: stat.size,
  };
}
async function protectedAncestors(file: string) {
  for (
    let directory = path.posix.dirname(file);
    ;
    directory = path.posix.dirname(directory)
  ) {
    const stat = await fs.lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== 0 ||
      (stat.mode & 0o022) !== 0 ||
      (await fs.realpath(directory)) !== directory
    )
      throw new Error("managed_probe_1");
    if (directory === "/") return;
  }
}
function sameFile(first: Stats, second: Stats) {
  return ["dev", "ino", "uid", "mode", "size", "mtimeMs", "ctimeMs"].every(
    (key) => first[key as keyof Stats] === second[key as keyof Stats],
  );
}
async function protectedMetadata(
  file: string,
  maximum: number,
  executable = false,
) {
  const metadata = await fs.lstat(file);
  if (
    !protectedFile(
      fileIdentity(metadata, (await fs.realpath(file)) === file),
      maximum,
      executable,
    )
  )
    throw new Error("managed_probe_2");
  await protectedAncestors(file);
  if (!sameFile(metadata, await fs.lstat(file))) throw new Error("managed_probe_3");
  return metadata;
}
async function boundedRead(
  file: string,
  maximum: number,
  protectedRecord = false,
  executable = false,
) {
  const metadata = protectedRecord
    ? await protectedMetadata(file, maximum, executable)
    : undefined;
  const handle = await fs.open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const first = await handle.stat();
    if (metadata && (!first.isFile() || !sameFile(first, metadata)))
      throw new Error("managed_probe_4");
    const buffer = Buffer.alloc(metadata ? metadata.size + 1 : maximum + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (
      length > maximum ||
      (metadata &&
        (length !== metadata.size ||
          !sameFile(first, await handle.stat()) ||
          !sameFile(first, await fs.lstat(file))))
    )
      throw new Error("managed_probe_5");
    return {
      bytes: buffer.subarray(0, length),
      identity: fileIdentity(
        first,
        !metadata || (await fs.realpath(file)) === file,
      ),
    };
  } finally {
    await handle.close();
  }
}

/** Fixed paths only; absence alone preserves the native distro helper boundary.
 * Callers must compare/recheck this mode before launch. No weaker retry exists. */
export async function readLinuxCodingMode(): Promise<"native" | "managed"> {
  try {
    await fs.lstat(MANAGED_CODING_MANIFEST_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "native";
    throw new Error("managed_probe_6");
  }
  try {
    if (
      process.platform !== "linux" ||
      process.arch !== "x64" ||
      process.getuid?.() !== 1000 ||
      process.getgid?.() !== 1000
    )
      throw new Error("managed_probe_7");
    const [manifest, outer, inner, profile] = await Promise.all([
      boundedRead(MANAGED_CODING_MANIFEST_PATH, 4096, true),
      boundedRead(OUTER, BINARY_LIMIT, true, true),
      boundedRead(INNER, BINARY_LIMIT, true, true),
      boundedRead(PROFILE, STATUS_LIMIT, true),
    ]);
    if (
      !hasManagedCodingToolchainIdentity({
        manifest: JSON.parse(manifest.bytes.toString("utf8")),
        manifestFile: manifest.identity,
        outer: { ...outer.identity, sha256: sha256(outer.bytes) },
        inner: { ...inner.identity, sha256: sha256(inner.bytes) },
        profile: { ...profile.identity, sha256: sha256(profile.bytes) },
      })
    )
      throw new Error("managed_probe_8");
    // The large CLI needs metadata/ancestor protection here, not a second
    // whole-binary allocation. Its runtime fingerprint is retained by ports.
    const [originalManifest, codex] = await Promise.all([
      boundedRead(CODEX_MANIFEST, 4096, true),
      protectedMetadata(MANAGED_CODEX_EXECUTABLE, CODEX_LIMIT, true),
    ]);
    if (
      !hasManagedCodexIdentity({
        manifest: JSON.parse(originalManifest.bytes.toString("utf8")),
        manifestFile: originalManifest.identity,
        executable: {
          ...fileIdentity(codex, true),
          path: MANAGED_CODEX_EXECUTABLE,
        },
      })
    )
      throw new Error("managed_probe_9");
    const docker = await fs.lstat("/.dockerenv");
    if (
      !docker.isFile() ||
      docker.isSymbolicLink() ||
      docker.uid !== 0 ||
      (docker.mode & 0o022) !== 0 ||
      (await fs.realpath("/.dockerenv")) !== "/.dockerenv"
    )
      throw new Error("managed_probe_10");
    await protectedAncestors("/.dockerenv");
    const [status, mounts, apparmor] = await Promise.all([
      boundedRead("/proc/self/status", STATUS_LIMIT),
      boundedRead("/proc/self/mountinfo", MOUNT_LIMIT),
      boundedRead("/proc/self/attr/current", 4096),
    ]);
    if (
      !hasManagedCodingContainment({
        platform: process.platform,
        architecture: process.arch,
        uid: process.getuid(),
        gid: process.getgid(),
        dockerMarker: true,
        status: status.bytes.toString("utf8"),
        mounts: mounts.bytes.toString("utf8"),
        apparmor: apparmor.bytes.toString("utf8"),
      })
    )
      throw new Error("managed_probe_11");
    // Resolve the fixed system interpreter, then validate its file and every
    // ancestor before any helper process. No human environment is inherited.
    const python = await fs.realpath("/usr/bin/python3");
    await protectedAncestors("/usr/bin/python3");
    await boundedRead(python, BINARY_LIMIT, true, true);
    const execute = promisify(childProcess.execFile);
    const environment = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" };
    const capabilityCheck =
      "import os,errno\nfor f in ['/usr/bin/bwrap','/opt/agentic-inner/bwrap','/opt/agentic-codex/bin/codex']:\n try: os.getxattr(f,'security.capability');raise RuntimeError('unexpected_capability')\n except OSError as e: assert e.errno==errno.ENODATA\nprint('NO_FILE_CAPABILITIES')";
    const capabilities = await execute(
      python,
      ["-I", "-S", "-c", capabilityCheck],
      { env: environment, timeout: 5000, maxBuffer: 4096 },
    );
    if (
      capabilities.stdout.trim() !== "NO_FILE_CAPABILITIES" ||
      capabilities.stderr
    )
      throw new Error("managed_probe_12");
    for (const helper of [OUTER, INNER]) {
      const help = await execute(helper, ["--help"], {
        env: environment,
        timeout: 5000,
        maxBuffer: 32768,
      });
      if (
        help.stderr ||
        !["--argv0", "--as-pid-1", "--perms", "--ro-bind-fd"].every((flag) =>
          help.stdout.includes(flag),
        )
      )
        throw new Error("managed_probe_13");
    }
    return "managed";
  } catch (error) {
    const code=(error as NodeJS.ErrnoException).code;
    const message=(error as Error).message;
    console.error(JSON.stringify({kind:"fixed_managed_admission_probe",code:typeof code==="string"&&/^[A-Z_]{1,40}$/.test(code)?code:null,refusal:typeof message==="string"&&/^managed_probe_[0-9]{1,3}$/.test(message)?message:null}));
    throw unsupported();
  }
}