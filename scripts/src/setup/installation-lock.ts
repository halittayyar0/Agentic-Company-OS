import { createHash } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
/** OS-owned loopback lease: automatically released on crashes, no stale lock file. */
export async function acquireInstallationLock(
  directory: string,
  appPort: number,
) {
  const identity =
    process.platform === "win32"
      ? path.resolve(directory).toLowerCase()
      : path.resolve(directory);
  const digest = createHash("sha256").update(identity).digest();
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", () =>
      reject(
        new Error(
          "Installation is already open, or its local coordination endpoint is in use",
        ),
      ),
    );
    if (process.platform === "win32") {
      // A named pipe keeps the crash-released OS lease without competing with
      // the Windows ephemeral TCP port range used by browsers and test runners.
      server.listen(
        {
          path: `\\\\.\\pipe\\acos-install-${digest.toString("hex")}`,
          exclusive: true,
        },
        resolve,
      );
    } else {
      let port = 40000 + (digest.readUInt32BE(0) % 20000);
      if (port === appPort) port = 40000 + ((port - 40000 + 1) % 20000);
      server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
    }
  });
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };
}
