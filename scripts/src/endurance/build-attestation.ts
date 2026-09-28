import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  EnduranceBuildAttestation,
  EnduranceRuntime,
  NativeRuntimeDependencyAttestation,
} from "./report-schema";
import {
  hashExactDirectoryTree,
  requireNode24Version,
} from "./native-runtime-provenance";

const BUILD_TIMEOUT_MS = 15 * 60_000;
const NATIVE_RUNTIME_PATHS = [
  "artifacts/api-server/dist",
  "artifacts/agentic-company-os/dist/public",
] as const;
const NATIVE_EXTERNAL_RUNTIME_DEPENDENCIES = [
  {
    name: "@electric-sql/pglite",
    sourcePath: "artifacts/api-server/node_modules/@electric-sql/pglite",
    deployedPath: "artifacts/api-server/dist/node_modules/@electric-sql/pglite",
  },
  {
    name: "playwright-core",
    sourcePath: "artifacts/api-server/node_modules/playwright-core",
    deployedPath: "artifacts/api-server/dist/node_modules/playwright-core",
  },
] as const;
const DOCKER_CONTEXT_PATHS = [
  ".dockerignore",
  "Dockerfile",
  "compose.yaml",
  "compose.soak.yaml",
] as const;

interface ArtifactFile {
  path: string;
  size: number;
  sha256: string;
}

interface RuntimeArtifactDigest {
  digest: string;
  fileCount: number;
  nativeRuntimeDependencies?: NativeRuntimeDependencyAttestation[];
}

export interface WallClockSourceIdentity {
  sourceCommitSha: string;
  sourceTreeSha256: string;
}

function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pathIdentity(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32"
    ? resolved.toLocaleLowerCase("en-US")
    : resolved;
}

function gitOutput(workspaceRoot: string, args: string[]): Buffer {
  return execFileSync("git", args, {
    cwd: workspaceRoot,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
}

async function exactWorkspaceRoot(workspaceRoot: string): Promise<string> {
  const requested = path.resolve(workspaceRoot);
  const metadata = await lstat(requested);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Endurance workspace must be a real directory");
  }
  const actual = await realpath(requested);
  if (pathIdentity(actual) !== pathIdentity(requested)) {
    throw new Error("Endurance workspace must not be redirected");
  }
  return actual;
}

function canonicalCommit(value: string, label: string): string {
  const commit = value.trim().toLowerCase();
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(commit)) {
    throw new Error(`${label} must be a full Git commit SHA`);
  }
  return commit;
}

function assertExactCleanCommit(
  workspaceRoot: string,
  expectedCommitSha: string,
): string {
  const expected = canonicalCommit(expectedCommitSha, "Expected commit");
  const actual = canonicalCommit(
    gitOutput(workspaceRoot, ["rev-parse", "--verify", "HEAD"]).toString(
      "utf8",
    ),
    "Workspace HEAD",
  );
  if (actual !== expected) {
    throw new Error(
      `Endurance workspace commit mismatch: expected ${expected}, received ${actual}`,
    );
  }
  const status = gitOutput(workspaceRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ".",
  ]).toString("utf8");
  if (status.length > 0) {
    throw new Error(
      "Endurance wall-clock execution requires a clean Git working tree",
    );
  }
  return actual;
}

function sourceTreeDigest(workspaceRoot: string): string {
  return sha256(
    gitOutput(workspaceRoot, ["ls-tree", "-r", "--full-tree", "HEAD"]),
  );
}

export async function readWallClockSourceIdentity(input: {
  workspaceRoot: string;
  expectedCommitSha?: string;
}): Promise<WallClockSourceIdentity> {
  const workspaceRoot = await exactWorkspaceRoot(input.workspaceRoot);
  const actualCommitSha = canonicalCommit(
    gitOutput(workspaceRoot, ["rev-parse", "--verify", "HEAD"]).toString(
      "utf8",
    ),
    "Workspace HEAD",
  );
  const expectedCommitSha = input.expectedCommitSha
    ? canonicalCommit(input.expectedCommitSha, "Expected commit")
    : actualCommitSha;
  const sourceCommitSha = assertExactCleanCommit(
    workspaceRoot,
    expectedCommitSha,
  );
  return {
    sourceCommitSha,
    sourceTreeSha256: sourceTreeDigest(workspaceRoot),
  };
}

