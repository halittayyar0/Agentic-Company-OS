import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createDockerWallClockEnvironment,
  DockerWallClockDriver,
} from "./endurance/docker-wall-clock-driver";
import type { FaultScheduleProfile } from "./endurance/fault-injector";
import { createNativeRuntimeSecrets } from "./endurance/native-postgres-harness";
import { NativeWallClockDriver } from "./endurance/native-wall-clock-driver";
import {
  createEnduranceReport,
  serializeEnduranceJournalEvent,
  serializeEnduranceReport,
  type EnduranceBuildAttestation,
  type EnduranceRuntime,
} from "./endurance/report-schema";
import { prepareWallClockBuildAttestation } from "./endurance/build-attestation";
import { ensureExactOutputDirectory } from "./endurance/safe-output";
import {
  runWallClockSoak,
  type WallClockRuntimeDriver,
  type WallClockSoakOptions,
  type WallClockSoakResult,
} from "./endurance/run-wall-clock-soak";

export interface WallClockCliArguments {
  runtime: "docker" | "native";
  postgresRoot: string | null;
  durationHours: number;
  seed: number;
  faultProfile?: FaultScheduleProfile;
  output: string;
  keepOnFailure: boolean;
  overwrite: boolean;
}

export interface WallClockWriteResult extends WallClockSoakResult {
  reportPath: string;
  journalPath: string;
  sha256Path: string;
  browserManifestPath: string;
  primaryEvidencePath: string;
  controlDirectory: string | null;
}

export interface WallClockWriteDependencies {
  signal?: AbortSignal;
  operatorToken?: string;
  workspaceRoot?: string;
  baseUrl?: string;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
  createRunId?: () => string;
  commitSha?: () => string;
  prepareBuildAttestation?: (input: {
    runtime: EnduranceRuntime;
    workspaceRoot: string;
    commitSha: string;
    environment: NodeJS.ProcessEnv;
  }) => Promise<EnduranceBuildAttestation>;
  driverFactory?: (input: {
    runtime: "docker" | "native";
    postgresRoot: string | null;
    runId: string;
    seed: number;
    faultProfile: FaultScheduleProfile;
    durationHours: number;
    workspaceRoot: string;
    runDirectory: string;
    controlDirectory: string;
    baseUrl: string | null;
    operatorToken: string;
    runtimeControlKey: string | null;
    environment: NodeJS.ProcessEnv;
  }) => WallClockRuntimeDriver;
  runSoak?: typeof runWallClockSoak;
}

const workspaceRootFromModule = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const RUN_RESOURCE_MARKER = ".agentic-os-endurance-run.json";

