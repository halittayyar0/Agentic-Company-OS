import assert from "node:assert/strict";
import test from "node:test";
import { parseContainerSmokeOptions } from "./container-install-smoke-options";

test("source and published coding installer proofs require explicit distinct selections", () => {
  const image = `ghcr.io/owner/app@sha256:${"a".repeat(64)}`;
  const codingImage = `ghcr.io/owner/app@sha256:${"b".repeat(64)}`;
  assert.deepEqual(parseContainerSmokeOptions([]), { codingRuntime: false });
  assert.deepEqual(parseContainerSmokeOptions(["--coding-source"]), {
    codingRuntime: true,
  });
  assert.deepEqual(parseContainerSmokeOptions([image]), {
    image,
    codingRuntime: false,
  });
  assert.deepEqual(parseContainerSmokeOptions([image, codingImage]), {
    image,
    codingImage,
    codingRuntime: true,
  });
  for (const args of [
    ["latest"],
    [image, image],
    [image, "latest"],
    ["--coding-source", image],
    [image, codingImage, "--privileged"],
    ["--coding-image", codingImage],
  ]) {
    assert.throws(() => parseContainerSmokeOptions(args));
  }
});
