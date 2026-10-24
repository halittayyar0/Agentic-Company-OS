import assert from "node:assert/strict";
import test from "node:test";
import { detectInstallCapabilities } from "./preflight";
import { setupCheckReport } from "./check-report";

test("setup check explains missing container prerequisites without publishing probe output", async () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const state = await detectInstallCapabilities({
      platform,
      arch: "x64",
      nodeVersion: "v24.22.1",
      run: async () => {
        throw Error("private-secret /private/home");
      },
    });
    const report = setupCheckReport(state);
    assert.equal(report.exitCode, 0);
    assert.match(report.text, /Native source: prerequisites available/);
    assert.match(report.text, /Install Docker/);
    assert.match(report.text, /PostgreSQL database/);
    assert.match(report.text, /Tailscale/);
    assert.doesNotMatch(report.text, /private-secret|\/private\/home/);
    const portable = setupCheckReport({
      ...state,
      native: { ready: false, issues: ["native_source_required"] },
    });
    assert.equal(portable.exitCode, 1);
    assert.match(portable.text, /source checkout/);
  }
});

test("unsupported Node cannot report a usable container installation", async () => {
  const state = await detectInstallCapabilities({
    platform: "linux",
    arch: "x64",
    nodeVersion: "v26.0.0",
    run: async (command, args) => {
      if (command === "docker" && args[0] === "info") return "linux";
      if (command === "docker") return "2.40.0";
      throw Error("missing");
    },
  });
  assert.equal(state.container.ready, false);
  assert.equal(setupCheckReport(state).exitCode, 1);
  assert.match(setupCheckReport(state).text, /Node.js 24/);
});

test("optional coding and phone absence never blocks an ordinary ready installation", () => {
  const report = setupCheckReport({
    platform: "linux",
    architecture: "arm64",
    nodeVersion: "v24.22.1",
    postgresClientVersion: null,
    composeVersion: "2.40.0",
    native: { ready: false, issues: ["native_source_required"] },
    container: { ready: true, issues: [] },
    coding: {
      ready: false,
      issues: ["coding_x64_engine_required", "coding_apparmor_required"],
      apparmor: false,
    },
    phone: { ready: false },
  });
  assert.equal(report.exitCode, 0);
  assert.match(report.text, /Container: prerequisites available/);
  assert.match(report.text, /No installation or model request/);
  assert.match(report.text, /x64/);
});
