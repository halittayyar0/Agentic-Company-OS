import assert from "node:assert/strict";
import test from "node:test";
import { detectInstallCapabilities } from "./preflight";

const available = async (command: string, args: string[]) => {
  if (command === "docker" && args[0] === "info") return "linux";
  if (command === "docker") return "2.40.0";
  if (command === "psql") return "psql (PostgreSQL) 17.10";
  throw new Error("unexpected command");
};

test("native installation stays available when Docker is absent", async () => {
  const state = await detectInstallCapabilities({
    platform: "win32",
    arch: "x64",
    nodeVersion: "v24.20.0",
    run: async (command, args) => {
      if (command === "docker") throw new Error("ENOENT");
      return available(command, args);
    },
  });
  assert.equal(state.native.ready, true);
  assert.equal(state.container.ready, false);
  assert.deepEqual(state.container.issues, ["docker_unavailable"]);
});

test("Docker client alone does not prove a working daemon", async () => {
  const state = await detectInstallCapabilities({
    run: async (command, args) => {
      if (command === "docker" && args[0] === "info")
        throw Error("daemon unavailable");
      return available(command, args);
    },
  });
  assert.equal(state.container.ready, false);
  assert.deepEqual(state.container.issues, ["docker_engine_unavailable"]);
});

test("a working engine without Compose reports only the missing Compose requirement", async () => {
  const state = await detectInstallCapabilities({
    run: async (command, args) => {
      if (command === "docker" && args[0] === "compose")
        throw Error("compose plugin unavailable");
      return available(command, args);
    },
  });
  assert.deepEqual(state.container.issues, ["compose_v2_required"]);
});

test("Docker Windows containers cannot run the Linux application image", async () => {
  const state = await detectInstallCapabilities({
    run: async (command, args) =>
      command === "docker" && args[0] === "info"
        ? "windows"
        : available(command, args),
  });
  assert.deepEqual(state.container.issues, ["docker_linux_engine_required"]);
});

test("native Node version and OS are checked independently of container capability", async () => {
  const state = await detectInstallCapabilities({
    platform: "freebsd",
    nodeVersion: "v26.0.0",
    run: available,
  });
  assert.deepEqual(state.native.issues, [
    "unsupported_platform",
    "node_24_required",
  ]);
  assert.equal(state.container.ready, false);
});

test("PostgreSQL CLI is optional when an existing database is supplied", async () => {
  const state = await detectInstallCapabilities({
    platform: "darwin",
    arch: "arm64",
    nodeVersion: "v24.20.0",
    run: async (command, args) => {
      if (command === "psql") throw Error("missing");
      return available(command, args);
    },
  });
  assert.equal(state.native.ready, true);
  assert.equal(state.postgresClientVersion, null);
  assert.equal(state.container.ready, true);
});

test("coding capability follows the actual engine architecture and exact Compose feature floor", async () => {
  for (const [version, architecture, expected] of [
    ["2.24.3", "x86_64", false],
    ["2.24.4", "x86_64", true],
    ["2.40.0", "aarch64", false],
    ["2.40.0-rc1", "x86_64", false],
    ["2.40.0", "amd64", true],
  ] as const) {
    const state = await detectInstallCapabilities({
      platform: "darwin",
      arch: "arm64",
      nodeVersion: "v24.20.0",
      run: async (command, args) => {
        if (
          command === "docker" &&
          args[0] === "info" &&
          args[2] === "{{json .}}"
        )
          return JSON.stringify({
            OSType: "linux",
            Architecture: architecture,
            SecurityOptions: ["name=apparmor"],
          });
        if (command === "docker" && args[0] === "compose") return version;
        return available(command, args);
      },
    });
    assert.equal(state.coding?.ready, expected, `${version}/${architecture}`);
    assert.equal(state.container.ready, true);
    if (expected) assert.equal(state.coding?.apparmor, true);
  }
});

test("an engine without AppArmor keeps ordinary installation available but cannot select managed coding", async () => {
  const state = await detectInstallCapabilities({
    platform: "darwin",
    arch: "arm64",
    nodeVersion: "v24.20.0",
    run: async (command, args) =>
      command === "docker" && args[0] === "info" && args[2] === "{{json .}}"
        ? JSON.stringify({
            OSType: "linux",
            Architecture: "x86_64",
            SecurityOptions: ["name=seccomp,profile=builtin"],
          })
        : available(command, args),
  });
  assert.equal(state.container.ready, true);
  assert.equal(state.native.ready, true);
  assert.equal(state.coding?.ready, false);
  assert.ok(state.coding?.issues.includes("coding_apparmor_required"));
});
