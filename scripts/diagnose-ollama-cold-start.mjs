// Diagnostic only: execute the unchanged boundary smoke once and observe only
// its owned daemon/runner. Sampling perturbs timing; this is not release proof.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";

assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
const [archive, output] = process.argv.slice(2);
assert.ok(archive && output && process.argv.length === 4);
assert.ok(path.isAbsolute(archive) && path.isAbsolute(output));
await mkdir(output, { recursive: false, mode: 0o700 });
const exec = promisify(execFile);
const source = "scripts/src/ollama-local-boundary-smoke.ts";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceSha256 = hash(await readFile(source));
const expectedSource = process.env.ACOS_DIAGNOSTIC_SOURCE_SHA256;
assert.match(expectedSource ?? "", /^[a-f0-9]{64}$/u);
assert.equal(sourceSha256, expectedSource);
const tempParent = await realpath(os.tmpdir());
const receipt = path.join(output, "boundary-receipt.json");
let stdout = "",
  stderr = "",
  daemon,
  child;
let finished = false,
  timedOut = false;
const startedAt = new Date().toISOString();
const started = performance.now();
const samples = [],
  observerErrors = [];
const append = (previous, bytes) =>
  Buffer.concat([Buffer.from(previous), bytes])
    .subarray(-131072)
    .toString("utf8");
