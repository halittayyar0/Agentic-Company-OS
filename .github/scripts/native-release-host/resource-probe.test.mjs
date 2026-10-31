import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  createResourceProbeTrace,
  probeWindowsResources,
  resourceProbeInvocation,
} from "./resource-probe.mjs";

const good = () => ({
  schema: "native-resource-probe@1",
  accepted: true,
  phase: "complete",
  freeVirtualKiB: 6291456,
  cFreeBytes: 2147483648,
  fixtureFreeBytes: 8589934592,
  nativeErrorCode: null,
  hresult: null,
});
test("native resource probe requires successful current-user metrics and keeps the original margins", async () => {
  let calls = 0;
  const trace = createResourceProbeTrace();
  const value = await probeWindowsResources(
    "D:\\synthetic-private-fixture",
    trace,
    async (exe, args, options) => {
      calls++;
      assert.equal(exe, process.env.PYTHON);
      assert.deepEqual(args.slice(0, 3), ["-I", "-S", "-B"]);
      assert.equal(args.at(-1), "D:\\synthetic-private-fixture");
      assert.equal(args.at(-2), "--fixture-root");
      assert.equal(options.timeout, 15000);
      assert.equal(options.windowsHide, true);
      return { stdout: JSON.stringify(good()), stderr: "" };
    },
  );
  assert.equal(calls, 1);
  assert.equal(trace.jsonAccepted, true);
  assert.equal(trace.phase, "complete");
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.timedOut, false);
  assert.deepEqual(value, {
    freeVirtualKiB: 6291456,
    cFreeBytes: 2147483648,
    fixtureFreeBytes: 8589934592,
  });
  for (const [field, min] of Object.entries(value)) {
    const trace = createResourceProbeTrace();
    await assert.rejects(
      probeWindowsResources(
        "D:\\synthetic-private-fixture",
        trace,
        async () => ({
          stdout: JSON.stringify({ ...good(), [field]: min - 1 }),
          stderr: "",
        }),
      ),
      /original_test_host_resource_margins_required/,
    );
    assert.equal(trace[field], min - 1);
  }
  for (const bad of [
    null,
    0,
    -1,
    NaN,
    Number.MAX_SAFE_INTEGER + 1,
    "synthetic-private-secret",
  ]) {
    await assert.rejects(
      probeWindowsResources(
        "D:\\synthetic-private-fixture",
        createResourceProbeTrace(),
        async () => ({
          stdout: JSON.stringify({ ...good(), freeVirtualKiB: bad }),
          stderr: "",
        }),
      ),
      /native_resource_probe_numeric_observation_required/,
    );
  }
});

test("actual native resource probe works without management modules in a sanitized environment", async () => {
  const env = {};
  for (const key of [
    "SystemRoot",
    "SystemDrive",
    "WINDIR",
    "COMSPEC",
    "COMPUTERNAME",
    "PROCESSOR_ARCHITECTURE",
    "NUMBER_OF_PROCESSORS",
    "OS",
    "TEMP",
    "TMP",
    "USERPROFILE",
  ])
    if (process.env[key]) env[key] = process.env[key];
  env.PATH = path.join(process.env.SystemRoot, "System32");
  const invoke = async (fixtureRoot) => {
    const { executable, args } = resourceProbeInvocation(fixtureRoot);
    return promisify(execFile)(executable, args, {
      env,
      windowsHide: true,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 65536,
    });
  };
  const result = await invoke(process.cwd());
  const value = JSON.parse(result.stdout);
  assert.equal(value.schema, "native-resource-probe@1");
  assert.equal(value.accepted, true);
  assert.equal(value.phase, "complete");
  assert.equal(value.nativeErrorCode, null);
  assert.equal(value.hresult, null);
  for (const key of ["freeVirtualKiB", "cFreeBytes", "fixtureFreeBytes"])
    assert.ok(Number.isSafeInteger(value[key]) && value[key] > 0);
  // Exercise a real kernel failure too, not a guessed error message. No file
  // or directory is created; an impossible child below this regular file fails.
  const error = await invoke(
    fileURLToPath(import.meta.url) + "\\nonexistent",
  ).catch((error) => error);
  assert.equal(error.code, 1);
  const failed = JSON.parse(error.stdout);
  assert.equal(failed.accepted, false);
  assert.equal(failed.phase, "fixture_disk");
  assert.ok(
    Number.isSafeInteger(failed.nativeErrorCode) && failed.nativeErrorCode > 0,
  );
  assert.equal(JSON.stringify(failed).includes("nonexistent"), false);
});

test("native resource probe records only closed failure facts and rejects failed, timed-out or malformed observations", async () => {
  for (const kind of ["native", "timeout", "parse", "spawn"]) {
    const trace = createResourceProbeTrace();
    await assert.rejects(
      probeWindowsResources(
        "D:\\synthetic-private-fixture",
        trace,
        async () => {
          if (kind === "parse")
            return {
              stdout: "private-invalid-output",
              stderr:
                "synthetic-private-secret\nnative_resource_phase:C:\\private-path\nnative_resource_phase:memory\n",
            };
          const error = new Error("synthetic-private-secret C:\\private-path");
          if (kind === "native")
            Object.assign(error, {
              code: 1,
              stdout: JSON.stringify({
                ...good(),
                accepted: false,
                phase: "fixture_disk",
                fixtureFreeBytes: null,
                nativeErrorCode: 5,
                hresult: -2147467259,
                private: "synthetic-private-secret",
              }),
              stderr: "C:\\private-path",
            });
          if (kind === "timeout")
            Object.assign(error, {
              code: null,
              killed: true,
              signal: "SIGTERM",
              stdout: "",
              stderr:
                "synthetic-private-secret\nnative_resource_phase:C:\\private-path\nnative_resource_phase:memory\n",
            });
          if (kind === "spawn")
            Object.assign(error, { code: "ENOENT", path: "C:\\private-path" });
          throw error;
        },
      ),
    );
    assert.equal(
      JSON.stringify(trace).includes("synthetic-private-secret"),
      false,
    );
    assert.equal(JSON.stringify(trace).includes("private-path"), false);
    if (kind === "native") {
      assert.equal(trace.phase, "fixture_disk");
      assert.equal(trace.nativeErrorCode, 5);
      assert.equal(trace.exitCode, 1);
      assert.equal(trace.jsonAccepted, true);
    }
    if (kind === "timeout") {
      assert.equal(trace.timedOut, true);
      assert.equal(trace.jsonAccepted, false);
      assert.equal(trace.phase, "memory");
    }
    if (kind === "parse") assert.equal(trace.phase, "parse");
    if (kind === "spawn") {
      assert.equal(trace.phase, "launch");
      assert.equal(trace.exitCode, null);
    }
  }
});
