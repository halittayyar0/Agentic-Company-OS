import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCodingContainerIdentity,
  assertNativeTestSummary,
  codingContainerArguments,
  isMissingOwnedContainer,
  assertCodingCompose,
} from "./coding-container-contract";

const image = `sha256:${"a".repeat(64)}`;

test("merged deployment cannot broaden the API or lose coding worker confinement", () => {
  const worker = {
    security_opt: [
      "no-new-privileges:true",
      "seccomp=./deploy/coding-seccomp.json",
    ],
    read_only: true,
    cap_drop: ["ALL"],
    pids_limit: 512,
  };
  const value = {
    services: {
      app: {
        security_opt: [
          "no-new-privileges:true",
          "seccomp=./deploy/chromium-seccomp.json",
        ],
      },
      "worker-1": worker,
      "worker-2": worker,
    },
  };
  assertCodingCompose(value, false);
  const copy = () => structuredClone(value);
  for (const patch of [
    {
      security_opt: [
        ...worker.security_opt,
        "seccomp=./deploy/chromium-seccomp.json",
      ],
    },
    { security_opt: ["seccomp=unconfined"] },
    { read_only: false },
    { cap_drop: [] },
    { privileged: true },
    { network_mode: "host" },
    { pid: "host" },
  ]) {
    const changed = copy();
    changed.services["worker-1"] = { ...worker, ...patch };
    assert.throws(() => assertCodingCompose(changed, false));
  }
  const changed = copy();
  changed.services.app.security_opt = worker.security_opt;
  assert.throws(() => assertCodingCompose(changed, false));
  assert.throws(() => assertCodingCompose(value, true));
  const enforced = copy();
  enforced.services["worker-1"].security_opt.push("apparmor=agentic-coding");
  assertCodingCompose(enforced, true);
});

test("Docker observation errors do not prove that the owned container was removed", () => {
  const name = "acos-proof-fixed";
  assert.equal(
    isMissingOwnedContainer(
      {
        code: 1,
        stderr: `Error response from daemon: No such container: ${name}\n`,
      },
      name,
    ),
    true,
  );
  assert.equal(
    isMissingOwnedContainer(
      { code: 1, stderr: "failed to connect to the docker API" },
      name,
    ),
    false,
  );
  assert.equal(
    isMissingOwnedContainer({ code: "ETIMEDOUT", stderr: "" }, name),
    false,
  );
  assert.equal(
    isMissingOwnedContainer(
      {
        code: 1,
        stderr:
          "Error response from daemon: No such container: acos-proof-other",
      },
      name,
    ),
    false,
  );
});
const identity = {
  uid: 1000,
  node: "v24.20.0",
  bwrapSha256:
    "d614afff26b5f4f2250f432876399dc95ed2e8c04dbf6dbece3a067d9c7cacb7",
  innerBwrapSha256:
    "9f5789651eb95860fe3242745513a177029983e7a208854529ae7dc23aaf0eb9",
  manifest: {
    executable: "/opt/agentic-codex/bin/codex",
    version: "0.159.2",
    imageRuntime: true,
    bwrapSha256:
      "77360cb751ccedc5971391444ac86a8a33c15b04d6b4a6fe45f5d25496e62c4c",
    integrity:
      "sha512-RrCZ1X52wpa1lOsXtCtSyhjOFdQPh7LH5Ccv8HsKmd/2UXbUwxXFqWXFK3JzatquUNGtW/TLox5Y7qVOGkV0/Q==",
  },
};

test("ordinary, root, replaced and wrong-version toolchains cannot satisfy the coding image gate", () => {
  assertCodingContainerIdentity(identity);
  for (const changed of [
    { ...identity, uid: 0 },
    { ...identity, node: "v20.19.0" },
    { ...identity, bwrapSha256: "b".repeat(64) },
    { ...identity, innerBwrapSha256: "b".repeat(64) },
    {
      ...identity,
      manifest: { ...identity.manifest, bwrapSha256: identity.bwrapSha256 },
    },
    { ...identity, manifest: { ...identity.manifest, imageRuntime: false } },
    {
      ...identity,
      manifest: { ...identity.manifest, executable: "/fixture/codex" },
    },
    {
      ...identity,
      manifest: { ...identity.manifest, integrity: "sha512-fake" },
    },
    { ...identity, manifest: { ...identity.manifest, version: "0.158.0" } },
    {},
  ])
    assert.throws(() => assertCodingContainerIdentity(changed));
});

test("a successful process exit or skipped native cases never become acceptance", () => {
  const tap =
    "# tests 23\n# pass 23\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
  assertNativeTestSummary(0, tap);
  assert.throws(() => assertNativeTestSummary(1, tap));
  assert.throws(() => assertNativeTestSummary(0, "all good"));
  assert.throws(() =>
    assertNativeTestSummary(0, tap.replace("# skipped 0", "# skipped 1")),
  );
  assert.throws(() =>
    assertNativeTestSummary(0, tap.replace("# pass 23", "# pass 22")),
  );
  assert.throws(() => assertNativeTestSummary(0, tap + "# pass 23\n"));
});

test("native tests use immutable image-owned tools, confinement and only one read-only fixture bind", () => {
  const args = codingContainerArguments({
    image,
    fixture: "/owned fixture",
    profile: "/coding seccomp.json",
    apparmor: true,
    name: "acos-proof-fixed",
  });
  assert.ok(args.includes("--pull=never"));
  assert.ok(args.includes("--security-opt=apparmor=agentic-coding"));
  assert.ok(args.includes("--security-opt=no-new-privileges:true"));
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("--cap-drop=ALL"));
  assert.ok(args.includes("--network=none"));
  assert.equal(args.filter((arg) => arg.startsWith("--mount=")).length, 1);
  assert.ok(
    args.includes(
      "--env=ACOS_LINUX_CODEX_EXECUTABLE=/opt/agentic-codex/bin/codex",
    ),
  );
  assert.ok(
    !args.some((arg) => /privileged|unconfined|docker.sock/u.test(arg)),
  );
  for (const input of ["latest", "sha256:bad", "--privileged"])
    assert.throws(() =>
      codingContainerArguments({
        image: input,
        fixture: "/fixture",
        profile: "/profile",
        apparmor: false,
        name: "acos-proof-fixed",
      }),
    );
  assert.throws(() =>
    codingContainerArguments({
      image,
      fixture: "/fixture,other",
      profile: "/profile",
      apparmor: false,
      name: "acos-proof-fixed",
    }),
  );
});
