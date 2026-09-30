import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:net";
import path from "node:path";
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

test(
  "Windows installation lock ignores an unrelated TCP listener at its old coordination port",
  { skip: process.platform !== "win32" },
  async () => {
    let occupied: Server | null = null;
    let directory = "";
    for (let attempt = 0; attempt < 20 && !occupied; attempt += 1) {
      directory = `installation-${randomUUID()}`;
      const identity = path.resolve(directory).toLowerCase();
      const port =
        40_000 +
        (createHash("sha256").update(identity).digest().readUInt32BE(0) %
          20_000);
      const candidate = createServer();
      try {
        await new Promise<void>((resolve, reject) => {
          candidate.once("error", reject);
          candidate.listen(
            { host: "127.0.0.1", port, exclusive: true },
            resolve,
          );
        });
        occupied = candidate;
      } catch {
        // Try another deterministic candidate if Windows already owns this port.
      }
    }
    assert.ok(occupied, "a test TCP port must be available");
    try {
      const release = await acquireInstallationLock(directory, 5000);
      await release();
    } finally {
      await new Promise<void>((resolve, reject) =>
        occupied.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
