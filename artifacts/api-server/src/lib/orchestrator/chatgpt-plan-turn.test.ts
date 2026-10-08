import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { configureChatGPTPlan } from "@workspace/ai-server";
import {
  agentsTable,
  db,
  dbReady,
  closeDatabase,
  messagesTable,
  usageEventsTable,
} from "@workspace/db";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import {
  markRuntimeStopped,
  registerRuntimeInstance,
} from "./runtime-instance-registry";
import { runAgentTurn } from "./run-agent-turn";

for (const mode of ["tool_history", "quota"] as const) {
  test(`real plan routing through an owned chat turn preserves ${mode}`, async (t) => {
    await dbReady;
    const runtime = await registerRuntimeInstance(
      {
        role: "api",
        schedulerEnabled: false,
        capabilities: { http: true, scheduler: false },
      },
      readRuntimeOperationsConfig({ RUNTIME_ROLE: "api" }),
    );
    const [agent] = await db
      .insert(agentsTable)
      .values({
        name: "Plan chat fixture",
        role: "Fixture",
        systemPrompt: "Use permitted tools.",
        createdByUser: true,
      })
      .returning();
    t.after(async () => {
      configureChatGPTPlan(null);
      await db
        .delete(usageEventsTable)
        .where(eq(usageEventsTable.agentId, agent.id));
      await db.delete(messagesTable).where(eq(messagesTable.agentId, agent.id));
      await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
      await markRuntimeStopped(runtime);
    });
    let inferenceCalls = 0;
    const requests: Array<Record<string, unknown>> = [];
    configureChatGPTPlan({
      resolveAccount: async () => ({
        id: "c1c94b4d-7ce4-4e95-a0d8-ea289080b445",
        hostId: "urn:uuid:712b4d81-573e-47fc-8e03-66c44670b2a1",
        clientId: "fixture-client",
        accountId: "fixture-profile",
        subject: "fixture-subject",
        revision: 1,
        updatedAt: 1,
        credentials: {
          accessToken: "fixture-plan-token",
          idToken: "fixture-id",
          grants: ["resource.invoke", "chatgpt.tokens.use.direct"],
          expiresAt: Date.now() + 3600_000,
        },
      }),
      fetch: async (input, init) => {
        if (String(input) === "https://api.openai.com/v1/models")
          return Response.json({
            models: [
              {
                slug: "gpt-fixture",
                display_name: "Fixture",
                visibility: "list",
              },
            ],
          });
        assert.equal(String(input), "https://api.openai.com/v1/responses");
        inferenceCalls++;
        requests.push(JSON.parse(init?.body as string));
        const usage = { input_tokens: 9, output_tokens: 4, total_tokens: 13 };
        const response =
          mode === "quota"
            ? {
                type: "response.failed",
                response: {
                  id: "resp_quota",
                  status: "failed",
                  usage,
                  error: {
                    code: "subscription_sharing_usage_limit_exceeded",
                    message: "private fixture diagnostic",
                  },
                },
              }
            : {
                type: "response.completed",
                response: {
                  id: `resp_${inferenceCalls}`,
                  status: "completed",
                  model: "gpt-fixture",
                  created_at: 123,
                  usage,
                  output:
                    inferenceCalls === 1
                      ? [
                          {
                            type: "reasoning",
                            id: "rs_fixture",
                            summary: [],
                            encrypted_content: "fixture-private-replay",
                          },
                          {
                            type: "function_call",
                            id: "fc_fixture",
                            call_id: "call_plan",
                            namespace: "local_tools",
                            name: "log_note",
                            arguments: '{"summary":"Fixture note"}',
                            status: "completed",
                          },
                        ]
                      : [
                          {
                            type: "message",
                            id: "msg_fixture",
                            status: "completed",
                            role: "assistant",
                            phase: "final_answer",
                            content: [
                              {
                                type: "output_text",
                                text: "Finished useful reply",
                                annotations: [],
                              },
                            ],
                          },
                        ],
                },
              };
        return new Response(`data: ${JSON.stringify(response)}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    const tools: string[] = [];
    const result = await runAgentTurn(
      agent,
      "Please complete this useful task.",
      { modelMode: "manual", modelId: "chatgpt:gpt-fixture" },
      undefined,
      {
        runtimeHandle: runtime,
        locale: "en",
        runTool: async (_context, name) => {
          tools.push(name);
          return {
            content: "Fixture note recorded",
            createdTasks: [],
            createdAgents: [],
            toolOutcome: "succeeded",
          };
        },
      },
    );
    const ledger = await db
      .select()
      .from(usageEventsTable)
      .where(eq(usageEventsTable.agentId, agent.id))
      .orderBy(usageEventsTable.id);
    if (mode === "quota") {
      assert.equal(result.outcome, "provider_error");
      assert.equal(inferenceCalls, 1);
      assert.deepEqual(tools, []);
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].outcome, "failed");
      assert.equal(ledger[0].totalTokens, 13);
      assert.ok(!result.agentMessage.content.includes("private fixture"));
    } else {
      assert.equal(result.outcome, "reply");
      assert.equal(result.agentMessage.content, "Finished useful reply");
      assert.equal(result.usedProvider, "chatgpt");
      assert.equal(inferenceCalls, 2);
      assert.deepEqual(tools, ["log_note"]);
      const second = requests[1].input as Array<Record<string, unknown>>;
      assert.ok(
        second.some(
          (item) =>
            item.type === "reasoning" &&
            item.encrypted_content === "fixture-private-replay",
        ),
      );
      assert.ok(
        second.some(
          (item) =>
            item.type === "function_call_output" &&
            item.call_id === "call_plan",
        ),
      );
      assert.equal(ledger.length, 2);
      assert.ok(
        ledger.every(
          (event) =>
            event.outcome === "completed" &&
            event.usageReported === true &&
            event.reportedCostUsd === null,
        ),
      );
    }
    const persisted = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.agentId, agent.id));
    assert.ok(!JSON.stringify(persisted).includes("fixture-private-replay"));
    assert.ok(requests.every((request) => !("max_output_tokens" in request)));
  });
}
test.after(() => closeDatabase());