function relativeArtifactPath(workspaceRoot: string, target: string): string {
  const relative = path.relative(workspaceRoot, target);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Runtime artifact escaped the endurance workspace");
  }
  return relative.split(path.sep).join("/");
}

async function collectArtifactFiles(
  workspaceRoot: string,
  target: string,
  files: ArtifactFile[],
): Promise<void> {
  const metadata = await lstat(target).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(
        `Required runtime artifact is missing: ${relativeArtifactPath(workspaceRoot, target)}`,
      );
    }
    throw error;
  });
  if (metadata.isSymbolicLink()) {
    throw new Error("Runtime artifact paths must not contain symbolic links");
  }
  const actual = await realpath(target);
  if (pathIdentity(actual) !== pathIdentity(target)) {
    throw new Error("Runtime artifact path was redirected");
  }
  if (metadata.isDirectory()) {
    const entries = await readdir(target, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isFile()) {
        throw new Error("Runtime artifacts must be regular files");
      }
      await collectArtifactFiles(
        workspaceRoot,
        path.join(target, entry.name),
        files,
      );
    }
    return;
  }
  if (!metadata.isFile()) {
    throw new Error("Runtime artifacts must be regular files");
  }
  const bytes = await readFile(actual);
  files.push({
    path: relativeArtifactPath(workspaceRoot, actual),
    size: bytes.length,
    sha256: sha256(bytes),
  });
}

function pathBelow(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative.length > 0 &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

async function materializeNativeRuntimeDependencies(
  isolatedWorkspaceRoot: string,
): Promise<void> {
  for (const dependency of NATIVE_EXTERNAL_RUNTIME_DEPENDENCIES) {
    const sourceRequested = path.join(
      isolatedWorkspaceRoot,
      ...dependency.sourcePath.split("/"),
    );
    const sourceMetadata = await lstat(sourceRequested).catch(() => null);
    if (
      !sourceMetadata ||
      (!sourceMetadata.isDirectory() && !sourceMetadata.isSymbolicLink())
    ) {
      throw new Error(
        `Native runtime dependency ${dependency.name} is missing from the isolated frozen install`,
      );
    }
    const source = await realpath(sourceRequested);
    if (
      !pathBelow(isolatedWorkspaceRoot, source) ||
      !(await lstat(source)).isDirectory()
    ) {
      throw new Error(
        `Native runtime dependency ${dependency.name} escaped the isolated frozen install`,
      );
    }
    const destination = path.join(
      isolatedWorkspaceRoot,
      ...dependency.deployedPath.split("/"),
    );
    if (await lstat(destination).catch(() => null)) {
      throw new Error(
        `Native runtime dependency destination already exists: ${dependency.name}`,
      );
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: true,
    });
    await hashExactDirectoryTree(
      destination,
      `Materialized native runtime dependency ${dependency.name}`,
    );
  }
}

async function nativeRuntimeDependencyAttestations(
  workspaceRoot: string,
): Promise<NativeRuntimeDependencyAttestation[]> {
  const attestations: NativeRuntimeDependencyAttestation[] = [];
  for (const dependency of NATIVE_EXTERNAL_RUNTIME_DEPENDENCIES) {
    const target = path.join(
      workspaceRoot,
      ...dependency.deployedPath.split("/"),
    );
    const digest = await hashExactDirectoryTree(
      target,
      `Native runtime dependency ${dependency.name}`,
    );
    const packageDocument = JSON.parse(
      await readFile(path.join(target, "package.json"), "utf8"),
    ) as { name?: unknown; version?: unknown };
    if (
      packageDocument.name !== dependency.name ||
      typeof packageDocument.version !== "string" ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(packageDocument.version)
    ) {
      throw new Error(
        `Native runtime dependency ${dependency.name} has invalid package identity`,
      );
    }
    attestations.push({
      name: dependency.name,
      version: packageDocument.version,
      path: dependency.deployedPath,
      sha256: digest.sha256,
      fileCount: digest.fileCount,
    });
  }
  return attestations;
}

