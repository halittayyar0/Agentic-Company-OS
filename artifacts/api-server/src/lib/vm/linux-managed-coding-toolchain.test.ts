import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import {
  hasManagedCodingContainment,
  hasManagedCodexIdentity,
  hasManagedCodingToolchainIdentity,
  MANAGED_CODING_MANIFEST_PATH,
  readLinuxCodingMode,
} from "./linux-managed-coding-toolchain";

// Hand-authored from the controlled managed-container observations. Expectations
// do not use the production manifest builder or mount/status parser.
const manifest = {
  kind: "managed-coding-helpers-v1",
  outerSha256:
    "d614afff26b5f4f2250f432876399dc95ed2e8c04dbf6dbece3a067d9c7cacb7",
  innerSha256:
    "9f5789651eb95860fe3242745513a177029983e7a208854529ae7dc23aaf0eb9",
  archiveSha256:
    "d038cebff7a83e2ea0039f652e19b18f708e99b93ab2372341d488c393fc1a5a",
  changedSourceSha256:
    "a2378ba1043fb9821310453db3c3988e84f194a66e8bc526f502deffc0340f27",
  filteredSourceSha256:
    "dcf9f8da4dce7cd5acf7b1e209eb14094a2cdf8613dc40f3caa3d13265ca909e",
  commandFilterSha256:
    "43da5df160b438feb7796814c88d81393ca618d67911e210858727f4e59faeac",
  procInformationGuardSha256:
    "e2fa084e91751700b4bf1c89c25d427a62a2025af72306735c946c92c52d415d",
  apparmorSha256:
    "738840b998afef3e2c626751d0fe8ad39b43fb39c39cc5d4627cbdb8365d869a",
};
const file = {
  regular: true,
  symlink: false,
  canonical: true,
  uid: 0,
  mode: 0o100444,
  size: 2383,
};
function toolchain() {
  return {
    manifest: { ...manifest },
    manifestFile: { ...file, size: 1024 },
    outer: { ...file, mode: 0o100555, sha256: manifest.outerSha256 },
    inner: { ...file, mode: 0o100555, sha256: manifest.innerSha256 },
    profile: { ...file, sha256: manifest.apparmorSha256 },
  };
}
const originalManifest = {
  root: "/opt/agentic-codex",
  executable: "/opt/agentic-codex/bin/codex",
  version: "0.159.2",
  archiveSha256:
    "84a6b35fb45bdcb94cef9fcb329438045a8911f53876cc9a9a7e6f9bb1382eba",
  integrity:
    "sha512-RrCZ1X52wpa1lOsXtCtSyhjOFdQPh7LH5Ccv8HsKmd/2UXbUwxXFqWXFK3JzatquUNGtW/TLox5Y7qVOGkV0/Q==",
  bwrapSha256:
    "77360cb751ccedc5971391444ac86a8a33c15b04d6b4a6fe45f5d25496e62c4c",
  imageRuntime: true,
};
function codexIdentity() {
  return {
    manifest: { ...originalManifest },
    manifestFile: { ...file, size: 1024 },
    executable: {
      ...file,
      path: "/opt/agentic-codex/bin/codex",
      mode: 0o100755,
      size: 216 * 1024 * 1024,
    },
  };
}
test("managed admission binds the protected original Codex archive manifest and fixed large executable", () => {
  assert.equal(hasManagedCodexIdentity(codexIdentity()), true);
  assert.equal(
    hasManagedCodexIdentity({
      ...codexIdentity(),
      executable: { ...codexIdentity().executable, size: 512 * 1024 * 1024 },
    }),
    true,
  );
  for (const key of Object.keys(originalManifest)) {
    const changed = { ...originalManifest, [key]: "unexpected" };
    assert.equal(
      hasManagedCodexIdentity({ ...codexIdentity(), manifest: changed }),
      false,
      key,
    );
    const missing = { ...originalManifest } as Record<string, unknown>;
    delete missing[key];
    assert.equal(
      hasManagedCodexIdentity({ ...codexIdentity(), manifest: missing }),
      false,
      key,
    );
  }
  for (const value of [null, [], { ...originalManifest, extra: true }])
    assert.equal(
      hasManagedCodexIdentity({ ...codexIdentity(), manifest: value }),
      false,
    );
});
test("managed Codex refuses another path and foreign or unprotected executable or original manifest", () => {
  for (const change of [
    { path: "/tmp/fake-codex" },
    { regular: false },
    { symlink: true },
    { canonical: false },
    { uid: 1000 },
    { mode: 0o100777 },
    { mode: 0o104755 },
    { mode: 0o102755 },
    { mode: 0o100644 },
    { size: 0 },
    { size: 512 * 1024 * 1024 + 1 },
  ])
    assert.equal(
      hasManagedCodexIdentity({
        ...codexIdentity(),
        executable: { ...codexIdentity().executable, ...change },
      }),
      false,
    );
  for (const change of [
    { regular: false },
    { symlink: true },
    { canonical: false },
    { uid: 1000 },
    { mode: 0o100666 },
    { size: 0 },
    { size: 4097 },
  ])
    assert.equal(
      hasManagedCodexIdentity({
        ...codexIdentity(),
        manifestFile: { ...file, ...change },
      }),
      false,
    );
});
const status = `Name:\tnode
Uid:\t1000\t1000\t1000\t1000
Gid:\t1000\t1000\t1000\t1000
CapInh:\t0000000000000000
CapPrm:\t0000000000000000
CapEff:\t0000000000000000
CapBnd:\t0000000000000000
CapAmb:\t0000000000000000
NoNewPrivs:\t1
Seccomp:\t2
`;
const mounts = `1 0 0:1 / / ro,relatime - overlay overlay rw
2 1 0:2 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw
3 1 0:3 / /sys ro,nosuid,nodev,noexec,relatime - sysfs sysfs ro
4 2 0:2 /bus /proc/bus ro,nosuid,nodev,noexec,relatime - proc proc rw
5 2 0:2 /fs /proc/fs ro,nosuid,nodev,noexec,relatime - proc proc rw
6 2 0:2 /irq /proc/irq ro,nosuid,nodev,noexec,relatime - proc proc rw
7 2 0:2 /sys /proc/sys ro,nosuid,nodev,noexec,relatime - proc proc rw
8 2 0:2 /sysrq-trigger /proc/sysrq-trigger ro,nosuid,nodev,noexec,relatime - proc proc rw
9 2 0:4 / /proc/acpi ro,nosuid,nodev,relatime - tmpfs tmpfs ro
10 2 0:5 /null /proc/interrupts rw,nosuid,nodev - tmpfs tmpfs rw
11 2 0:5 /null /proc/kcore rw,nosuid,nodev - tmpfs tmpfs rw
12 2 0:5 /null /proc/keys rw,nosuid,nodev - tmpfs tmpfs rw
13 2 0:5 /null /proc/latency_stats rw,nosuid,nodev - tmpfs tmpfs rw
14 2 0:5 /null /proc/timer_list rw,nosuid,nodev - tmpfs tmpfs rw
15 2 0:6 / /proc/scsi ro,nosuid,nodev,relatime - tmpfs tmpfs ro
`;
function containment() {
  return {
    platform: "linux",
    architecture: "x64",
    uid: 1000,
    gid: 1000,
    dockerMarker: true,
    status,
    mounts,
    apparmor: "agentic-coding (enforce)\n",
  };
}

