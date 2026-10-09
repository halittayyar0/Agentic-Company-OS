import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import test from "node:test";
import { codexOfflineRpc } from "./codex-offline-rpc";

function fixture() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  return {
    child,
    rpc: codexOfflineRpc(
      child as unknown as ChildProcessWithoutNullStreams,
      "/fixture-workspace",
    ),
  };
}

test("offline verifier drains native diagnostics without retaining their body", async () => {
  const { child, rpc } = fixture();
  try {
    const result = rpc.request("initialize", {});
    child.stderr.write(Buffer.alloc(64 * 1024, 120));
    assert.equal(child.stderr.readableLength, 0);
    child.stdout.write(
      JSON.stringify({ id: 1, result: { ready: true } }) + "\n",
    );
    assert.deepEqual(await result, { ready: true });
  } finally {
    rpc.dispose();
  }
});

test("oversized native diagnostics fail a pending probe with a fixed error", async () => {
  const { child, rpc } = fixture();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = rpc.request("initialize", {});
    child.stderr.write(Buffer.alloc(128 * 1024 + 1, 120));
    await assert.rejects(
      Promise.race([
        result,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("diagnostics_not_drained")),
            150,
          );
        }),
      ]),
      { message: "offline_native_protocol_failed" },
    );
    await assert.rejects(rpc.request("initialize", {}), {
      message: "offline_native_protocol_failed",
    });
  } finally {
    clearTimeout(timer);
    rpc.dispose();
  }
});
