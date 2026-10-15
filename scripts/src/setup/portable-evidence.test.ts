import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../../..", import.meta.url));

test("portable installer includes an offline evidence verifier", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "acos-portable-proof-"));
  const output = path.join(directory, "setup");
  try {
    await run(
      process.execPath,
      [
        path.join(root, "scripts", "build-setup.mjs"),
        "--image",
        `ghcr.io/owner/app@sha256:${"b".repeat(64)}`,
        "--commit",
        "a".repeat(40),
        "--coding-image",
        `ghcr.io/owner/app@sha256:${"c".repeat(64)}`,
        "--out",
        output,
      ],
      { cwd: root, timeout: 30_000 },
    );
    const manifest = JSON.parse(
      await readFile(path.join(output, "distribution.json"), "utf8"),
    );
    assert.equal(
      manifest.codingImage,
      `ghcr.io/owner/app@sha256:${"c".repeat(64)}`,
    );
    const bootstrap = path.join(output, "scripts/src/setup/bootstrap.mjs");
    const noTools = {
      cwd: directory,
      timeout: 10_000,
      env: {
        PATH: "",
        SystemRoot: process.env.SystemRoot,
        HOME: directory,
        USERPROFILE: directory,
        TEMP: directory,
        TMP: directory,
      },
    };
    const beforeCheck = await readdir(directory);
    // An empty PATH alone cannot prove zero probes: preflight catches missing
    // tools. Count every process launch before the bundled entrypoint loads.
    const forbidProbes = `
      import { createRequire, syncBuiltinESMExports } from "node:module";
      const child = createRequire(process.cwd() + "/probe.cjs")("node:child_process");
      let probes = 0;
      for (const name of ["exec", "execFile", "spawn", "execSync", "execFileSync", "spawnSync"])
        child[name] = () => { probes++; throw Error("unexpected setup probe"); };
      syncBuiltinESMExports();
      process.on("exit", () => { if (probes) process.exitCode = 9; });
    `;
    const preload = `data:text/javascript,${encodeURIComponent(forbidProbes)}`;
    await assert.rejects(
      run(
        process.execPath,
        [
          "--import",
          preload,
          "--input-type=module",
          "-e",
          'import { execFile } from "node:child_process"; try { execFile("probe"); } catch {}',
        ],
        noTools,
      ),
      (error: unknown) => (error as { code: number }).code === 9,
    );
    const help = await run(
      process.execPath,
      ["--import", preload, bootstrap, "--help"],
      noTools,
    );
    assert.match(help.stdout, /--check/u);
    assert.equal(help.stderr, "");
    await assert.rejects(
      run(process.execPath, [bootstrap, "--check"], noTools),
      (error: unknown) => {
        const result = error as {
          code: number;
          stdout: string;
          stderr: string;
        };
        assert.equal(result.code, 1);
        assert.match(result.stdout, /Container: not ready/u);
        assert.match(result.stdout, /Native source: not ready/u);
        assert.match(result.stdout, /source checkout/u);
        assert.match(result.stdout, /Install Docker/u);
        assert.doesNotMatch(result.stdout, /ghcr\.io\/owner|private-secret/u);
        assert.equal(result.stderr, "");
        return true;
      },
    );
    await assert.rejects(
      run(process.execPath, [bootstrap, "--private-secret"], noTools),
      (error: unknown) => {
        const result = error as { code: number; stderr: string };
        assert.equal(result.code, 1);
        assert.match(result.stderr, /Use --help/u);
        assert.doesNotMatch(result.stderr, /private-secret/u);
        return true;
      },
    );
    assert.deepEqual(await readdir(directory), beforeCheck);
    for (const file of [
      "compose.coding.yaml",
      "compose.coding-apparmor.yaml",
      "deploy/coding-seccomp.json",
      "deploy/agentic-coding.apparmor",
      "deploy/APPARMOR-LICENSE",
    ]) {
      assert.equal(
        await readFile(path.join(output, file), "utf8"),
        await readFile(path.join(root, file), "utf8"),
      );
    }
    const verifier = path.join(
      output,
      "scripts",
      "src",
      "setup",
      "verify-evidence.mjs",
    );
    const windows = await readFile(
      path.join(output, "VERIFY-EVIDENCE.cmd"),
      "utf8",
    );
    const unix = await readFile(
      path.join(output, "VERIFY-EVIDENCE.command"),
      "utf8",
    );
    assert.match(windows, /verify-evidence\.mjs/u);
    assert.match(unix, /verify-evidence\.mjs/u);
    const body = {
      schema: "agentic-company-os/evidence-window@1",
      exportedAt: "2026-09-29T00:00:00.000Z",
      boundary: {
        source: "task-activity-api",
        taskId: 1,
        fullHistory: false,
        receipts: false,
        capturedAt: null,
        beforeId: null,
        nextBeforeId: null,
        pageNumber: 1,
        refreshFailed: false,
        firstEventAt: null,
        lastEventAt: null,
      },
      task: {
        id: 1,
        status: "pending",
        updatedAt: "2026-09-29T00:00:00.000Z",
        stepCounter: 0,
        cycleCounter: 0,
        resultSummaryStored: false,
      },
      stages: ["intake", "plan", "route", "execute", "review", "deliver"].map(
        (id) => ({
          id,
          state: "missing",
          source: null,
          evidence: "missing",
          timestamp: null,
          activityId: null,
        }),
      ),
      stats: {
        eventCount: 0,
        toolEventCount: 0,
        judgeCount: 0,
        warningCount: 0,
        errorCount: 0,
      },
      events: [],
    };
    const packet = {
      ...body,
      integrity: {
        algorithm: "SHA-256",
        digest: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
      },
    };
    const file = path.join(directory, "proof.json");
    await writeFile(file, JSON.stringify(packet));
    const accepted = await run(process.execPath, [verifier, file], {
      timeout: 10_000,
    });
    assert.match(accepted.stdout, /checksum and shape: valid/u);
    packet.task.status = "failed";
    await writeFile(file, JSON.stringify(packet));
    await assert.rejects(
      run(process.execPath, [verifier, file], { timeout: 10_000 }),
    );
  } finally {
    assert.equal(path.dirname(directory), tmpdir());
    assert.match(path.basename(directory), /^acos-portable-proof-/u);
    await rm(directory, { recursive: true, force: true });
  }
});
