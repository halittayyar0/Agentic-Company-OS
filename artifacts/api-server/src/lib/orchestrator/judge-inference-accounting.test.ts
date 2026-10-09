import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  db,
  dbReady,
  closeDatabase,
  inferenceAttemptsTable,
  usageEventsTable,
  activityEventsTable,
  runtimeControlsTable,
} from "@workspace/db";
import { runJudge } from "./judge";
import { InferenceAccountingError } from "./inference-accounting";
import type { createChatCompletion } from "@workspace/ai-server";
import { EmergencyStopError } from "./runtime-emergency-stop";
test.after(() => closeDatabase());

for (const purpose of ["completion", "approval"] as const)
  test(`unaccounted ${purpose} review cannot become a warning or dispatch a fallback`, async (t) => {
    await dbReady;
    const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      url = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "owned-fixture-key";
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
    const [agent] = await db
      .insert(agentsTable)
      .values({
        name: "Owned judge accounting fixture",
        role: "Fixture",
        systemPrompt: "Fixture",
      })
      .returning();
    t.after(async () => {
      if (key === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = key;
      if (url === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
      else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = url;
      await db
        .delete(usageEventsTable)
        .where(eq(usageEventsTable.agentId, agent.id));
      await db
        .delete(inferenceAttemptsTable)
        .where(eq(inferenceAttemptsTable.agentId, agent.id));
      await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
    });
    let calls = 0,
      reviews = 0;
    const params = {
      agent,
      taskId: null,
      purpose,
      originalBrief: "Owned fixture",
      actionSummary: "Owned fixture",
      persistReview: async () => {
        reviews++;
      },
    };
    const dependencies = {
      createCompletion: async (
        input: Parameters<typeof createChatCompletion>[0],
      ) => {
        await input.beforeRequest?.();
        calls++;
        throw Object.assign(new Error("Owned synthetic provider rejection"), {
          status: 429,
        });
      },
    };
    await assert.rejects(
      runJudge(params, dependencies),
      InferenceAccountingError,
    );
    assert.equal(calls, 1);
    assert.equal(reviews, 0);
    const [attempt] = await db
      .select()
      .from(inferenceAttemptsTable)
      .where(eq(inferenceAttemptsTable.agentId, agent.id));
    const [receipt] = await db
      .select()
      .from(usageEventsTable)
      .where(eq(usageEventsTable.agentId, agent.id));
    assert.equal(attempt.state, "uncertain");
    assert.equal(receipt.usageReported, false);
    assert.equal(receipt.ordinaryInferenceId, attempt.id);
    await assert.rejects(
      runJudge(params, dependencies),
      InferenceAccountingError,
    );
    assert.equal(calls, 1);
    assert.equal(reviews, 0);
  });

for (const purpose of ["completion", "approval"] as const)
  for (const boundary of ["reserve", "dispatch"] as const)
    test(`taskless ${purpose} review preserves an emergency denial at ${boundary} without caller hooks or a fallback review`, async (t) => {
      await dbReady;
      const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        url = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "owned-fixture-key";
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL =
        "https://example.invalid/v1";
      const [agent] = await db
        .insert(agentsTable)
        .values({
          name: "Owned taskless judge stop",
          role: "Fixture",
          systemPrompt: "Fixture",
        })
        .returning();
      const stop = () =>
        db
          .update(runtimeControlsTable)
          .set({
            emergencyStopEnabled: true,
            emergencyStopReason: "provider outage",
          })
          .where(eq(runtimeControlsTable.id, 1));
      t.after(async () => {
        if (key === undefined)
          delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
        else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = key;
        if (url === undefined)
          delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
        else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = url;
        await db
          .update(runtimeControlsTable)
          .set({ emergencyStopEnabled: false, emergencyStopReason: null })
          .where(eq(runtimeControlsTable.id, 1));
        await db
          .delete(activityEventsTable)
          .where(eq(activityEventsTable.agentId, agent.id));
        await db
          .delete(usageEventsTable)
          .where(eq(usageEventsTable.agentId, agent.id));
        await db
          .delete(inferenceAttemptsTable)
          .where(eq(inferenceAttemptsTable.agentId, agent.id));
        await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
      });
      let primary: unknown,
        calls = 0;
      const original = db.transaction.bind(db);
      t.mock.method(
        db,
        "transaction",
        async (callback: Parameters<typeof db.transaction>[0]) => {
          try {
            return await original(callback);
          } catch (error) {
            if (error instanceof EmergencyStopError) primary = error;
            throw error;
          }
        },
      );
      if (boundary === "reserve") await stop();
      await assert.rejects(
        runJudge(
          {
            agent,
            taskId: null,
            purpose,
            originalBrief: "Owned fixture",
            actionSummary: "Owned fixture",
          },
          {
            createCompletion: async (params) => {
              await stop();
              await params.beforeRequest?.();
              calls++;
              throw new Error("Stopped judge must never request a model");
            },
          },
        ),
        (error) => error instanceof EmergencyStopError && error === primary,
      );
      assert.equal(calls, 0);
      assert.equal(
        (
          await db
            .select()
            .from(activityEventsTable)
            .where(eq(activityEventsTable.agentId, agent.id))
        ).length,
        0,
      );
      assert.equal(
        (
          await db
            .select()
            .from(usageEventsTable)
            .where(eq(usageEventsTable.agentId, agent.id))
        ).length,
        0,
      );
      const attempts = await db
        .select()
        .from(inferenceAttemptsTable)
        .where(eq(inferenceAttemptsTable.agentId, agent.id));
      assert.equal(attempts.length, boundary === "reserve" ? 0 : 1);
      if (boundary === "dispatch")
        assert.equal(attempts[0].state, "not_dispatched");
    });
