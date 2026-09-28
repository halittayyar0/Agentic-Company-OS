import { constants as fsConstants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  NativeWallClockDriver,
  type NativeWallClockDriverOptions,
} from "./endurance/native-wall-clock-driver";
import type { WallClockRuntimeDriver } from "./endurance/run-wall-clock-soak";
import {
  parseWallClockArguments,
  wallClockExitCode,
  writeWallClockSoakReport,
  type WallClockCliArguments,
  type WallClockWriteDependencies,
  type WallClockWriteResult,
} from "./run-wall-clock-soak";

export interface NativeWallClockCliArguments extends Omit<
  WallClockCliArguments,
  "runtime" | "postgresRoot"
> {
  runtime: "native";
  postgresRoot: string;
}

export interface NativeWallClockCommandResult extends WallClockWriteResult {
  runtimeDirectory: string | null;
}

export interface NativeWallClockCommandDependencies {
  signal?: AbortSignal;
  environment?: NodeJS.ProcessEnv;
  workspaceRoot?: string;
  writeReport?: typeof writeWallClockSoakReport;
  driverFactory?: (
    options: NativeWallClockDriverOptions,
  ) => WallClockRuntimeDriver;
}

export function parseNativeWallClockArguments(
  argv: string[],
  environment: NodeJS.ProcessEnv = process.env,
): NativeWallClockCliArguments {
  const parsed = parseWallClockArguments(
    ["--runtime", "native", ...argv],
    environment,
  );
  if (parsed.runtime !== "native" || !parsed.postgresRoot) {
    throw new Error("Native wall-clock parser returned a non-native runtime");
  }
  return parsed as NativeWallClockCliArguments;
}

export function runtimeDirectoryForNativeReport(
  reportPath: string,
  runId: string,
): string {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/u.test(runId)) {
    throw new TypeError("runId must be a safe native runtime identity");
  }
  const resolvedReport = path.resolve(reportPath);
  return path.join(
    path.dirname(resolvedReport),
    `${path.basename(resolvedReport)}.native-runtime`,
    runId,
  );
}

function pathIdentity(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32"
    ? resolved.toLocaleLowerCase("en-US")
    : resolved;
}

