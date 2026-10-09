import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export interface BundleAsset {
  fileName: string;
  contents: Buffer;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const modulePath = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 1024 &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  !value.startsWith("/") &&
  !value.includes(":") &&
  !value
    .split("/")
    .some((part) => ["", ".", "..", "node_modules"].includes(part));

/** Compiler-owned source mapping must match every supplied JS output. A shared
 * old source module prevents excluding a whole chunk from an older budget. */
function validatedSourceMap(assets: readonly BundleAsset[], manifest: unknown) {
  assert.ok(object(manifest) && manifest.schemaVersion === 1);
  assert.ok(
    Object.keys(manifest).length === 2 && Object.hasOwn(manifest, "chunks"),
  );
  assert.ok(Array.isArray(manifest.chunks) && manifest.chunks.length <= 2000);
  const javascript = assets.filter((asset) => asset.fileName.endsWith(".js"));
  const byFile = new Map(javascript.map((asset) => [asset.fileName, asset]));
  assert.equal(byFile.size, javascript.length, "Ambiguous output assets");
  const byModule = new Map<string, BundleAsset>();
  const modulesByFile = new Map<string, string[]>();
  for (const chunk of manifest.chunks) {
    assert.ok(object(chunk) && Object.keys(chunk).length === 3);
    assert.ok(
      typeof chunk.fileName === "string" &&
        /^assets\/[^/\\]+\.js$/u.test(chunk.fileName),
    );
    assert.ok(
      typeof chunk.sha256 === "string" && /^[0-9a-f]{64}$/u.test(chunk.sha256),
    );
    assert.ok(Array.isArray(chunk.modules) && chunk.modules.length <= 2000);
    const name = chunk.fileName.slice("assets/".length);
    const asset = byFile.get(name);
    assert.ok(
      asset && !modulesByFile.has(name),
      "Missing or ambiguous mapped output",
    );
    assert.equal(
      createHash("sha256").update(asset.contents).digest("hex"),
      chunk.sha256,
      "Build output hash mismatch",
    );
    const modules: string[] = [];
    for (const module of chunk.modules) {
      assert.ok(
        modulePath(module) && !byModule.has(module),
        "Unsafe or ambiguous source ownership",
      );
      modules.push(module);
      byModule.set(module, asset);
    }
    modulesByFile.set(name, modules);
  }
  assert.equal(modulesByFile.size, javascript.length, "Unmapped JS output");
  return { byModule, modulesByFile };
}

/** Find a source's owner for exact-fragment inspection. This does not classify
 * its full chunk as exclusive or authorize subtracting shared legacy bytes. */
export function assertNoExcludedBundleModules(
  assets: readonly BundleAsset[],
  manifest: unknown,
  excluded: readonly string[],
): void {
  assert.ok(excluded.every(modulePath));
  assert.equal(new Set(excluded).size, excluded.length);
  const { byModule } = validatedSourceMap(assets, manifest);
  for (const module of excluded)
    assert.ok(
      !byModule.has(module),
      `Runtime bundle includes CSS-excluded source: ${module}`,
    );
}

export function resolveBundleModuleAsset(
  assets: readonly BundleAsset[],
  manifest: unknown,
  module: string,
): BundleAsset {
  assert.ok(modulePath(module));
  const asset = validatedSourceMap(assets, manifest).byModule.get(module);
  assert.ok(asset, "Required source has no output owner");
  return asset;
}

export function resolveExclusiveBundleAssets(
  assets: readonly BundleAsset[],
  manifest: unknown,
  requiredModules: readonly string[],
  allowedModules: readonly string[],
): BundleAsset[] {
  assert.ok(requiredModules.length > 0 && requiredModules.every(modulePath));
  assert.ok(allowedModules.every(modulePath));
  assert.equal(new Set(requiredModules).size, requiredModules.length);
  assert.equal(new Set(allowedModules).size, allowedModules.length);
  const allowed = new Set(allowedModules);
  assert.ok(requiredModules.every((module) => allowed.has(module)));
  const { byModule, modulesByFile } = validatedSourceMap(assets, manifest);
  const selected = new Map<string, BundleAsset>();
  for (const module of requiredModules) {
    const asset = byModule.get(module);
    assert.ok(asset, "Required source has no output owner");
    assert.ok(
      modulesByFile.get(asset.fileName)!.every((source) => allowed.has(source)),
      "Feature chunk includes unrelated source",
    );
    selected.set(asset.fileName, asset);
  }
  return [...selected.values()].sort((a, b) =>
    a.fileName.localeCompare(b.fileName),
  );
}
