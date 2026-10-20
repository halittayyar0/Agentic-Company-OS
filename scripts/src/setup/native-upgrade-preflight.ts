import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import {
  readNativeDistribution,
  type NativeDistribution,
} from "./native-distribution";
import { readNativeLaunchPointer } from "./native-launch";
import { readNativeRelease, stableVersionParts } from "./native-release";
import { validateInstallationInput } from "./plan";
import { readBoundedRegularFile } from "./resume";

const migrationRoot = "artifacts/api-server/dist/db-migrations/";
const legacyVersions = new Map([
  ["8946dea16eeb314e66b078995b98d0e43a631fdc", "0.5.5"],
]);
const fingerprint = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("native_upgrade_identity");
  return value as Record<string, unknown>;
}

function identity(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

async function existingDirectory(value: string): Promise<string> {
  if (!path.isAbsolute(value)) throw new Error("native_upgrade_path");
  const resolved = path.resolve(value);
  const info = await lstat(resolved),
    actual = await realpath(resolved);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    identity(actual) !== identity(resolved)
  )
    throw new Error("native_upgrade_path");
  // An ancestor junction targeting the same physical directory is still an alias.
  let cursor = resolved;
  while (path.dirname(cursor) !== cursor) {
    if ((await lstat(cursor)).isSymbolicLink())
      throw new Error("native_upgrade_path");
    cursor = path.dirname(cursor);
  }
  return actual;
}

function overlaps(first: string, second: string): boolean {
  const a = identity(first),
    b = identity(second);
  const contains = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) &&
        relative !== ".." &&
        !path.isAbsolute(relative))
    );
  };
  return contains(a, b) || contains(b, a);
}

async function packageIdentity(root: string, allowLegacy: boolean) {
  const distribution = await readNativeDistribution(root);
  if (!distribution) throw new Error("native_upgrade_package_required");
  const release = await readNativeRelease(root, distribution);
  const applicationVersion =
    release?.applicationVersion ??
    (allowLegacy ? legacyVersions.get(distribution.commit) : undefined);
  if (!applicationVersion) throw new Error("native_upgrade_unknown_release");
  return {
    distribution,
    summary: {
      root,
      commit: distribution.commit,
      applicationVersion,
      target: distribution.target,
      postgresVersion: distribution.postgresVersion,
      nodeVersion: distribution.nodeVersion,
    },
  };
}

interface MigrationEntry {
  idx: number;
  version: "7";
  when: number;
  tag: string;
  breakpoints: boolean;
}

/** Shared by fresh inspection and journal recovery; live metadata may already
 * be guarded during recovery. This grants no authority to move any data.
 */
export async function inspectNativeUpgradePackages(input: {
  sourceRoot: string;
  targetRoot: string;
}) {
  const sourceRoot = await existingDirectory(input.sourceRoot),
    targetRoot = await existingDirectory(input.targetRoot);
  if (overlaps(sourceRoot, targetRoot)) throw new Error("native_upgrade_path");
  const source = await packageIdentity(sourceRoot, true),
    target = await packageIdentity(targetRoot, false);
  const from = stableVersionParts(source.summary.applicationVersion),
    to = stableVersionParts(target.summary.applicationVersion);
  if (
    from[0] !== 0 ||
    from[1] !== 5 ||
    from[2] < 5 ||
    to[0] !== 0 ||
    to[1] !== 5 ||
    to[2] <= from[2] ||
    source.summary.commit === target.summary.commit ||
    source.summary.target !== target.summary.target
  )
    throw new Error("native_upgrade_unsupported_version");
  const oldEntries = await readNativeMigrationHistory(
      sourceRoot,
      source.distribution,
    ),
    newEntries = await readNativeMigrationHistory(
      targetRoot,
      target.distribution,
    );
  if (newEntries.length < oldEntries.length)
    throw new Error("native_upgrade_migration_history");
  const oldFiles = new Map(
      source.distribution.files.map((file) => [file.path, file]),
    ),
    newFiles = new Map(
      target.distribution.files.map((file) => [file.path, file]),
    );
  for (const row of oldEntries) {
    const file = `${migrationRoot}${row.tag}.sql`;
    if (
      JSON.stringify(row) !== JSON.stringify(newEntries[row.idx]) ||
      oldFiles.get(file)?.sha256 !== newFiles.get(file)?.sha256 ||
      oldFiles.get(file)?.bytes !== newFiles.get(file)?.bytes
    )
      throw new Error("native_upgrade_migration_history");
  }
  return {
    source,
    target,
    migrations: {
      retained: oldEntries.length,
      added: newEntries.length - oldEntries.length,
    },
  };
}

