import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { writeExactOutputBundle } from "./safe-output";

test("safe output rejects a linked overwrite target without touching its referent", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-safe-output-"));
  const external = path.join(directory, "external.txt");
  const linked = path.join(directory, "report.json");
  await writeFile(external, "preserve", "utf8");
  try {
    try {
      await symlink(external, linked, "file");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["EPERM", "EACCES", "ENOTSUP"].includes(String(error.code))
      ) {
        context.skip(`symlink creation is unavailable: ${String(error.code)}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      writeExactOutputBundle({
        outputDirectory: directory,
        overwrite: true,
        files: [{ path: linked, bytes: "replacement" }],
      }),
      /regular.*non-linked|linked.*target/iu,
    );
    assert.equal(await readFile(external, "utf8"), "preserve");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("safe output rejects a parent junction before creating external files", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-safe-output-"));
  const externalDirectory = await mkdtemp(
    path.join(tmpdir(), "agentic-safe-output-external-"),
  );
  const linkedDirectory = path.join(directory, "linked");
  try {
    try {
      await symlink(
        externalDirectory,
        linkedDirectory,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["EPERM", "EACCES", "ENOTSUP"].includes(String(error.code))
      ) {
        context.skip(`symlink creation is unavailable: ${String(error.code)}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      writeExactOutputBundle({
        outputDirectory: linkedDirectory,
        overwrite: true,
        files: [
          { path: path.join(linkedDirectory, "report.json"), bytes: "{}\n" },
        ],
      }),
      /output directory.*real|redirected/iu,
    );
    assert.deepEqual(await readdir(externalDirectory), []);
  } finally {
    await Promise.all([
      rm(directory, { recursive: true, force: true }),
      rm(externalDirectory, { recursive: true, force: true }),
    ]);
  }
});

test("safe output atomically replaces only verified regular files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-safe-output-"));
  const report = path.join(directory, "report.json");
  const sidecar = `${report}.sha256`;
  await Promise.all([
    writeFile(report, "old-report", "utf8"),
    writeFile(sidecar, "old-sidecar", "utf8"),
  ]);
  try {
    await writeExactOutputBundle({
      outputDirectory: directory,
      overwrite: true,
      files: [
        { path: report, bytes: "new-report" },
        { path: sidecar, bytes: "new-sidecar" },
      ],
    });
    assert.equal(await readFile(report, "utf8"), "new-report");
    assert.equal(await readFile(sidecar, "utf8"), "new-sidecar");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
