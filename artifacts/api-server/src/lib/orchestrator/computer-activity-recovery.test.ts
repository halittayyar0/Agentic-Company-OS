import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  activityEventsTable,
  db,
  dbReady,
  type ActivityEvent,
} from "@workspace/db";
import { reconcileInterruptedComputerActivities } from "./execute-tool";

test("startup recovery marks interrupted computer activity without a JSON type error", async () => {
  await dbReady;
  const [running] = await db
    .insert(activityEventsTable)
    .values({
      agentId: null,
      taskId: null,
      type: "note",
      summary: "Interrupted test step",
      detail: {
        sessionId: "computer:test-recovery",
        sequence: 1,
        status: "running",
        lifecyclePhase: "running",
      },
      severity: "info",
    })
    .returning();

  try {
    await reconcileInterruptedComputerActivities();
    const [recovered] = await db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.id, running.id));

    assertRecovered(recovered);
  } finally {
    await db
      .delete(activityEventsTable)
      .where(eq(activityEventsTable.id, running.id));
  }
});

function assertRecovered(event: ActivityEvent | undefined): void {
  assert.ok(event);
  assert.equal(event.severity, "warning");
  assert.equal(event.detail?.status, "failed");
  assert.equal(event.detail?.lifecyclePhase, "completed");
  assert.equal(event.detail?.interrupted, true);
  assert.equal(typeof event.detail?.interruptedAt, "string");
}
