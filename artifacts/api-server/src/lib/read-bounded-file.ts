import { constants } from "node:fs";
import fs from "node:fs/promises";

/** Check and read the same descriptor, with a hard allocation/read bound. */
export async function readBoundedRegularFile(
  filePath: string,
  maxBytes: number,
  options: { rejectSymlinks?: boolean } = {},
): Promise<string> {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 16 * 1024 * 1024
  )
    throw new RangeError("Invalid file read limit");
  const flags =
    constants.O_RDONLY |
    (process.platform === "win32"
      ? 0
      : constants.O_NONBLOCK |
        (options.rejectSymlinks ? constants.O_NOFOLLOW : 0));
  const handle = await fs.open(filePath, flags);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error("Expected a regular file");
    if (metadata.size > maxBytes)
      throw new Error("File exceeds its read limit");
    if (options.rejectSymlinks && process.platform === "win32") {
      const linked = await fs.lstat(filePath);
      if (
        linked.isSymbolicLink() ||
        linked.dev !== metadata.dev ||
        linked.ino !== metadata.ino
      )
        throw new Error("Linked or replaced file is not allowed");
    }
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw new Error("File exceeds its read limit");
    return buffer.subarray(0, length).toString("utf8");
  } finally {
    await handle.close();
  }
}
