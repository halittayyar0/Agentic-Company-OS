import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseNativePostgresSmokeArguments,
  writeNativePostgresSmokeReport,
} from "../run-native-postgres-smoke";

test("native PostgreSQL smoke CLI validates portable root, seed, and output", () => {
  assert.throws(
    () => parseNativePostgresSmokeArguments([], {}),
    /postgres-root.*required/iu,
  );
  assert.deepEqual(
    parseNativePostgresSmokeArguments(
      [
        "--",
        "--postgres-root",
        "D:/postgres",
        "--seed",
        "7",
        "--output",
        "native-smoke.json",
        "--overwrite",
      ],
      {},
    ),
    {
      postgresRoot: path.resolve("D:/postgres"),
      output: path.resolve("native-smoke.json"),
      seed: 7,
      overwrite: true,
    },
  );
  assert.throws(
    () =>
      parseNativePostgresSmokeArguments(
        ["--postgres-root", "D:/postgres", "--seed", "-1"],
        {},
      ),
    /seed/iu,
  );
});

test("native smoke report preflights its sidecar before overwrite", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-native-smoke-"));
  const output = path.join(directory, "native-smoke.json");
  await Promise.all([
    writeFile(output, "stale-report", "utf8"),
    mkdir(`${output}.sha256`),
  ]);
  try {
    await assert.rejects(
      writeNativePostgresSmokeReport({
        reportPath: output,
        report: { schemaVersion: 1, pass: true },
        overwrite: true,
      }),
      /regular.*non-linked|directory|EISDIR/iu,
    );
    assert.equal(await readFile(output, "utf8"), "stale-report");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
