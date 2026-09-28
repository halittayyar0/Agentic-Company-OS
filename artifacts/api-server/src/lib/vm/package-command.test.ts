import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test(
  "the actual VM dispatcher starts npm on Windows without a command shell",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "acos npm workspace "));
    const previousRoot = process.env.AGENT_SANDBOX_ROOT,
      previousExec = process.env.ALLOW_AGENT_PROCESS_EXEC;
    process.env.AGENT_SANDBOX_ROOT = root;
    process.env.ALLOW_AGENT_PROCESS_EXEC = "true";
    t.after(async () => {
      if (previousRoot === undefined) delete process.env.AGENT_SANDBOX_ROOT;
      else process.env.AGENT_SANDBOX_ROOT = previousRoot;
      if (previousExec === undefined)
        delete process.env.ALLOW_AGENT_PROCESS_EXEC;
      else process.env.ALLOW_AGENT_PROCESS_EXEC = previousExec;
      await rm(root, { recursive: true, force: true });
      const { closeDatabase } = await import("@workspace/db");
      await closeDatabase();
    });
    const { execInSandbox, execArgvInSandbox } = await import("./sandbox");
    const result = await execInSandbox(
      1001,
      "npm --version",
      20000,
      undefined,
      "en",
    );
    assert.equal(result.ok, true, `${result.note}: ${result.stderr}`);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
    const structured = await execArgvInSandbox(
      1001,
      [
        "node",
        "--eval",
        "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
        "path with spaces",
        "literal&argument",
      ],
      10000,
      undefined,
      "en",
    );
    assert.equal(structured.ok, true, structured.stderr);
    assert.deepEqual(JSON.parse(structured.stdout), [
      "path with spaces",
      "literal&argument",
    ]);
    assert.throws(
      () => execArgvInSandbox(1001, ["node", "bad\0argument"]),
      /Invalid structured/,
    );
  },
);
