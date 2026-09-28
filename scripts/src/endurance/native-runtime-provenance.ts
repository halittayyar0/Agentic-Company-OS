import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";

export interface ExactDirectoryDigest {
  rootPath: string;
  sha256: string;
  fileCount: number;
  totalBytes: number;
}

function pathIdentity(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32"
    ? resolved.toLocaleLowerCase("en-US")
    : resolved;
}

export function requireNode24Version(value: string, label = "Node.js"): string {
  const version = value.trim();
  if (!/^v24\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(version)) {
    throw new Error(`${label} requires an exact Node.js 24.x runtime`);
  }
  return version;
}

export async function sha256ExactFile(
  filePath: string,
  label: string,
): Promise<string> {
  const requested = path.resolve(filePath);
  const metadata = await lstat(requested).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be an exact regular file`);
  }
  const actual = await realpath(requested);
  if (pathIdentity(actual) !== pathIdentity(requested)) {
    throw new Error(`${label} must not be redirected`);
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(actual)) hash.update(chunk);
  return hash.digest("hex");
}

export async function hashExactDirectoryTree(
  directory: string,
  label: string,
): Promise<ExactDirectoryDigest> {
  const requestedRoot = path.resolve(directory);
  const rootMetadata = await lstat(requestedRoot).catch(() => null);
  if (!rootMetadata?.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error(`${label} must be an exact real directory`);
  }
  const actualRoot = await realpath(requestedRoot);
  if (pathIdentity(actualRoot) !== pathIdentity(requestedRoot)) {
    throw new Error(`${label} must not be redirected`);
  }

  const files: Array<{ path: string; size: number; sha256: string }> = [];
  const visit = async (target: string): Promise<void> => {
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) {
      throw new Error(`${label} must not contain symbolic links`);
    }
    const actual = await realpath(target);
    if (pathIdentity(actual) !== pathIdentity(target)) {
      throw new Error(`${label} entry must not be redirected`);
    }
    if (metadata.isDirectory()) {
      const entries = await readdir(target, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
      for (const entry of entries) {
        if (
          entry.isSymbolicLink() ||
          (!entry.isDirectory() && !entry.isFile())
        ) {
          throw new Error(
            `${label} must contain only real files and directories`,
          );
        }
        await visit(path.join(target, entry.name));
      }
      return;
    }
    if (!metadata.isFile()) {
      throw new Error(`${label} must contain only regular files`);
    }
    files.push({
      path: path.relative(requestedRoot, target).split(path.sep).join("/"),
      size: metadata.size,
      sha256: await sha256ExactFile(target, `${label} file`),
    });
  };
  await visit(requestedRoot);
  if (files.length === 0) throw new Error(`${label} must not be empty`);
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  const manifest = files
    .map((file) => `${file.path}\0${file.size}\0${file.sha256}\n`)
    .join("");
  return {
    rootPath: actualRoot,
    sha256: createHash("sha256").update(manifest).digest("hex"),
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
  };
}
