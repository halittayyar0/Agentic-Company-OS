import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { eq, inArray } from "drizzle-orm";
import type { createChatCompletion } from "@workspace/ai-server";
import {
  agentsTable,
  db,
  dbReady,
  messagesTable,
  operationInvocationsTable,
  operationReceiptsTable,
  runtimeInstancesTable,
  usageEventsTable,
} from "@workspace/db";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import {
  runDurableExternalEffect,
  type ToolExecutionResult,
  type ToolRuntimeContext,
} from "./execute-tool";
import {
  markRuntimeDraining,
  markRuntimeStopped,
  registerRuntimeInstance,
  RuntimeClaimAdmissionError,
  type RuntimeInstanceHandle,
} from "./runtime-instance-registry";
import { markRuntimeOperationsUnknownAfterDrainTimeout } from "./operation-receipts";
import { runAgentTurn } from "./run-agent-turn";

const apiConfig = readRuntimeOperationsConfig({ RUNTIME_ROLE: "api" });

interface ChatRuntimeFixture {
  agent: typeof agentsTable.$inferSelect;
  runtime: RuntimeInstanceHandle;
}

async function createFixture(t: TestContext): Promise<ChatRuntimeFixture> {
  await dbReady;
  const suffix = randomUUID();
  const runtime = await registerRuntimeInstance(
    {
      role: "api",
      schedulerEnabled: false,
      capabilities: { http: true, scheduler: false },
      buildVersion: `chat-runtime-fence-${suffix}`,
    },
    apiConfig,
  );
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Chat runtime fence ${suffix}`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  assert.ok(agent);

  t.after(async () => {
    const receipts = await db
      .select({ id: operationReceiptsTable.id })
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.agentId, agent.id));
    if (receipts.length > 0) {
      const receiptIds = receipts.map((receipt) => receipt.id);
      await db
        .delete(operationInvocationsTable)
        .where(inArray(operationInvocationsTable.receiptId, receiptIds));
      await db
        .delete(operationReceiptsTable)
        .where(inArray(operationReceiptsTable.id, receiptIds));
    }
    await db
      .delete(usageEventsTable)
      .where(eq(usageEventsTable.agentId, agent.id));
    await db.delete(messagesTable).where(eq(messagesTable.agentId, agent.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
    await markRuntimeStopped(runtime);
    await db
      .delete(runtimeInstancesTable)
      .where(eq(runtimeInstancesTable.id, runtime.id));
  });

  return { agent, runtime };
}

function completionWithOneTool(): {
  createCompletion: typeof createChatCompletion;
  getCalls: () => number;
} {
  let calls = 0;
  return {
    getCalls: () => calls,
    createCompletion: async (params) => {
      calls += 1;
      const firstRound = calls === 1;
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
                content: firstRound ? null : "Runtime-fenced turn finished.",
                refusal: null,
                ...(firstRound
                  ? {
                      tool_calls: [
                        {
                          id: `call-${randomUUID()}`,
                          type: "function" as const,
                          function: {
                            name: "vm_run_command",
                            arguments: JSON.stringify({ command: "echo ok" }),
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
    },
  };
}

function operationResult(
  toolOutcome: ToolExecutionResult["toolOutcome"] = "succeeded",
): ToolExecutionResult {
  return {
    content: "Synthetic chat effect",
    createdTasks: [],
    createdAgents: [],
    toolOutcome,
  };
}

function runtimeBoundDependencies(
  fixture: ChatRuntimeFixture,
  createCompletion: typeof createChatCompletion,
  runTool: NonNullable<Parameters<typeof runAgentTurn>[4]>["runTool"],
) {
  return {
    locale: "tr" as const,
    runtimeHandle: fixture.runtime,
    createCompletion,
    runTool,
  };
}

async function runSyntheticEffect(
  fixture: ChatRuntimeFixture,
  createCompletion: typeof createChatCompletion,
  execute: Parameters<typeof runDurableExternalEffect>[1]["execute"],
): Promise<{
  result: Awaited<ReturnType<typeof runAgentTurn>>;
  outcome: string;
}> {
  let outcome = "not-called";
  const result = await runAgentTurn(
    fixture.agent,
    "Run one runtime-fenced synthetic command.",
    { modelMode: "manual", modelId: "minimax/minimax-m3:free" },
    undefined,
    runtimeBoundDependencies(
      fixture,
      createCompletion,
      async (context: ToolRuntimeContext) => {
        const effect = await runDurableExternalEffect(context, {
          toolName: "vm_run_command",
          normalizedArgs: {
            commandHash: `sha256:${"a".repeat(64)}`,
            commandName: "echo",
            commandChars: 7,
          },
          execute,
          onError: async () => operationResult("rejected"),
        });
        outcome = effect.toolOutcome;
        return effect;
      },
    ),
  );
  return { result, outcome };
}

test("the current API incarnation owns a chat operation invocation", async (t) => {
  const fixture = await createFixture(t);
  const completion = completionWithOneTool();
  let effects = 0;

  const { outcome } = await runSyntheticEffect(
    fixture,
    completion.createCompletion,
    async ({ startEffect }) => {
      await startEffect();
      effects += 1;
      return {
        result: operationResult(),
        resultData: { ok: true, exitCode: 0, durationMs: 1 },
      };
    },
  );

  assert.equal(outcome, "succeeded");
  assert.equal(effects, 1);
  const [invocation] = await db
    .select()
    .from(operationInvocationsTable)
    .where(eq(operationInvocationsTable.workerInstanceId, fixture.runtime.id));
  assert.equal(invocation?.executionKind, "chat_turn");
  assert.equal(invocation?.state, "succeeded");
});

test("shutdown before startEffect fences a chat side effect", async (t) => {
  const fixture = await createFixture(t);
  const completion = completionWithOneTool();
  let effects = 0;

  const { outcome } = await runSyntheticEffect(
    fixture,
    completion.createCompletion,
    async ({ startEffect }) => {
      await markRuntimeDraining(fixture.runtime);
      await startEffect();
      effects += 1;
      return { result: operationResult() };
    },
  );

  assert.equal(effects, 0);
  assert.equal(outcome, "rejected");
  const [receipt] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.agentId, fixture.agent.id));
  assert.equal(receipt?.state, "reserved");
});

test("a crashed API incarnation cannot commit success after the effect boundary", async (t) => {
  const fixture = await createFixture(t);
  const completion = completionWithOneTool();
  let effects = 0;

  await assert.rejects(
    runSyntheticEffect(
      fixture,
      completion.createCompletion,
      async ({ startEffect }) => {
        await startEffect();
        effects += 1;
        await db
          .update(runtimeInstancesTable)
          .set({ state: "stale" })
          .where(eq(runtimeInstancesTable.id, fixture.runtime.id));
        return {
          result: operationResult(),
          resultData: { ok: true, exitCode: 0, durationMs: 1 },
        };
      },
    ),
    RuntimeClaimAdmissionError,
  );

  assert.equal(effects, 1);
  const [receipt] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.agentId, fixture.agent.id));
  assert.equal(receipt?.state, "unknown");
});

test("drain timeout fences the exact chat invocation and records only its unknown notice", async (t) => {
  const fixture = await createFixture(t);
  const completion = completionWithOneTool();
  let effects = 0;
  let fenced = 0;

  const { result, outcome } = await runSyntheticEffect(
    fixture,
    completion.createCompletion,
    async ({ startEffect }) => {
      await startEffect();
      effects += 1;
      await markRuntimeDraining(fixture.runtime);
      fenced = await markRuntimeOperationsUnknownAfterDrainTimeout(
        fixture.runtime,
      );
      return {
        result: operationResult(),
        resultData: { ok: true, exitCode: 0, durationMs: 1 },
      };
    },
  );

  assert.equal(outcome, "unknown");
  assert.equal(result.outcome, "tool_outcome_unknown");
  assert.equal(result.agentMessage.role, "system");
  assert.match(result.agentMessage.content, /sonucu doğrulanamadı/);
  assert.equal(completion.getCalls(), 1);
  assert.equal(effects, 1);
  assert.equal(fenced, 1);
  const invocations = await db
    .select()
    .from(operationInvocationsTable)
    .where(eq(operationInvocationsTable.workerInstanceId, fixture.runtime.id));
  assert.equal(invocations.length, 1);
  const invocation = invocations[0];
  assert.equal(invocation?.state, "unknown");
  assert.equal(invocation?.failureKind, "shutdown_drain_timeout");
  const [receipt] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.agentId, fixture.agent.id));
  assert.equal(receipt?.state, "unknown");
  const persisted = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.agentId, fixture.agent.id))
    .orderBy(messagesTable.id);
  assert.deepEqual(
    persisted.map((message) => message.role),
    ["user", "system"],
  );
});

test("a stopped runtime cannot finalize even an already unknown drained chat turn", async (t) => {
  const fixture = await createFixture(t);
  const completion = completionWithOneTool();
  let effects = 0;
  let fenced = 0;

  await assert.rejects(
    runSyntheticEffect(
      fixture,
      completion.createCompletion,
      async ({ startEffect }) => {
        await startEffect();
        effects += 1;
        await markRuntimeDraining(fixture.runtime);
        fenced = await markRuntimeOperationsUnknownAfterDrainTimeout(
          fixture.runtime,
        );
        await markRuntimeStopped(fixture.runtime);
        return {
          result: operationResult(),
          resultData: { ok: true, exitCode: 0, durationMs: 1 },
        };
      },
    ),
    RuntimeClaimAdmissionError,
  );

  assert.equal(effects, 1);
  assert.equal(fenced, 1);
  assert.equal(completion.getCalls(), 1);
  const invocations = await db
    .select()
    .from(operationInvocationsTable)
    .where(eq(operationInvocationsTable.workerInstanceId, fixture.runtime.id));
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0]?.state, "unknown");
  assert.equal(invocations[0]?.failureKind, "shutdown_drain_timeout");
  const [receipt] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.agentId, fixture.agent.id));
  assert.equal(receipt?.state, "unknown");
  const persisted = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.agentId, fixture.agent.id));
  assert.deepEqual(
    persisted.map((message) => message.role),
    ["user"],
  );
});

test("a stale API incarnation cannot commit the final agent response", async (t) => {
  const fixture = await createFixture(t);
  let providerCalls = 0;
  const createCompletion: typeof createChatCompletion = async (params) => {
    providerCalls += 1;
    await db
      .update(runtimeInstancesTable)
      .set({ state: "stale" })
      .where(eq(runtimeInstancesTable.id, fixture.runtime.id));
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
            finish_reason: "stop",
            logprobs: null,
            message: {
              role: "assistant",
              content: "A stale runtime must not persist this response.",
              refusal: null,
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

  await assert.rejects(
    runAgentTurn(
      fixture.agent,
      "Fence the final response too.",
      { modelMode: "manual", modelId: "minimax/minimax-m3:free" },
      undefined,
      {
        runtimeHandle: fixture.runtime,
        createCompletion,
      },
    ),
    RuntimeClaimAdmissionError,
  );
  assert.equal(providerCalls, 1);
  const persistedMessages = await db
    .select({ role: messagesTable.role, content: messagesTable.content })
    .from(messagesTable)
    .where(eq(messagesTable.agentId, fixture.agent.id));
  assert.deepEqual(
    persistedMessages.map((message) => message.role),
    ["user"],
  );
  assert.equal(
    persistedMessages.some((message) =>
      message.content.includes("stale runtime"),
    ),
    false,
  );
});
