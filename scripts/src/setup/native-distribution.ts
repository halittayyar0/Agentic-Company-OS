import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { readBoundedRegularFile } from "./resume";

export interface NativeDistribution {
  schemaVersion: 1;
  commit: string;
  target: string;
  nodeVersion: string;
  postgresVersion: string;
  files: { path: string; bytes: number; sha256: string }[];
}

const targets = new Set([
  "win32-x64",
  "darwin-x64",
  "darwin-arm64",
  "linux-x64",
  "linux-arm64",
]);
const defaultHost = () => ({
  platform: process.platform,
  architecture: process.arch,
});

export function nativeRequiredFiles(host: {
  platform: string;
  architecture: string;
}): string[] {
  if (!targets.has(`${host.platform}-${host.architecture}`))
    throw new Error("native_package_platform");
  const suffix = host.platform === "win32" ? ".exe" : "";
  return [
    host.platform === "win32"
      ? "runtime/node/node.exe"
      : "runtime/node/bin/node",
    ...[
      "postgres",
      "initdb",
      "pg_ctl",
      "pg_dump",
      "pg_restore",
      "psql",
      "pg_isready",
      "pg_controldata",
    ].map((name) => `runtime/postgres/bin/${name}${suffix}`),
    "scripts/src/setup/bootstrap.mjs",
    "scripts/src/setup/setup-client.js",
    "artifacts/api-server/start.mjs",
    "artifacts/api-server/start-worker.mjs",
    "artifacts/api-server/dist/index.mjs",
    "artifacts/api-server/dist/worker-entry.mjs",
    "artifacts/api-server/dist/db-migrations/meta/_journal.json",
    "artifacts/agentic-company-os/dist/public/index.html",
  ];
}

function keys(value: Record<string, unknown>, expected: string): boolean {
  return Object.keys(value).sort().join(",") === expected;
}

function safeRelative(file: string): boolean {
  return (
    file.length > 0 &&
    file.length <= 1024 &&
    !/[\\:\u0000-\u001f\u007f]/u.test(file) &&
    file
      .split("/")
      .every(
        (part) =>
          part.length > 0 &&
          part !== "." &&
          part !== ".." &&
          !/[. ]$/u.test(part) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      )
  );
}

export function validateNativeDistribution(
  value: unknown,
  host: { platform: string; architecture: string } = defaultHost(),
): NativeDistribution {
  const fail = () => {
    throw new Error("native_package_manifest");
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  const data = value as Record<string, unknown>;
  if (
    !keys(
      data,
      "commit,files,nodeVersion,postgresVersion,schemaVersion,target",
    ) ||
    data.schemaVersion !== 1 ||
    typeof data.commit !== "string" ||
    !/^[a-f0-9]{40}$/u.test(data.commit) ||
    data.target !== `${host.platform}-${host.architecture}` ||
    !targets.has(String(data.target)) ||
    typeof data.nodeVersion !== "string" ||
    !/^24\.\d+\.\d+$/u.test(data.nodeVersion) ||
    typeof data.postgresVersion !== "string" ||
    !/^17\.\d+$/u.test(data.postgresVersion) ||
    !Array.isArray(data.files) ||
    data.files.length < 1 ||
    data.files.length > 20_000
  )
    return fail();
  const seen = new Set<string>();
  let total = 0;
  const files = data.files.map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
    const row = raw as Record<string, unknown>;
    if (
      !keys(row, "bytes,path,sha256") ||
      typeof row.path !== "string" ||
      !safeRelative(row.path) ||
      seen.has(row.path.toLowerCase()) ||
      row.path === "native-distribution.json" ||
      !Number.isSafeInteger(row.bytes) ||
      Number(row.bytes) < 0 ||
      Number(row.bytes) > 128 * 1024 * 1024 ||
      typeof row.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(row.sha256)
    )
      return fail();
    seen.add(row.path.toLowerCase());
    total += Number(row.bytes);
    if (total > 2 * 1024 * 1024 * 1024) return fail();
    return { path: row.path, bytes: row.bytes as number, sha256: row.sha256 };
  });
  if (nativeRequiredFiles(host).some((file) => !seen.has(file.toLowerCase())))
    return fail();
  return {
    schemaVersion: 1,
    commit: data.commit,
    target: data.target as string,
    nodeVersion: data.nodeVersion,
    postgresVersion: data.postgresVersion,
    files,
  };
}

export async function readNativeDistribution(
  root: string,
): Promise<NativeDistribution | null> {
  const manifest = path.join(root, "native-distribution.json");
  let bytes: string;
  try {
    bytes = await readBoundedRegularFile(manifest, 4 * 1024 * 1024, {
      rejectSymlinks: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const data = validateNativeDistribution(JSON.parse(bytes));
  const exact = await realpath(root);
  for (const row of data.files) {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const file = path.join(exact, ...row.path.split("/"));
      if ((await realpath(file)) !== file)
        throw new Error("redirected package path");
      handle = await open(
        file,
        constants.O_RDONLY |
          (process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
      );
      const info = await handle.stat(),
        leaf = await lstat(file);
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        info.size !== row.bytes ||
        leaf.isSymbolicLink() ||
        leaf.ino !== info.ino ||
        leaf.dev !== info.dev
      )
        throw new Error("changed package file");
      const hash = createHash("sha256");
      for await (const chunk of handle.createReadStream({ autoClose: false }))
        hash.update(chunk);
      if (hash.digest("hex") !== row.sha256)
        throw new Error("changed package bytes");
    } catch {
      throw new Error("native_package_integrity");
    } finally {
      await handle?.close();
    }
  }
  return data;
}
