import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { activityEventsTable, db, dbReady } from "@workspace/db";
import { asc } from "drizzle-orm";
import { parseOperationsEventDetail } from "../operations/operations-events";
import { readWorkspaceLocale } from "../workspace-locale";
import { localEmergencyStopSnapshot } from "./local-emergency-epoch";
import {
  getEmergencyStopStatus,
  setEmergencyStop,
} from "./runtime-emergency-stop";

test("emergency control remains immediate and durable when workspace language is unreadable", async (t) => {
  await dbReady;
  const originalDirectory = process.cwd();
  const temporaryRoot = await realpath(os.tmpdir());
  const directory = await mkdtemp(
    path.join(temporaryRoot, "acos-emergency-locale-"),
  );
  await writeFile(
    path.join(directory, "pnpm-workspace.yaml"),
    "packages: []\n",
  );
  await mkdir(path.join(directory, "data"));
  const preference = path.join(directory, "data", "workspace-locale.json");
  process.chdir(directory);
  t.after(async () => {
    try {
      await setEmergencyStop({ enabled: false, reason: null });
    } finally {
      process.chdir(originalDirectory);
      const resolved = await realpath(directory);
      assert.equal(path.dirname(resolved), temporaryRoot);
      assert.ok(path.basename(resolved).startsWith("acos-emergency-locale-"));
      await rm(resolved, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  });
  await setEmergencyStop({ enabled: false, reason: null });
  const events = () =>
    db.select().from(activityEventsTable).orderBy(asc(activityEventsTable.id));

  for (const [label, contents] of [
    ["invalid JSON", "{"],
    ["unsupported language", '{"locale":"unsupported"}'],
    ["oversized preference", " ".repeat(1025)],
  ]) {
    await t.test(label, async () => {
      await writeFile(preference, contents);
      await assert.rejects(readWorkspaceLocale());
      assert.equal(localEmergencyStopSnapshot().stopped, false);
      const before = await events();
      const reason = `Operator source 原文 {reason} — ${label}`;
      const pending = setEmergencyStop({ enabled: true, reason });
      // Check before awaiting database work: translation cannot delay the local fence.
      assert.equal(localEmergencyStopSnapshot().stopped, true);
      const stopped = await pending;
      assert.equal(stopped.emergencyStopEnabled, true);
      assert.equal(stopped.reason, reason);
      assert.equal((await getEmergencyStopStatus()).version, stopped.version);

      const recorded = await events();
      assert.equal(recorded.length, before.length + 2);
      const [audit, operation] = recorded.slice(-2);
      assert.equal(audit.type, "task_status_changed");
      assert.equal(
        audit.summary,
        "Operator acil durdurmayi etkinlestirdi; yeni ajan yurutmeleri engellendi.",
      );
      assert.equal(audit.detail?.reason, reason);
      assert.equal(audit.detail?.version, stopped.version);
      assert.equal(audit.taskId, null);
      assert.equal(audit.agentId, null);
      assert.equal(operation.type, "operations_changed");
      assert.deepEqual(parseOperationsEventDetail(operation.detail), {
        schemaVersion: 1,
        kind: "runtime_control_changed",
        enabled: true,
      });

      const replay = await setEmergencyStop({ enabled: true, reason });
      assert.equal(replay.changed, false);
      assert.equal(replay.version, stopped.version);
      assert.deepEqual(await events(), recorded);

      const resumed = await setEmergencyStop({ enabled: false, reason: null });
      assert.equal(resumed.emergencyStopEnabled, false);
      assert.equal(localEmergencyStopSnapshot().stopped, false);
      const after = await events();
      assert.equal(after.length, recorded.length + 2);
      assert.deepEqual(after.slice(0, recorded.length), recorded);
      assert.equal(
        after.at(-2)?.summary,
        "Operator acil durdurmayi kaldirdi; yeni ajan yurutmeleri yeniden etkin.",
      );
      assert.deepEqual(parseOperationsEventDetail(after.at(-1)?.detail), {
        schemaVersion: 1,
        kind: "runtime_control_changed",
        enabled: false,
      });
      // A later valid preference is not permission to rewrite immutable source records.
      await writeFile(preference, '{"locale":"en"}');
      assert.equal(await readWorkspaceLocale(), "en");
      assert.deepEqual(await events(), after);
    });
  }
});
