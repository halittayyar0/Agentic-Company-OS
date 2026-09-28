import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseNewestOperationsSnapshot,
  operationsSnapshotMatchesScope,
} from "./operations-snapshot-cache";

function snapshot(cursor: string, generatedAt: string, marker: string) {
  return { cursor, generatedAt, marker };
}

test("durable snapshot selection never regresses a canonical cursor", () => {
  const current = snapshot(
    "9007199254740995",
    "2026-09-01T12:00:00.000Z",
    "current",
  );
  const delayedHttp = snapshot(
    "9007199254740994",
    "2026-09-01T12:00:05.000Z",
    "delayed-http",
  );
  const next = snapshot("9007199254740996", "2026-09-01T11:59:59.000Z", "next");

  assert.equal(chooseNewestOperationsSnapshot(current, delayedHttp), current);
  assert.equal(chooseNewestOperationsSnapshot(current, next), next);
});

test("equal cursors retain the freshest derived runtime snapshot", () => {
  const current = snapshot("42", "2026-09-01T12:00:00.000Z", "current");
  const older = snapshot("42", "2026-09-01T11:59:59.000Z", "older");
  const refreshed = snapshot("42", "2026-09-01T12:00:05.000Z", "refreshed");

  assert.equal(chooseNewestOperationsSnapshot(current, older), current);
  assert.equal(chooseNewestOperationsSnapshot(current, refreshed), refreshed);
});

test("scoped SSE snapshots require a canonical envelope-matching cursor", () => {
  const project = {
    cursor: "51",
    generatedAt: "2026-09-01T12:00:00.000Z",
    rootTask: { id: 101 },
    runtime: {},
    queue: {},
    usage: {},
    taskCounts: {},
    members: [],
    attempts: [],
    receipts: [],
    incidents: [],
    milestones: [],
    fleetHealthSamples: [],
  };
  assert.equal(
    operationsSnapshotMatchesScope(
      project,
      { scope: "project", taskId: 101 },
      "51",
    ),
    true,
  );
  assert.equal(
    operationsSnapshotMatchesScope(
      project,
      { scope: "project", taskId: 102 },
      "51",
    ),
    false,
  );
  assert.equal(
    operationsSnapshotMatchesScope(
      project,
      { scope: "project", taskId: 101 },
      "52",
    ),
    false,
  );
  assert.equal(
    operationsSnapshotMatchesScope(
      { ...project, cursor: "051" },
      { scope: "project", taskId: 101 },
      "051",
    ),
    false,
  );
});
