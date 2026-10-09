import assert from "node:assert/strict";
import test from "node:test";
import { planInstallation, validateInstallationInput } from "./plan";
import type { InstallCapabilities } from "./preflight";

const capabilities: InstallCapabilities = {
  platform: "win32",
  architecture: "x64",
  nodeVersion: "v24.20.0",
  postgresClientVersion: null,
  composeVersion: "2.40.0",
  native: { ready: true, issues: [] },
  container: { ready: true, issues: [] },
};
const input = {
  mode: "native",
  locale: "tr",
  port: 5000,
  accessMode: "approval",
  provider: "later",
  phoneAccess: "local",
  toolPacks: ["data", "documents"],
};

test("coding workers are an explicit compatible container choice, never a side effect of a tool pack", () => {
  const compatible = {
    ...capabilities,
    coding: { ready: true, issues: [], apparmor: true },
  };
  const selected = { ...input, mode: "container", codingRuntime: true };
  assert.equal(
    planInstallation(selected, compatible).settings.codingRuntime,
    true,
  );
  assert.equal(
    planInstallation({ ...input, toolPacks: ["code"] }, compatible).settings
      .codingRuntime,
    undefined,
  );
  for (const patch of [
    { mode: "native" },
    { accessMode: "read_only" },
    {
      accessMode: "custom",
      customPermissions: {
        files: true,
        terminal: false,
        browser: false,
        delegation: false,
        sudo: false,
      },
    },
  ]) {
    assert.throws(
      () => planInstallation({ ...selected, ...patch }, compatible),
      /coding/u,
    );
  }
  assert.throws(() => planInstallation(selected, capabilities), /coding/u);
  assert.throws(
    () =>
      planInstallation(selected, {
        ...compatible,
        coding: { ...compatible.coding, apparmor: false },
      }),
    /coding/u,
  );
  assert.throws(
    () => validateInstallationInput({ ...selected, codingRuntime: "true" }),
    /coding/u,
  );
});

test("custom permissions remain explicit and immutable in the reviewed plan", () => {
  const customPermissions = {
    files: true,
    terminal: false,
    browser: true,
    delegation: false,
    sudo: false,
  };
  const plan = planInstallation(
    { ...input, accessMode: "custom", customPermissions },
    capabilities,
  );
  assert.deepEqual(plan.settings.customPermissions, customPermissions);
  assert.equal(Object.isFrozen(plan.settings.customPermissions), true);
  assert.throws(
    () => planInstallation({ ...input, customPermissions }, capabilities),
    /custom/u,
  );
  assert.throws(
    () =>
      planInstallation(
        {
          ...input,
          accessMode: "custom",
          customPermissions: { ...customPermissions, root: true },
        },
        capabilities,
      ),
    /custom/u,
  );
});

test("installer supports native and container with distinct reviewable steps", () => {
  const native = planInstallation(input, capabilities);
  const container = planInstallation(
    { ...input, mode: "container" },
    capabilities,
  );
  assert.ok(native.steps.includes("connect_postgres"));
  assert.ok(!native.steps.includes("compose_up"));
  assert.ok(container.steps.includes("compose_up"));
  assert.ok(!container.steps.includes("connect_postgres"));
  assert.equal(native.steps.at(-1), "verify_runtime");
  assert.equal(container.steps.at(-1), "verify_runtime");
  assert.notEqual(native.id, container.id);
});

test("all seven languages and all four access modes are accepted explicitly", () => {
  for (const locale of ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"]) {
    for (const accessMode of [
      "read_only",
      "approval",
      "full_access",
      "custom",
    ]) {
      const plan = planInstallation(
        { ...input, locale, accessMode },
        capabilities,
      );
      assert.equal(plan.settings.locale, locale);
      assert.equal(plan.settings.accessMode, accessMode);
    }
  }
});

test("unavailable modes cannot be planned and arbitrary fields cannot smuggle commands", () => {
  assert.throws(
    () =>
      planInstallation(
        { ...input, mode: "container" },
        {
          ...capabilities,
          container: { ready: false, issues: ["docker_unavailable"] },
        },
      ),
    /docker_unavailable/,
  );
  for (const patch of [
    { mode: "shell" },
    { locale: "zh" },
    { accessMode: "sudo" },
    { port: 0 },
    { port: 65536 },
    { port: 5000.5 },
    { command: "anything" },
    { toolPacks: ["../../../file"] },
    { provider: "arbitrary_url" },
  ]) {
    assert.throws(() => validateInstallationInput({ ...input, ...patch }));
  }
});

test("plan retains selected packs once, freezes settings and never accepts credentials", () => {
  const plan = planInstallation(
    { ...input, toolPacks: ["data", "data"] },
    capabilities,
  );
  assert.deepEqual(plan.settings.toolPacks, ["data"]);
  assert.equal(Object.isFrozen(plan.settings), true);
  assert.equal(Object.isFrozen(plan.settings.toolPacks), true);
  assert.throws(() =>
    planInstallation(
      { ...input, apiKey: "must-not-be-persisted" },
      capabilities,
    ),
  );
});
