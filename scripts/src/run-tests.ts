import { spawn } from "node:child_process";
import { readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testLoaderUrl } from "./test-node-options";
import { assertLocalTestEnvironment } from "./test-environment";

assertLocalTestEnvironment(process.env);

// Windows hosted runners expose TEMP through an 8.3 account alias. Resolve the
// OS-selected root before tests create their owned files; never relax the
// production checks rejecting redirected user-supplied output directories.
const canonicalTemp = await realpath(tmpdir());
const testEnvironment = {
  ...process.env,
  TEMP: canonicalTemp,
  TMP: canonicalTemp,
  TMPDIR: canonicalTemp,
};

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
const scanRoots = ["artifacts", "lib", "scripts"];
const ignoredDirectories = new Set([
  ".git",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);
const testFilePattern = /\.test\.(?:[cm]?js|tsx?)$/u;
// Many integration files each boot an independent PGlite WASM runtime. A
// CPU-count default can exhaust memory on developer machines and small CI
// runners. Keep the default bounded; explicit larger hosts may opt in.
const concurrency = process.env.TEST_CONCURRENCY ?? "2";
if (!/^[1-8]$/u.test(concurrency)) {
  throw new Error("TEST_CONCURRENCY must be an integer from 1 through 8.");
}
if (
  process.env.TEST_DISABLE_WASM_CODE_GC !== undefined &&
  process.env.TEST_DISABLE_WASM_CODE_GC !== "1"
) {
  throw new Error("TEST_DISABLE_WASM_CODE_GC must be 1 when set.");
}

async function discoverTests(directory: string): Promise<string[]> {
  const discovered: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        discovered.push(...(await discoverTests(absolutePath)));
      }
      continue;
    }
    if (entry.isFile() && testFilePattern.test(entry.name)) {
      discovered.push(absolutePath);
    }
  }

  return discovered;
}

const testFiles = (
  await Promise.all(
    scanRoots.map((root) => discoverTests(path.join(workspaceRoot, root))),
  )
)
  .flat()
  .sort((left, right) => left.localeCompare(right, "en"));

if (testFiles.length === 0) {
  throw new Error(
    "No test files were discovered under artifacts/, lib/, or scripts/.",
  );
}

console.log(
  `Discovered ${testFiles.length} test files; at most ${concurrency} concurrent file processes.`,
);

const child = spawn(
  process.execPath,
  [
    // Node 24's V8 can abort while freeing PGlite WASM code on Windows.
    // Keep the workaround inside test child processes until the fix lands.
    ...(process.env.TEST_DISABLE_WASM_CODE_GC === "1"
      ? ["--no-wasm-code-gc"]
      : []),
    "--import",
    testLoaderUrl,
    "--test",
    // Fail and identify a hung file instead of consuming the whole CI job.
    "--test-timeout=300000",
    `--test-concurrency=${concurrency}`,
    ...testFiles,
  ],
  {
    cwd: workspaceRoot,
    env: testEnvironment,
    stdio: "inherit",
    windowsHide: true,
  },
);

const exitCode = await new Promise<number>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) {
      reject(new Error(`Test runner terminated by ${signal}.`));
      return;
    }
    resolve(code ?? 1);
  });
});

if (exitCode !== 0) process.exitCode = exitCode;
