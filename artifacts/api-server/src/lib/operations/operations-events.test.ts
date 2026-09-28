import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db, dbReady, activityEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

test("operations changes append a fixed redacted durable cursor event", async () => {
  await dbReady;
  const modulePath = "./operations-events";
  const events = await import(modulePath).catch(() => null);
  assert.ok(
    events?.appendOperationsChanged,
    "appendOperationsChanged must be implemented",
  );

  const attemptId = randomUUID();
  const inserted = await events.appendOperationsChanged(db, {
    kind: "attempt_state_changed",
    taskId: null,
    agentId: null,
    attemptId,
    state: "running",
    unsafeSecret: "OPERATOR_AUTH_TOKEN=must-not-appear",
  });

  const [row] = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.id, inserted.id));
  assert.ok(row);
  assert.equal(row.type, "operations_changed");
  assert.equal(row.summary, "Operational attempt state changed.");
  assert.equal(row.severity, "info");
  assert.deepEqual(row.detail, {
    schemaVersion: 1,
    kind: "attempt_state_changed",
    attemptId,
    state: "running",
  });
  assert.doesNotMatch(JSON.stringify(row), /must-not-appear/);
});

test("operations cursor projection rejects malformed durable detail", async () => {
  const modulePath = "./operations-events";
  const events = await import(modulePath).catch(() => null);
  assert.ok(
    events?.parseOperationsEventDetail,
    "parseOperationsEventDetail must be implemented",
  );

  assert.equal(
    events.parseOperationsEventDetail({
      schemaVersion: 1,
      kind: "attempt_state_changed",
      attemptId: "a",
      state: "running",
      prompt: "secret",
    }),
    null,
  );
});

test("runtime control invalidations distinguish stop activation from recovery", async () => {
  await dbReady;
  const events = await import("./operations-events");
  const activated = await events.appendOperationsChanged(db, {
    kind: "runtime_control_changed",
    enabled: true,
  });
  const recovered = await events.appendOperationsChanged(db, {
    kind: "runtime_control_changed",
    enabled: false,
  });
  const rows = await db
    .select()
    .from(activityEventsTable)
    .where(
      eq(activityEventsTable.summary, "Operational runtime control changed."),
    );
  const activation = rows.find((row) => row.id === activated.id);
  const recovery = rows.find((row) => row.id === recovered.id);
  assert.equal(activation?.severity, "critical");
  assert.equal(recovery?.severity, "info");
  assert.deepEqual(activation?.detail, {
    schemaVersion: 1,
    kind: "runtime_control_changed",
    enabled: true,
  });
  assert.deepEqual(recovery?.detail, {
    schemaVersion: 1,
    kind: "runtime_control_changed",
    enabled: false,
  });
});
