import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  codexTaskConfigured,
  codexConfigurationStatus,
  readCodexConfigurationReport,
} from "./codex-task-capability";

const enabled = {
  ALLOW_AGENT_CODEX_TASKS: "true",
  ALLOW_AGENT_PROCESS_EXEC: "true",
  ACOS_CODEX_EXECUTABLE: process.execPath,
  RUNTIME_ROLE: "worker",
};
test("configuration reports distinguish opt-in from actual native support without exposing host paths or asserting readiness", () => {
  for (const platform of ["win32", "linux", "darwin"] as const) {
    const report = readCodexConfigurationReport(enabled, platform);
    assert.equal(
      codexConfigurationStatus(report),
      platform === "win32" || platform === "linux"
        ? "preflight_required"
        : "unsupported_platform",
    );
    assert.equal(
      Object.values(report).every((value) => typeof value === "boolean"),
      true,
    );
    assert.doesNotMatch(
      JSON.stringify(report),
      /node\.exe|private|available|verified|account/i,
    );
    assert.equal(codexTaskConfigured(enabled), true);
  }
  for (const environment of [
    {},
    { ...enabled, ALLOW_AGENT_CODEX_TASKS: "false" },
    { ...enabled, RUNTIME_ROLE: "api" },
  ])
    assert.equal(
      codexConfigurationStatus(
        readCodexConfigurationReport(environment, "win32"),
      ),
      "disabled",
    );
  for (const environment of [
    { ...enabled, ALLOW_AGENT_PROCESS_EXEC: "false" },
    { ...enabled, ACOS_CODEX_EXECUTABLE: "relative" },
    {
      ...enabled,
      ACOS_CODEX_EXECUTABLE: path.join(
        path.dirname(process.execPath),
        "bad\nname",
      ),
    },
    { ...enabled, ACOS_CODEX_EXECUTABLE: process.execPath + "x".repeat(4096) },
  ]) {
    assert.equal(codexTaskConfigured(environment), false);
    assert.equal(
      codexConfigurationStatus(
        readCodexConfigurationReport(environment, "win32"),
      ),
      "configuration_required",
    );
  }
  assert.equal(codexConfigurationStatus({}), "not_reported");
  assert.equal(
    codexConfigurationStatus({
      ...readCodexConfigurationReport(enabled, "win32"),
      codexNativeController: "true",
    } as never),
    "not_reported",
  );
  assert.equal(
    codexConfigurationStatus({
      ...readCodexConfigurationReport(enabled, "win32"),
      codexConfigurationV1: false,
    }),
    "not_reported",
  );
});
