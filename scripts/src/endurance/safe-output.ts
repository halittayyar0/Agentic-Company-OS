import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

function pathIdentity(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32"
    ? resolved.toLocaleLowerCase("en-US")
    : resolved;
}

async function metadataIfPresent(target: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function requireExactDirectory(directory: string): Promise<string> {
  const resolved = path.resolve(directory);
  const metadata = await lstat(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Output directory must be a real directory");
  }
  const actual = await realpath(resolved);
  if (pathIdentity(actual) !== pathIdentity(resolved)) {
    throw new Error("Output directory was redirected");
  }
  return actual;
}

export async function ensureExactOutputDirectory(
  directory: string,
): Promise<string> {
  const resolved = path.resolve(directory);
  const missing: string[] = [];
  let cursor = resolved;
  while (!(await metadataIfPresent(cursor))) {
    missing.push(cursor);
    const parent = path.dirname(cursor);
    if (pathIdentity(parent) === pathIdentity(cursor)) {
      throw new Error("Unable to locate an existing output directory root");
    }
    cursor = parent;
  }
  await requireExactDirectory(cursor);
  for (const target of missing.reverse()) {
    try {
      await mkdir(target, { recursive: false, mode: 0o700 });
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      )) {
        throw error;
      }
    }
    await requireExactDirectory(target);
  }
  return requireExactDirectory(resolved);
}

export async function writeExactOutputBundle(input: {
  outputDirectory: string;
  overwrite: boolean;
  files: Array<{ path: string; bytes: string | Buffer }>;
}): Promise<void> {
  if (input.files.length === 0) {
    throw new TypeError("Output bundle must contain at least one file");
  }
  const outputDirectory = await ensureExactOutputDirectory(
    input.outputDirectory,
  );
  const targets = new Set<string>();
  for (const file of input.files) {
    const target = path.resolve(file.path);
    if (pathIdentity(path.dirname(target)) !== pathIdentity(outputDirectory)) {
      throw new Error("Output bundle file escaped its exact output directory");
    }
    const identity = pathIdentity(target);
    if (targets.has(identity)) {
      throw new Error("Output bundle contains a duplicate target");
    }
    targets.add(identity);
    const metadata = await metadataIfPresent(target);
    if (!metadata) continue;
    if (!input.overwrite) {
      throw new Error(`Output already exists: ${target}`);
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("Overwrite target must be a regular, non-linked file");
    }
    const actual = await realpath(target);
    if (pathIdentity(actual) !== identity) {
      throw new Error("Overwrite target was redirected");
    }
  }

  const transactionId = randomUUID().replaceAll("-", "");
  const files = input.files.map((file, index) => ({
    finalPath: path.resolve(file.path),
    temporaryPath: path.join(
      outputDirectory,
      `.${path.basename(file.path)}.${transactionId}.${index}.tmp`,
    ),
    bytes: file.bytes,
  }));
  try {
    for (const file of files) {
      await writeFile(file.temporaryPath, file.bytes, {
        flag: "wx",
        mode: 0o600,
      });
    }
    for (const file of files) {
      if (input.overwrite) {
        await rename(file.temporaryPath, file.finalPath);
      } else {
        try {
          await link(file.temporaryPath, file.finalPath);
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
          ) {
            throw new Error(`Output already exists: ${file.finalPath}`);
          }
          throw error;
        }
      }
    }
  } finally {
    await Promise.all(
      files.map((file) => rm(file.temporaryPath, { force: true })),
    );
  }
}
