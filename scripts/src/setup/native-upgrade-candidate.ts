import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { OwnerPrivateStorage } from "@workspace/ai-server/owner-private-storage";
import { readBoundedRegularFile } from "./installation-files";
import { readNativeDistribution } from "./native-distribution";
import { readNativeRelease } from "./native-release";
import { readNativeUpgradeJournal } from "./native-upgrade-journal";
import {
  inspectNativeUpgrade,
  inspectNativeUpgradePackages,
} from "./native-upgrade-preflight";
import { validateInstallationInput, type InstallationInput } from "./plan";

export interface NativeUpgradeCandidate {
  mode: "upgrade" | "retry" | "recover";
  directory: string;
  installationId: string;
  locale: InstallationInput["locale"];
  sourceVersion: string;
  targetVersion: string;
  sourceCommit: string;
  targetCommit: string;
  metadataSha256: string;
  pointerSha256: string;
  upgradeId?: string;
}
const hash = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");
const same = (a: string, b: string) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
async function directory(value: string) {
  if (!path.isAbsolute(value)) throw new Error("invalid path");
  const resolved = path.resolve(value),
    actual = await realpath(resolved),
    info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink() || !same(resolved, actual))
    throw new Error("redirected path");
  return actual;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid record");
  return value as Record<string, unknown>;
}

/** Read-only discovery for the local setup session. This never relaxes ordinary
 * launch-pointer validation, initializes a directory, probes services, or returns
 * credentials. Only absence of a remembered pointer can mean a fresh setup.
 */
export async function discoverNativeUpgradeCandidate(input: {
  installationParent: string;
  targetRoot: string;
  directory?: string;
}): Promise<NativeUpgradeCandidate | null> {
  try {
    let parent: string;
    try {
      parent = await directory(
        input.directory
          ? path.dirname(input.directory)
          : input.installationParent,
      );
    } catch (error) {
      if (
        !input.directory &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
        return null;
      throw error;
    }
    let pointerBytes: string;
    try {
      pointerBytes = await readBoundedRegularFile(
        path.join(parent, "native-launch.json"),
        8192,
        { rejectSymlinks: true },
      );
    } catch (error) {
      if (
        !input.directory &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
        return null;
      throw error;
    }
    const pointer = object(JSON.parse(pointerBytes));
    if (
      Object.keys(pointer).sort().join(",") !==
        "commit,directory,schemaVersion,workspaceRoot" ||
      pointer.schemaVersion !== 1 ||
      typeof pointer.commit !== "string" ||
      !/^[a-f0-9]{40}$/u.test(pointer.commit) ||
      typeof pointer.workspaceRoot !== "string" ||
      !path.isAbsolute(pointer.workspaceRoot) ||
      typeof pointer.directory !== "string" ||
      !path.isAbsolute(pointer.directory) ||
      !same(path.dirname(pointer.directory), parent) ||
      !/^instance-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(
        path.basename(pointer.directory),
      )
    )
      throw new Error("invalid pointer");
    const instance = await directory(pointer.directory),
      targetRoot = await directory(input.targetRoot);
    if (input.directory && !same(await directory(input.directory), instance))
      throw new Error("different instance");
    const storage = new OwnerPrivateStorage(instance);
    const liveBytes = await storage.read("installation.json");
    if (!liveBytes) throw new Error("missing installation");
    const live = object(JSON.parse(liveBytes)),
      livePlan = object(live.plan);
    if (
      live.schemaVersion !== 1 ||
      livePlan.schemaVersion !== 1 ||
      livePlan.id !== path.basename(instance).slice(9)
    )
      throw new Error("invalid installation");
    const settings = validateInstallationInput(livePlan.settings);
    if (settings.mode !== "native" || settings.codingRuntime)
      throw new Error("not managed native");
    const journal = await readNativeUpgradeJournal(instance);
    if (journal && !["complete", "abandoned"].includes(journal.phase)) {
      if (
        journal.targetRoot !== targetRoot ||
        journal.installationId !== livePlan.id
      )
        throw new Error("different target");
      const packages = await inspectNativeUpgradePackages(journal);
      if (
        packages.source.summary.commit !== journal.sourceCommit ||
        packages.target.summary.commit !== journal.targetCommit
      )
        throw new Error("changed package");
      if (!(
        (path.resolve(pointer.workspaceRoot) === journal.sourceRoot &&
          pointer.commit === journal.sourceCommit) ||
        (path.resolve(pointer.workspaceRoot) === journal.targetRoot &&
          pointer.commit === journal.targetCommit)
      ))
        throw new Error("foreign pointer");
      const originalBytes =
        journal.phase === "preparing"
          ? liveBytes
          : await new OwnerPrivateStorage(
              path.join(instance, "native-upgrades", journal.upgradeId),
            ).read("original-installation.json");
      if (
        !originalBytes ||
        hash(originalBytes) !== journal.originalMetadataSha256
      )
        throw new Error("changed original record");
      const original = object(JSON.parse(originalBytes)),
        plan = object(original.plan),
        options = object(original.runtimeOptions);
      const originalSettings = validateInstallationInput(plan.settings);
      if (
        original.phase !== "complete" ||
        plan.id !== journal.installationId ||
        originalSettings.mode !== "native" ||
        originalSettings.codingRuntime ||
        typeof original.workspaceRoot !== "string" ||
        path.resolve(original.workspaceRoot) !== journal.sourceRoot ||
        options.nativeBundleCommit !== journal.sourceCommit
      )
        throw new Error("invalid original record");
      return {
        mode: journal.phase === "preparing" ? "retry" : "recover",
        directory: instance,
        installationId: journal.installationId,
        locale: originalSettings.locale,
        sourceVersion: packages.source.summary.applicationVersion,
        targetVersion: packages.target.summary.applicationVersion,
        sourceCommit: journal.sourceCommit,
        targetCommit: journal.targetCommit,
        upgradeId: journal.upgradeId,
        metadataSha256: journal.originalMetadataSha256,
        pointerSha256: hash(pointerBytes),
      };
    }
    const target = await readNativeDistribution(targetRoot);
    if (!target || !(await readNativeRelease(targetRoot, target)))
      throw new Error("missing native target");
    if (
      pointer.commit === target.commit &&
      path.resolve(pointer.workspaceRoot) === targetRoot
    ) {
      if (
        typeof live.workspaceRoot !== "string" ||
        path.resolve(live.workspaceRoot) !== targetRoot ||
        object(live.runtimeOptions).nativeBundleCommit !== target.commit
      )
        throw new Error("different current record");
      if (
        journal &&
        journal.phase === "complete" &&
        (journal.targetRoot !== targetRoot ||
          journal.targetCommit !== target.commit)
      )
        throw new Error("different completed upgrade");
      return null;
    }
    const inspected = await inspectNativeUpgrade({
      directory: instance,
      targetRoot,
    });
    return {
      mode: "upgrade",
      directory: instance,
      installationId: inspected.installation.id,
      locale: inspected.installation.locale,
      sourceVersion: inspected.source.applicationVersion,
      targetVersion: inspected.target.applicationVersion,
      sourceCommit: inspected.source.commit,
      targetCommit: inspected.target.commit,
      metadataSha256: inspected.installation.metadataSha256,
      pointerSha256: inspected.installation.pointerSha256,
    };
  } catch {
    throw new Error("native_upgrade_candidate_invalid");
  }
}
