import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import {
  db,
  dbReady,
  agentsTable,
  tasksTable,
  approvalRequestsTable,
  activityEventsTable,
  runtimeControlsTable,
} from "@workspace/db";
import {
  createApprovalsRouter,
  type ApprovalDecisionDependencies,
} from "./approvals";

async function fixture(
  t: TestContext,
  dependencies: ApprovalDecisionDependencies = {},
) {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Approval test owner",
      role: "Test",
      systemPrompt: "Test only",
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Approval decision test",
      brief: "No external execution",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
    })
    .returning();
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "other",
      title: "Approval fixture",
      description: "Test only",
      scope: {
        toolName: "vm_write_file",
        argsHash: "a".repeat(64),
        target: "fixture.txt",
        preview: "Fixture content",
      },
      expiresAt: new Date(Date.now() + 60000),
    })
    .returning();
  const app = express();
  app.use(express.json());
  app.use("/api", createApprovalsRouter(dependencies));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db
      .update(runtimeControlsTable)
      .set({ emergencyStopEnabled: false })
      .where(eq(runtimeControlsTable.id, 1));
    await db
      .delete(activityEventsTable)
      .where(eq(activityEventsTable.taskId, task.id));
    await db
      .delete(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, approval.id));
    await db.delete(tasksTable).where(eq(tasksTable.id, task.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });
  async function decide(data: Record<string, unknown>) {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/approvals/${approval.id}/decision`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  }
  return { agent, task, approval, decide };
}

test("emergency stop blocks approval at the API boundary while still allowing rejection", async (t) => {
  const { approval, task, decide } = await fixture(t);
  await db
    .update(runtimeControlsTable)
    .set({ emergencyStopEnabled: true })
    .where(eq(runtimeControlsTable.id, 1));
  const denied = await decide({ decision: "approved" });
  assert.equal(denied.status, 423);
  assert.equal(denied.body.code, "EMERGENCY_STOP_ACTIVE");
  const [pending] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, approval.id));
  assert.equal(pending.status, "pending");
  assert.equal(
    (await decide({ decision: "rejected", note: "Do not run this." })).status,
    200,
  );
  const [blocked] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  assert.equal(blocked.status, "blocked");
});

test("the decision compares expiry using the time after its locks, not the earlier HTTP arrival", async (t) => {
  let now = new Date();
  let expiresAfterLock = new Date();
  const { approval, decide } = await fixture(t, {
    now: () => now,
    afterDecisionLocks: async () => {
      now = expiresAfterLock;
    },
  });
  expiresAfterLock = new Date(approval.expiresAt!.getTime() + 1);
  const result = await decide({ decision: "approved" });
  assert.equal(result.status, 410);
  assert.equal(result.body.code, "APPROVAL_EXPIRED");
  const [row] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, approval.id));
  assert.equal(row.status, "pending");
});

test("approval fences the reviewed scope and concurrent decisions can record only one result", async (t) => {
  const { approval, decide } = await fixture(t);
  for (const expectedArgsHash of [null, "b".repeat(64)]) {
    const result = await decide({ decision: "approved", expectedArgsHash });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "APPROVAL_SCOPE_CHANGED");
  }
  const replies = await Promise.all([
    decide({
      decision: "approved",
      expectedArgsHash: approval.scope!.argsHash,
    }),
    decide({ decision: "rejected", note: "Race fixture" }),
  ]);
  assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 409]);
  const events = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.taskId, approval.taskId));
  assert.equal(
    events.filter((event) => event.type === "approval_resolved").length,
    1,
  );
});

test("decision audit text uses all seven requested locales without rewriting the request title or note", async (t) => {
  const labels = {
    tr: "Onay kaydedildi",
    en: "Approval recorded",
    de: "Genehmigung erfasst",
    ru: "Одобрение сохранено",
    "zh-CN": "已记录批准",
    "zh-TW": "已記錄核准",
    ar: "تم تسجيل الموافقة",
  };
  for (const [locale, label] of Object.entries(labels)) {
    await t.test(locale, async (subtest) => {
      const { approval, decide } = await fixture(subtest);
      assert.equal(
        (
          await decide({
            decision: "approved",
            locale,
            note: "原文 / Original note",
          })
        ).status,
        200,
      );
      const [event] = await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.taskId, approval.taskId));
      assert.equal(event.summary, `${label}: ${approval.title}`);
      assert.equal((event.detail as { locale: string }).locale, locale);
      assert.equal(
        (event.detail as { decisionNote: string }).decisionNote,
        "原文 / Original note",
      );
      assert.equal(
        (event.detail as { actionQueued: boolean }).actionQueued,
        false,
      );
    });
  }
});
