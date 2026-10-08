// Derived from the SHA-512 verified official Codex0.159.2 linux-x64 package.
// A vendor version string alone is never accepted as a compatible system tool.
export const PINNED_CODEX_BWRAP_SHA256 =
  "77360cb751ccedc5971391444ac86a8a33c15b04d6b4a6fe45f5d25496e62c4c";

export function acceptsLinuxBwrapIdentity(input: {
  version: string;
  help: string;
  sha256: string;
  architecture: string;
}): boolean {
  if (!/--argv0\s+VALUE\b/u.test(input.help)) return false;
  if (/^bubblewrap 0\.(?:[6-9]|[1-9]\d+)\.\d+\s*$/u.test(input.version))
    return true;
  return (
    input.version.trim() === "bubblewrap built for Codex" &&
    input.architecture === "x64" &&
    input.sha256 === PINNED_CODEX_BWRAP_SHA256
  );
}