test("only the exact protected managed helper and packaged profile identities qualify", () => {
  assert.equal(hasManagedCodingToolchainIdentity(toolchain()), true);
  for (const key of ["outer", "inner", "profile"] as const) {
    const changed = toolchain();
    changed[key].sha256 = "0".repeat(64);
    assert.equal(hasManagedCodingToolchainIdentity(changed), false, key);
  }
  for (const key of Object.keys(manifest)) {
    assert.equal(
      hasManagedCodingToolchainIdentity({
        ...toolchain(),
        manifest: { ...manifest, [key]: "unexpected" },
      }),
      false,
      key,
    );
  }
  for (const value of [null, [], "manifest", { ...manifest, extra: true }])
    assert.equal(
      hasManagedCodingToolchainIdentity({ ...toolchain(), manifest: value }),
      false,
    );
});

test("managed identity refuses redirected, foreign, writable, privileged or oversized files", () => {
  for (const key of ["manifestFile", "outer", "inner", "profile"] as const)
    for (const change of [
      { regular: false },
      { symlink: true },
      { canonical: false },
      { uid: 1000 },
      { mode: 0o100666 },
      { mode: 0o104555 },
      { mode: 0o102555 },
      { size: 0 },
      { size: 32 * 1024 * 1024 + 1 },
    ]) {
      const changed = toolchain();
      Object.assign(changed[key], change);
      assert.equal(
        hasManagedCodingToolchainIdentity(changed),
        false,
        `${key} ${JSON.stringify(change)}`,
      );
    }
  assert.equal(
    hasManagedCodingToolchainIdentity({
      ...toolchain(),
      manifestFile: { ...file, size: 4097 },
    }),
    false,
  );
  assert.equal(
    hasManagedCodingToolchainIdentity({
      ...toolchain(),
      outer: { ...toolchain().outer, mode: 0o100444 },
    }),
    false,
  );
});

