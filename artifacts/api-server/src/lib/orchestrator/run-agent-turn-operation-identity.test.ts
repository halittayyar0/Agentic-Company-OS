import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import type { createChatCompletion } from "@workspace/ai-server";
import {
  agentsTable,
  db,
  dbReady,
  messagesTable,
  runtimeInstancesTable,
  tasksTable,
  usageEventsTable,
} from "@workspace/db";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import type { executeTool } from "./execute-tool";
import {
  markRuntimeStopped,
  registerRuntimeInstance,
} from "./runtime-instance-registry";
import { runAgentTurn } from "./run-agent-turn";

const apiConfig = readRuntimeOperationsConfig({ RUNTIME_ROLE: "api" });

for (const operationOutcome of [
  "unknown",
  "outcome_unknown",
  "deferred",
] as const) {
  test(`${operationOutcome} chat effects keep persisted operation identity and stop the turn`, async (t) => {
    await dbReady;
    const runtime = await registerRuntimeInstance(
      {
        role: "api",
        schedulerEnabled: false,
        capabilities: { http: true, scheduler: false },
      },
      apiConfig,
    );
    const [agent] = await db
      .insert(agentsTable)
      .values({
        name: `Chat receipt ${operationOutcome}`,
        role: "Test",
        systemPrompt: "Test only",
        createdByUser: true,
      })
      .returning();
    assert.ok(agent);
    const [task] = await db
      .insert(tasksTable)
      .values({
        title: `Scoped chat ${operationOutcome}`,
        brief: "The chat stays scoped to this project task.",
        ownerAgentId: agent.id,
        createdByUser: true,
      })
      .returning();
    assert.ok(task);
    t.after(async () => {
      await db
        .delete(usageEventsTable)
        .where(eq(usageEventsTable.agentId, agent.id));
      await db.delete(messagesTable).where(eq(messagesTable.agentId, agent.id));
      await db.delete(tasksTable).where(eq(tasksTable.id, task.id));
      await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
      await markRuntimeStopped(runtime);
      await db
        .delete(runtimeInstancesTable)
        .where(eq(runtimeInstancesTable.id, runtime.id));
    });

    let providerCalls = 0;
    const createCompletion: typeof createChatCompletion = async (params) => {
      providerCalls += 1;
      const firstRound = providerCalls === 1;
      return {
        provider: "openrouter",
        completion: {
          id: randomUUID(),
          object: "chat.completion",
          created: Math.floor(Date.now() / 1_000),
          model: params.model,
          choices: [
            {
              index: 0,
              finish_reason: firstRound ? "tool_calls" : "stop",
              logprobs: null,
              message: {
                role: "assistant",
                content: firstRound
                  ? null
                  : "This provider call must not happen.",
                refusal: null,
                ...(firstRound
                  ? {
                      tool_calls: [
                        {
                          id: "call-unknown-effect",
                          type: "function" as const,
                          function: {
                            name: "log_note",
                            arguments: JSON.stringify({ summary: "first" }),
                          },
                        },
                        {
                          id: "call-must-not-run",
                          type: "function" as const,
                          function: {
                            name: "post_company_message",
                            arguments: JSON.stringify({ content: "second" }),
                          },
                        },
                      ],
                    }
                  : {}),
              },
            },
          ],
          usage: {
            prompt_tokens: 2,
            completion_tokens: 1,
            total_tokens: 3,
          },
        },
      };
    };

    const observedContexts: Parameters<typeof executeTool>[0][] = [];
    const observedTools: string[] = [];
    const runTool: typeof executeTool = async (context, toolName) => {
      observedContexts.push(context);
      observedTools.push(toolName);
      if (observedTools.length === 1) {
        return {
          content: "The side effect could not be reconciled.",
          createdTasks: [],
          createdAgents: [],
          toolOutcome: operationOutcome,
          receiptId: `receipt-chat-${operationOutcome}`,
        };
      }
      return {
        content: "This tool call must not happen.",
        createdTasks: [],
        createdAgents: [],
        toolOutcome: "succeeded",
      };
    };

    const result = await runAgentTurn(
      agent,
      "Keep this operation scoped to the project chat.",
      { modelMode: "manual", modelId: "minimax/minimax-m3:free" },
      task,
      { locale: "tr", runtimeHandle: runtime, createCompletion, runTool },
    );

    assert.equal(
      providerCalls,
      1,
      "non-final operation evidence must stop later provider rounds",
    );
    assert.deepEqual(observedTools, ["log_note"]);
    assert.equal(observedContexts.length, 1);
    const context = observedContexts[0];
    assert.equal(context.taskId, task.id);
    assert.ok(context.operationIdentity);
    const { agentLeaseOwner, ...stableIdentity } = context.operationIdentity;
    assert.match(agentLeaseOwner, /^chat:/u);
    assert.deepEqual(stableIdentity, {
      executionKind: "chat_turn",
      logicalExecutionId: `chat:${result.userMessage.id}`,
      runtimeInstanceId: runtime.id,
      originAttemptId: null,
      sourceMessageId: result.userMessage.id,
      modelToolCallId: "call-unknown-effect",
      callSlot: "round:0:tool:0",
    });
    assert.equal(result.userMessage.taskId, task.id);
    assert.equal(result.agentMessage.taskId, task.id);
    if (operationOutcome === "deferred") {
      assert.match(result.agentMessage.content, /başka bir worker|yeniden/iu);
    } else {
      assert.match(result.agentMessage.content, /sonucu doğrulanamadı/iu);
      assert.match(
        result.agentMessage.content,
        new RegExp(`receipt-chat-${operationOutcome}`, "u"),
      );
    }

    const [releasedAgent] = await db
      .select({
        currentTaskId: agentsTable.currentTaskId,
        runLeaseOwner: agentsTable.runLeaseOwner,
      })
      .from(agentsTable)
      .where(eq(agentsTable.id, agent.id));
    assert.deepEqual(releasedAgent, {
      currentTaskId: null,
      runLeaseOwner: null,
    });
  });
}