function finiteNumber(value: string | undefined, label: string): number {
  if (
    !value ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?$/iu.test(value)
  ) {
    throw new TypeError(`${label} must be a finite non-negative number`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new TypeError(`${label} must be a finite non-negative number`);
  }
  return parsed;
}

function unsignedInteger(value: string | undefined, label: string): number {
  if (!value || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 0xffff_ffff) {
    throw new TypeError(`${label} must be an unsigned 32-bit integer`);
  }
  return parsed;
}

export function parseWallClockArguments(
  argv: string[],
  environment: NodeJS.ProcessEnv = process.env,
): WallClockCliArguments {
  let runtime: "docker" | "native" = "docker";
  let postgresRootArgument: string | null = null;
  let durationHours = 24;
  let seed = 240_901;
  let faultProfile: FaultScheduleProfile = "standard";
  let output = path.join(
    tmpdir(),
    `agentic-company-os-wall-clock-${process.pid}.json`,
  );
  let keepOnFailure = false;
  let overwrite = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--keep-on-failure") {
      keepOnFailure = true;
      continue;
    }
    if (argument === "--overwrite") {
      overwrite = true;
      continue;
    }
    const value = argv[index + 1];
    switch (argument) {
      case "--runtime":
        if (value !== "docker" && value !== "native") {
          throw new TypeError("runtime must be docker or native");
        }
        runtime = value;
        index += 1;
        break;
      case "--postgres-root":
        if (!value || value.startsWith("--")) {
          throw new TypeError("postgres-root path is required");
        }
        postgresRootArgument = value;
        index += 1;
        break;
      case "--duration-hours":
        durationHours = finiteNumber(value, "duration-hours");
        index += 1;
        break;
      case "--seed":
        seed = unsignedInteger(value, "seed");
        index += 1;
        break;
      case "--fault-profile":
        if (value !== "standard" && value !== "compressed-all") {
          throw new TypeError(
            "fault-profile must be standard or compressed-all",
          );
        }
        faultProfile = value;
        index += 1;
        break;
      case "--output":
        if (!value || value.startsWith("--")) {
          throw new TypeError("output path is required");
        }
        output = value;
        index += 1;
        break;
      default:
        throw new TypeError(`Unknown argument: ${argument}`);
    }
  }
  if (durationHours < 1 / 60) {
    throw new TypeError("duration-hours must be at least one minute");
  }
  if (faultProfile === "compressed-all" && durationHours < 2 / 60) {
    throw new TypeError(
      "compressed-all fault profile requires at least two minutes",
    );
  }
  if (runtime === "docker" && postgresRootArgument) {
    throw new TypeError("postgres-root is only valid with --runtime native");
  }
  const nativePostgresRoot =
    postgresRootArgument ?? environment.ENDURANCE_POSTGRES_ROOT?.trim() ?? "";
  if (runtime === "native" && !nativePostgresRoot) {
    throw new TypeError(
      "postgres-root is required via --postgres-root or ENDURANCE_POSTGRES_ROOT for native runtime",
    );
  }
  return {
    runtime,
    postgresRoot:
      runtime === "native" ? path.resolve(nativePostgresRoot) : null,
    durationHours,
    seed,
    faultProfile,
    output: path.resolve(output),
    keepOnFailure,
    overwrite,
  };
}

function journalPathFor(reportPath: string): string {
  return reportPath.endsWith(".json")
    ? `${reportPath.slice(0, -".json".length)}.jsonl`
    : `${reportPath}.jsonl`;
}

function browserManifestPathFor(reportPath: string): string {
  return `${reportPath}.browser-manifest.json`;
}

function primaryEvidencePathFor(reportPath: string): string {
  return `${reportPath}.primary-evidence.jsonl`;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pathIdentity(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32"
    ? resolved.toLocaleLowerCase("en-US")
    : resolved;
}

async function requireExactEvidenceDirectory(
  directory: string,
): Promise<string> {
  const resolved = path.resolve(directory);
  const metadata = await lstat(resolved).catch(() => null);
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Endurance evidence directory must be a real directory");
  }
  const actual = await realpath(resolved);
  if (pathIdentity(actual) !== pathIdentity(resolved)) {
    throw new Error("Endurance evidence directory must not be redirected");
  }
  return actual;
}

async function metadataIfPresent(target: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function prepareBrowserEvidenceDirectory(input: {
  reportPath: string;
  runId: string;
}): Promise<string> {
  const reportDirectory = await requireExactEvidenceDirectory(
    path.dirname(input.reportPath),
  );
  const browserRoot = path.resolve(
    reportDirectory,
    `${path.basename(input.reportPath)}.browser`,
  );
  if (
    pathIdentity(path.dirname(browserRoot)) !== pathIdentity(reportDirectory)
  ) {
    throw new Error("Browser evidence root escaped its report directory");
  }
  let rootMetadata = await metadataIfPresent(browserRoot);
  if (!rootMetadata) {
    try {
      await mkdir(browserRoot, { recursive: false, mode: 0o700 });
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      )) {
        throw error;
      }
    }
    rootMetadata = await metadataIfPresent(browserRoot);
  }
  if (!rootMetadata?.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("Browser evidence directory must be a real directory");
  }
  const actualBrowserRoot = await realpath(browserRoot);
  if (pathIdentity(actualBrowserRoot) !== pathIdentity(browserRoot)) {
    throw new Error("Browser evidence directory was redirected");
  }

  const runDirectory = path.join(actualBrowserRoot, input.runId);
  if (await metadataIfPresent(runDirectory)) {
    throw new Error("Browser run evidence directory already exists");
  }
  await mkdir(runDirectory, { recursive: false, mode: 0o700 });
  const runMetadata = await lstat(runDirectory);
  const actualRunDirectory = await realpath(runDirectory);
  if (
    !runMetadata.isDirectory() ||
    runMetadata.isSymbolicLink() ||
    pathIdentity(actualRunDirectory) !== pathIdentity(runDirectory) ||
    pathIdentity(path.dirname(actualRunDirectory)) !==
      pathIdentity(actualBrowserRoot)
  ) {
    throw new Error("Browser run evidence directory was redirected");
  }
  return actualRunDirectory;
}

