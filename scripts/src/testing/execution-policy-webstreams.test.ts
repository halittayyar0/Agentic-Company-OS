import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { prepareLocalTestEnvironment } from "../test-environment";
import { testLoaderUrl } from "../test-node-options";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const policyUrl = new URL(
  "../../../artifacts/api-server/src/lib/execution-policy.ts",
  import.meta.url,
).href;
const databaseModuleUrl = new URL(
  "../../../lib/db/src/index.ts",
  import.meta.url,
).href;

// Real Node streams and the real database-backed policy check. Effects are
// recorded decisions only: no file, browser, delegation or model is invoked.
const probe = String.raw`
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { setImmediate } from "node:timers/promises";
import { dbReady, closeDatabase } from ${JSON.stringify(databaseModuleUrl)};
import { withToolPolicy, assertToolPolicy, readExecutionPolicy, updateExecutionPolicy } from ${JSON.stringify(policyUrl)};

async function drain(readable) {
  const values = [];
  for await (const value of readable) values.push(value);
  assert.deepEqual(values, ["first", "second", "third"]);
}
function queue(stream) {
  const writer = stream.writable.getWriter();
  return Promise.all([writer.write("first"), writer.write("second"),
    writer.write("third"), writer.close()]);
}
async function rawContext(creator, queuer) {
  const scope = new AsyncLocalStorage();
  const seen = [];
  const stream = scope.run(creator, () => new TransformStream({
    transform(value, controller) {
      seen.push(scope.getStore() ?? null); controller.enqueue(value);
    },
    flush() { seen.push(scope.getStore() ?? null); },
  }));
  const writing = scope.run(queuer, () => queue(stream));
  await setImmediate();
  assert.deepEqual(seen, [], "writes must actually park before the reader starts");
  await scope.run("reader", () => drain(stream.readable));
  await writing;
  return seen;
}
async function policyContext(writerTool, readerTool) {
  const seen = [];
  async function inspect() {
    try { await assertToolPolicy(); seen.push("allowed"); }
    catch (error) {
      if (error?.code !== "EXECUTION_POLICY_DENIED") throw error;
      seen.push("denied");
    }
  }
  const pending = await withToolPolicy(writerTool, async () => {
    const stream = new TransformStream({
      async transform(value, controller) { await inspect(); controller.enqueue(value); },
      flush: inspect,
    });
    return { stream, writing: queue(stream) };
  });
  await setImmediate();
  assert.deepEqual(seen, [], "policy callbacks must wait for backpressure");
  await withToolPolicy(readerTool, () => drain(pending.stream.readable));
  await pending.writing;
  return seen;
}
await dbReady;
try {
  const initial = await readExecutionPolicy();
  await updateExecutionPolicy({ mode: "read_only", expectedRevision: initial.revision });
  const result = {
    wasmCodeGcDisabled: process.execArgv.includes("--no-wasm-code-gc"),
    scoped: await rawContext("writer", "writer"),
    unscoped: await rawContext(undefined, undefined),
    scopedOtherQueue: await rawContext("writer", "different-writer"),
    unscopedOtherQueue: await rawContext(undefined, "different-writer"),
    scopedNoQueue: await rawContext("writer", undefined),
    deniedWriter: await policyContext("vm_write_file", "computer_observe"),
    observingWriter: await policyContext("computer_observe", "vm_write_file"),
  };
  console.log(JSON.stringify(result));
} finally { await closeDatabase(); }
`;

interface Observations {
  wasmCodeGcDisabled: boolean;
  scoped: Array<string | null>;
  unscoped: Array<string | null>;
  scopedOtherQueue: Array<string | null>;
  unscopedOtherQueue: Array<string | null>;
  scopedNoQueue: Array<string | null>;
  deniedWriter: string[];
  observingWriter: string[];
}
const observations: Array<{ mode: string; result: Observations }> = [];

test.before(async () => {
  for (const flags of [[], ["--no-async-context-frame"]]) {
    // A nested probe owns fresh provider storage and must never import a user's
    // database. Keep database conflicts visible to the existing environment gate.
    const env = await prepareLocalTestEnvironment({
      ...process.env,
      CHATGPT_STORAGE_DIRECTORY: undefined,
    });
    const { stdout } = await execute(
      process.execPath,
      [
        ...(process.env.TEST_DISABLE_WASM_CODE_GC === "1"
          ? ["--no-wasm-code-gc"]
          : []),
        ...flags,
        "--import",
        testLoaderUrl,
        "--input-type=module",
        "--eval",
        probe,
      ],
      { cwd: root, env, timeout: 60000, maxBuffer: 65536, windowsHide: true },
    );
    observations.push({
      mode: flags[0] ?? "default",
      result: JSON.parse(stdout),
    });
  }
});

test("parked stream callbacks keep their creating context and never borrow a reader scope", () => {
  for (const { mode, result } of observations) {
    if (process.env.TEST_DISABLE_WASM_CODE_GC === "1")
      assert.equal(result.wasmCodeGcDisabled, true, mode);
    assert.deepEqual(result.scoped, Array(4).fill("writer"), mode);
    assert.deepEqual(result.unscoped, Array(4).fill(null), mode);
    assert.deepEqual(result.scopedOtherQueue, Array(4).fill("writer"), mode);
    assert.deepEqual(result.unscopedOtherQueue, Array(4).fill(null), mode);
    assert.deepEqual(result.scopedNoQueue, Array(4).fill("writer"), mode);
  }
});

test("read-only stream writer remains denied when an observing reader drains it", () => {
  for (const { mode, result } of observations)
    assert.deepEqual(result.deniedWriter, Array(4).fill("denied"), mode);
});

test("observing stream writer remains allowed when an effect-denied reader drains it", () => {
  for (const { mode, result } of observations)
    assert.deepEqual(result.observingWriter, Array(4).fill("allowed"), mode);
});
