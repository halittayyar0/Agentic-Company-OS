import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { readFile } from "node:fs/promises";

const execute = promisify(execFile);
const integer = (value) => (Number.isSafeInteger(value) ? value : null);
const phases = new Set([
  "compile",
  "memory",
  "c_disk",
  "fixture_disk",
  "complete",
]);
export async function resourceProbeCommand(fixtureRoot) {
  assert.match(fixtureRoot, /^[A-Za-z]:[\\/]/u);
  const source = await readFile(
    new URL("./resource-probe.ps1", import.meta.url),
    "utf8",
  );
  return (
    "& {\n" +
    source +
    "\n} -FixtureRoot '" +
    fixtureRoot.replaceAll("'", "''") +
    "'"
  );
}
export function createResourceProbeTrace() {
  return {
    backend: "win32",
    phase: "not_started",
    exitCode: null,
    timedOut: false,
    jsonAccepted: false,
    nativeErrorCode: null,
    hresult: null,
    elapsedMs: null,
    freeVirtualKiB: null,
    cFreeBytes: null,
    fixtureFreeBytes: null,
  };
}

/** One current-user native observation, no WMI, fallback or synthetic metrics. */
export async function probeWindowsResources(
  fixtureRoot,
  trace = createResourceProbeTrace(),
  run = execute,
) {
  assert.equal(process.platform, "win32");
  assert.equal(process.arch, "x64");
  assert.match(fixtureRoot, /^[A-Za-z]:[\\/]/u);
  const started = Date.now();
  trace.phase = "launch";
  let stdout = "",
    failed = false;
  try {
    const result = await run(
      path.join(
        process.env.SystemRoot,
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      ),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        await resourceProbeCommand(fixtureRoot),
      ],
      { windowsHide: true, encoding: "utf8", timeout: 15000, maxBuffer: 65536 },
    );
    stdout = result.stdout;
    trace.exitCode = 0;
  } catch (error) {
    failed = true;
    trace.exitCode = integer(error?.code);
    trace.timedOut = error?.killed === true;
    if (typeof error?.stdout === "string") stdout = error.stdout;
  } finally {
    trace.elapsedMs = Date.now() - started;
  }
  if (!stdout && failed)
    throw new Error("native_resource_probe_process_failed");
  trace.phase = "parse";
  assert.ok(
    typeof stdout === "string" && Buffer.byteLength(stdout) <= 65536,
    "bounded_native_resource_observation_required",
  );
  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new Error("native_resource_probe_json_required");
  }
  assert.ok(
    result &&
      result.schema === "native-resource-probe@1" &&
      typeof result.accepted === "boolean" &&
      phases.has(result.phase),
    "native_resource_probe_schema_required",
  );
  assert.ok(
    result.nativeErrorCode === null ||
      (integer(result.nativeErrorCode) !== null && result.nativeErrorCode >= 0),
    "native_resource_probe_error_code_required",
  );
  assert.ok(
    result.hresult === null || integer(result.hresult) !== null,
    "native_resource_probe_hresult_required",
  );
  trace.phase = result.phase;
  trace.nativeErrorCode = result.nativeErrorCode;
  trace.hresult = result.hresult;
  trace.jsonAccepted = true;
  assert.equal(failed, false, "native_resource_probe_process_failed");
  assert.ok(
    result.accepted &&
      result.phase === "complete" &&
      result.nativeErrorCode === null &&
      result.hresult === null,
    "native_resource_probe_success_required",
  );
  const values = {};
  for (const field of ["freeVirtualKiB", "cFreeBytes", "fixtureFreeBytes"]) {
    trace[field] =
      integer(result[field]) !== null && result[field] >= 0
        ? result[field]
        : null;
    assert.ok(
      integer(result[field]) !== null && result[field] > 0,
      "native_resource_probe_numeric_observation_required",
    );
    values[field] = result[field];
  }
  assert.ok(
    values.freeVirtualKiB >= 6291456 &&
      values.cFreeBytes >= 2147483648 &&
      values.fixtureFreeBytes >= 8589934592,
    "original_test_host_resource_margins_required",
  );
  return values;
}
