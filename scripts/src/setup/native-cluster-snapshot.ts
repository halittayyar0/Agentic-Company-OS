export interface ClusterSnapshotProgress {
  phase: "inventory" | "copy" | "verify";
  copiedFiles: number;
}
interface Options {
  directory: string;
  upgradeId: string;
  inspectStopped: () => Promise<{
    dataDirectory: string;
    postgresMajor: number;
  }>;
  signal?: AbortSignal;
  onProgress?: (progress: ClusterSnapshotProgress) => void | Promise<void>;
}
export interface NativeClusterInventory {
  directories: string[];
  files: { path: string; bytes: number; sha256: string }[];
  bytes: number;
  sha256: string;
}

async function exactDirectory(directory: string) {
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (await realpath(directory)) !== directory
  )
    throw new Error("native_snapshot_path");
}

async function readClusterFile(
  file: string,
  signal?: AbortSignal,
  destination?: string,
) {
  signal?.throwIfAborted();
  const source = await open(
    file,
    constants.O_RDONLY |
      (process.platform === "win32"
        ? 0
        : constants.O_NOFOLLOW | constants.O_NONBLOCK),
  );
  let output: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // Validate the descriptor we actually opened before reading any bytes.
    const before = await source.stat(),
      leaf = await lstat(file);
    if (
      !before.isFile() ||
      leaf.isSymbolicLink() ||
      before.nlink !== 1 ||
      !Number.isSafeInteger(before.size) ||
      before.size < 0 ||
      before.ino !== leaf.ino ||
      before.dev !== leaf.dev ||
      (await realpath(file)) !== file
    )
      throw new Error("native_snapshot_path");
    const unchanged = (after: typeof before) =>
      after.isFile() &&
      after.nlink === 1 &&
      after.ino === before.ino &&
      after.dev === before.dev &&
      after.size === before.size &&
      after.mtimeMs === before.mtimeMs &&
      after.ctimeMs === before.ctimeMs;
    if (!unchanged(await source.stat()))
      throw new Error("native_snapshot_changed");
    if (destination) {
      await exactDirectory(path.dirname(destination));
      output = await open(destination, "wx", 0o600);
    }
    const hash = createHash("sha256"),
      buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    while (true) {
      signal?.throwIfAborted();
      const { bytesRead } = await source.read(
        buffer,
        0,
        buffer.length,
        position,
      );
      if (!bytesRead) break;
      if (position + bytesRead > before.size)
        throw new Error("native_snapshot_changed");
      hash.update(buffer.subarray(0, bytesRead));
      if (output) {
        let written = 0;
        while (written < bytesRead) {
          signal?.throwIfAborted();
          const next = await output.write(
            buffer,
            written,
            bytesRead - written,
            position + written,
          );
          if (!next.bytesWritten) throw new Error("native_snapshot_write");
          written += next.bytesWritten;
        }
      }
      position += bytesRead;
    }
    if (
      position !== before.size ||
      !unchanged(await source.stat()) ||
      !unchanged(await lstat(file)) ||
      (await realpath(file)) !== file
    )
      throw new Error("native_snapshot_changed");
    await output?.sync();
    return { bytes: position, sha256: hash.digest("hex") };
  } finally {
    await output?.close();
    await source.close();
  }
}

/** Complete cold-cluster inventory, including empty directories and WAL.
 * The caller holds the instance OS lease and separately verifies clean shutdown.
 */
export async function inventoryNativeCluster(
  directory: string,
  signal?: AbortSignal,
): Promise<NativeClusterInventory> {
  if (!path.isAbsolute(directory) || path.resolve(directory) !== directory)
    throw new Error("native_snapshot_path");
  const directories: string[] = [],
    files: NativeClusterInventory["files"] = [];
  let bytes = 0;
  const visit = async (folder: string, relative: string, depth: number) => {
    signal?.throwIfAborted();
    if (depth > 32 || directories.length > 100_000 || files.length > 100_000)
      throw new Error("native_snapshot_bounds");
    await exactDirectory(folder);
    for (const name of (await readdir(folder)).sort()) {
      signal?.throwIfAborted();
      if (
        !/^[a-zA-Z0-9_.-]+$/u.test(name) ||
        name.length > 255 ||
        name === "." ||
        name === ".."
      )
        throw new Error("native_snapshot_path");
      const file = path.join(folder, name),
        leaf = relative ? `${relative}/${name}` : name;
      const info = await lstat(file);
      if (info.isSymbolicLink()) throw new Error("native_snapshot_path");
      if (info.isDirectory()) {
        directories.push(leaf);
        await visit(file, leaf, depth + 1);
      } else {
        if (files.length >= 100_000) throw new Error("native_snapshot_bounds");
        const row = await readClusterFile(file, signal);
        bytes += row.bytes;
        if (!Number.isSafeInteger(bytes))
          throw new Error("native_snapshot_bounds");
        files.push({ path: leaf, ...row });
      }
    }
  };
  await visit(directory, "", 0);
  const content = { directories, files, bytes };
  return {
    ...content,
    sha256: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
  };
}

