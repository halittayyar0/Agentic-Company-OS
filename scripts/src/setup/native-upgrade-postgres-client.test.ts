import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { nativeRequiredFiles } from "./native-distribution";
import { startNativeUpgradePostgres } from "./native-upgrade-postgres-client";

test("staging IPC client joins clean exit, aborts startup and rejects malformed or failed children", async (t) => {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-stage-ipc-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = nativeRequiredFiles({
    platform: process.platform,
    architecture: process.arch,
  });
  const node = files[0],
    entry = "scripts/src/setup/stage-postgres.mjs";
  for (const file of [...files, entry]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    if (file === node) await copyFile(process.execPath, path.join(root, file));
    else await writeFile(path.join(root, file), "fixture");
  }
  async function script(bytes: string) {
    await writeFile(path.join(root, entry), bytes);
    const rows = [];
    for (const file of [...files, entry]) {
      const content = await readFile(path.join(root, file));
      rows.push({
        path: file,
        bytes: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
    }
    await writeFile(
      path.join(root, "native-distribution.json"),
      JSON.stringify({
        schemaVersion: 1,
        commit: "a".repeat(40),
        target: `${process.platform}-${process.arch}`,
        nodeVersion: "24.21.0",
        postgresVersion: "17.10",
        files: rows,
      }),
    );
  }
  const cleanup = `process.on('disconnect',()=>process.exit(0));process.on('message',()=>process.send({type:'stopped'},()=>process.exit(0)));`;
  await t.test(
    "successful stop is idempotent and waits for acknowledgement plus process exit",
    async () => {
      await script(cleanup + `process.send({type:'ready'});`);
      const worker = await startNativeUpgradePostgres({
        targetRoot: root,
        stagingDirectory: root,
      });
      await Promise.all([worker.stop(), worker.stop()]);
    },
  );
  await t.test(
    "abort during startup shuts down the child before rejecting",
    async () => {
      await script(
        cleanup +
          `import {writeFileSync} from 'node:fs';import path from 'node:path';writeFileSync(path.join(process.argv[2],'test-child-started'),'started');`,
      );
      const controller = new AbortController();
      const rejected = assert.rejects(
        startNativeUpgradePostgres({
          targetRoot: root,
          stagingDirectory: root,
          signal: controller.signal,
        }),
        /aborted/u,
      );
      try {
        const deadline = Date.now() + 10_000;
        let started = false;
        while (Date.now() < deadline) {
          try {
            await readFile(path.join(root, "test-child-started"));
            started = true;
            break;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          await delay(25);
        }
        assert.equal(
          started,
          true,
          "abort must exercise a running child, not only preflight",
        );
      } finally {
        controller.abort();
        await rejected;
      }
    },
  );
  for (const frame of [
    { type: "failed" },
    { type: "ready", secret: "must never surface" },
  ]) {
    await t.test(
      "untrusted frames fail closed without exposing contents",
      async () => {
        await script(cleanup + `process.send(${JSON.stringify(frame)});`);
        await assert.rejects(
          startNativeUpgradePostgres({
            targetRoot: root,
            stagingDirectory: root,
          }),
          /^Error: native_upgrade_staging_cleanup$/u,
        );
      },
    );
  }
  await t.test(
    "zero exit without a ready frame never starts migration",
    async () => {
      await script("process.exit(0);");
      await assert.rejects(
        startNativeUpgradePostgres({
          targetRoot: root,
          stagingDirectory: root,
        }),
        /native_upgrade_staging_cleanup/u,
      );
    },
  );
});
