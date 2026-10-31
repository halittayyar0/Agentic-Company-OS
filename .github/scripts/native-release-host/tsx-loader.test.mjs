import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { ownedTsxLoader } from "./tsx-loader.mjs";

test("the exact private driver preload starts on Windows with sanitized environment before any model or installer", async () => {
  const env = {};
  for (const key of [
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOME",
    "APPDATA",
    "LOCALAPPDATA",
  ])
    if (process.env[key]) env[key] = process.env[key];
  env.PATH = path.join(process.env.SystemRoot, "System32");
  const result = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      ownedTsxLoader(process.cwd()),
      "--input-type=module",
      "-e",
      "process.stdout.write('owned_tsx_preload_ready')",
    ],
    {
      cwd: process.cwd(),
      env,
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 65536,
    },
  );
  assert.equal(result.stdout, "owned_tsx_preload_ready");
  assert.throws(
    () => ownedTsxLoader("relative/root"),
    /absolute_application_root_required/,
  );
});
