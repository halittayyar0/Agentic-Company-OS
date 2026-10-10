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
        ollamaCloudOrigin: null,
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
        ollamaCloudOrigin: null,
      },
    });
    const consent = await writeRuntimeConfigSnapshot(
      {
        ollamaBaseUrl: "http://127.0.0.1:11434/v1",
        ollamaCloudOrigin: "http://127.0.0.1:11434",
      } as RuntimeConfig,
      2,
    );
    assert.equal(
      (consent.config as Record<string, unknown>).ollamaCloudOrigin,
      "http://127.0.0.1:11434",
    );
    assert.equal(
      (await readRuntimeConfigSnapshot()).config.ollamaCloudOrigin,
      "http://127.0.0.1:11434",
    );
    const consentBytes = await readFile(configFile, "utf8");
    for (const invalid of [
      "https://public.example",
      "http://127.0.0.1:11434/v1",
      "http://user:secret@127.0.0.1:11434",
      "http://127.0.0.1:11434?secret=value",
      123,
      "",
    ]) {
      await assert.rejects(
        writeRuntimeConfigSnapshot(
          { ollamaCloudOrigin: invalid } as RuntimeConfig,
          3,
        ),
      );
      assert.equal(await readFile(configFile, "utf8"), consentBytes);
    }
    const moved = await writeRuntimeConfigSnapshot(
      { ollamaBaseUrl: "http://192.168.1.2:11434" },
      3,
    );
    assert.equal(moved.config.ollamaCloudOrigin, null);
    const restored = await writeRuntimeConfigSnapshot(
      { ollamaBaseUrl: null },
      4,
    );
    assert.equal(restored.config.ollamaCloudOrigin, null);
    const concurrent = await Promise.allSettled([
      writeRuntimeConfigSnapshot(
        { ollamaCloudOrigin: null } as RuntimeConfig,
        5,
      ),
      writeRuntimeConfigSnapshot(
        { ollamaBaseUrl: "http://127.0.0.1:11434" },
        5,
      ),
    ]);
    assert.equal(
      concurrent.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      concurrent.filter((result) => result.status === "rejected").length,
      1,
    );
    await writeFile(
      configFile,
      JSON.stringify({
        _revision: 6,
        ollamaCloudOrigin: "https://public.example",
      }),
    );
    await assert.rejects(readRuntimeConfigSnapshot());
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
