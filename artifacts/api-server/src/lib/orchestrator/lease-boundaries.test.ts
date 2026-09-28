import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { agentsTable, db, dbReady, tasksTable } from "@workspace/db";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import { heartbeatJudgeTaskLease } from "./execute-tool";
import { resolveCompanyMeetingLeaseMs } from "./run-company-meeting";
import { registerRuntimeInstance } from "./runtime-instance-registry";
import { claimDueTasks } from "./scheduler";

test("judge attempts use the configured durable task heartbeat instead of extending the recovery window", async (t) => {
  await dbReady;
  const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
  const runtime = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    config,
  );
  t.after(() => runtime.stopHeartbeat());
  const leaseOwner = `task:judge-heartbeat:${Date.now()}`;
  const initiallyExpired = new Date(Date.now() - 1_000);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Judge heartbeat owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: initiallyExpired,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Slow judge lease",
      brief: "Fallback attempts must retain exclusive ownership.",
      ownerAgentId: agent.id,
      status: "in_progress",
      leaseOwner,
      leaseExpiresAt: initiallyExpired,
      lastSteppedAt: new Date(Date.now() - 60_000),
      createdByUser: true,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, agent.id));

  const previousTimeout = process.env.LLM_REQUEST_TIMEOUT_MS;
  process.env.LLM_REQUEST_TIMEOUT_MS = "600000";
  try {
    let durableAssertions = 0;
    const renewalAt = new Date();
    await heartbeatJudgeTaskLease({
      agent,
      taskId: task.id,
      taskLeaseOwner: leaseOwner,
      assertTaskLease: async () => {
        durableAssertions += 1;
        const leaseExpiresAt = new Date(
          renewalAt.getTime() + config.taskLeaseMs,
        );
        await db.transaction(async (tx) => {
          const [renewedAgent] = await tx
            .update(agentsTable)
            .set({ runLeaseExpiresAt: leaseExpiresAt })
            .where(eq(agentsTable.id, agent.id))
            .returning({ id: agentsTable.id });
          const [renewedTask] = await tx
            .update(tasksTable)
            .set({ leaseExpiresAt, lastHeartbeatAt: renewalAt })
            .where(eq(tasksTable.id, task.id))
            .returning({ id: tasksTable.id });
          assert.ok(renewedAgent && renewedTask);
        });
      },
    });
    assert.equal(durableAssertions, 1);
    const [persistedTask] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    const [persistedAgent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, agent.id));
    assert.equal(
      persistedTask.leaseExpiresAt?.getTime(),
      renewalAt.getTime() + config.taskLeaseMs,
    );
    assert.equal(
      persistedTask.leaseExpiresAt?.getTime(),
      persistedAgent.runLeaseExpiresAt?.getTime(),
    );
    const claimed = await claimDueTasks(runtime, config);
    assert.equal(
      claimed.some((candidate) => candidate.id === task.id),
      false,
    );

    await db
      .update(agentsTable)
      .set({ runLeaseOwner: "revoked-by-operator" })
      .where(eq(agentsTable.id, agent.id));
    await assert.rejects(
      heartbeatJudgeTaskLease({
        agent,
        taskId: task.id,
        taskLeaseOwner: leaseOwner,
        assertTaskLease: async () => {
          throw new Error("Task or agent lease was lost before judge attempt");
        },
      }),
      /lease was lost/iu,
    );
  } finally {
    if (previousTimeout === undefined)
      delete process.env.LLM_REQUEST_TIMEOUT_MS;
    else process.env.LLM_REQUEST_TIMEOUT_MS = previousTimeout;
  }
});

test("company meeting lease covers the configured model timeout plus buffer", () => {
  assert.equal(resolveCompanyMeetingLeaseMs("120000"), 5 * 60_000);
  assert.equal(resolveCompanyMeetingLeaseMs("600000"), 11 * 60_000);
});