export async function readNativeMigrationHistory(
  root: string,
  distribution: NativeDistribution,
): Promise<MigrationEntry[]> {
  try {
    const journalPath = `${migrationRoot}meta/_journal.json`;
    const declared = distribution.files.find(
      (file) => file.path === journalPath,
    );
    const bytes = await readBoundedRegularFile(
      path.join(root, journalPath),
      1024 * 1024,
      { rejectSymlinks: true },
    );
    if (
      !declared ||
      declared.bytes !== Buffer.byteLength(bytes) ||
      declared.sha256 !== fingerprint(bytes)
    )
      throw new Error("changed migration journal");
    const value = object(JSON.parse(bytes));
    if (
      Object.keys(value).sort().join(",") !== "dialect,entries,version" ||
      value.dialect !== "postgresql" ||
      value.version !== "7" ||
      !Array.isArray(value.entries) ||
      !value.entries.length ||
      value.entries.length > 4096
    )
      throw new Error("invalid journal");
    let previous = -1;
    const files = new Set(distribution.files.map((file) => file.path));
    return value.entries.map((entry, index) => {
      const row = object(entry);
      if (
        Object.keys(row).sort().join(",") !==
          "breakpoints,idx,tag,version,when" ||
        row.idx !== index ||
        row.version !== "7" ||
        !Number.isSafeInteger(row.when) ||
        Number(row.when) <= previous ||
        typeof row.breakpoints !== "boolean" ||
        typeof row.tag !== "string" ||
        row.tag.length > 160 ||
        !new RegExp(`^${String(index).padStart(4, "0")}_[a-z0-9_]+$`, "u").test(
          row.tag,
        ) ||
        !files.has(`${migrationRoot}${row.tag}.sql`)
      )
        throw new Error("invalid migration entry");
      previous = row.when as number;
      return {
        idx: index,
        version: "7",
        when: previous,
        tag: row.tag,
        breakpoints: row.breakpoints,
      };
    });
  } catch {
    throw new Error("native_upgrade_migration_history");
  }
}

/** Read-only compatibility evidence, NOT permission to mutate or start an installation.
 * The upgrade coordinator must repeat this inspection under the OS instance lease.
 * Never call resume's directory-creating helpers or probe Docker/providers here.
 */
export async function inspectNativeUpgrade(input: {
  directory: string;
  targetRoot: string;
}) {
  const directory = await existingDirectory(input.directory);
  const metadataFile = path.join(directory, "installation.json");
  const metadataBytes = await readBoundedRegularFile(metadataFile, 64000, {
    rejectSymlinks: true,
  });
  let saved: Record<string, unknown>,
    plan: Record<string, unknown>,
    options: Record<string, unknown>;
  try {
    saved = object(JSON.parse(metadataBytes));
    plan = object(saved.plan);
    options = object(saved.runtimeOptions);
  } catch {
    throw new Error("native_upgrade_identity");
  }
  if (
    saved.schemaVersion !== 1 ||
    saved.phase !== "complete" ||
    plan.schemaVersion !== 1 ||
    typeof plan.id !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(plan.id) ||
    path.basename(directory) !== `instance-${plan.id}` ||
    typeof saved.workspaceRoot !== "string"
  )
    throw new Error("native_upgrade_identity");
  const settings = validateInstallationInput(plan.settings);
  if (settings.mode !== "native" || settings.codingRuntime)
    throw new Error("native_upgrade_managed_native_required");
  const sourceRoot = await existingDirectory(saved.workspaceRoot);
  const targetRoot = await existingDirectory(input.targetRoot);
  if (
    overlaps(sourceRoot, targetRoot) ||
    overlaps(sourceRoot, directory) ||
    overlaps(targetRoot, directory)
  )
    throw new Error("native_upgrade_path");
  const { source, target, migrations } = await inspectNativeUpgradePackages({
    sourceRoot,
    targetRoot,
  });
  if (options.nativeBundleCommit !== source.summary.commit)
    throw new Error("native_upgrade_identity");

  const parent = path.dirname(directory);
  const pointerFile = path.join(parent, "native-launch.json");
  const pointerBytes = await readBoundedRegularFile(pointerFile, 8192, {
    rejectSymlinks: true,
  });
  if (
    (await readNativeLaunchPointer(
      parent,
      saved.workspaceRoot,
      source.summary.commit,
    )) !== directory
  )
    throw new Error("native_upgrade_identity");
  const secrets = await existingDirectory(path.join(directory, "secrets"));
  const names = [
    "database_url",
    "operator_auth_token",
    "runtime_control_key",
    ...(["openai", "openrouter"].includes(settings.provider)
      ? ["provider_key"]
      : []),
  ];
  for (const name of names) {
    const value = await readBoundedRegularFile(path.join(secrets, name), 4096, {
      rejectSymlinks: true,
    });
    if (!value || /[\r\n\0]/u.test(value))
      throw new Error("native_upgrade_credentials");
    if (name === "database_url") {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new Error("native_upgrade_database_identity");
      }
      if (
        url.protocol !== "postgresql:" ||
        url.hostname !== "127.0.0.1" ||
        url.username !== "agentic" ||
        !url.password ||
        url.pathname !== "/postgres" ||
        Number(url.port) < 1024 ||
        !url.port ||
        url.search ||
        url.hash
      )
        throw new Error("native_upgrade_database_identity");
    }
  }
  if (options.ollamaUrl !== undefined) {
    let url: URL;
    try {
      url = new URL(String(options.ollamaUrl));
    } catch {
      throw new Error("native_upgrade_model_endpoint");
    }
    if (
      typeof options.ollamaUrl !== "string" ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      /[\r\n\0]/u.test(options.ollamaUrl)
    )
      throw new Error("native_upgrade_model_endpoint");
  }
  if (
    metadataBytes !==
      (await readBoundedRegularFile(metadataFile, 64000, {
        rejectSymlinks: true,
      })) ||
    pointerBytes !==
      (await readBoundedRegularFile(pointerFile, 8192, {
        rejectSymlinks: true,
      }))
  )
    throw new Error("native_upgrade_identity_changed");
  return {
    source: source.summary,
    target: target.summary,
    installation: {
      directory,
      id: plan.id,
      locale: settings.locale,
      port: settings.port,
      metadataSha256: fingerprint(metadataBytes),
      pointerSha256: fingerprint(pointerBytes),
    },
    migrations,
  };
}
