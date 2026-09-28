import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { acquireInstallationLock } from "./installation-lock";
test("concurrent launchers cannot own the same installation, and release allows restart", async () => {
  const directory = `installation-${randomUUID()}`,
    release = await acquireInstallationLock(directory, 5000);
  try {
    await assert.rejects(
      acquireInstallationLock(directory, 5000),
      /already open/,
    );
  } finally {
    await release();
  }
  const second = await acquireInstallationLock(directory, 5000);
  await second();
  await second();
});
