import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import {
  captureOwnedOllamaStartupEvidence,
  runOllamaLocalBoundarySmoke,
} from "./ollama-local-boundary-smoke";
import { ProcessSupervisor } from "./endurance/process-supervisor";

// An explicitly separate observation, never a replacement release gate.
assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
const [archive, receipt, diagnostic] = process.argv.slice(2);
assert.ok(archive && receipt && diagnostic);
const original = ProcessSupervisor.prototype.waitUntilReady;
const observations: Array<Record<string, unknown>> = [];
let entered = 0;
ProcessSupervisor.prototype.waitUntilReady = async function (probe, options) {
  if (options.label !== "Owned pinned Ollama") {
    return original.call(this, probe, options);
  }
  entered++;
  assert.equal(entered, 1, "one_original_daemon_only");
  assert.equal(options.timeoutMs, 20000);
  const started = performance.now();
  const capture = (phase: string) => {
    const row = {
      phase,
      elapsedMs: performance.now() - started,
      evidence: captureOwnedOllamaStartupEvidence(this),
    };
    observations.push(row);
    console.log(JSON.stringify(row));
  };
  const timer = setTimeout(() => capture("original-20s-boundary"), 20000);
  try {
    await original.call(this, probe, { ...options, timeoutMs: 75000 });
    capture("diagnostic-http-ready");
  } catch (error) {
    capture("diagnostic-failed");
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
let completed = false;
try {
  await runOllamaLocalBoundarySmoke(archive, receipt);
  completed = true;
} catch {
  process.exitCode = 1;
} finally {
  ProcessSupervisor.prototype.waitUntilReady = original;
  const bytes = await readFile(receipt);
  const boundary = JSON.parse(bytes.toString("utf8"));
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const result = {
    recordedAt: new Date().toISOString(),
    head,
    diagnosticOnly: true,
    acceptanceGate: false,
    originalSpawnToHttpLimitMs: 20000,
    diagnosticSpawnToHttpLimitMs: 75000,
    daemonStarts: entered,
    observations,
    boundaryCompletedUnderDiagnosticLimit: completed && boundary.passed,
    boundaryReceiptSha256: createHash("sha256").update(bytes).digest("hex"),
    sourceSmokeSha256: createHash("sha256")
      .update(await readFile("scripts/src/ollama-local-boundary-smoke.ts"))
      .digest("hex"),
    ownedRemoteRequests: boundary.ownedRemoteRequests,
    cleanup: boundary.cleanup,
    scope:
      "One separate cold daemon, same pinned archive/home/isolation/cloud and alias assertions. A deliberately declared 75s observational ceiling with state at 20s; never relabel the original failed gate or infer its exact cause from this new execution.",
  };
  await writeFile(diagnostic, JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(JSON.stringify(result));
}