async function writeDurableEvidenceBundle(input: {
  reportDirectory: string;
  overwrite: boolean;
  files: Array<{ path: string; bytes: string }>;
}): Promise<void> {
  const reportDirectory = await requireExactEvidenceDirectory(
    input.reportDirectory,
  );
  for (const file of input.files) {
    const target = path.resolve(file.path);
    if (pathIdentity(path.dirname(target)) !== pathIdentity(reportDirectory)) {
      throw new Error("Endurance evidence file escaped its report directory");
    }
    const metadata = await lstat(target).catch(() => null);
    if (!metadata) continue;
    if (!input.overwrite) {
      throw new Error(
        `Endurance output already exists; pass --overwrite to replace it: ${target}`,
      );
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(
        "Endurance overwrite target must be a regular, non-linked file",
      );
    }
    const actual = await realpath(target);
    if (pathIdentity(actual) !== pathIdentity(target)) {
      throw new Error("Endurance overwrite target was redirected");
    }
  }

  if (!input.overwrite) {
    for (const file of input.files) {
      await writeFile(file.path, file.bytes, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    }
    return;
  }

  const transactionId = randomUUID().replaceAll("-", "");
  const temporaryFiles = input.files.map((file, index) => ({
    finalPath: file.path,
    temporaryPath: path.join(
      reportDirectory,
      `.${path.basename(file.path)}.${transactionId}.${index}.tmp`,
    ),
    bytes: file.bytes,
  }));
  try {
    for (const file of temporaryFiles) {
      await writeFile(file.temporaryPath, file.bytes, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    }
    for (const file of temporaryFiles) {
      await rename(file.temporaryPath, file.finalPath);
    }
  } finally {
    await Promise.all(
      temporaryFiles.map((file) => rm(file.temporaryPath, { force: true })),
    );
  }
}

async function serializeBrowserEvidenceManifest(
  reportPath: string,
  result: WallClockSoakResult,
): Promise<string> {
  const reportDirectory = path.dirname(path.resolve(reportPath));
  const browserRoot = path.resolve(
    reportDirectory,
    `${path.basename(reportPath)}.browser`,
    result.report.runId,
  );
  const checkpoints = [];
  for (const checkpoint of result.browser?.checkpoints ?? []) {
    const checkpointPath = path.resolve(checkpoint.path);
    const relativeToBrowserRoot = path.relative(browserRoot, checkpointPath);
    if (
      !relativeToBrowserRoot ||
      relativeToBrowserRoot.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToBrowserRoot)
    ) {
      throw new Error(
        "Browser checkpoint escaped its run-scoped evidence directory",
      );
    }
    const actualDigest = sha256(await readFile(checkpointPath));
    if (actualDigest !== checkpoint.sha256) {
      throw new Error(
        "Browser checkpoint SHA-256 changed before evidence was written",
      );
    }
    checkpoints.push({
      kind: checkpoint.kind,
      path: path
        .relative(reportDirectory, checkpointPath)
        .split(path.sep)
        .join("/"),
      sha256: checkpoint.sha256,
      capturedAt: checkpoint.capturedAt,
    });
  }
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      runId: result.report.runId,
      reportFile: path.basename(reportPath),
      checkpoints,
      samples: (result.browser?.samples ?? []).map((sample) => ({
        index: sample.index,
        capturedAt: sample.capturedAt,
        runtimeLabel: sample.runtimeLabel,
        incidentVisible: sample.incidentVisible,
        reconnectCursorAdvanced: sample.reconnectCursorAdvanced,
        pageErrors: sample.pageErrors,
        mismatch: sample.mismatch ?? null,
      })),
    },
    null,
    2,
  )}\n`;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function generatedRunId(): string {
  const entropy = randomUUID().replaceAll("-", "").slice(0, 24);
  return `soak-${entropy}`;
}

function validatedRunId(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/u.test(value)) {
    throw new TypeError(
      "generated runId must use lowercase letters, digits, and hyphens",
    );
  }
  return value;
}

function validatedCommitSha(value: string): string {
  const sha = value.trim();
  if (!/^[a-f0-9]{7,64}$/iu.test(sha)) {
    throw new Error("Unable to resolve a canonical git commit SHA");
  }
  return sha;
}

function currentCommitSha(workspaceRoot: string): string {
  const fromEnvironment = process.env.GITHUB_SHA?.trim();
  if (fromEnvironment) return validatedCommitSha(fromEnvironment);
  return validatedCommitSha(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }),
  );
}

async function operatorTokenFor(
  workspaceRoot: string,
  explicit: string | undefined,
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  const direct = explicit ?? environment.OPERATOR_AUTH_TOKEN;
  if (direct?.trim()) return direct.trim();
  let fromFile = "";
  try {
    fromFile = await readFile(
      path.join(workspaceRoot, ".secrets", "operator_auth_token"),
      "utf8",
    );
  } catch {
    throw new Error(
      "A local operator token is required in OPERATOR_AUTH_TOKEN or .secrets/operator_auth_token",
    );
  }
  if (!fromFile.trim()) {
    throw new Error("The local operator token file is empty");
  }
  return fromFile.trim();
}

async function configuredSecretBytes(input: {
  label: string;
  workspaceRoot: string;
  defaultFileName: string;
  directEnvironmentName: string;
  fileEnvironmentNames: string[];
  environment: NodeJS.ProcessEnv;
}): Promise<Buffer> {
  const direct = input.environment[input.directEnvironmentName]?.trim();
  if (direct) return Buffer.from(`${direct}\n`, "utf8");
  const configuredFile = input.fileEnvironmentNames
    .map((name) => input.environment[name]?.trim())
    .find((value): value is string => Boolean(value));
  const source = configuredFile
    ? path.resolve(input.workspaceRoot, configuredFile)
    : path.join(input.workspaceRoot, ".secrets", input.defaultFileName);
  let bytes: Buffer;
  try {
    bytes = await readFile(source);
  } catch {
    throw new Error(`${input.label} secret file is required`);
  }
  if (!bytes.toString("utf8").trim()) {
    throw new Error(`${input.label} secret file is empty`);
  }
  return bytes;
}

async function writeRunScopedSecrets(input: {
  workspaceRoot: string;
  secretDirectory: string;
  operatorToken: string;
  environment: NodeJS.ProcessEnv;
}): Promise<void> {
  const [databaseUrl, runtimeControlKey, postgresPassword] = await Promise.all([
    configuredSecretBytes({
      label: "Database URL",
      workspaceRoot: input.workspaceRoot,
      defaultFileName: "database_url",
      directEnvironmentName: "DATABASE_URL",
      fileEnvironmentNames: [
        "ENDURANCE_DATABASE_URL_SECRET_FILE",
        "DATABASE_URL_FILE",
      ],
      environment: input.environment,
    }),
    configuredSecretBytes({
      label: "Runtime control key",
      workspaceRoot: input.workspaceRoot,
      defaultFileName: "runtime_control_key",
      directEnvironmentName: "RUNTIME_CONTROL_KEY",
      fileEnvironmentNames: [
        "ENDURANCE_RUNTIME_CONTROL_KEY_SECRET_FILE",
        "RUNTIME_CONTROL_KEY_FILE",
      ],
      environment: input.environment,
    }),
    configuredSecretBytes({
      label: "PostgreSQL password",
      workspaceRoot: input.workspaceRoot,
      defaultFileName: "postgres_password",
      directEnvironmentName: "POSTGRES_PASSWORD",
      fileEnvironmentNames: [
        "ENDURANCE_POSTGRES_PASSWORD_SECRET_FILE",
        "POSTGRES_PASSWORD_FILE",
      ],
      environment: input.environment,
    }),
  ]);
  await Promise.all([
    writeFile(
      path.join(input.secretDirectory, "operator_auth_token"),
      `${input.operatorToken}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    ),
    writeFile(path.join(input.secretDirectory, "database_url"), databaseUrl, {
      flag: "wx",
      mode: 0o600,
    }),
    writeFile(
      path.join(input.secretDirectory, "runtime_control_key"),
      runtimeControlKey,
      { flag: "wx", mode: 0o600 },
    ),
    writeFile(
      path.join(input.secretDirectory, "postgres_password"),
      postgresPassword,
      { flag: "wx", mode: 0o600 },
    ),
  ]);
}

