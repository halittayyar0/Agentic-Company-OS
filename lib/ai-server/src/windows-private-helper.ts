import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { constants, type BigIntStats } from "node:fs";
import { WINDOWS_PRIVATE_HELPER } from "./windows-private-helper-manifest";

function unchanged(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    right.isFile() &&
    !right.isSymbolicLink()
  );
}

/** The adjacent asset belongs to the trusted application, like this JS bundle.
 * Recheck every invocation; no override, download, compiler or shell fallback.
 * This is not a claim against a same-owner writer who can replace app code. */
export async function windowsPrivateHelperExecutable(): Promise<string> {
  const executable = fileURLToPath(
    new URL("./windows-private-helper.exe", import.meta.url),
  );
  try {
    // Inspect and consume one descriptor. POSIX nonblocking mode also lets us
    // reject a substituted FIFO instead of waiting for another process to open it.
    const handle = await open(
      executable,
      process.platform === "win32"
        ? constants.O_RDONLY
        : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const before = await handle.stat({ bigint: true });
      if (
        !before.isFile() ||
        before.size !== BigInt(WINDOWS_PRIVATE_HELPER.bytes) ||
        before.size <= 0n ||
        before.size > 1024n * 1024n
      )
        throw new Error("invalid");
      const actual = await realpath(executable);
      if (
        (process.platform === "win32" ? actual.toLowerCase() : actual) !==
        (process.platform === "win32" ? executable.toLowerCase() : executable)
      )
        throw new Error("invalid");
      const bytes = Buffer.alloc(WINDOWS_PRIVATE_HELPER.bytes + 1);
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
      if (
        length !== WINDOWS_PRIVATE_HELPER.bytes ||
        createHash("sha256").update(bytes.subarray(0, length)).digest("hex") !==
          WINDOWS_PRIVATE_HELPER.sha256 ||
        !unchanged(before, await handle.stat({ bigint: true })) ||
        !unchanged(before, await lstat(executable, { bigint: true }))
      )
        throw new Error("invalid");
    } finally {
      await handle.close();
    }
    return executable;
  } catch (error) {
    throw new Error(
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "windows_private_storage_helper_unavailable"
        : "windows_private_storage_helper_invalid",
    );
  }
}

export interface WindowsDirectoryReceipt {
  protocol: 1;
  created: boolean;
  device: string;
  inode: string;
}

export function parseWindowsDirectoryReceipt(
  text: string,
): WindowsDirectoryReceipt {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object") throw new Error("invalid");
    const record = value as Record<string, unknown>;
    const identifier = (field: unknown) =>
      typeof field === "string" &&
      /^[1-9][0-9]{0,19}$/u.test(field) &&
      BigInt(field) <= 18446744073709551615n;
    if (
      record.protocol !== 1 ||
      typeof record.created !== "boolean" ||
      !identifier(record.device) ||
      !identifier(record.inode)
    )
      throw new Error("invalid");
    const result: WindowsDirectoryReceipt = {
      protocol: 1,
      created: record.created,
      device: record.device as string,
      inode: record.inode as string,
    };
    if (JSON.stringify(result) !== text) throw new Error("invalid");
    return result;
  } catch {
    throw new Error("windows_private_storage_postcondition");
  }
}