async function requireExactDirectory(
  directory: string,
  label: string,
): Promise<string> {
  const resolved = path.resolve(directory);
  const metadata = await lstat(resolved).catch(() => null);
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real local directory`);
  }
  const actual = await realpath(resolved);
  if (pathIdentity(actual) !== pathIdentity(resolved)) {
    throw new Error(`${label} must not be redirected`);
  }
  return actual;
}

export async function archiveNativeRuntimeLogs(input: {
  reportPath: string;
  runId: string;
  controlDirectory: string;
}): Promise<string> {
  const runtimeDirectory = runtimeDirectoryForNativeReport(
    input.reportPath,
    input.runId,
  );
  const reportDirectory = path.dirname(path.resolve(input.reportPath));
  await requireExactDirectory(reportDirectory, "Native report directory");
  const controlDirectory = await requireExactDirectory(
    input.controlDirectory,
    "Native control directory",
  );
  const sourceLogs = path.join(controlDirectory, "logs");
  await requireExactDirectory(sourceLogs, "Native source log directory");

  const runtimeParent = path.dirname(runtimeDirectory);
  const parentMetadata = await lstat(runtimeParent).catch(() => null);
  if (parentMetadata) {
    await requireExactDirectory(runtimeParent, "Native runtime evidence root");
  } else {
    await mkdir(runtimeParent, { recursive: false, mode: 0o700 });
    await requireExactDirectory(runtimeParent, "Native runtime evidence root");
  }
  try {
    await mkdir(runtimeDirectory, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(
        "Native runtime evidence already exists; refusing to overwrite prior logs",
      );
    }
    throw error;
  }
  await requireExactDirectory(
    runtimeDirectory,
    "Native run evidence directory",
  );
  const targetLogs = path.join(runtimeDirectory, "logs");
  await mkdir(targetLogs, { recursive: false, mode: 0o700 });
  await requireExactDirectory(targetLogs, "Native retained log directory");

  const entries = (await readdir(sourceLogs, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  let totalBytes = 0;
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      !/^[a-z0-9][a-z0-9._-]{0,127}\.log$/iu.test(entry.name)
    ) {
      throw new Error("Native source logs contain an unsafe entry");
    }
    const source = path.join(sourceLogs, entry.name);
    const metadata = await lstat(source);
    const resolvedSource = await realpath(source);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      pathIdentity(path.dirname(resolvedSource)) !== pathIdentity(sourceLogs)
    ) {
      throw new Error("Native source log escaped its temporary directory");
    }
    totalBytes += metadata.size;
    if (metadata.size > 100 * 1024 * 1024 || totalBytes > 400 * 1024 * 1024) {
      throw new Error("Native retained logs exceed the bounded evidence limit");
    }
    await copyFile(
      resolvedSource,
      path.join(targetLogs, entry.name),
      fsConstants.COPYFILE_EXCL,
    );
  }
  return runtimeDirectory;
}

function retainNativeRuntimeLogs(
  driver: WallClockRuntimeDriver,
  input: { reportPath: string; runId: string; controlDirectory: string },
): WallClockRuntimeDriver {
  return new Proxy(driver, {
    get(target, property) {
      if (property === "stop") {
        return async (options: { keepData: boolean }) => {
          let stopFailure: unknown;
          try {
            await target.stop(options);
          } catch (error) {
            stopFailure = error;
          }
          let archiveFailure: unknown;
          try {
            await archiveNativeRuntimeLogs(input);
          } catch (error) {
            archiveFailure = error;
          }
          if (stopFailure && archiveFailure) {
            throw new AggregateError(
              [stopFailure, archiveFailure],
              "Native runtime stop and log retention both failed",
            );
          }
          if (stopFailure) throw stopFailure;
          if (archiveFailure) throw archiveFailure;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export async function executeNativeWallClockCommand(
  argv: string[],
  dependencies: NativeWallClockCommandDependencies = {},
): Promise<NativeWallClockCommandResult> {
  const environment = dependencies.environment ?? process.env;
  const options = parseNativeWallClockArguments(argv, environment);
  let runtimeDirectory: string | null = null;
  const writeDependencies: WallClockWriteDependencies = {
    signal: dependencies.signal,
    environment,
    workspaceRoot: dependencies.workspaceRoot,
    driverFactory: (input) => {
      if (
        input.runtime !== "native" ||
        !input.postgresRoot ||
        !input.runtimeControlKey
      ) {
        throw new Error("Native writer received an invalid runtime contract");
      }
      const controlDirectory = input.runDirectory;
      runtimeDirectory = runtimeDirectoryForNativeReport(
        options.output,
        input.runId,
      );
      const driverOptions: NativeWallClockDriverOptions = {
        runId: input.runId,
        seed: input.seed,
        durationHours: input.durationHours,
        faultProfile: input.faultProfile,
        workspaceRoot: input.workspaceRoot,
        postgresRoot: input.postgresRoot,
        runDirectory: controlDirectory,
        operatorToken: input.operatorToken,
        runtimeControlKey: input.runtimeControlKey,
        environment: input.environment,
      };
      const driver =
        dependencies.driverFactory?.(driverOptions) ??
        new NativeWallClockDriver(driverOptions);
      return retainNativeRuntimeLogs(driver, {
        reportPath: options.output,
        runId: input.runId,
        controlDirectory,
      });
    },
  };
  const result = await (dependencies.writeReport ?? writeWallClockSoakReport)(
    options,
    writeDependencies,
  );
  return { ...result, runtimeDirectory };
}

function boundedMessage(error: unknown): string {
  return Buffer.from(
    error instanceof Error ? error.message : String(error),
    "utf8",
  )
    .subarray(0, 1_000)
    .toString("utf8");
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const interrupt = (signal: "SIGINT" | "SIGTERM") => {
    if (!controller.signal.aborted) {
      controller.abort(
        new Error(`Native endurance run interrupted by ${signal}`),
      );
    }
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  try {
    const result = await executeNativeWallClockCommand(process.argv.slice(2), {
      signal: controller.signal,
    });
    process.stdout.write(
      `${JSON.stringify({
        reportPath: result.reportPath,
        journalPath: result.journalPath,
        sha256Path: result.sha256Path,
        browserManifestPath: result.browserManifestPath,
        runtimeDirectory: result.runtimeDirectory,
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
    process.stderr.write(
      `endurance:wall-clock:native failed: ${boundedMessage(error)}\n`,
    );
    process.exitCode = 1;
  });
}
