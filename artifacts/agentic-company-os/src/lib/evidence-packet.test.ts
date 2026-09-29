import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Task } from "@workspace/api-client-react";
import type { RunTrace } from "./run-trace";
import { createEvidencePacket, evidenceWindowBody } from "./evidence-packet";
import {
  verifyEvidenceFile,
  verifyEvidencePacket,
} from "../../../../scripts/src/verify-evidence";

test("shareable evidence omits free-form content and verifies its checksum", async () => {
  const task = {
    id: 12,
    title: "SECRET_TITLE",
    brief: "SECRET_BRIEF",
    resultSummary: "SECRET_RESULT",
    lastError: "SECRET_ERROR",
    status: "completed",
    updatedAt: "2026-09-29T00:00:00.000Z",
    stepAttempts: 2,
    cycleCount: 1,
  } as Task;
  const trace = {
    stages: ["intake", "plan", "route", "execute", "review", "deliver"].map(
      (id) => ({
        id,
        state: "recorded",
        source: "task",
        evidence: "created",
        timestamp: "2026-09-29T00:00:00.000Z",
        activityId: null,
      }),
    ),
    stats: {
      eventCount: 1,
      toolEventCount: 0,
      judgeCount: 0,
      warningCount: 0,
      errorCount: 0,
      uniqueAgentIds: [1],
    },
    events: [
      {
        id: 7,
        agentId: 1,
        taskId: 12,
        type: "note",
        severity: "info",
        createdAt: "2026-09-29T00:00:00.000Z",
        summary: "SECRET_SUMMARY",
        detail: [{ key: "url", value: "https://example.com/SECRET_PATH" }],
        categories: [],
      },
    ],
  } as RunTrace;
  const packet = await createEvidencePacket(
    evidenceWindowBody({
      task,
      trace,
      exportedAt: "2026-09-29T00:01:00.000Z",
      boundary: {
        taskId: 12,
        capturedAt: "2026-09-29T00:01:00.000Z",
        beforeId: null,
        nextBeforeId: null,
        pageNumber: 1,
        refreshFailed: false,
      },
    }),
  );
  assert.equal(verifyEvidencePacket(packet), true);
  assert.doesNotMatch(JSON.stringify(packet), /SECRET/u);
  const changed = JSON.parse(JSON.stringify(packet));
  changed.task.status = "failed";
  assert.equal(verifyEvidencePacket(changed), false);
  const added = JSON.parse(JSON.stringify(packet));
  added.events[0].summary = "PRIVATE";
  assert.equal(verifyEvidencePacket(added), false);
  const directory = await mkdtemp(path.join(tmpdir(), "acos-evidence-"));
  try {
    const file = path.join(directory, "evidence.json");
    await writeFile(file, JSON.stringify(packet, null, 2));
    assert.equal(await verifyEvidenceFile(file), true);
    await writeFile(file, JSON.stringify(changed));
    assert.equal(await verifyEvidenceFile(file), false);
  } finally {
    await unlink(path.join(directory, "evidence.json"));
    await rmdir(directory);
  }
});