// Load TS directly so this exact PID owns the smoke, avoiding a CLI wrapper
// process between the observer and the supervisor's detached daemon.
const smoke = spawn(
  process.execPath,
  ["--import", "tsx", source, archive, receipt],
  {
    env: { ...process.env, ACOS_OLLAMA_BOUNDARY_SMOKE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  },
);
smoke.stdout.on("data", (bytes) => {
  stdout = append(stdout, bytes);
});
smoke.stderr.on("data", (bytes) => {
  stderr = append(stderr, bytes);
});
const completion = new Promise((resolve) => {
  smoke.once("error", (error) => {
    observerErrors.push(error.message);
    finished = true;
    resolve({ code: null, signal: null, spawnError: error.message });
  });
  smoke.once("close", (code, signal) => {
    finished = true;
    resolve({ code, signal });
  });
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForCompletion(ms) {
  let timer;
  try {
    await Promise.race([
      completion,
      new Promise((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function descendants(parent) {
  const result = await exec("/usr/bin/pgrep", ["-P", String(parent)], {
    timeout: 1000,
    maxBuffer: 8192,
  }).catch((error) => {
    if (error.code === 1) return { stdout: "" };
    throw error;
  });
  return result.stdout
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((pid) => {
      assert.match(pid, /^[1-9][0-9]*$/u);
      return Number(pid);
    });
}
async function command(pid, parent) {
  const result = await exec(
    "/bin/ps",
    ["-p", String(pid), "-o", "ppid=", "-o", "command="],
    {
      timeout: 1000,
      maxBuffer: 16384,
    },
  ).catch((error) => {
    if (error.code === 1) return { stdout: "" };
    throw error;
  });
  const match = result.stdout.trim().match(/^(\d+)\s+(.+)$/u);
  return match && Number(match[1]) === parent ? match[2] : null;
}
async function locateDaemon() {
  for (const pid of await descendants(smoke.pid)) {
    const cmd = await command(pid, smoke.pid);
    const match = cmd?.match(
      /^(\/.*\/acos-ollama-boundary-[A-Za-z0-9]+\/bin\/ollama) serve$/u,
    );
    if (!match) continue;
    const binary = await realpath(match[1]);
    assert.equal(binary, match[1]);
    const home = path.dirname(path.dirname(binary));
    assert.equal(path.dirname(home), tempParent);
    assert.ok((await lstat(binary)).isFile());
    assert.equal(
      hash(await readFile(binary)),
      "5565c2ff13bf37d2e14fc3e746aa9656e9adb983ca5505be1b0dbeeccd66b27b",
    );
    return { pid, binary, home, observedAtMs: performance.now() - started };
  }
}
async function locateRunner() {
  for (const pid of await descendants(daemon.pid)) {
    const cmd = await command(pid, daemon.pid);
    if (cmd?.startsWith(daemon.binary + " runner "))
      return { pid, parent: daemon.pid };
  }
}
function redact(value) {
  return value
    .replaceAll(daemon?.home ?? "<not-created>", "<owned-home>")
    .replaceAll(process.cwd(), "<checkout>")
    .replaceAll(os.homedir(), "<runner-home>")
    .replaceAll(tempParent, "<runner-temp>");
}
async function sample(pid, name, atMs) {
  const result = await exec("/usr/bin/sample", [String(pid), "1", "10"], {
    timeout: 4500,
    maxBuffer: 2097152,
  })
    .then((row) => ({ ...row, code: 0 }))
    .catch((error) => ({
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      code: error.code ?? null,
    }));
  const text = redact(result.stdout + "\n" + result.stderr);
  const usable = result.code === 0 && /Call graph:/u.test(text);
  const file = `${atMs}-${name}.txt`;
  await writeFile(path.join(output, file), text, { flag: "wx", mode: 0o600 });
  samples.push({
    file,
    pid,
    atMs,
    bytes: Buffer.byteLength(text),
    sha256: hash(text),
    code: result.code,
    usable,
  });
  if (!usable) observerErrors.push(`native_stack_capture_incomplete:${file}`);
}
async function joinOriginal() {
  await waitForCompletion(Math.max(0, 240000 - (performance.now() - started)));
  if (finished) return;
  timedOut = true;
  daemon ??= await locateDaemon();
  if (
    daemon &&
    (await command(daemon.pid, smoke.pid)) === daemon.binary + " serve"
  ) {
    try {
      process.kill(-daemon.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  try {
    process.kill(-smoke.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await waitForCompletion(5000);
  if (!finished) process.kill(-smoke.pid, "SIGKILL");
  await waitForCompletion(5000);
  assert.ok(finished, "diagnostic_process_join_failed");
}
try {
  // This only bounds the observer. The production extraction/startup/probe
  // deadlines stay unchanged, and a timeout can never become an acceptance.
  while (!finished && !daemon && performance.now() - started < 210000) {
    daemon = await locateDaemon();
    if (!daemon) await delay(150);
  }
  if (daemon) {
    const observed = performance.now();
    for (const atMs of [5000, 15000]) {
      while (!finished && performance.now() - observed < atMs) await delay(100);
      if (finished) break;
      assert.equal(
        await command(daemon.pid, smoke.pid),
        daemon.binary + " serve",
      );
      child = await locateRunner();
      await Promise.all([
        sample(daemon.pid, "daemon", atMs),
        ...(child ? [sample(child.pid, "runner", atMs)] : []),
      ]);
    }
  }
  await joinOriginal();
} catch (error) {
  observerErrors.push(error.message);
  // Continue joining the original smoke so its existing cleanup remains owner.
  await joinOriginal();
}
const terminal = await completion;
await writeFile(
  path.join(output, "smoke-output.txt"),
  redact(stdout + "\n" + stderr),
  { flag: "wx", mode: 0o600 },
);
const originalReceipt = await readFile(receipt).catch(() => null);
const boundary = originalReceipt ? JSON.parse(originalReceipt) : null;
const startupFailureReproduced =
  boundary?.passed === false &&
  boundary.startupTiming?.firstObservedAfterStartMs?.httpReady === null;
if (boundary?.passed === false && (!daemon || samples.length === 0)) {
  observerErrors.push("failed_smoke_without_owned_native_stack_capture");
}
const diagnosis = {
  diagnosticOnly: true,
  releaseAccepted: false,
  performanceAcceptance: false,
  originalMain: "eaca08da7a261f590b866290305a472b3fc909d5",
  originalRun: 39562340346,
  originalJob: 119096327848,
  originalFailureLogSha256:
    "04d4876989dda5b10d95ac73ce03084b1c64c4ddc598a94e1bc40ffb6ee4675f",
  originalFailureReceiptSha256:
    "b39df69e78574fd7471cbc45333295ce82ec9ea9faed750952b1304f8c161ad4",
  startedAt,
  elapsedMs: performance.now() - started,
  sourceSha256,
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  unchangedStartupDeadlineMs: 20000,
  unchangedGpuAndIsolatedEnvironment: true,
  boundedSamplingPerturbsTiming: true,
  startupFailureReproduced,
  terminal,
  timedOut,
  daemon: daemon
    ? { pid: daemon.pid, observedAtMs: daemon.observedAtMs }
    : null,
  samples,
  observerErrors,
  receiptSha256: originalReceipt ? hash(originalReceipt) : null,
  boundary,
};
await writeFile(
  path.join(output, "diagnosis.json"),
  JSON.stringify(diagnosis, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(
  JSON.stringify({
    diagnosticOnly: true,
    releaseAccepted: false,
    terminal,
    samples: samples.length,
    observerErrors,
    timedOut,
  }),
);
assert.ok(
  !timedOut && observerErrors.length === 0 && originalReceipt,
  "diagnostic_capture_incomplete",
);
