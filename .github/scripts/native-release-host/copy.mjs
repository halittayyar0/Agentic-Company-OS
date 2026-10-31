import assert from "node:assert/strict";
import { readFile, readdir, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export async function verifyDriverCopy(trackedDirectory, copiedDirectory) {
  for (const directory of [trackedDirectory, copiedDirectory]) {
    const meta = await lstat(directory);
    assert.ok(
      meta.isDirectory() && !meta.isSymbolicLink(),
      "regular_driver_directory_required",
    );
  }
  const source = await readdir(trackedDirectory, { withFileTypes: true });
  assert.ok(
    source.length > 0 && source.length <= 64,
    "bounded_flat_driver_source_required",
  );
  const names = new Set(),
    manifest = [];
  for (const entry of source.sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  )) {
    assert.ok(
      entry.isFile() && !entry.isSymbolicLink(),
      "flat_regular_driver_source_required",
    );
    assert.match(
      entry.name,
      /^[a-z0-9][a-z0-9._-]*\.(?:mjs|mts|py|json|md|ps1)$/u,
      "known_driver_source_filename_required",
    );
    names.add(entry.name);
    const original = path.join(trackedDirectory, entry.name),
      copy = path.join(copiedDirectory, entry.name);
    for (const file of [original, copy]) {
      const meta = await lstat(file);
      assert.ok(
        meta.isFile() && !meta.isSymbolicLink() && meta.size <= 2 * 1024 * 1024,
        "bounded_regular_driver_file_required",
      );
    }
    const originalBytes = await readFile(original),
      copyBytes = await readFile(copy);
    assert.deepEqual(copyBytes, originalBytes, "copied_driver_bytes_changed");
    manifest.push({
      file: entry.name,
      bytes: originalBytes.length,
      sha256: createHash("sha256").update(originalBytes).digest("hex"),
    });
  }
  const generated = new Set([
    "fresh-package-driver.mts",
    "baseline-package-driver.mts",
    "ordinary-native-host.ps1",
    "private-context-path.txt",
  ]);
  for (const entry of await readdir(copiedDirectory, { withFileTypes: true })) {
    assert.ok(
      entry.isFile() && !entry.isSymbolicLink(),
      "unexpected_copied_driver_code",
    );
    assert.ok(
      names.has(entry.name) || generated.has(entry.name),
      "unexpected_copied_driver_code",
    );
  }
  return manifest;
}
