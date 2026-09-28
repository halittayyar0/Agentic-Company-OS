import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runNativePostgresSmoke } from "./endurance/native-postgres-smoke";
import {
  ensureExactOutputDirectory,
  writeExactOutputBundle,
} from "./endurance/safe-output";

export interface NativePostgresSmokeCliArguments {
  postgresRoot: string;
  output: string;
  seed: number;
  overwrite: boolean;
}

function unsignedInteger(value: string | undefined): number {
  if (!value || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError("seed must be a non-negative integer");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 0xffff_ffff) {
    throw new TypeError("seed must be an unsigned 32-bit integer");
  }
  return parsed;
}

export function parseNativePostgresSmokeArguments(
  argv: string[],
  environment: NodeJS.ProcessEnv = process.env,
): NativePostgresSmokeCliArguments {
  let postgresRoot = environment.ENDURANCE_POSTGRES_ROOT?.trim() ?? "";
  let output = path.join(
    tmpdir(),
    `agentic-native-postgres-smoke-${process.pid}.json`,
  );
  let seed = 240_901;
  let overwrite = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--overwrite") {
      overwrite = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new TypeError(`${argument.replace(/^--/u, "")} value is required`);
    }
    switch (argument) {
      case "--postgres-root":
        postgresRoot = value;
        break;
      case "--output":
        output = value;
        break;
      case "--seed":
        seed = unsignedInteger(value);
        break;
      default:
        throw new TypeError(`Unknown argument: ${argument}`);
    }
    index += 1;
  }
  if (!postgresRoot) {
    throw new TypeError(
      "postgres-root is required via --postgres-root or ENDURANCE_POSTGRES_ROOT",
    );
  }
  return {
    postgresRoot: path.resolve(postgresRoot),
    output: path.resolve(output),
    seed,
    overwrite,
  };
}

export async function writeNativePostgresSmokeReport(input: {
  reportPath: string;
  report: unknown;
  overwrite: boolean;
}): Promise<void> {
  const reportPath = path.resolve(input.reportPath);
  const reportBytes = `${JSON.stringify(input.report, null, 2)}\n`;
  await writeExactOutputBundle({
    outputDirectory: path.dirname(reportPath),
    overwrite: input.overwrite,
    files: [
      { path: reportPath, bytes: reportBytes },
      {
        path: `${reportPath}.sha256`,
        bytes: `${createHash("sha256").update(reportBytes).digest("hex")}\n`,
      },
    ],
  });
}

export async function executeNativePostgresSmokeCommand(
  argv: string[],
  environment: NodeJS.ProcessEnv = process.env,
) {
  const options = parseNativePostgresSmokeArguments(argv, environment);
  const reportDirectory = await ensureExactOutputDirectory(
    path.dirname(options.output),
  );
  const runId = `smoke-${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  const runtimeRoot = await ensureExactOutputDirectory(
    path.join(reportDirectory, `${path.basename(options.output)}.runtime`),
  );
  const runtimeDirectory = await ensureExactOutputDirectory(
    path.join(runtimeRoot, runId),
  );
  const report = await runNativePostgresSmoke({
    runId,
    seed: options.seed,
    workspaceRoot: path.resolve(import.meta.dirname, "../.."),
    postgresRoot: options.postgresRoot,
    runDirectory: runtimeDirectory,
  });
  await writeNativePostgresSmokeReport({
    reportPath: options.output,
    report,
    overwrite: options.overwrite,
  });
  return {
    report,
    reportPath: options.output,
    sha256Path: `${options.output}.sha256`,
    runtimeDirectory,
  };
}

async function main(): Promise<void> {
  const result = await executeNativePostgresSmokeCommand(process.argv.slice(2));
  process.stdout.write(
    `${JSON.stringify({
      reportPath: result.reportPath,
      sha256Path: result.sha256Path,
      runtimeDirectory: result.runtimeDirectory,
      pass: result.report.pass,
      failure: result.report.failure,
    })}\n`,
  );
  process.exitCode = result.report.pass ? 0 : 1;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `endurance:native-postgres-smoke failed: ${Buffer.from(message, "utf8").subarray(0, 1_000).toString("utf8")}\n`,
    );
    process.exitCode = 1;
  });
}
