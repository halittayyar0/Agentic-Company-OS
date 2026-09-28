import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadWorkspaceEnv } from "./load-workspace-env.mjs";

test("isolated installations select their own env file and reject a relative override", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "agentic-env-override-"),
  );
  const previous = process.env.WORKSPACE_ENV_FILE;
  t.after(async () => {
    if (previous === undefined) delete process.env.WORKSPACE_ENV_FILE;
    else process.env.WORKSPACE_ENV_FILE = previous;
    delete process.env.ACOS_ISOLATED_ENV_TEST;
    await rm(directory, { recursive: true, force: true });
  });
  const file = path.join(directory, "isolated.env");
  await writeFile(file, "ACOS_ISOLATED_ENV_TEST=isolated\n");
  process.env.WORKSPACE_ENV_FILE = file;
  assert.equal(loadWorkspaceEnv(), true);
  assert.equal(process.env.ACOS_ISOLATED_ENV_TEST, "isolated");
  process.env.WORKSPACE_ENV_FILE = "relative.env";
  assert.throws(() => loadWorkspaceEnv(), /absolute/);
});

test("workspace env loader is optional and preserves explicit process values", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-os-env-"));
  const envPath = path.join(tempDir, ".env");
  const explicitKey = `AGENTIC_OS_EXPLICIT_${process.pid}`;
  const loadedKey = `AGENTIC_OS_LOADED_${process.pid}`;

  try {
    process.env[explicitKey] = "from-process";
    delete process.env[loadedKey];
    await writeFile(
      envPath,
      `${explicitKey}=from-file\n${loadedKey}=from-file\n`,
      "utf8",
    );

    assert.equal(loadWorkspaceEnv(envPath), true);
    assert.equal(process.env[explicitKey], "from-process");
    assert.equal(process.env[loadedKey], "from-file");
    assert.equal(loadWorkspaceEnv(path.join(tempDir, "missing.env")), false);
  } finally {
    delete process.env[explicitKey];
    delete process.env[loadedKey];
    await rm(tempDir, { recursive: true, force: true });
  }
});
