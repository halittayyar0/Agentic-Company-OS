import { constants } from "node:fs";
import { open, lstat } from "node:fs/promises";

/** Read and validate one descriptor; shared by normal resume and recovery. */
export async function readBoundedRegularFile(
  file: string,
  limit: number,
  _options: { rejectSymlinks: true },
) {
  const handle = await open(
    file,
    constants.O_RDONLY |
      (process.platform === "win32"
        ? 0
        : constants.O_NOFOLLOW | constants.O_NONBLOCK),
  );
  try {
    const stat = await handle.stat(),
      leaf = await lstat(file);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > limit ||
      leaf.isSymbolicLink() ||
      stat.ino !== leaf.ino ||
      stat.dev !== leaf.dev
    )
      throw new Error("Invalid private installation file");
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        size,
        buffer.length - size,
        size,
      );
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > limit) throw new Error("Installation file too large");
    return buffer.subarray(0, size).toString("utf8");
  } finally {
    await handle.close();
  }
}
