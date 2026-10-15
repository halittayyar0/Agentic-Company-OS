import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
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
  "installation lock ignores an unrelated TCP listener at its old coordination port",
  { skip: process.platform !== "win32" && process.platform !== "linux" },
  async () => {
    let occupied: Server | null = null;
    let directory = "";
    for (let attempt = 0; attempt < 20 && !occupied; attempt += 1) {
      directory = `installation-${randomUUID()}`;
      const identity =
        process.platform === "win32"
          ? path.resolve(directory).toLowerCase()
          : path.resolve(directory);
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
        // Try another deterministic candidate if the OS already owns this port.
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

test(
  "Linux installation lock is released when its owning process crashes",
  { skip: process.platform !== "linux", timeout: 15000 },
  async (t) => {
    const directory = `installation-${randomUUID()}`;
    const moduleUrl = new URL("./installation-lock.ts", import.meta.url).href;
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { acquireInstallationLock } from ${JSON.stringify(moduleUrl)};
await acquireInstallationLock(${JSON.stringify(directory)}, 5000);
process.stdout.write("owned\\n");`,
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    const exited = once(child, "exit");
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await exited;
    });
    let output = "";
    for await (const chunk of child.stdout) {
      output += String(chunk);
      if (output === "owned\n") break;
    }
    assert.equal(output, "owned\n");
    await assert.rejects(
      acquireInstallationLock(directory, 5000),
      /already open/,
    );
    child.kill("SIGKILL");
    assert.deepEqual(await exited, [null, "SIGKILL"]);
    const release = await acquireInstallationLock(directory, 5000);
    await release();
  },
);
