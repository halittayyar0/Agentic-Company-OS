import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveProcessLaunch } from "./process-launch";

test("Windows package tools execute their JS entrypoint directly, preserving argument boundaries", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "acos package tools "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cli = path.join(root, "node_modules/npm/bin/npm-cli.js");
  await mkdir(path.dirname(cli), { recursive: true });
  await writeFile(
    cli,
    "process.stdout.write(JSON.stringify(process.argv.slice(2)))",
  );
  const resolved = await resolveProcessLaunch(
    "npm",
    ["run", "test with spaces"],
    { platform: "win32", searchDirectories: [root] },
  );
  assert.equal(resolved.command, process.execPath);
  assert.deepEqual(resolved.args, [cli, "run", "test with spaces"]);
  const { stdout } = await promisify(execFile)(
    resolved.command,
    resolved.args,
    { windowsHide: true },
  );
  assert.deepEqual(JSON.parse(stdout), ["run", "test with spaces"]);
  await assert.rejects(
    resolveProcessLaunch("pnpm", [], {
      platform: "win32",
      searchDirectories: [root],
    }),
    /PACKAGE_MANAGER_UNAVAILABLE/,
  );
  assert.deepEqual(
    await resolveProcessLaunch("npm", ["--version"], { platform: "linux" }),
    { command: "npm", args: ["--version"] },
  );
});
