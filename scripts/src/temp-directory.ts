import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

// Resolve only the OS-selected root. User-supplied paths still go through
// the strict symlink and ownership checks at their individual boundaries.
export function canonicalTempRoot(): string {
  // The JavaScript implementation preserves Windows 8.3 spellings, whereas
  // promises.realpath (used by our guards) expands them through the native API.
  return realpathSync.native(tmpdir());
}
