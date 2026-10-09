import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  tasksTable,
  db,
  dbReady,
  closeDatabase,
  inferenceAttemptsTable,
  usageEventsTable,
  runtimeControlsTable,
} from "@workspace/db";
import type { createChatCompletion } from "@workspace/ai-server";
import {
  runAccountedCompletion,
  InferenceAccountingError,
} from "./inference-accounting";
import { EmergencyStopError } from "./runtime-emergency-stop";
import { TaskSpendBudgetError } from "./task-spend-admission";

test.after(() => closeDatabase());
for (const denial of ["emergency", "budget", "inactive_agent"] as const) {
  test(`${denial} during local provider preparation releases only the positively unstarted reservation and preserves the denial`, async (t) => {
    await dbReady;
    const [agent] = await db
      .insert(agentsTable)
      .values({
        name: "Owned preparation denial",
        role: "Fixture",
        systemPrompt: "Fixture",
      })
      .returning();
    const [task] = await db
      .insert(tasksTable)
      .values({
        title: "Owned preparation denial",
        brief: "Fixture",
        ownerAgentId: agent.id,
      })
      .returning();
    const undo = async () => {
      if (denial === "emergency")
        await db
          .update(runtimeControlsTable)
          .set({ emergencyStopEnabled: false })
          .where(eq(runtimeControlsTable.id, 1));
      else if (denial === "budget")
        await db
          .update(tasksTable)
          .set({ tokensUsed: 0 })
          .where(eq(tasksTable.id, task.id));
      else
        await db
          .update(agentsTable)
          .set({ isActive: true })
          .where(eq(agentsTable.id, agent.id));
    };
    t.after(async () => {
      await undo();
      await db
        .delete(usageEventsTable)
        .where(eq(usageEventsTable.agentId, agent.id));
      await db
        .delete(inferenceAttemptsTable)
        .where(eq(inferenceAttemptsTable.agentId, agent.id));
      await db.delete(tasksTable).where(eq(tasksTable.id, task.id));
      await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
    });
    let requests = 0,
      primary: unknown;
    const completion: typeof createChatCompletion = async (params) => {
      try {
        await params.beforeRequest?.();
      } catch (error) {
        primary = error;
        throw error;
      }
      requests++;
      return {
        provider: "openrouter",
        completion: {
          id: "owned-preparation-response",
          object: "chat.completion",
          created: 1,
          model: "fixture",
          choices: [],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        },
      };
    };
    const context = {
      agentId: agent.id,
      taskId: task.id,
      provider: "openrouter",
      modelId: "fixture",
      kind: "task_step" as const,
    };
    const params = { model: "fixture", messages: [] };
    await assert.rejects(
      runAccountedCompletion(context, params, async (input) => {
        if (denial === "emergency")
          await db
            .update(runtimeControlsTable)
            .set({ emergencyStopEnabled: true })
            .where(eq(runtimeControlsTable.id, 1));
        else if (denial === "budget")
          await db
            .update(tasksTable)
            .set({ tokensUsed: 2147483647 })
            .where(eq(tasksTable.id, task.id));
        else
          await db
            .update(agentsTable)
            .set({ isActive: false })
            .where(eq(agentsTable.id, agent.id));
        return completion(input);
      }),
      (error) =>
        error === primary &&
        (denial === "emergency"
          ? error instanceof EmergencyStopError
          : denial === "budget"
            ? error instanceof TaskSpendBudgetError
            : error instanceof InferenceAccountingError),
    );
    assert.equal(requests, 0);
    assert.equal(
      (
        await db
          .select()
          .from(usageEventsTable)
          .where(eq(usageEventsTable.agentId, agent.id))
      ).length,
      0,
    );
    const [prepared] = await db
      .select()
      .from(inferenceAttemptsTable)
      .where(eq(inferenceAttemptsTable.agentId, agent.id));
    assert.equal(prepared.state, "not_dispatched");
    assert.equal(prepared.dispatchedAt, null);
    assert.ok(prepared.settledAt);
    await undo();
    const successful = await runAccountedCompletion(
      context,
      params,
      completion,
    );
    assert.equal(successful.usage.totalTokens, 5);
    assert.equal(requests, 1);
    const attempts = await db
      .select()
      .from(inferenceAttemptsTable)
      .where(eq(inferenceAttemptsTable.agentId, agent.id));
    assert.equal(attempts.length, 2);
    assert.equal(attempts.filter((a) => a.state === "accounted").length, 1);
    const [receipt] = await db
      .select()
      .from(usageEventsTable)
      .where(eq(usageEventsTable.agentId, agent.id));
    assert.ok(receipt);
    assert.notEqual(receipt.ordinaryInferenceId, prepared.id);
  });
}