export async function createWallClockRunResourceDirectory(
  runId: string,
): Promise<{
  runResourceDirectory: string;
  controlDirectory: string;
  secretDirectory: string;
}> {
  const validated = validatedRunId(runId);
  const runResourceDirectory = await mkdtemp(
    path.join(tmpdir(), `agentic-os-soak-run-${validated}-`),
  );
  const controlDirectory = path.join(runResourceDirectory, "control");
  const secretDirectory = path.join(runResourceDirectory, "secrets");
  await Promise.all([
    mkdir(controlDirectory, { recursive: false, mode: 0o700 }),
    mkdir(secretDirectory, { recursive: false, mode: 0o700 }),
    writeFile(
      path.join(runResourceDirectory, RUN_RESOURCE_MARKER),
      `${JSON.stringify({ schemaVersion: 1, runId: validated })}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    ),
  ]);
  return { runResourceDirectory, controlDirectory, secretDirectory };
}

export async function removeExactRunResourceDirectory(
  runResourceDirectory: string,
  runId: string,
): Promise<void> {
  const validated = validatedRunId(runId);
  const requestedRunDirectory = path.resolve(runResourceDirectory);
  const resolvedTempRoot = await realpath(tmpdir());
  const requestedParent = path.dirname(requestedRunDirectory);
  if (
    !path
      .basename(requestedRunDirectory)
      .startsWith(`agentic-os-soak-run-${validated}-`) ||
    requestedParent.toLocaleLowerCase("en-US") !==
      resolvedTempRoot.toLocaleLowerCase("en-US")
  ) {
    throw new Error("Refusing to remove an unscoped endurance run directory");
  }
  const directoryMetadata = await lstat(requestedRunDirectory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new Error("Refusing to remove a non-directory endurance target");
  }
  const resolvedRunDirectory = await realpath(requestedRunDirectory);
  if (
    resolvedRunDirectory.toLocaleLowerCase("en-US") !==
    requestedRunDirectory.toLocaleLowerCase("en-US")
  ) {
    throw new Error("Refusing to remove a linked endurance run directory");
  }
  const markerPath = path.join(requestedRunDirectory, RUN_RESOURCE_MARKER);
  const markerMetadata = await lstat(markerPath);
  if (!markerMetadata.isFile() || markerMetadata.isSymbolicLink()) {
    throw new Error("Endurance run ownership marker is not a regular file");
  }
  const resolvedMarker = await realpath(markerPath);
  if (
    path.dirname(resolvedMarker).toLocaleLowerCase("en-US") !==
      resolvedRunDirectory.toLocaleLowerCase("en-US") ||
    path.basename(resolvedMarker) !== RUN_RESOURCE_MARKER
  ) {
    throw new Error("Endurance run ownership marker escaped its run directory");
  }
  let marker: unknown;
  try {
    marker = JSON.parse(await readFile(resolvedMarker, "utf8"));
  } catch {
    throw new Error("Endurance run ownership marker is invalid");
  }
  if (
    !marker ||
    typeof marker !== "object" ||
    Array.isArray(marker) ||
    (marker as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    (marker as { runId?: unknown }).runId !== validated
  ) {
    throw new Error("Endurance run ownership marker does not match the runId");
  }
  await rm(requestedRunDirectory, { recursive: true, force: true });
}

function defaultBaseUrl(environment: NodeJS.ProcessEnv): string {
  const configured = environment.ENDURANCE_BASE_URL?.trim();
  if (configured) return configured;
  const port = environment.APP_PORT?.trim() || "5000";
  if (!/^[1-9][0-9]{0,4}$/u.test(port) || Number(port) > 65_535) {
    throw new Error("APP_PORT must be an integer from 1 to 65535");
  }
  return `http://127.0.0.1:${port}`;
}

function boundedFailureMessage(error: unknown, secrets: string[]): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets.filter(Boolean)) {
    message = message.split(secret).join("[redacted]");
  }
  return Buffer.from(message, "utf8").subarray(0, 1_000).toString("utf8");
}

function failedSoakResult(input: {
  runId: string;
  seed: number;
  durationHours: number;
  commitSha: string;
  startedAt: Date;
  completedAt: Date;
  failure: string;
}): WallClockSoakResult {
  const requiredHealthSampleBuckets = Math.max(
    1,
    Math.floor(input.durationHours * 60),
  );
  const report = createEnduranceReport({
    runId: input.runId,
    mode: "wall_clock",
    seed: input.seed,
    commitSha: input.commitSha,
    startedAt: input.startedAt.toISOString(),
    completedAt: input.completedAt.toISOString(),
    wallClockHours: Math.max(
      0,
      (input.completedAt.getTime() - input.startedAt.getTime()) /
        (60 * 60 * 1_000),
    ),
    simulatedMinutes: 0,
    topology: { api: 1, workers: 2, agents: 10, database: "postgres" },
    injections: [],
    metrics: {
      expectedResponsibilities: requiredHealthSampleBuckets * 10,
      completedResponsibilities: 0,
      maxResponsibilityCycleLag: 0,
      irreversibleReceiptSuccessCount: 0,
      duplicateIrreversibleReceiptKeys: [],
      staleOwnerCommits: 0,
      recoveryDurationsMs: [],
      missingIncidentIds: [],
      healthTruthMismatches: ["runner_failure"],
      sseReconnectObserved: false,
      healthSampleBuckets: 0,
      requiredHealthSampleBuckets,
    },
  });
  return {
    report,
    journal: [
      {
        schemaVersion: 1,
        runId: input.runId,
        sequence: 0,
        occurredAt: input.completedAt.toISOString(),
        kind: "run_failed",
        data: { failure: input.failure },
      },
    ],
    primaryEvidence: [],
    browser: null,
    projectId: null,
    failure: input.failure,
  };
}

async function writeEvidenceFiles(input: {
  reportPath: string;
  journalPath: string;
  overwrite: boolean;
  result: WallClockSoakResult;
}): Promise<string> {
  try {
    const journalBytes = input.result.journal
      .map(serializeEnduranceJournalEvent)
      .join("");
    const primaryEvidenceBytes = input.result.primaryEvidence
      .map((item) => `${JSON.stringify(item)}\n`)
      .join("");
    input.result.report.evidence = {
      ...input.result.report.evidence,
      journalSha256: sha256(Buffer.from(journalBytes, "utf8")),
      primaryEvidenceSha256: sha256(Buffer.from(primaryEvidenceBytes, "utf8")),
    };
    const browserManifest = await serializeBrowserEvidenceManifest(
      input.reportPath,
      input.result,
    );
    const manifestDigest = sha256(Buffer.from(browserManifest, "utf8"));
    if (input.result.report.evidence?.browser) {
      input.result.report.evidence.browser.manifestSha256 = manifestDigest;
    }
    const reportBytes = serializeEnduranceReport(input.result.report);
    await writeDurableEvidenceBundle({
      reportDirectory: path.dirname(input.reportPath),
      overwrite: input.overwrite,
      files: [
        {
          path: browserManifestPathFor(input.reportPath),
          bytes: browserManifest,
        },
        { path: input.journalPath, bytes: journalBytes },
        {
          path: primaryEvidencePathFor(input.reportPath),
          bytes: primaryEvidenceBytes,
        },
        { path: input.reportPath, bytes: reportBytes },
        {
          path: `${input.reportPath}.sha256`,
          bytes: `${sha256(Buffer.from(reportBytes, "utf8"))}\n`,
        },
      ],
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(
        `Endurance output already exists; pass --overwrite to replace it: ${input.reportPath}`,
      );
    }
    throw error;
  }
  return `${input.reportPath}.sha256`;
}

export function wallClockExitCode(
  result: Pick<WallClockSoakResult, "report" | "failure">,
): 0 | 1 {
  return result.failure === null &&
    result.report.pass &&
    result.report.verified24h
    ? 0
    : 1;
}

export async function writeWallClockSoakReport(
  options: WallClockCliArguments,
  dependencies: WallClockWriteDependencies = {},
): Promise<WallClockWriteResult> {
  const reportPath = path.resolve(options.output);
  const faultProfile = options.faultProfile ?? "standard";
  const journalPath = journalPathFor(reportPath);
  const sha256Path = `${reportPath}.sha256`;
  const browserManifestPath = browserManifestPathFor(reportPath);
  const primaryEvidencePath = primaryEvidencePathFor(reportPath);
  if (
    !options.overwrite &&
    (
      await Promise.all([
        pathExists(reportPath),
        pathExists(journalPath),
        pathExists(sha256Path),
        pathExists(browserManifestPath),
        pathExists(primaryEvidencePath),
      ])
    ).some(Boolean)
  ) {
    throw new Error(
      `Endurance output already exists; pass --overwrite to replace it: ${reportPath}`,
    );
  }

  await ensureExactOutputDirectory(path.dirname(reportPath));
  await requireExactEvidenceDirectory(path.dirname(reportPath));
  const workspaceRoot = path.resolve(
    dependencies.workspaceRoot ?? workspaceRootFromModule,
  );
  const environment = dependencies.environment ?? process.env;
  const now = dependencies.now ?? (() => new Date());
  const startedAt = now();
  const runId = validatedRunId(
    dependencies.createRunId?.() ?? generatedRunId(),
  );
  const { runResourceDirectory, controlDirectory, secretDirectory } =
    await createWallClockRunResourceDirectory(runId);
  let commitSha = "unresolved";
  let operatorToken = dependencies.operatorToken?.trim() ?? "";
  let runtimeControlKey = "";
  let result: WallClockSoakResult;

  try {
    commitSha = validatedCommitSha(
      dependencies.commitSha?.() ?? currentCommitSha(workspaceRoot),
    );
    const enduranceRuntime: EnduranceRuntime =
      options.runtime === "native" ? "native-postgres" : "docker-compose";
    const buildAttestation = await (
      dependencies.prepareBuildAttestation ??
      ((input) =>
        prepareWallClockBuildAttestation({
          workspaceRoot: input.workspaceRoot,
          runtime: input.runtime,
          expectedCommitSha: input.commitSha,
          environment: input.environment,
        }))
    )({
      runtime: enduranceRuntime,
      workspaceRoot,
      commitSha,
      environment,
    });
    const browserOutputDirectory = await prepareBrowserEvidenceDirectory({
      reportPath,
      runId,
    });
    let driver: WallClockRuntimeDriver;
    if (options.runtime === "native") {
      if (!options.postgresRoot) {
        throw new TypeError("postgresRoot is required for native runtime");
      }
      const generatedSecrets = createNativeRuntimeSecrets();
      operatorToken = operatorToken || generatedSecrets.operatorToken;
      runtimeControlKey = generatedSecrets.runtimeControlKey;
      driver =
        dependencies.driverFactory?.({
          runtime: "native",
          postgresRoot: options.postgresRoot,
          runId,
          seed: options.seed,
          durationHours: options.durationHours,
          faultProfile,
          workspaceRoot,
          runDirectory: controlDirectory,
          controlDirectory,
          baseUrl: null,
          operatorToken,
          runtimeControlKey,
          environment,
        }) ??
        new NativeWallClockDriver({
          runId,
          seed: options.seed,
          durationHours: options.durationHours,
          faultProfile,
          workspaceRoot,
          postgresRoot: options.postgresRoot,
          runDirectory: controlDirectory,
          operatorToken,
          runtimeControlKey,
          environment,
        });
    } else {
      operatorToken = await operatorTokenFor(
        workspaceRoot,
        dependencies.operatorToken,
        environment,
      );
      await writeRunScopedSecrets({
        workspaceRoot,
        secretDirectory,
        operatorToken,
        environment,
      });
      const soakEnvironment = createDockerWallClockEnvironment({
        runId,
        seed: options.seed,
        workspaceRoot,
        controlDirectory,
        secretDirectory,
        environment,
      });
      const baseUrl = dependencies.baseUrl ?? defaultBaseUrl(environment);
      driver =
        dependencies.driverFactory?.({
          runtime: "docker",
          postgresRoot: null,
          runId,
          seed: options.seed,
          durationHours: options.durationHours,
          faultProfile,
          workspaceRoot,
          runDirectory: controlDirectory,
          controlDirectory,
          baseUrl,
          operatorToken,
          runtimeControlKey: null,
          environment: soakEnvironment,
        }) ??
        new DockerWallClockDriver({
          runId,
          seed: options.seed,
          durationHours: options.durationHours,
          faultProfile,
          workspaceRoot,
          controlDirectory,
          baseUrl,
          operatorToken,
          environment: soakEnvironment,
        });
    }
    const soakOptions: WallClockSoakOptions = {
      runId,
      seed: options.seed,
      durationHours: options.durationHours,
      faultProfile,
      commitSha,
      browserOutputDirectory,
      keepOnFailure: options.keepOnFailure,
    };
    result = await (dependencies.runSoak ?? runWallClockSoak)(
      soakOptions,
      driver,
      { signal: dependencies.signal },
    );
    if (result.report.provenance) {
      if (result.report.provenance.configuration.runtime !== enduranceRuntime) {
        throw new Error(
          "Runtime provenance does not match the preflight build attestation",
        );
      }
      result.report.provenance.buildAttestation = buildAttestation;
    }
  } catch (error) {
    const failure = boundedFailureMessage(error, [
      operatorToken,
      runtimeControlKey,
    ]);
    result = failedSoakResult({
      runId,
      seed: options.seed,
      durationHours: options.durationHours,
      commitSha,
      startedAt,
      completedAt: now(),
      failure,
    });
  }

  let evidenceWriteFailure: unknown;
  try {
    await writeEvidenceFiles({
      reportPath,
      journalPath,
      overwrite: options.overwrite,
      result,
    });
  } catch (error) {
    evidenceWriteFailure = error;
  }
  const keepControlDirectory =
    options.keepOnFailure &&
    (evidenceWriteFailure !== undefined || wallClockExitCode(result) !== 0);
  let cleanupFailure: unknown;
  if (!keepControlDirectory) {
    try {
      await removeExactRunResourceDirectory(runResourceDirectory, runId);
    } catch (error) {
      cleanupFailure = error;
    }
  }
  if (evidenceWriteFailure && cleanupFailure) {
    throw new AggregateError(
      [evidenceWriteFailure, cleanupFailure],
      "Endurance evidence writing and temporary resource cleanup both failed",
    );
  }
  if (evidenceWriteFailure) throw evidenceWriteFailure;
  if (cleanupFailure) throw cleanupFailure;
  return {
    ...result,
    reportPath,
    journalPath,
    sha256Path,
    browserManifestPath,
    primaryEvidencePath,
    controlDirectory: keepControlDirectory ? controlDirectory : null,
  };
}

export async function executeWallClockCommand(
  argv: string[],
  dependencies: WallClockWriteDependencies = {},
): Promise<WallClockWriteResult> {
  return writeWallClockSoakReport(parseWallClockArguments(argv), dependencies);
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const interrupt = (signal: "SIGINT" | "SIGTERM") => {
    if (!controller.signal.aborted) {
      controller.abort(new Error(`Endurance run interrupted by ${signal}`));
    }
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  try {
    const result = await executeWallClockCommand(process.argv.slice(2), {
      signal: controller.signal,
    });
    process.stdout.write(
      `${JSON.stringify({
        reportPath: result.reportPath,
        journalPath: result.journalPath,
        sha256Path: result.sha256Path,
        browserManifestPath: result.browserManifestPath,
        primaryEvidencePath: result.primaryEvidencePath,
        controlDirectory: result.controlDirectory,
        pass: result.report.pass,
        verified24h: result.report.verified24h,
        failure: result.failure,
      })}\n`,
    );
    process.exitCode = wallClockExitCode(result);
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    const message = boundedFailureMessage(error, []);
    process.stderr.write(`endurance:wall-clock failed: ${message}\n`);
    process.exitCode = 1;
  });
}