async function runtimeArtifactDigest(input: {
  workspaceRoot: string;
  runtime: EnduranceRuntime;
  sourceTreeSha256: string;
}): Promise<RuntimeArtifactDigest> {
  const paths =
    input.runtime === "native-postgres"
      ? NATIVE_RUNTIME_PATHS
      : DOCKER_CONTEXT_PATHS;
  const files: ArtifactFile[] = [];
  for (const relative of paths) {
    await collectArtifactFiles(
      input.workspaceRoot,
      path.join(input.workspaceRoot, ...relative.split("/")),
      files,
    );
  }
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (files.length === 0) {
    throw new Error("Runtime artifact manifest is empty");
  }
  const manifest = [
    `runtime:${input.runtime}`,
    `source-tree:${input.sourceTreeSha256}`,
    ...files.map((file) => `${file.path}\0${file.size}\0${file.sha256}`),
  ].join("\n");
  return {
    digest: sha256(`${manifest}\n`),
    fileCount: files.length,
    ...(input.runtime === "native-postgres"
      ? {
          nativeRuntimeDependencies: await nativeRuntimeDependencyAttestations(
            input.workspaceRoot,
          ),
        }
      : {}),
  };
}

function runFrozenNativeProductionBuild(
  workspaceRoot: string,
  environment: NodeJS.ProcessEnv,
): void {
  const npmExecPath = environment.npm_execpath?.trim();
  if (!npmExecPath || !path.isAbsolute(npmExecPath)) {
    throw new Error(
      "Native endurance build requires an absolute npm_execpath from pnpm",
    );
  }
  const version = execFileSync(process.execPath, [npmExecPath, "--version"], {
    cwd: workspaceRoot,
    env: environment,
    encoding: "utf8",
    timeout: BUILD_TIMEOUT_MS,
    windowsHide: true,
  }).trim();
  if (version !== "10.17.1") {
    throw new Error(
      `Native endurance build requires pnpm 10.17.1, received ${version}`,
    );
  }
  execFileSync(
    process.execPath,
    [npmExecPath, "install", "--frozen-lockfile", "--force"],
    {
      cwd: workspaceRoot,
      env: { ...environment, CI: "true" },
      stdio: "inherit",
      timeout: BUILD_TIMEOUT_MS,
      windowsHide: true,
    },
  );
  execFileSync(process.execPath, [npmExecPath, "run", "build"], {
    cwd: workspaceRoot,
    env: { ...environment, CI: "true" },
    stdio: "inherit",
    timeout: BUILD_TIMEOUT_MS,
    windowsHide: true,
  });
}

async function withIsolatedNativeBuild<T>(input: {
  workspaceRoot: string;
  sourceCommitSha: string;
  environment: NodeJS.ProcessEnv;
  runNativeBuild?: (isolatedWorkspaceRoot: string) => Promise<void> | void;
  consume: (isolatedWorkspaceRoot: string) => Promise<T>;
}): Promise<T> {
  const isolatedRoot = await mkdtemp(
    path.join(tmpdir(), "agentic-native-build-"),
  );
  const isolatedWorkspaceRoot = path.join(isolatedRoot, "checkout");
  try {
    execFileSync(
      "git",
      [
        "clone",
        "--quiet",
        "--no-hardlinks",
        "--no-checkout",
        "--",
        input.workspaceRoot,
        isolatedWorkspaceRoot,
      ],
      {
        cwd: isolatedRoot,
        encoding: "buffer",
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      },
    );
    execFileSync(
      "git",
      ["checkout", "--quiet", "--detach", input.sourceCommitSha],
      {
        cwd: isolatedWorkspaceRoot,
        encoding: "buffer",
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      },
    );
    assertExactCleanCommit(isolatedWorkspaceRoot, input.sourceCommitSha);
    if (input.runNativeBuild) {
      await input.runNativeBuild(isolatedWorkspaceRoot);
    } else {
      runFrozenNativeProductionBuild(isolatedWorkspaceRoot, input.environment);
    }
    await materializeNativeRuntimeDependencies(isolatedWorkspaceRoot);
    assertExactCleanCommit(isolatedWorkspaceRoot, input.sourceCommitSha);
    return await input.consume(isolatedWorkspaceRoot);
  } finally {
    await rm(isolatedRoot, { recursive: true, force: true });
  }
}

