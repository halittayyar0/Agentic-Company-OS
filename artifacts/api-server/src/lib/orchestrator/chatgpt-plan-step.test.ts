import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { configureChatGPTPlan } from "@workspace/ai-server";
import {
  agentsTable,
  tasksTable,
  taskAttemptsTable,
  usageEventsTable,
  db,
  dbReady,
  closeDatabase,
} from "@workspace/db";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import {
  registerRuntimeInstance,
  markRuntimeStopped,
} from "./runtime-instance-registry";
import { stepTask } from "./step-task";

for (const scenario of [
  "unknown_quota",
  "known_quota",
  "interrupted",
] as const) {
  test(`owned plan task persists ${scenario} without success, paid fallback or automatic replay`, async (t) => {
    await dbReady;
    const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
    const runtime = await registerRuntimeInstance(
      { role: "worker", schedulerEnabled: true },
      config,
    );
    const leaseOwner = randomUUID(),
      leaseExpiresAt = new Date(Date.now() + 900000);
    const [agent] = await db
      .insert(agentsTable)
      .values({
        name: "Plan step fixture",
        role: "Fixture",
        systemPrompt: "Complete the assigned work",
        modelMode: "manual",
        modelId: "chatgpt:fixture-step",
        status: "working",
        runLeaseOwner: leaseOwner,
        runLeaseExpiresAt: leaseExpiresAt,
      })
      .returning();
    const [task] = await db
      .insert(tasksTable)
      .values({
        title: "Useful plan task",
        brief: "Complete this work",
        ownerAgentId: agent.id,
        status: "in_progress",
        leaseOwner,
        leaseExpiresAt,
        autonomyMode: scenario === "known_quota" ? "continuous" : "finite",
        cadenceSeconds: scenario === "known_quota" ? 3600 : null,
      })
      .returning();
    t.after(async () => {
      configureChatGPTPlan(null);
      await db
        .delete(usageEventsTable)
        .where(eq(usageEventsTable.agentId, agent.id));
      await db
        .delete(taskAttemptsTable)
        .where(eq(taskAttemptsTable.taskId, task.id));
      await db.delete(tasksTable).where(eq(tasksTable.id, task.id));
      await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
      await markRuntimeStopped(runtime);
    });
    await db
      .update(agentsTable)
      .set({ currentTaskId: task.id })
      .where(eq(agentsTable.id, agent.id));
    const attemptId = randomUUID(),
      logicalExecutionId = randomUUID();
    await db.insert(taskAttemptsTable).values({
      id: attemptId,
      taskId: task.id,
      agentId: agent.id,
      workerInstanceId: runtime.id,
      leaseOwner,
      attemptNumber: 1,
      cycleNumber: 0,
      state: "claimed",
      logicalExecutionId,
    });
    let inferenceCalls = 0,
      toolCalls = 0;
    const retryAt = Date.now() + 5 * 60_000;
    const selected = {
      id: randomUUID(),
      hostId: "urn:uuid:712b4d81-573e-47fc-8e03-66c44670b2a1",
      clientId: "fixture-step-client",
      accountId: "fixture-step-profile",
      subject: "fixture-step-subject",
      revision: 1,
      updatedAt: 1,
      credentials: {
        accessToken: "fixture-step-access",
        idToken: "fixture-step-id",
        grants: ["resource.invoke", "chatgpt.tokens.use.direct"],
        expiresAt: Date.now() + 3600_000,
      },
    };
    const fixtureFetch: typeof fetch = async (input) => {
      if (String(input).endsWith("/models"))
        return Response.json({
          models: [
            {
              slug: "fixture-step",
              display_name: "Fixture",
              visibility: "list",
            },
          ],
        });
      assert.equal(String(input), "https://api.openai.com/v1/responses");
      inferenceCalls++;
      if (scenario === "known_quota")
        return Response.json(
          { error: { code: "rate_limit_exceeded" } },
          {
            status: 429,
            headers: { "retry-after": new Date(retryAt).toUTCString() },
          },
        );
      const response =
        scenario === "unknown_quota"
          ? {
              type: "response.failed",
              response: {
                id: "resp_step",
                error: {
                  code: "subscription_sharing_usage_limit_exceeded",
                  message: "private fixture diagnostic",
                },
                usage: { input_tokens: 20, output_tokens: 7, total_tokens: 27 },
              },
            }
          : { type: "response.created", response: { id: "resp_step" } };
      return new Response(`data: ${JSON.stringify(response)}\n\n`, {
        headers: { "content-type": "text/event-stream" },
      });
    };
    configureChatGPTPlan({
      resolveAccount: async () => selected!,
      fetch: fixtureFetch,
    });
    await stepTask(
      {
        ...task,
        leaseOwner,
        runtimeAttemptId: attemptId,
        runtimeInstanceId: runtime.id,
        logicalExecutionId,
      },
      {
        runtimeOperationsConfig: config,
        locale: "en",
        runTool: async () => {
          toolCalls++;
          throw new Error("An unfinished response cannot execute tools");
        },
      },
    );
    const [saved] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    const [attempt] = await db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, attemptId));
    assert.equal(inferenceCalls, 1);
    assert.equal(toolCalls, 0);
    assert.equal(saved.leaseOwner, null);
    assert.equal(attempt.failureKind, "chatgpt_plan");
    assert.equal(attempt.provider, "chatgpt");
    assert.equal(attempt.modelId, "chatgpt:fixture-step");
    assert.ok(!saved.lastError?.includes("private fixture"));
    if (scenario === "known_quota") {
      assert.equal(saved.status, "in_progress");
      assert.equal(attempt.state, "retrying");
      assert.ok(
        saved.nextAttemptAt &&
          saved.nextAttemptAt.getTime() >= Math.floor(retryAt / 1000) * 1000,
      );
    } else {
      assert.equal(saved.status, "blocked");
      assert.equal(attempt.state, "blocked");
      assert.equal(saved.nextAttemptAt, null);
      assert.match(saved.lastError ?? "", /resume|retry/i);
    }
    const [usage] = await db
      .select()
      .from(usageEventsTable)
      .where(eq(usageEventsTable.taskId, task.id));
    assert.equal(usage.outcome, "failed");
    assert.equal(usage.usageReported, scenario === "unknown_quota");
    assert.equal(saved.tokensUsed, scenario === "unknown_quota" ? 27 : 0);
    assert.equal(attempt.totalTokens, scenario === "unknown_quota" ? 27 : 0);
  });
}
test.after(() => closeDatabase());
