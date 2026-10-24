import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { publicNativeSetupState } from "./native-package-proof";

test("Windows installation CI uses the reviewed PostgreSQL security release", async () => {
  const ci = await readFile(
    new URL("../../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const reviewedUrl =
    "https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip";
  const assertReviewedDownloads = (workflow: string) =>
    assert.deepEqual(
      [
        ...workflow.matchAll(
          /^[ \t]*-Uri[ \t]+"([^"\r\n]+)"[ \t]*`?[ \t]*$/gmu,
        ),
      ].map((match) => match[1]),
      [reviewedUrl, reviewedUrl],
    );
  assertReviewedDownloads(ci);
  for (const url of [
    "https://example.invalid/?next=" + reviewedUrl,
    reviewedUrl + ".unreviewed",
    reviewedUrl + "?unreviewed",
    reviewedUrl + "#unreviewed",
    reviewedUrl.replace("get.enterprisedb.com", "get.enterprisedb.com.invalid"),
    reviewedUrl.replace("get.enterprisedb.com", "get.enterprisedb.com:444"),
    reviewedUrl.replace("get.enterprisedb.com", "get.enterprisedb.com@invalid"),
    reviewedUrl.replace("https:", "http:"),
    reviewedUrl.replace("17.11", "17.10"),
  ]) {
    assert.throws(
      () => assertReviewedDownloads(ci.replaceAll(reviewedUrl, url)),
      "The entire PostgreSQL download operand must match the reviewed URL",
    );
  }
  for (const name of [
    "ci.yml",
    "platforms.yml",
    "distribution.yml",
    "native-packages.yml",
  ]) {
    const workflow = await readFile(
      new URL(`../../../.github/workflows/${name}`, import.meta.url),
      "utf8",
    );
    const versions = [
      ...workflow.matchAll(/^\s+node-version:\s*(\S+)\s*$/gmu),
    ].map((match) => match[1]);
    assert.ok(
      versions.length > 0,
      `${name} must explicitly select its host runtime`,
    );
    assert.ok(
      versions.every((version) => version === "24.22.1"),
      `${name} must not reuse an affected preinstalled Node 24 cache`,
    );
  }
});

test("new native packages admit patched runtimes while rejecting previously valid old pins", async () => {
  const { nodeArchiveDownloadUrl, postgresSourceDownloadUrl } = await import(
    new URL("../../native-runtime-download.mjs", import.meta.url).href
  );
  const pins = JSON.parse(
    await readFile(
      new URL("../../../deploy/native-runtimes.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(pins.postgres.version, "17.11");
  assert.equal(postgresSourceDownloadUrl(pins.postgres), pins.postgres.url);
  assert.throws(() =>
    postgresSourceDownloadUrl({
      ...pins.postgres,
      version: "17.10",
      url: "https://ftp.postgresql.org/pub/source/v17.10/postgresql-17.10.tar.bz2",
    }),
  );
  for (const url of [
    pins.postgres.url + "?unreviewed",
    "https://example.invalid/source.tar.bz2",
  ]) {
    assert.throws(() => postgresSourceDownloadUrl({ ...pins.postgres, url }));
  }
  assert.deepEqual(Object.keys(pins.targets).sort(), [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
    "win32-x64",
  ]);
  for (const [target, value] of Object.entries(pins.targets)) {
    const pin = (value as { node: { version: string; url: string } }).node;
    assert.equal(pin.version, "24.22.1");
    assert.equal(nodeArchiveDownloadUrl(target, pin), pin.url);
    assert.throws(() =>
      nodeArchiveDownloadUrl(target, {
        ...pin,
        version: "24.21.0",
        url: pin.url.replaceAll("24.22.1", "24.21.0"),
      }),
    );
  }
});

test("native runtime downloads accept only the reviewed target URL, never arbitrary pin-file data", async () => {
  const { nodeArchiveDownloadUrl } = await import(
    new URL("../../native-runtime-download.mjs", import.meta.url).href
  );
  const pins = JSON.parse(
    await readFile(
      new URL("../../../deploy/native-runtimes.json", import.meta.url),
      "utf8",
    ),
  );
  for (const [target, value] of Object.entries(pins.targets)) {
    const pin = (value as { node: { version: string; url: string } }).node;
    assert.equal(nodeArchiveDownloadUrl(target, pin), pin.url);
    for (const url of [
      "https://example.invalid/private-file-contents",
      pin.url + "?secret=private-file-contents",
      pin.url + "#private-file-contents",
      "https://nodejs.org/dist/../../unreviewed",
      "file:///private-file-contents",
    ])
      assert.throws(() => nodeArchiveDownloadUrl(target, { ...pin, url }));
    assert.throws(() =>
      nodeArchiveDownloadUrl(target, { ...pin, version: "24.99.0" }),
    );
  }
  assert.throws(() => nodeArchiveDownloadUrl("linux-unreviewed", {}));
});

test("native public setup evidence projects bounded known states without copying private server payloads", () => {
  const privateValue = "http://127.0.0.1:4000/#private-session-token";
  assert.deepEqual(
    publicNativeSetupState({
      phase: "failed",
      step: "prepare_private_config",
      completedSteps: ["check_environment"],
      error: { message: privateValue },
      url: privateValue,
    }),
    {
      phase: "failed",
      step: "prepare_private_config",
      completedSteps: ["check_environment"],
      error: "setup_failed",
    },
  );
  const projected = publicNativeSetupState({
    phase: privateValue,
    step: privateValue,
    completedSteps: [
      "check_environment",
      privateValue,
      "start_native",
      "check_environment",
    ],
    error: privateValue,
  });
  assert.deepEqual(projected, {
    phase: "unknown",
    step: null,
    completedSteps: ["check_environment", "start_native"],
    error: "setup_failed",
  });
  assert.ok(!JSON.stringify(projected).includes(privateValue));
  // Node assertions can echo the original HTTP value despite a custom message.
  // Even that error object must be represented only by the public error code.
  let failure: unknown;
  try {
    assert.equal(privateValue, "complete", "Installation must complete");
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error && failure.message.includes(privateValue));
  assert.equal(
    publicNativeSetupState({ error: failure }).error,
    "setup_failed",
  );
  assert.deepEqual(publicNativeSetupState({}), {
    phase: "unknown",
    step: null,
    completedSteps: [],
    error: null,
  });
});
