import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createEnduranceFaultControlWriter } from "./fault-control-writer";

test("fault control writer publishes monotonic run-scoped documents atomically", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "agentic-soak-fault-control-"),
  );
  const controlFile = path.join(directory, "fault-control.json");
  try {
    const writer = createEnduranceFaultControlWriter({
      runId: "soak-240901",
      seed: 240_901,
      runDirectory: directory,
      controlFile,
    });

    assert.equal(
      await writer.set([
        {
          taskId: 7,
          attemptNumber: 4,
          step: 3,
          outcome: "timeout",
          delayMs: 5_000,
        },
      ]),
      1,
    );
    assert.deepEqual(JSON.parse(await readFile(controlFile, "utf8")), {
      schemaVersion: 1,
      runId: "soak-240901",
      revision: 1,
      seed: 240_901,
      entries: [
        {
          taskId: 7,
          attemptNumber: 4,
          step: 3,
          outcome: "timeout",
          delayMs: 5_000,
        },
      ],
    });

    assert.equal(await writer.clear(), 2);
    assert.deepEqual(JSON.parse(await readFile(controlFile, "utf8")), {
      schemaVersion: 1,
      runId: "soak-240901",
      revision: 2,
      seed: 240_901,
      entries: [],
    });
    assert.deepEqual(await readdir(directory), ["fault-control.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fault control writer rejects path escape, duplicate identities, and foreign state", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "agentic-soak-fault-control-"),
  );
  const controlFile = path.join(directory, "fault-control.json");
  try {
    assert.throws(
      () =>
        createEnduranceFaultControlWriter({
          runId: "../unsafe",
          seed: 1,
          runDirectory: directory,
          controlFile,
        }),
      /runId/,
    );
    assert.throws(
      () =>
        createEnduranceFaultControlWriter({
          runId: "safe-run",
          seed: 1,
          runDirectory: directory,
          controlFile: path.join(directory, "nested", "fault-control.json"),
        }),
      /directly inside/,
    );

    const writer = createEnduranceFaultControlWriter({
      runId: "safe-run",
      seed: 1,
      runDirectory: directory,
      controlFile,
    });
    await assert.rejects(
      writer.set([
        { taskId: 1, attemptNumber: 1, step: 0, outcome: "rate_limit" },
        { taskId: 1, attemptNumber: 1, step: 0, outcome: "malformed" },
      ]),
      /duplicate identity/,
    );

    await writeFile(
      controlFile,
      `${JSON.stringify({
        schemaVersion: 1,
        runId: "foreign-run",
        revision: 9,
        seed: 1,
        entries: [],
      })}\n`,
      "utf8",
    );
    await assert.rejects(writer.clear(), /does not match this endurance run/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fault control bind mode preserves group readability on atomic replacement and rejects broad modes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-fault-mode-"));
  const controlFile = path.join(directory, "fault-control.json");
  try {
    assert.throws(
      () =>
        createEnduranceFaultControlWriter({
          runId: "mode-check",
          seed: 1,
          runDirectory: directory,
          controlFile,
          fileMode: 0o666 as 0o640,
        }),
      /fileMode/,
    );
    const writer = createEnduranceFaultControlWriter({
      runId: "mode-check",
      seed: 1,
      runDirectory: directory,
      controlFile,
      fileMode: 0o640,
    });
    await writer.clear();
    await writer.clear();
    assert.equal(JSON.parse(await readFile(controlFile, "utf8")).revision, 2);
    if (process.platform !== "win32")
      assert.equal((await stat(controlFile)).mode & 0o777, 0o640);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