async function requireExactDirectory(
  directory: string,
  label: string,
): Promise<string> {
  const requested = path.resolve(directory);
  const metadata = await lstat(requested).catch(() => null);
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be an exact real directory`);
  }
  const actual = await realpath(requested);
  if (pathIdentity(actual) !== pathIdentity(requested)) {
    throw new Error(`${label} must not be redirected`);
  }
  return actual;
}

async function ensureExactDirectoryChain(
  rootDirectory: string,
  targetDirectory: string,
): Promise<void> {
  const root = await requireExactDirectory(rootDirectory, "Native build root");
  const target = path.resolve(targetDirectory);
  const relative = path.relative(root, target);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Native build directory escaped its exact root");
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    await requireExactDirectory(current, "Native build ancestor");
    const next = path.join(current, segment);
    const metadata = await lstat(next).catch((error: unknown) => {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    });
    if (!metadata) {
      await requireExactDirectory(current, "Native build ancestor");
      await mkdir(next, { recursive: false });
    }
    await requireExactDirectory(next, "Native build ancestor");
    current = next;
  }
}

function requireDirectChild(
  parent: string,
  child: string,
  label: string,
): void {
  if (
    pathIdentity(path.dirname(path.resolve(child))) !== pathIdentity(parent)
  ) {
    throw new Error(`${label} escaped its exact parent`);
  }
}

async function requireExactChildDirectory(
  parent: string,
  child: string,
  label: string,
): Promise<void> {
  await requireExactDirectory(parent, `${label} parent`);
  requireDirectChild(parent, child, label);
  await requireExactDirectory(child, label);
}

async function assertExactMissing(
  parent: string,
  child: string,
  label: string,
): Promise<void> {
  await requireExactDirectory(parent, `${label} parent`);
  requireDirectChild(parent, child, label);
  const metadata = await lstat(child).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (metadata) throw new Error(`${label} already exists`);
}

async function removeExactChildDirectory(
  parent: string,
  child: string,
  label: string,
): Promise<void> {
  await requireExactChildDirectory(parent, child, label);
  await hashExactDirectoryTree(child, label);
  await requireExactDirectory(parent, `${label} parent`);
  await requireExactDirectory(child, label);
  await rm(child, { recursive: true, force: false });
}

async function replaceDirectoryFromIsolatedBuild(input: {
  workspaceRoot: string;
  isolatedWorkspaceRoot: string;
  relativePath: string;
}): Promise<void> {
  const segments = input.relativePath.split("/");
  const source = path.join(input.isolatedWorkspaceRoot, ...segments);
  const target = path.join(input.workspaceRoot, ...segments);
  const parent = path.dirname(target);
  await hashExactDirectoryTree(source, `Isolated ${input.relativePath}`);
  await ensureExactDirectoryChain(input.workspaceRoot, parent);
  const nonce = randomUUID().replaceAll("-", "");
  const stage = path.join(parent, `.${path.basename(target)}.stage-${nonce}`);
  const backup = path.join(parent, `.${path.basename(target)}.backup-${nonce}`);
  let stageExists = false;
  let backupExists = false;
  let targetInstalled = false;
  try {
    await assertExactMissing(parent, stage, "Native build stage");
    await cp(source, stage, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
    });
    stageExists = true;
    await requireExactChildDirectory(parent, stage, "Native build stage");
    await hashExactDirectoryTree(stage, "Native build stage");
    await ensureExactDirectoryChain(input.workspaceRoot, parent);
    const existing = await lstat(target).catch((error: unknown) => {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    });
    if (existing) {
      await requireExactChildDirectory(
        parent,
        target,
        "Existing native runtime artifact",
      );
      await hashExactDirectoryTree(target, "Existing native runtime artifact");
      await assertExactMissing(parent, backup, "Native build backup");
      await ensureExactDirectoryChain(input.workspaceRoot, parent);
      await requireExactChildDirectory(
        parent,
        target,
        "Existing native runtime artifact",
      );
      await rename(target, backup);
      backupExists = true;
      await requireExactChildDirectory(parent, backup, "Native build backup");
    }
    try {
      await ensureExactDirectoryChain(input.workspaceRoot, parent);
      await requireExactChildDirectory(parent, stage, "Native build stage");
      await assertExactMissing(parent, target, "Native runtime target");
      await rename(stage, target);
      stageExists = false;
      targetInstalled = true;
      await requireExactChildDirectory(
        parent,
        target,
        "Deployed native runtime artifact",
      );
    } catch (installError) {
      if (backupExists) {
        try {
          await ensureExactDirectoryChain(input.workspaceRoot, parent);
          await requireExactChildDirectory(
            parent,
            backup,
            "Native build backup",
          );
          await assertExactMissing(parent, target, "Native runtime target");
          await rename(backup, target);
          backupExists = false;
          await requireExactChildDirectory(
            parent,
            target,
            "Restored native runtime artifact",
          );
        } catch (restoreError) {
          throw new AggregateError(
            [installError, restoreError],
            `Native build deployment failed and the previous artifact backup was retained at ${backup}`,
          );
        }
      }
      throw installError;
    }
    if (backupExists) {
      await removeExactChildDirectory(parent, backup, "Native build backup");
      backupExists = false;
    }
  } finally {
    if (stageExists) {
      await removeExactChildDirectory(parent, stage, "Native build stage");
    }
    if (backupExists && targetInstalled) {
      await removeExactChildDirectory(parent, backup, "Native build backup");
    }
  }
}

async function deployIsolatedNativeBuild(input: {
  workspaceRoot: string;
  isolatedWorkspaceRoot: string;
}): Promise<void> {
  for (const relativePath of NATIVE_RUNTIME_PATHS) {
    await replaceDirectoryFromIsolatedBuild({ ...input, relativePath });
  }
}

export async function prepareWallClockBuildAttestation(input: {
  workspaceRoot: string;
  runtime: EnduranceRuntime;
  expectedCommitSha: string;
  environment?: NodeJS.ProcessEnv;
  runNativeBuild?: (isolatedWorkspaceRoot: string) => Promise<void> | void;
}): Promise<EnduranceBuildAttestation> {
  const nodeVersion = requireNode24Version(process.version, "Wall-clock build");
  const workspaceRoot = await exactWorkspaceRoot(input.workspaceRoot);
  const sourceCommitSha = assertExactCleanCommit(
    workspaceRoot,
    input.expectedCommitSha,
  );
  const sourceTreeSha256 = sourceTreeDigest(workspaceRoot);
  let artifact: RuntimeArtifactDigest;
  if (input.runtime === "native-postgres") {
    const isolatedArtifact = await withIsolatedNativeBuild({
      workspaceRoot,
      sourceCommitSha,
      environment: input.environment ?? process.env,
      runNativeBuild: input.runNativeBuild,
      consume: async (isolatedWorkspaceRoot) => {
        const built = await runtimeArtifactDigest({
          workspaceRoot: isolatedWorkspaceRoot,
          runtime: input.runtime,
          sourceTreeSha256,
        });
        await deployIsolatedNativeBuild({
          workspaceRoot,
          isolatedWorkspaceRoot,
        });
        return built;
      },
    });
    assertExactCleanCommit(workspaceRoot, sourceCommitSha);
    artifact = await runtimeArtifactDigest({
      workspaceRoot,
      runtime: input.runtime,
      sourceTreeSha256,
    });
    if (
      artifact.digest !== isolatedArtifact.digest ||
      artifact.fileCount !== isolatedArtifact.fileCount ||
      JSON.stringify(artifact.nativeRuntimeDependencies) !==
        JSON.stringify(isolatedArtifact.nativeRuntimeDependencies)
    ) {
      throw new Error(
        "Deployed native runtime artifacts differ from the isolated build",
      );
    }
  } else {
    artifact = await runtimeArtifactDigest({
      workspaceRoot,
      runtime: input.runtime,
      sourceTreeSha256,
    });
  }
  return {
    schemaVersion: 1,
    cleanTree: true,
    nodeVersion,
    sourceCommitSha,
    sourceTreeSha256,
    runtime: input.runtime,
    subject:
      input.runtime === "native-postgres"
        ? "native-runtime-artifacts"
        : "docker-build-context",
    runtimeArtifactSha256: artifact.digest,
    runtimeArtifactFileCount: artifact.fileCount,
    ...(artifact.nativeRuntimeDependencies
      ? { nativeRuntimeDependencies: artifact.nativeRuntimeDependencies }
      : {}),
  };
}

export async function verifyWallClockBuildAttestation(input: {
  workspaceRoot: string;
  expectedCommitSha: string;
  expectedRuntime: EnduranceRuntime;
  attestation: EnduranceBuildAttestation;
  environment?: NodeJS.ProcessEnv;
  runNativeBuild?: (isolatedWorkspaceRoot: string) => Promise<void> | void;
}): Promise<void> {
  const nodeVersion = requireNode24Version(
    process.version,
    "Wall-clock verifier build",
  );
  const workspaceRoot = await exactWorkspaceRoot(input.workspaceRoot);
  const sourceCommitSha = assertExactCleanCommit(
    workspaceRoot,
    input.expectedCommitSha,
  );
  const attestation = input.attestation;
  if (
    attestation.schemaVersion !== 1 ||
    attestation.cleanTree !== true ||
    attestation.nodeVersion !== nodeVersion ||
    attestation.sourceCommitSha !== sourceCommitSha
  ) {
    throw new Error("Wall-clock build attestation commit is invalid");
  }
  if (attestation.runtime !== input.expectedRuntime) {
    throw new Error("Wall-clock build attestation runtime mismatch");
  }
  const expectedSubject =
    input.expectedRuntime === "native-postgres"
      ? "native-runtime-artifacts"
      : "docker-build-context";
  if (attestation.subject !== expectedSubject) {
    throw new Error("Wall-clock build attestation subject is invalid");
  }
  const sourceTreeSha256 = sourceTreeDigest(workspaceRoot);
  if (attestation.sourceTreeSha256 !== sourceTreeSha256) {
    throw new Error("Wall-clock build attestation source tree digest mismatch");
  }
  const artifact = await runtimeArtifactDigest({
    workspaceRoot,
    runtime: input.expectedRuntime,
    sourceTreeSha256,
  });
  if (
    attestation.runtimeArtifactSha256 !== artifact.digest ||
    attestation.runtimeArtifactFileCount !== artifact.fileCount ||
    JSON.stringify(attestation.nativeRuntimeDependencies) !==
      JSON.stringify(artifact.nativeRuntimeDependencies)
  ) {
    throw new Error("Wall-clock build attestation artifact digest mismatch");
  }
  if (input.expectedRuntime === "native-postgres") {
    const independentlyBuilt = await withIsolatedNativeBuild({
      workspaceRoot,
      sourceCommitSha,
      environment: input.environment ?? process.env,
      runNativeBuild: input.runNativeBuild,
      consume: (isolatedWorkspaceRoot) =>
        runtimeArtifactDigest({
          workspaceRoot: isolatedWorkspaceRoot,
          runtime: input.expectedRuntime,
          sourceTreeSha256,
        }),
    });
    if (
      independentlyBuilt.digest !== artifact.digest ||
      independentlyBuilt.fileCount !== artifact.fileCount ||
      JSON.stringify(independentlyBuilt.nativeRuntimeDependencies) !==
        JSON.stringify(artifact.nativeRuntimeDependencies)
    ) {
      throw new Error(
        "Native runtime artifacts differ from the independent frozen build",
      );
    }
  }
}
