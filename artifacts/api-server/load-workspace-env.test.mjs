import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadWorkspaceEnv } from "./load-workspace-env.mjs";

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
