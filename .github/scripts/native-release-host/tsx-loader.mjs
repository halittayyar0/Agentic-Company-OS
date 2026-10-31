import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
export function ownedTsxLoader(applicationRoot) {
  assert.ok(
    path.isAbsolute(applicationRoot),
    "absolute_application_root_required",
  );
  return pathToFileURL(
    path.join(applicationRoot, "node_modules/tsx/dist/loader.mjs"),
  ).href;
}
