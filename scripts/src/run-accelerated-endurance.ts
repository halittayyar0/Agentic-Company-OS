import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runAcceleratedEndurance } from "./endurance/accelerated-simulation";
import {
  serializeEnduranceJournalEvent,
  serializeEnduranceReport,
} from "./endurance/report-schema";
import { writeExactOutputBundle } from "./endurance/safe-output";

export interface AcceleratedCliArguments {
  seed: number;
  minutes: number;
  output: string;
  overwrite: boolean;
}

interface WriteAcceleratedOptions extends AcceleratedCliArguments {
  runId?: string;
  commitSha?: string;
  startedAt?: Date;
}

function positiveInteger(value: string | undefined, label: string): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return parsed;
}

export function parseAcceleratedArguments(
  argv: string[],
): AcceleratedCliArguments {
  let seed = 240_901;
  let minutes = 1_440;
  let output = path.join(
    tmpdir(),
    `agentic-company-os-accelerated-${process.pid}.json`,
  );
  let overwrite = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--overwrite") {
      overwrite = true;
      continue;
    }
    const value = argv[index + 1];
    switch (argument) {
      case "--seed":
        seed = positiveInteger(value, "seed");
        index += 1;
        break;
      case "--minutes":
        minutes = positiveInteger(value, "minutes");
        index += 1;
        break;
      case "--output":
        if (!value || value.startsWith("--")) {
          throw new TypeError("output path is required");
        }
        output = path.resolve(value);
        index += 1;
        break;
      default:
        throw new TypeError(`Unknown argument: ${argument}`);
    }
  }
  if (minutes < 1_440) {
    throw new TypeError(
      "accelerated endurance requires at least 1,440 minutes",
    );
  }
  return { seed, minutes, output: path.resolve(output), overwrite };
}

function currentCommitSha(): string {
  const fromEnvironment = process.env.GITHUB_SHA?.trim();
  if (fromEnvironment) return fromEnvironment;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown-local-commit";
  }
}

export async function writeAcceleratedEnduranceReport(
  options: WriteAcceleratedOptions,
): Promise<{
  reportPath: string;
  journalPath: string;
  report: Awaited<ReturnType<typeof runAcceleratedEndurance>>["report"];
}> {
  const reportPath = path.resolve(options.output);
  const journalPath = reportPath.endsWith(".json")
    ? `${reportPath.slice(0, -".json".length)}.jsonl`
    : `${reportPath}.jsonl`;
  const result = await runAcceleratedEndurance({
    seed: options.seed,
    minutes: options.minutes,
    runId: options.runId ?? `accelerated-${randomUUID()}`,
    // Accelerated time is virtual and intentionally deterministic. Wall-clock
    // provenance belongs to the real soak report, not these evidence buckets.
    startedAt: options.startedAt,
    commitSha: options.commitSha ?? currentCommitSha(),
  });
  try {
    const journalBytes = result.journal
      .map(serializeEnduranceJournalEvent)
      .join("");
    result.report.evidence = {
      ...result.report.evidence,
      journalSha256: createHash("sha256")
        .update(journalBytes, "utf8")
        .digest("hex"),
    };
    const reportBytes = serializeEnduranceReport(result.report);
    await writeExactOutputBundle({
      outputDirectory: path.dirname(reportPath),
      overwrite: options.overwrite,
      files: [
        { path: journalPath, bytes: journalBytes },
        { path: reportPath, bytes: reportBytes },
        {
          path: `${reportPath}.sha256`,
          bytes: `${createHash("sha256").update(reportBytes).digest("hex")}\n`,
        },
      ],
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(
        `Endurance output already exists; pass --overwrite to replace it: ${reportPath}`,
      );
    }
    throw error;
  }
  return { reportPath, journalPath, report: result.report };
}

async function main(): Promise<void> {
  const options = parseAcceleratedArguments(process.argv.slice(2));
  const result = await writeAcceleratedEnduranceReport(options);
  // Keep CLI output concise and machine-readable for CI operators.
  process.stdout.write(
    `${JSON.stringify({
      reportPath: result.reportPath,
      journalPath: result.journalPath,
      sha256Path: `${result.reportPath}.sha256`,
      pass: result.report.pass,
      simulatedMinutes: result.report.simulatedMinutes,
      verified24h: result.report.verified24h,
    })}\n`,
  );
  if (!result.report.pass) process.exitCode = 1;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`endurance:accelerated failed: ${message}\n`);
    process.exitCode = 1;
  });
}