test("observed managed containment accepts Docker's twelve preserved proc masks", () => {
  assert.equal(hasManagedCodingContainment(containment()), true);
  assert.equal(
    hasManagedCodingContainment({
      ...containment(),
      mounts:
        mounts +
        "16 1 0:7 /with\\040space /owned\\040space rw - tmpfs tmpfs rw\n",
    }),
    true,
  );
});

test("managed containment refuses unsupported platform, identities and AppArmor state", () => {
  for (const change of [
    { platform: "win32" },
    { architecture: "arm64" },
    { uid: 0 },
    { gid: 0 },
    { dockerMarker: false },
    { apparmor: "unconfined\n" },
    { apparmor: "agentic-coding (complain)\n" },
    { apparmor: "agentic-coding-other (enforce)\n" },
  ])
    assert.equal(
      hasManagedCodingContainment({ ...containment(), ...change }),
      false,
    );
});

test("every status identity and capability must be present, unique and exact", () => {
  for (const field of [
    "Uid",
    "Gid",
    "CapInh",
    "CapPrm",
    "CapEff",
    "CapBnd",
    "CapAmb",
    "NoNewPrivs",
    "Seccomp",
  ]) {
    const line = status
      .split("\n")
      .find((value) => value.startsWith(field + ":"))!;
    for (const changed of [
      status.replace(line + "\n", ""),
      status + line + "\n",
      status.replace(line, field + ":\t0"),
    ])
      assert.equal(
        hasManagedCodingContainment({ ...containment(), status: changed }),
        false,
        field,
      );
  }
  for (const field of ["Uid", "Gid"])
    for (const columns of [
      "1000 0 1000 1000",
      "1000 1000 1000 0",
      "1000 1000 1000",
      "1000 1000 1000 1000 1000",
    ])
      assert.equal(
        hasManagedCodingContainment({
          ...containment(),
          status: status.replace(
            new RegExp(`${field}:.*`),
            field + ":\t" + columns,
          ),
        }),
        false,
      );
  assert.equal(
    hasManagedCodingContainment({
      ...containment(),
      status: status + "malformed\n",
    }),
    false,
  );
  assert.equal(
    hasManagedCodingContainment({ ...containment(), status: status + "\0" }),
    false,
  );
});

test("all proc mount attributes are required and ambiguous or added proc mounts refuse", () => {
  for (const line of mounts.trimEnd().split("\n")) {
    assert.equal(
      hasManagedCodingContainment({
        ...containment(),
        mounts: mounts.replace(line + "\n", ""),
      }),
      false,
      line,
    );
    assert.equal(
      hasManagedCodingContainment({
        ...containment(),
        mounts: mounts + line + "\n",
      }),
      false,
      line,
    );
  }
  for (const changed of [
    mounts.replace("/ / ro,", "/ / rw,"),
    mounts.replace("/ /sys ro,", "/ /sys rw,"),
    mounts.replace("/bus /proc/bus ro,", "/bus /proc/bus rw,"),
    mounts.replace("/bus /proc/bus", "/ /proc/bus"),
    mounts.replace("/null /proc/keys", "/keys /proc/keys"),
    mounts.replace("- tmpfs tmpfs", "- proc proc"),
    mounts.replace("rw,nosuid,nodev,noexec", "rw,nosuid,nodev"),
    mounts + "16 2 0:9 / /proc/unmasked rw - proc proc rw\n",
    mounts.replace(" - proc proc rw", " proc proc rw"),
    mounts.replace("/proc/bus", "/proc/\\142us"),
    mounts + "broken\n",
  ])
    assert.equal(
      hasManagedCodingContainment({ ...containment(), mounts: changed }),
      false,
      changed,
    );
});

test("only an absent fixed manifest selects native mode without examining distro helpers", async (t) => {
  t.mock.method(fs, "lstat", async (file: unknown) => {
    assert.equal(file, "/usr/share/doc/acos-proc-vendor-probe/helpers.json");
    throw Object.assign(new Error("absent"), { code: "ENOENT" });
  });
  assert.equal(await readLinuxCodingMode(), "native");
});

test("manifest lookup errors never silently select native mode", async (t) => {
  for (const code of ["EACCES", "ELOOP", "ENOTDIR", "EIO"]) {
    const lookup = t.mock.method(fs, "lstat", async () => {
      throw Object.assign(new Error("sensitive-path-must-not-leak"), { code });
    });
    await assert.rejects(readLinuxCodingMode(), {
      message: "owned_linux_runtime_unsupported",
    });
    lookup.mock.restore();
  }
});

test("a present invalid manifest never downgrades to native mode", async (t) => {
  t.mock.method(fs, "lstat", async (file: unknown) => {
    assert.equal(file, MANAGED_CODING_MANIFEST_PATH);
    return { isFile: () => false, isSymbolicLink: () => true };
  });
  await assert.rejects(readLinuxCodingMode(), {
    message: "owned_linux_runtime_unsupported",
  });
});
