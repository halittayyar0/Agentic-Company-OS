import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFounderShell } from "./sandbox";

test("host shell checks original request authority before creating a directory or starting the shell", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "acos-host-boundary-"));
  const cwd = path.join(root, "work");
  const previous = process.env.ALLOW_FOUNDER_SHELL;
  process.env.ALLOW_FOUNDER_SHELL = "true";
  t.after(async () => {
    if (previous === undefined) delete process.env.ALLOW_FOUNDER_SHELL;
    else process.env.ALLOW_FOUNDER_SHELL = previous;
    await fsp.rm(root, { recursive: true, force: true });
  });
  let checks = 0;
  await assert.rejects(
    execFounderShell("echo controlled-fixture", cwd, async () => {
      checks++;
      throw Error("original owner expired");
    }),
    /original owner expired/,
  );
  assert.equal(checks, 1);
  await assert.rejects(fsp.access(cwd));
  const completed = await execFounderShell(
    "echo controlled-fixture",
    cwd,
    async () => {
      checks++;
    },
  );
  assert.equal(completed.ok, true);
  assert.match(completed.stdout, /controlled-fixture/);
  assert.equal(
    checks,
    3,
    "check before directory creation and again at process launch",
  );
});
