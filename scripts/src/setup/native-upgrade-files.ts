import { createHash, randomUUID } from "node:crypto";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { readBoundedRegularFile } from "./installation-files";

export const nativeUpgradeHash = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");

export async function syncNativeUpgradeDirectory(
  directory: string,
): Promise<void> {
  if (
    (await realpath(directory)) !== directory ||
    !(await lstat(directory)).isDirectory()
  )
    throw new Error("native_upgrade_file_path");
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Compare under the instance lease, then atomically replace and flush.
 * An already-applied identical write is safe to acknowledge after interruption.
 */
export async function replaceNativeUpgradeFile(
  file: string,
  expectedSha256: string,
  bytes: string,
): Promise<void> {
  const parent = path.dirname(file);
  if (!path.isAbsolute(file) || (await realpath(parent)) !== parent)
    throw new Error("native_upgrade_file_path");
  const before = await readBoundedRegularFile(file, 64000, {
    rejectSymlinks: true,
  });
  if (nativeUpgradeHash(before) === nativeUpgradeHash(bytes)) return;
  if (nativeUpgradeHash(before) !== expectedSha256)
    throw new Error("native_upgrade_file_changed");
  const temporary = path.join(parent, `.native-upgrade-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const current = await readBoundedRegularFile(file, 64000, {
      rejectSymlinks: true,
    });
    if (nativeUpgradeHash(current) !== expectedSha256)
      throw new Error("native_upgrade_file_changed");
    await rename(temporary, file);
    await syncNativeUpgradeDirectory(parent);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