async function syncDirectory(directory: string) {
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Copy only: never changes the source database, metadata, launch pointer or secrets.
 * The coordinator must hold the installation lease throughout this operation.
 * Failed/aborted copies are retained without a successful receipt for recovery.
 */
export async function snapshotNativeCluster(options: Options): Promise<{
  upgradeId: string;
  stagingDirectory: string;
  dataDirectory: string;
  inventory: NativeClusterInventory;
}> {
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
  const directory = path.resolve(options.directory);
  if (
    !path.isAbsolute(options.directory) ||
    !uuid.test(options.upgradeId) ||
    !path.basename(directory).startsWith("instance-") ||
    !uuid.test(path.basename(directory).slice(9))
  )
    throw new Error("native_snapshot_identity");
  options.signal?.throwIfAborted();
  await exactDirectory(directory);
  const source = path.join(directory, "database");
  const inspect = async () => {
    const state = await options.inspectStopped();
    if (state.dataDirectory !== source || state.postgresMajor !== 17)
      throw new Error("native_snapshot_identity");
    options.signal?.throwIfAborted();
  };
  await inspect();
  await options.onProgress?.({ phase: "inventory", copiedFiles: 0 });
  const inventory = await inventoryNativeCluster(source, options.signal);
  for (const name of [
    "PG_VERSION",
    "agentic-cluster.json",
    "global/pg_control",
  ])
    if (!inventory.files.some((file) => file.path === name))
      throw new Error("native_snapshot_identity");
  if (
    !inventory.directories.includes("pg_wal") ||
    !inventory.directories.includes("pg_tblspc") ||
    inventory.files.some((file) => file.path.startsWith("pg_tblspc/"))
  )
    throw new Error("native_snapshot_identity");
  await new OwnerPrivateStorage(directory).initialize();
  const upgrades = path.join(directory, "native-upgrades");
  await new OwnerPrivateStorage(upgrades).initialize();
  const attempt = path.join(upgrades, options.upgradeId);
  await new OwnerPrivateStorage(attempt).initialize(true);
  const stagingDirectory = path.join(attempt, "stage"),
    dataDirectory = path.join(stagingDirectory, "database");
  await new OwnerPrivateStorage(stagingDirectory).initialize(true);
  await mkdir(dataDirectory, { mode: 0o700 });
  for (const name of inventory.directories) {
    options.signal?.throwIfAborted();
    await mkdir(path.join(dataDirectory, name), { mode: 0o700 });
  }
  let copiedFiles = 0;
  await options.onProgress?.({ phase: "copy", copiedFiles });
  for (const row of inventory.files) {
    options.signal?.throwIfAborted();
    const copied = await readClusterFile(
      path.join(source, row.path),
      options.signal,
      path.join(dataDirectory, row.path),
    );
    if (copied.sha256 !== row.sha256 || copied.bytes !== row.bytes)
      throw new Error("native_snapshot_changed");
    await options.onProgress?.({ phase: "copy", copiedFiles: ++copiedFiles });
  }
  await options.onProgress?.({ phase: "verify", copiedFiles });
  await inspect();
  const original = await inventoryNativeCluster(source, options.signal);
  const copied = await inventoryNativeCluster(dataDirectory, options.signal);
  if (
    original.sha256 !== inventory.sha256 ||
    copied.sha256 !== inventory.sha256
  )
    throw new Error("native_snapshot_changed");
  for (const name of [...inventory.directories].reverse())
    await syncDirectory(path.join(dataDirectory, name));
  for (const folder of [
    dataDirectory,
    stagingDirectory,
    attempt,
    upgrades,
    directory,
  ])
    await syncDirectory(folder);
  return {
    upgradeId: options.upgradeId,
    stagingDirectory,
    dataDirectory,
    inventory,
  };
}
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { OwnerPrivateStorage } from "@workspace/ai-server/owner-private-storage";
