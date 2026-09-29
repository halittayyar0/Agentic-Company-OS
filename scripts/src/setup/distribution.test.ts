import assert from "node:assert/strict";
import test from "node:test";
import { validateDistribution } from "./distribution";

test("portable distributions require a pinned source revision and immutable image", () => {
  const valid = {
    schemaVersion: 1,
    commit: "a".repeat(40),
    image: `ghcr.io/owner/app@sha256:${"b".repeat(64)}`,
  };
  assert.deepEqual(validateDistribution(valid), valid);
  assert.throws(() =>
    validateDistribution({ ...valid, image: "ghcr.io/owner/app:latest" }),
  );
  assert.throws(() => validateDistribution({ ...valid, commit: "main" }));
  assert.throws(() =>
    validateDistribution({ ...valid, command: "run something" }),
  );
});
