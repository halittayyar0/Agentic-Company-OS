import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  readRuntimeConfigSnapshot,
  writeRuntimeConfigSnapshot,
  type RuntimeConfig,
} from "./runtime-config";

test("local model address persists canonically and unsafe edits cannot replace it", async () => {
  const originalCwd = process.cwd();
  const directory = await mkdtemp(path.join(tmpdir(), "acos-local-provider-"));
  process.chdir(directory);
  const configFile = path.join(directory, "data/runtime-config.json");
  try {
    await writeRuntimeConfigSnapshot(
      { ollamaBaseUrl: " http://127.0.0.1:11434/ " } as RuntimeConfig,
      0,
    );
    assert.deepEqual(await readRuntimeConfigSnapshot(), {
      revision: 1,
      config: {
        openrouterApiKey: undefined,
        openaiApiKey: undefined,
        ollamaBaseUrl: "http://127.0.0.1:11434/v1",
      },
    });
    const saved = await readFile(configFile, "utf8");
    for (const invalid of [
      "https://public.example/v1",
      "http://169.254.169.254/v1",
      "http://user:secret@127.0.0.1:11434/v1",
      "http://127.0.0.1:11434/v1?token=secret",
      "not-a-url",
      123,
    ]) {
      await assert.rejects(
        writeRuntimeConfigSnapshot(
          { ollamaBaseUrl: invalid } as RuntimeConfig,
          1,
        ),
      );
      assert.equal(await readFile(configFile, "utf8"), saved);
    }
    await assert.rejects(
      writeRuntimeConfigSnapshot(
        { ollamaBaseUrl: "http://192.168.1.2:11434" } as RuntimeConfig,
        0,
      ),
      (error: unknown) =>
        (error as { code?: string }).code === "LLM_CONFIG_CHANGED",
    );
    await writeRuntimeConfigSnapshot(
      { ollamaBaseUrl: null } as RuntimeConfig,
      1,
    );
    assert.deepEqual(await readRuntimeConfigSnapshot(), {
      revision: 2,
      config: {
        openrouterApiKey: undefined,
        openaiApiKey: undefined,
        ollamaBaseUrl: null,
      },
    });
    await writeFile(
      configFile,
      JSON.stringify({ _revision: 2, ollamaBaseUrl: 123 }),
    );
    await assert.rejects(readRuntimeConfigSnapshot());
  } finally {
    process.chdir(originalCwd);
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
