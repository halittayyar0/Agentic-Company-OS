import assert from "node:assert/strict";

const BWRAP =
  "d614afff26b5f4f2250f432876399dc95ed2e8c04dbf6dbece3a067d9c7cacb7";
const INTEGRITY =
  "sha512-RrCZ1X52wpa1lOsXtCtSyhjOFdQPh7LH5Ccv8HsKmd/2UXbUwxXFqWXFK3JzatquUNGtW/TLox5Y7qVOGkV0/Q==";

export function assertCodingCompose(value: unknown, apparmor: boolean): void {
  const services = (
    value as { services?: Record<string, Record<string, unknown>> } | null
  )?.services;
  assert.ok(services, "coding_compose_services_missing");
  assert.deepEqual(
    services.app?.security_opt,
    ["no-new-privileges:true", "seccomp=./deploy/chromium-seccomp.json"],
    "coding_compose_must_preserve_api_profile",
  );
  for (const name of ["worker-1", "worker-2"]) {
    const service: Record<string, unknown> | undefined = services[name];
    assert.ok(service, "coding_compose_worker_missing");
    assert.deepEqual(
      service.security_opt,
      [
        "no-new-privileges:true",
        "seccomp=./deploy/coding-seccomp.json",
        ...(apparmor ? ["apparmor=agentic-coding"] : []),
      ],
      "coding_compose_worker_security_invalid",
    );
    assert.equal(
      service.read_only,
      true,
      "coding_compose_worker_root_must_be_readonly",
    );
    assert.deepEqual(
      service.cap_drop,
      ["ALL"],
      "coding_compose_worker_must_drop_capabilities",
    );
    assert.equal(service.pids_limit, 512, "coding_compose_worker_pids_invalid");
    assert.ok(
      service.privileged !== true &&
        service.network_mode !== "host" &&
        service.pid !== "host",
      "coding_compose_host_escape_configuration_refused",
    );
  }
}

export function isMissingOwnedContainer(error: unknown, name: string): boolean {
  const result = error as { code?: unknown; stderr?: unknown } | null;
  if (!result || result.code !== 1 || typeof result.stderr !== "string")
    return false;
  return [
    `Error response from daemon: No such container: ${name}`,
    `Error: No such object: ${name}`,
  ].includes(result.stderr.trim());
}

export function assertCodingContainerIdentity(value: unknown): void {
  const identity = value as {
    uid?: unknown;
    node?: unknown;
    bwrapSha256?: unknown;
    innerBwrapSha256?: unknown;
    manifest?: {
      executable?: unknown;
      version?: unknown;
      imageRuntime?: unknown;
      integrity?: unknown;
      bwrapSha256?: unknown;
    };
  } | null;
  assert.ok(
    identity &&
      identity.uid === 1000 &&
      typeof identity.node === "string" &&
      /^v24\.\d+\.\d+$/u.test(identity.node) &&
      identity.bwrapSha256 === BWRAP &&
      identity.innerBwrapSha256 ===
        "9f5789651eb95860fe3242745513a177029983e7a208854529ae7dc23aaf0eb9" &&
      identity.manifest?.bwrapSha256 ===
        "77360cb751ccedc5971391444ac86a8a33c15b04d6b4a6fe45f5d25496e62c4c" &&
      identity.manifest?.imageRuntime === true &&
      identity.manifest.executable === "/opt/agentic-codex/bin/codex" &&
      identity.manifest.version === "0.159.2" &&
      identity.manifest.integrity === INTEGRITY,
    "coding_container_identity_invalid",
  );
}

export function assertNativeTestSummary(
  exitCode: number | null,
  output: string,
): void {
  assert.equal(exitCode, 0, "coding_container_native_process_failed");
  for (const [label, count] of Object.entries({
    tests: 23,
    pass: 23,
    fail: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
  })) {
    const matches = [
      ...output.matchAll(new RegExp(`^# ${label} (\\d+)\\r?$`, "gmu")),
    ];
    assert.equal(
      matches.length,
      1,
      "coding_container_native_summary_missing_or_ambiguous",
    );
    assert.equal(
      Number(matches[0][1]),
      count,
      "coding_container_native_summary_failed",
    );
  }
}

export function codingContainerArguments(input: {
  image: string;
  fixture: string;
  profile: string;
  apparmor: boolean;
  name: string;
}): string[] {
  assert.match(
    input.image,
    /^(?:sha256:[a-f0-9]{64}|ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64})$/u,
    "coding_container_image_must_be_immutable",
  );
  assert.match(
    input.name,
    /^acos-proof-[a-z0-9-]{1,48}$/u,
    "coding_container_name_invalid",
  );
  assert.ok(
    input.fixture &&
      input.profile &&
      !/[\r\n\0,]/u.test(input.fixture) &&
      !/[\r\n\0]/u.test(input.profile),
    "coding_container_mount_path_invalid",
  );
  return [
    "run",
    "--rm",
    "--pull=never",
    `--name=${input.name}`,
    "--network=none",
    "--read-only",
    "--user=1000:1000",
    "--cap-drop=ALL",
    "--pids-limit=512",
    "--security-opt=no-new-privileges:true",
    `--security-opt=seccomp=${input.profile}`,
    ...(input.apparmor ? ["--security-opt=apparmor=agentic-coding"] : []),
    "--tmpfs=/tmp:rw,exec,nosuid,size=256m,mode=1777",
    `--mount=type=bind,src=${input.fixture},dst=/fixture,readonly`,
    "--env=HOME=/tmp",
    "--env=ACOS_LINUX_NAMESPACE_TESTS=1",
    "--env=ACOS_LINUX_CODEX_TESTS=1",
    "--env=ACOS_LINUX_CODEX_EXECUTABLE=/opt/agentic-codex/bin/codex",
    "--env=ACOS_LINUX_LAUNCHER_WORKER=/fixture/launcher-owner.mjs",
  ];
}
