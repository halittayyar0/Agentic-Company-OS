import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import express from "express";
import { eq, sql } from "drizzle-orm";
import type { createChatCompletion } from "@workspace/ai-server";
import {
  agentsTable,
  messagesTable,
  tasksTable,
  projectMembersTable,
  runtimeControlsTable,
  agentInteractionRequestsTable,
  db,
  dbReady,
  closeDatabase,
} from "@workspace/db";
import { createAgentRequestsRouter } from "./agent-requests";
import {
  runAgentTurn,
  AgentBusyError,
} from "../lib/orchestrator/run-agent-turn";
import {
  registerRuntimeInstance,
  markRuntimeStopped,
} from "../lib/orchestrator/runtime-instance-registry";
import {
  bindHttpRuntimeHandle,
  releaseHttpRuntimeHandle,
} from "../lib/http-runtime-context";
import { readRuntimeOperationsConfig } from "../lib/runtime-operations-config";
import { agentConfigVersion } from "../lib/agent-config-version";
import { WORKSPACE_LOCALES } from "../lib/workspace-locale";

const reply: typeof createChatCompletion = async () => ({
  provider: "ollama",
  completion: {
    id: randomUUID(),
    object: "chat.completion",
    created: 1,
    model: "observed-provider-model",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        logprobs: null,
        message: {
          role: "assistant",
          content: "Recorded reply",
          refusal: null,
        },
      },
    ],
  },
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("durable expert requests preserve one execution identity and recover honest outcomes", async (t) => {
  await dbReady;
  const runtime = await registerRuntimeInstance(
    {
      role: "api",
      schedulerEnabled: false,
      capabilities: { http: true, scheduler: false },
    },
    readRuntimeOperationsConfig({ RUNTIME_ROLE: "api" }),
  );
  bindHttpRuntimeHandle(runtime);
  t.after(async () => {
    releaseHttpRuntimeHandle(runtime);
    await markRuntimeStopped(runtime);
    await closeDatabase();
  });

  async function fixture(
    child: TestContext,
    runTurn: typeof runAgentTurn = async (agent, content, model, task, deps) =>
      runAgentTurn(agent, content, model, task, {
        ...deps!,
        createCompletion: reply,
      }),
  ) {
    const [agent] = await db
      .insert(agentsTable)
      .values({
        name: randomUUID(),
        role: "Test",
        systemPrompt: "Original prompt",
        modelMode: "manual",
        modelId: "minimax/minimax-m3:free",
        createdByUser: true,
      })
      .returning();
    const app = express();
    app.use(express.json());
    app.use("/api", createAgentRequestsRouter({ runTurn }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}/api/agents/${agent.id}/requests`;
    child.after(async () => {
      await db
        .update(runtimeControlsTable)
        .set({ emergencyStopEnabled: false })
        .where(eq(runtimeControlsTable.id, 1));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const input = {
      requestId: randomUUID(),
      kind: "ask",
      locale: "en",
      content: "Test this one intent",
      expectedConfig: agentConfigVersion(agent),
    };
    async function send(body: unknown = input, url = base) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        data: (await response.json()) as Record<string, any>,
      };
    }
    return { agent, input, base, send };
  }

  await t.test(
    "simultaneous sends and read-only recovery never dispatch twice, even under stop",
    async (child) => {
      const entered = deferred(),
        release = deferred();
      let calls = 0;
      const f = await fixture(child, (agent, content, model, task, deps) =>
        runAgentTurn(agent, content, model, task, {
          ...deps!,
          createCompletion: async (params) => {
            calls++;
            entered.resolve();
            await release.promise;
            return reply(params);
          },
        }),
      );
      const first = f.send();
      await Promise.race([
        entered.promise,
        first.then(() => {
          throw new Error(
            "Request ended before the injected provider was reached",
          );
        }),
      ]);
      try {
        const pending = await f.send();
        assert.equal(pending.data.deliveryState, "unconfirmed");
        assert.equal(pending.data.replayed, true);
        assert.ok(pending.data.userMessage.id);
        const recovered = (await (
          await fetch(`${f.base}/${f.input.requestId}`)
        ).json()) as any;
        assert.equal(recovered.userMessage.id, pending.data.userMessage.id);
      } finally {
        release.resolve();
      }
      const complete = await first;
      assert.equal(complete.status, 200);
      assert.equal(complete.data.deliveryState, "complete");
      assert.equal(complete.data.outcome, "reply");
      assert.equal(complete.data.usedProvider, "ollama");
      assert.equal(complete.data.usedModel, "observed-provider-model");
      assert.equal(
        complete.data.agentMessage.modelId,
        "observed-provider-model",
      );
      await db
        .update(runtimeControlsTable)
        .set({ emergencyStopEnabled: true })
        .where(eq(runtimeControlsTable.id, 1));
      await db
        .update(agentsTable)
        .set({ isActive: false })
        .where(eq(agentsTable.id, f.agent.id));
      const replay = await f.send();
      assert.equal(replay.data.agentMessage.id, complete.data.agentMessage.id);
      assert.equal(replay.data.replayed, true);
      assert.equal(
        (await f.send({ ...f.input, content: "Different intent" })).data.code,
        "AGENT_REQUEST_CONFLICT",
      );
      assert.equal(
        (
          await f.send(
            f.input,
            f.base.replace(
              `/agents/${f.agent.id}/`,
              `/agents/${f.agent.id + 1000}/`,
            ),
          )
        ).status,
        409,
      );
      assert.equal((await fetch(`${f.base}/${randomUUID()}`)).status, 404);
      assert.equal(calls, 1);
      const records = await db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.agentId, f.agent.id));
      assert.equal(records.length, 2);
    },
  );

  for (const kind of ["delegate", "continuous"] as const) {
    await t.test(
      `${kind} creates one queued project and roster atomically with its final receipt`,
      async (child) => {
        let turns = 0;
        const f = await fixture(child, async () => {
          turns++;
          throw new Error("Chat must not run");
        });
        const input = { ...f.input, kind };
        const results = await Promise.all([f.send(input), f.send(input)]);
        const complete = results.find(
          (value) => value.data.deliveryState === "complete",
        )!;
        assert.ok(complete);
        const replay = await f.send(input);
        assert.equal(replay.data.task.id, complete.data.task.id);
        assert.equal(replay.data.outcome, "queued");
        assert.equal(replay.data.task.status, "pending");
        assert.equal(
          replay.data.task.autonomyMode,
          kind === "continuous" ? "continuous" : "finite",
        );
        assert.equal(
          replay.data.task.cadenceSeconds,
          kind === "continuous" ? 3600 : null,
        );
        const tasks = await db
          .select()
          .from(tasksTable)
          .where(eq(tasksTable.ownerAgentId, f.agent.id));
        assert.equal(tasks.length, 1);
        const members = await db
          .select()
          .from(projectMembersTable)
          .where(eq(projectMembersTable.taskId, tasks[0]!.id));
        assert.ok(
          members.some(
            (member) =>
              member.agentId === f.agent.id &&
              member.memberRole === "coordinator",
          ),
        );
        assert.equal(turns, 0);
      },
    );
  }

  await t.test(
    "stale configuration and pre-claim stop are durable rejections",
    async (child) => {
      const f = await fixture(child);
      await db
        .update(agentsTable)
        .set({ systemPrompt: "Changed" })
        .where(eq(agentsTable.id, f.agent.id));
      const stale = await f.send();
      assert.equal(stale.data.deliveryState, "rejected");
      assert.equal(stale.data.failureCode, "AGENT_CONFIG_CHANGED");
      const staleProject = await f.send({
        ...f.input,
        requestId: randomUUID(),
        kind: "delegate",
      });
      assert.equal(staleProject.data.failureCode, "AGENT_CONFIG_CHANGED");
      assert.equal(
        (
          await db
            .select()
            .from(tasksTable)
            .where(eq(tasksTable.ownerAgentId, f.agent.id))
        ).length,
        0,
      );
      await db
        .update(agentsTable)
        .set({ systemPrompt: "Original prompt" })
        .where(eq(agentsTable.id, f.agent.id));
      assert.equal((await f.send()).data.failureCode, "AGENT_CONFIG_CHANGED");
      await db
        .update(runtimeControlsTable)
        .set({ emergencyStopEnabled: true })
        .where(eq(runtimeControlsTable.id, 1));
      const stoppedInput = { ...f.input, requestId: randomUUID() };
      assert.equal(
        (await f.send(stoppedInput)).data.failureCode,
        "EMERGENCY_STOP_ACTIVE",
      );
      await db
        .update(runtimeControlsTable)
        .set({ emergencyStopEnabled: false })
        .where(eq(runtimeControlsTable.id, 1));
      assert.equal((await f.send(stoppedInput)).data.deliveryState, "rejected");
      assert.equal(
        (
          await db
            .select()
            .from(messagesTable)
            .where(eq(messagesTable.agentId, f.agent.id))
        ).length,
        0,
      );
    },
  );

  await t.test(
    "lost agent ownership after model execution leaves unconfirmed work without replay",
    async (child) => {
      let calls = 0;
      const f = await fixture(child, (agent, content, model, task, deps) =>
        runAgentTurn(agent, content, model, task, {
          ...deps!,
          createCompletion: async (params) => {
            calls++;
            await db
              .update(agentsTable)
              .set({
                runLeaseOwner: "replacement-owner",
                runLeaseExpiresAt: new Date(Date.now() + 60000),
              })
              .where(eq(agentsTable.id, agent.id));
            return reply(params);
          },
        }),
      );
      const result = await f.send();
      assert.equal(result.data.deliveryState, "unconfirmed");
      assert.ok(result.data.userMessage.id);
      assert.equal(result.data.agentMessage, undefined);
      assert.equal((await f.send()).data.deliveryState, "unconfirmed");
      assert.equal(calls, 1);
      const [owner] = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, f.agent.id));
      assert.equal(owner?.runLeaseOwner, "replacement-owner");
      assert.equal(
        (
          await db
            .select()
            .from(messagesTable)
            .where(eq(messagesTable.agentId, f.agent.id))
        ).length,
        1,
      );
    },
  );

  await t.test(
    "receipt write failure rolls back final message and never reruns the admitted turn",
    async (child) => {
      let calls = 0;
      const f = await fixture(child, (agent, content, model, task, deps) =>
        runAgentTurn(agent, content, model, task, {
          ...deps!,
          createCompletion: async (params) => {
            calls++;
            return reply(params);
          },
          onCompleted: async (tx, result) => {
            await deps!.onCompleted!(tx, result);
            throw new Error("Injected commit failure");
          },
        }),
      );
      assert.equal((await f.send()).data.deliveryState, "unconfirmed");
      assert.equal((await f.send()).data.deliveryState, "unconfirmed");
      const records = await db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.agentId, f.agent.id));
      assert.deepEqual(
        records.map((record) => record.role),
        ["user"],
      );
      assert.equal(calls, 1);
    },
  );

  await t.test(
    "project sends bind scope, preserve isolated history and replay after project removal",
    async (child) => {
      let calls = 0;
      const f = await fixture(
        child,
        async (agent, content, model, task, deps) => {
          assert.ok(task);
          await db
            .update(tasksTable)
            .set({ brief: "Fresh scoped brief" })
            .where(eq(tasksTable.id, task.id));
          return runAgentTurn(agent, content, model, task, {
            ...deps!,
            createCompletion: async (params) => {
              calls++;
              const context = JSON.stringify(params.messages);
              assert.match(context, /project-history-sentinel/);
              assert.doesNotMatch(
                context,
                /direct-history-sentinel|other-project-sentinel/,
              );
              assert.match(context, /Fresh scoped brief/);
              assert.doesNotMatch(context, /Stale scoped brief/);
              return reply(params);
            },
          });
        },
      );
      const [project, other] = await db
        .insert(tasksTable)
        .values([
          {
            title: "Project",
            brief: "Stale scoped brief",
            ownerAgentId: f.agent.id,
          },
          { title: "Other", brief: "Other brief", ownerAgentId: f.agent.id },
        ])
        .returning();
      await db.insert(messagesTable).values([
        {
          agentId: f.agent.id,
          role: "user",
          taskId: null,
          content: "direct-history-sentinel",
        },
        {
          agentId: f.agent.id,
          role: "user",
          taskId: project.id,
          content: "project-history-sentinel",
        },
        {
          agentId: f.agent.id,
          role: "user",
          taskId: other.id,
          content: "other-project-sentinel",
        },
      ]);
      const input = { ...f.input, taskId: project.id };
      const first = await f.send(input);
      assert.equal(first.status, 200);
      assert.equal(first.data.deliveryState, "complete");
      assert.equal(first.data.taskId, project.id);
      assert.equal(first.data.userMessage.taskId, project.id);
      assert.equal(first.data.agentMessage.taskId, project.id);
      assert.equal((await f.send({ ...input, taskId: other.id })).status, 409);
      assert.equal((await f.send(f.input)).status, 409);
      await db.delete(tasksTable).where(eq(tasksTable.id, project.id));
      const recovered = await f.send(input);
      assert.equal(recovered.data.replayed, true);
      assert.equal(recovered.data.agentMessage.id, first.data.agentMessage.id);
      assert.equal(
        (
          (await (await fetch(`${f.base}/${input.requestId}`)).json()) as {
            taskId: number;
          }
        ).taskId,
        project.id,
      );
      assert.equal(calls, 1);
    },
  );

  await t.test(
    "project ownership is checked again at admission and cannot fall back to direct chat",
    async (child) => {
      const [other] = await db
        .insert(agentsTable)
        .values({ name: randomUUID(), role: "Other", systemPrompt: "Test" })
        .returning();
      let calls = 0;
      const f = await fixture(
        child,
        async (agent, content, model, task, deps) => {
          assert.ok(task);
          await db
            .update(tasksTable)
            .set({ ownerAgentId: other.id })
            .where(eq(tasksTable.id, task.id));
          return runAgentTurn(agent, content, model, task, {
            ...deps!,
            createCompletion: async (params) => {
              calls++;
              return reply(params);
            },
          });
        },
      );
      const [project] = await db
        .insert(tasksTable)
        .values({
          title: "Changing owner",
          brief: "Test",
          ownerAgentId: f.agent.id,
        })
        .returning();
      const input = { ...f.input, taskId: project.id };
      const result = await f.send(input);
      assert.equal(result.status, 200);
      assert.equal(result.data.deliveryState, "rejected");
      assert.equal(result.data.failureCode, "PROJECT_CHAT_UNAVAILABLE");
      assert.equal(result.data.userMessage, undefined);
      assert.equal((await f.send(input)).data.replayed, true);
      assert.equal(
        (
          await f.send({
            ...input,
            requestId: randomUUID(),
            taskId: 2147483647,
          })
        ).data.failureCode,
        "PROJECT_CHAT_UNAVAILABLE",
      );
      assert.equal(calls, 0);
      assert.equal(
        (
          await db
            .select()
            .from(messagesTable)
            .where(eq(messagesTable.agentId, f.agent.id))
        ).length,
        0,
      );
    },
  );

  await t.test(
    "an upgrade preserves historical direct-request hashes without dispatch",
    async (child) => {
      let calls = 0;
      const f = await fixture(child, async () => {
        calls++;
        throw new Error("Historical receipt must not dispatch");
      });
      const oldHash = createHash("sha256")
        .update(
          JSON.stringify([
            "agent-request-v1",
            f.agent.id,
            f.input.kind,
            f.input.content,
            f.input.locale,
            null,
            null,
            f.input.expectedConfig,
          ]),
        )
        .digest("hex");
      await db.insert(agentInteractionRequestsTable).values({
        requestId: f.input.requestId,
        agentId: f.agent.id,
        requestHash: oldHash,
        response: {
          requestId: f.input.requestId,
          agentId: f.agent.id,
          kind: "ask",
          deliveryState: "unconfirmed",
          outcome: "unconfirmed",
          replayed: false,
          createdTasks: [],
          createdAgents: [],
        },
      });
      const result = await f.send();
      assert.equal(result.status, 200);
      assert.equal(result.data.replayed, true);
      assert.equal(result.data.deliveryState, "unconfirmed");
      assert.equal(result.data.taskId, undefined);
      assert.equal(calls, 0);
    },
  );

  await t.test(
    "request validation prevents accidental unscoped or oversized work",
    async (child) => {
      const f = await fixture(child);
      for (const body of [
        { ...f.input, taskId: 0 },
        { ...f.input, kind: "delegate", taskId: 1 },
        { ...f.input, content: " " },
        { ...f.input, kind: "delegate", content: "a".repeat(8001) },
        { ...f.input, modelMode: "manual" },
        { ...f.input, modelMode: "manual", modelId: "伪装/model" },
        { ...f.input, modelId: "abc" },
        { ...f.input, kind: "continuous", modelMode: "auto" },
      ]) {
        assert.equal((await f.send(body)).status, 400);
      }
      assert.equal(
        (
          await db
            .select()
            .from(agentInteractionRequestsTable)
            .where(
              eq(agentInteractionRequestsTable.requestId, f.input.requestId),
            )
        ).length,
        0,
      );
      assert.equal(
        (
          await fetch(
            `${f.base.replace(`/agents/${f.agent.id}/`, "/agents/999999999999999999/")}/${f.input.requestId}`,
          )
        ).status,
        400,
      );
    },
  );

  await t.test(
    "project creation rolls back if its completion receipt cannot commit",
    async (child) => {
      const f = await fixture(child);
      await db.execute(
        sql`CREATE FUNCTION test_reject_complete_request() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.response->>'deliveryState' = 'complete' THEN RAISE EXCEPTION 'Synthetic receipt failure'; END IF; RETURN NEW; END; $$`,
      );
      await db.execute(
        sql`CREATE TRIGGER test_reject_complete_request BEFORE UPDATE ON agent_interaction_requests FOR EACH ROW EXECUTE FUNCTION test_reject_complete_request()`,
      );
      try {
        const input = { ...f.input, kind: "delegate" };
        assert.equal((await f.send(input)).data.deliveryState, "unconfirmed");
        assert.equal(
          (
            await db
              .select()
              .from(tasksTable)
              .where(eq(tasksTable.ownerAgentId, f.agent.id))
          ).length,
          0,
        );
        await db.execute(
          sql`DROP TRIGGER test_reject_complete_request ON agent_interaction_requests`,
        );
        assert.equal((await f.send(input)).data.deliveryState, "unconfirmed");
        assert.equal(
          (
            await db
              .select()
              .from(tasksTable)
              .where(eq(tasksTable.ownerAgentId, f.agent.id))
          ).length,
          0,
        );
      } finally {
        await db.execute(
          sql`DROP TRIGGER IF EXISTS test_reject_complete_request ON agent_interaction_requests`,
        );
        await db.execute(sql`DROP FUNCTION test_reject_complete_request()`);
      }
    },
  );

  for (const effect of ["throw", "unknown", "deferred"] as const) {
    await t.test(
      `${effect} tool effect is not repeated by send recovery`,
      async (child) => {
        let tools = 0,
          providers = 0;
        const f = await fixture(child, (agent, content, model, task, deps) =>
          runAgentTurn(agent, content, model, task, {
            ...deps!,
            createCompletion: async (params) => {
              providers++;
              const response = await reply(params);
              response.completion.choices[0]!.message.tool_calls = [
                {
                  type: "function",
                  id: "one-effect",
                  function: {
                    name: "log_note",
                    arguments: '{"summary":"Synthetic test"}',
                  },
                },
              ];
              return response;
            },
            runTool: async () => {
              tools++;
              if (effect === "throw")
                throw new Error("Synthetic failure after effect");
              return {
                content: "Synthetic effect record",
                createdTasks: [],
                createdAgents: [],
                toolOutcome: effect,
                receiptId: "test-effect-receipt",
              };
            },
          }),
        );
        const first = await f.send();
        const replay = await f.send();
        assert.equal(
          first.data.deliveryState,
          effect === "throw" ? "unconfirmed" : "complete",
        );
        assert.equal(
          first.data.outcome,
          effect === "throw"
            ? "unconfirmed"
            : effect === "unknown"
              ? "tool_outcome_unknown"
              : "tool_deferred",
        );
        assert.equal(replay.data.outcome, first.data.outcome);
        if (effect !== "throw") {
          assert.equal(first.data.agentMessage.role, "system");
          assert.match(first.data.agentMessage.content, /test-effect-receipt/);
        }
        assert.equal(tools, 1);
        assert.equal(providers, 1);
      },
    );
  }

  await t.test(
    "all seven locales bind the model prompt and store failures as system notices",
    async (child) => {
      const seen: string[] = [];
      const f = await fixture(child, (agent, content, model, task, deps) =>
        runAgentTurn(agent, content, model, task, {
          ...deps!,
          createCompletion: async (params) => {
            seen.push(String(params.messages[0]?.content));
            throw new Error("Synthetic provider failure, no network");
          },
        }),
      );
      const notices = new Set<string>();
      for (const locale of WORKSPACE_LOCALES) {
        const result = await f.send({
          ...f.input,
          requestId: randomUUID(),
          locale,
        });
        assert.equal(result.data.deliveryState, "complete");
        assert.equal(result.data.outcome, "provider_error");
        assert.equal(result.data.agentMessage.role, "system");
        assert.equal(result.data.usedModel, null);
        assert.equal(result.data.usedProvider, null);
        assert.match(seen.at(-1)!, new RegExp(`locale="${locale}"`));
        assert.doesNotMatch(
          result.data.agentMessage.content,
          /Synthetic provider failure/,
        );
        notices.add(result.data.agentMessage.content);
      }
      assert.equal(notices.size, 7);
    },
  );

  await t.test(
    "claim uses current permissions and prompt; admission record and lease roll back together",
    async (child) => {
      const f = await fixture(child);
      await db
        .update(agentsTable)
        .set({
          systemPrompt: "Fresh reviewed prompt",
          permissions: {
            ...f.agent.permissions,
            canUseTerminal: false,
            canBrowse: false,
          },
        })
        .where(eq(agentsTable.id, f.agent.id));
      await runAgentTurn(
        f.agent,
        "Check current configuration",
        undefined,
        undefined,
        {
          runtimeHandle: runtime,
          locale: "en",
          createCompletion: async (params) => {
            assert.match(
              String(params.messages[0]?.content),
              /Fresh reviewed prompt/,
            );
            assert.ok(
              !params.tools?.some(
                (tool) =>
                  "function" in tool && tool.function.name === "vm_run_command",
              ),
            );
            return reply(params);
          },
        },
      );
      const before = await db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.agentId, f.agent.id));
      await assert.rejects(
        runAgentTurn(f.agent, "Must roll back", undefined, undefined, {
          runtimeHandle: runtime,
          onAccepted: async () => {
            throw new Error("Admission receipt failed");
          },
          createCompletion: async () => {
            throw new Error("Provider must not run");
          },
        }),
        /Admission receipt failed/,
      );
      assert.equal(
        (
          await db
            .select()
            .from(messagesTable)
            .where(eq(messagesTable.agentId, f.agent.id))
        ).length,
        before.length,
      );
      const [owner] = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, f.agent.id));
      assert.equal(owner?.runLeaseOwner, null);
      await db
        .update(agentsTable)
        .set({
          runLeaseOwner: "expired-owner",
          runLeaseExpiresAt: new Date(Date.now() - 1000),
        })
        .where(eq(agentsTable.id, f.agent.id));
      await assert.rejects(
        runAgentTurn(f.agent, "Expire after provider", undefined, undefined, {
          runtimeHandle: runtime,
          createCompletion: async (params) => {
            await db
              .update(agentsTable)
              .set({ runLeaseExpiresAt: new Date(Date.now() - 1) })
              .where(eq(agentsTable.id, f.agent.id));
            return reply(params);
          },
        }),
        AgentBusyError,
      );
    },
  );
});
