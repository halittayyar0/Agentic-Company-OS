import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseAcceleratedArguments,
  writeAcceleratedEnduranceReport,
} from "../run-accelerated-endurance";

test("accelerated CLI parsing rejects unknown and undersized scenarios", () => {
  assert.throws(
    () => parseAcceleratedArguments(["--mystery", "yes"]),
    /Unknown argument/,
  );
  assert.throws(
    () => parseAcceleratedArguments(["--minutes", "1439"]),
    /at least 1,440/,
  );
  assert.deepEqual(
    parseAcceleratedArguments([
      "--seed",
      "240901",
      "--minutes",
      "1440",
      "--output",
      "report.json",
      "--overwrite",
    ]),
    {
      seed: 240_901,
      minutes: 1_440,
      output: path.resolve("report.json"),
      overwrite: true,
    },
  );
});

test("report writer creates summary and JSONL evidence without accidental overwrite", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-endurance-"));
  const output = path.join(directory, "report.json");
  try {
    const result = await writeAcceleratedEnduranceReport({
      seed: 7,
      minutes: 1_440,
      output,
      overwrite: false,
      commitSha: "test-commit",
      runId: "cli-test",
      startedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    assert.equal(result.reportPath, output);
    const journalPath = path.join(directory, "report.jsonl");
    assert.equal(result.journalPath, journalPath);
    const report = JSON.parse(await readFile(output, "utf8"));
    const journalBytes = await readFile(journalPath);
    const journal = journalBytes
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(report.pass, true);
    assert.equal(report.verified24h, false);
    assert.equal(
      report.evidence.journalSha256,
      createHash("sha256").update(journalBytes).digest("hex"),
    );
    assert.equal(journal.at(-1).kind, "run_completed");
    assert.deepEqual(
      journal.map((event) => event.sequence),
      Array.from({ length: journal.length }, (_, index) => index),
    );

    await assert.rejects(
      writeAcceleratedEnduranceReport({
        seed: 7,
        minutes: 1_440,
        output,
        overwrite: false,
        commitSha: "test-commit",
        runId: "cli-test-second",
        startedAt: new Date("2026-09-01T00:00:00.000Z"),
      }),
      /already exists/,
    );

    await writeFile(output, "stale", "utf8");
    await writeAcceleratedEnduranceReport({
      seed: 7,
      minutes: 1_440,
      output,
      overwrite: true,
      commitSha: "test-commit",
      runId: "cli-test-overwrite",
      startedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    assert.equal(JSON.parse(await readFile(output, "utf8")).pass, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("accelerated overwrite preflights the sidecar before replacing any evidence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-os-endurance-"));
  const output = path.join(directory, "report.json");
  const journal = path.join(directory, "report.jsonl");
  await Promise.all([
    writeFile(output, "stale-report", "utf8"),
    writeFile(journal, "stale-journal", "utf8"),
    mkdir(`${output}.sha256`),
  ]);
  try {
    await assert.rejects(
      writeAcceleratedEnduranceReport({
        seed: 7,
        minutes: 1_440,
        output,
        overwrite: true,
        commitSha: "test-commit",
        runId: "cli-test-linked-sidecar",
        startedAt: new Date("2026-09-01T00:00:00.000Z"),
      }),
      /regular.*non-linked|sidecar|directory|EISDIR/iu,
    );
    assert.equal(await readFile(output, "utf8"), "stale-report");
    assert.equal(await readFile(journal, "utf8"), "stale-journal");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
