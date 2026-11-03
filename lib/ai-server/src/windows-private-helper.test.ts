import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { parseWindowsDirectoryReceipt } from "./windows-private-helper";

test("private checker directory receipts reject ambiguous, unbounded or extra output", () => {
  const receipt = {
    protocol: 1,
    created: true,
    device: "1",
    inode: "18446744073709551615",
  };
  const text = JSON.stringify(receipt);
  assert.deepEqual(parseWindowsDirectoryReceipt(text), receipt);
  for (const invalid of [
    "",
    "null",
    "[]",
    `${text}\n`,
    ` ${text}`,
    text + text,
    text.replace('"created":true', '"created":true,"created":false'),
    JSON.stringify({ ...receipt, extra: true }),
    ...[
      0,
      "0",
      "01",
      "-1",
      "1.0",
      "1e3",
      "18446744073709551616",
      "9".repeat(100),
    ].map((inode) => JSON.stringify({ ...receipt, inode })),
    JSON.stringify({ ...receipt, protocol: 2 }),
    JSON.stringify({ ...receipt, created: 1 }),
  ])
    assert.throws(
      () => parseWindowsDirectoryReceipt(invalid),
      /windows_private_storage_postcondition/u,
    );
});

test("relocated private checker loader rejects missing, altered, nonregular and redirected assets on every call", async (t) => {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-checker-asset-"),
  );
  t.after(async () => {
    assert.match(path.basename(root), /^acos-checker-asset-/u);
    await rm(root, { recursive: true, force: true });
  });
  const proposed = path.join(root, "çalışma 私人 folder");
  await mkdir(proposed);
  const directory = await realpath(proposed);
  const bundled = path.join(directory, "loader.mjs");
  const { build } = await import(
    new URL(
      "../../../artifacts/api-server/node_modules/esbuild/lib/main.js",
      import.meta.url,
    ).href
  );
  await build({
    entryPoints: [
      fileURLToPath(new URL("./windows-private-helper.ts", import.meta.url)),
    ],
    outfile: bundled,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    logLevel: "silent",
  });
  const { windowsPrivateHelperExecutable: load } = await import(
    pathToFileURL(bundled).href
  );
  const executable = path.join(directory, "windows-private-helper.exe");
  await assert.rejects(load(), /windows_private_storage_helper_unavailable/u);
  const original = await readFile(
    new URL("./windows-private-helper.exe", import.meta.url),
  );
  await writeFile(executable, original);
  assert.equal(await load(), executable);
  const changed = Buffer.from(original);
  changed[changed.length - 1] ^= 1;
  await writeFile(executable, changed);
  await assert.rejects(load(), /windows_private_storage_helper_invalid/u);
  await writeFile(executable, original.subarray(0, original.length - 1));
  await assert.rejects(load(), /windows_private_storage_helper_invalid/u);
  await rm(executable);
  await mkdir(executable);
  await assert.rejects(load(), /windows_private_storage_helper_invalid/u);
  await rm(executable, { recursive: true });
  if (process.platform !== "win32") {
    await promisify(execFile)("mkfifo", [executable], { timeout: 5_000 });
    // Isolate a blocking open in a child so a regression cannot stall the suite.
    const fifoProbe = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import assert from 'node:assert/strict';
const { windowsPrivateHelperExecutable: load } = await import(${JSON.stringify(pathToFileURL(bundled).href)});
await assert.rejects(load(), /windows_private_storage_helper_invalid/u);`,
      ],
      { timeout: 5_000 },
    );
    assert.equal(fifoProbe.stderr, "");
    await rm(executable);
  }
  await copyFile(
    new URL("./windows-private-helper.exe", import.meta.url),
    executable,
  );
  assert.equal(
    await load(),
    executable,
    "a corrected adjacent asset can be retried explicitly",
  );
  const alias = path.join(root, "redirected");
  await symlink(
    directory,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  // Importing through a data URL preserves the deliberately redirected module
  // URL. Native ESM imports canonicalize symlinks before import.meta.url exists.
  const source = (await readFile(bundled, "utf8")).replaceAll(
    "import.meta.url",
    JSON.stringify(pathToFileURL(path.join(alias, "loader.mjs")).href),
  );
  const redirected = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  await assert.rejects(
    redirected.windowsPrivateHelperExecutable(),
    /windows_private_storage_helper_invalid/u,
  );
});
