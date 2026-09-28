import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { testLoaderUrl } from "./test-node-options";

test("test environment canonicalizes the OS temp alias before child tests run", async (t) => {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-temp-alias-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = path.join(root, "real temp");
  const alias = path.join(root, "temp alias");
  await mkdir(target);
  await symlink(
    target,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  const preload = new URL("./test-node-options.ts", import.meta.url).href;
  const script = `await import(${JSON.stringify(preload)}); console.log((await import('node:os')).tmpdir());`;
  const result = await promisify(execFile)(
    process.execPath,
    ["--import", testLoaderUrl, "--input-type=module", "--eval", script],
    {
      env: { ...process.env, TMP: alias, TEMP: alias, TMPDIR: alias },
      windowsHide: true,
      timeout: 30000,
    },
  );
  assert.equal(result.stdout.trim(), await realpath(target));
});
