import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { testLoaderUrl } from "./test-node-options";

test("test preload and inherited worker preload resolve outside the workspace", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "acos-test-loader-"));
  t.after(() => rmdir(directory));
  const script = `const { Worker } = require('node:worker_threads');
    const worker = new Worker("require('node:worker_threads').parentPort.postMessage('worker-ready')", { eval: true });
    worker.on('error', error => { throw error; });
    worker.on('message', message => console.log(message));`;
  // Regression evidence: the previous relative preload cannot resolve here.
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "--eval", script],
      { cwd: directory, timeout: 30000, windowsHide: true },
    ),
    /Cannot find package 'tsx'/,
  );
  const result = await promisify(execFile)(
    process.execPath,
    ["--import", testLoaderUrl, "--eval", script],
    { cwd: directory, timeout: 30000, windowsHide: true },
  );
  assert.match(result.stdout, /worker-ready/);
  assert.equal(result.stderr, "");
});
