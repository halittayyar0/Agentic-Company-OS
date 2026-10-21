import { createHash } from "node:crypto";
import path from "node:path";
import type { NativeDistribution } from "./native-distribution";
import { readBoundedRegularFile } from "./resume";

export interface NativeRelease {
  schemaVersion: 1;
  applicationVersion: string;
  commit: string;
  upgradeProtocol: 1;
}

export function stableVersionParts(value: unknown): number[] {
  if (
    typeof value !== "string" ||
    value.length > 48 ||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(value)
  )
    throw new Error("native_release_version");
  const parts = value.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger))
    throw new Error("native_release_version");
  return parts;
}

export function validateNativeRelease(
  value: unknown,
  commit: string,
): NativeRelease {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("native_release_identity");
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",") !==
      "applicationVersion,commit,schemaVersion,upgradeProtocol" ||
    row.schemaVersion !== 1 ||
    row.upgradeProtocol !== 1 ||
    !/^[a-f0-9]{40}$/u.test(commit) ||
    row.commit !== commit
  )
    throw new Error("native_release_identity");
  stableVersionParts(row.applicationVersion);
  return {
    schemaVersion: 1,
    applicationVersion: row.applicationVersion as string,
    commit,
    upgradeProtocol: 1,
  };
}

export function createNativeRelease(
  applicationVersion: string,
  commit: string,
): NativeRelease {
  return validateNativeRelease(
    { schemaVersion: 1, applicationVersion, commit, upgradeProtocol: 1 },
    commit,
  );
}

/** Only inventoried metadata is authoritative. Legacy packages had no version file. */
export async function readNativeRelease(
  root: string,
  distribution: NativeDistribution,
): Promise<NativeRelease | null> {
  const row = distribution.files.find(
    (file) => file.path === "native-release.json",
  );
  if (!row) return null;
  try {
    const bytes = await readBoundedRegularFile(
      path.join(root, row.path),
      4096,
      { rejectSymlinks: true },
    );
    if (
      Buffer.byteLength(bytes) !== row.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== row.sha256
    )
      throw new Error("changed release bytes");
    return validateNativeRelease(JSON.parse(bytes), distribution.commit);
  } catch {
    throw new Error("native_release_identity");
  }
}
