import assert from "node:assert/strict";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

export function parseFixtureBuildNetwork(
  value: string | undefined,
): "host" | undefined {
  if (value === undefined) return undefined;
  if (value !== "host") throw new Error("unsupported_fixture_build_network");
  return value;
}

// Only the disposable installer acceptance fixture uses this. A private Docker
// engine without a default bridge may need host networking to download build
// dependencies. Installed services retain their ordinary Compose networks and
// confinement; the default CI/public installation does not select this option.
export async function applyFixtureBuildNetwork(
  command: { command: string; args: string[] },
  fixtureParent: string,
  network: "host" | undefined,
): Promise<void> {
  if (network === undefined) return;
  assert.equal(network, "host");
  if (
    command.command !== "docker" ||
    command.args[0] !== "compose" ||
    !command.args.includes("--build")
  )
    return;
  const index = command.args.lastIndexOf("--file");
  const file = command.args[index + 1];
  assert.ok(
    index >= 0 && file && path.isAbsolute(file),
    "fixture_override_required",
  );
  const owned = await realpath(fixtureParent);
  const resolved = await realpath(file);
  const relative = path.relative(owned, resolved);
  assert.ok(
    relative &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
    "fixture_override_outside_owned_directory",
  );
  assert.equal(path.basename(resolved), "compose.override.json");
  const stat = await lstat(file);
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink(),
    "fixture_override_must_be_regular",
  );
  const override = JSON.parse(await readFile(resolved, "utf8")) as {
    services: Record<string, { build?: Record<string, unknown> }>;
  };
  assert.deepEqual(Object.keys(override.services).sort(), [
    "app",
    "worker-1",
    "worker-2",
  ]);
  for (const service of Object.values(override.services)) {
    assert.ok(
      service.build === undefined ||
        (service.build !== null &&
          typeof service.build === "object" &&
          !Array.isArray(service.build)),
    );
    service.build = { ...service.build, network };
  }
  await writeFile(resolved, JSON.stringify(override), { mode: 0o600 });
}
