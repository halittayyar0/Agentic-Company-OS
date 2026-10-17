import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { publicNativeSetupState } from "./native-package-proof";

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
