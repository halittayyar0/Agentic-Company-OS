import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

// Resolve only the OS-selected root. User-supplied paths still go through
// the strict symlink and ownership checks at their individual boundaries.
export function canonicalTempRoot(): string {
  return realpathSync(tmpdir());
}
