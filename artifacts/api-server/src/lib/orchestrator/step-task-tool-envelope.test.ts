import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import type { createChatCompletion } from "@workspace/ai-server";
import {
  activityEventsTable,
  agentsTable,
  db,
  dbReady,
  closeDatabase,
  taskAttemptsTable,
  tasksTable,
  usageEventsTable,
} from "@workspace/db";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import { WORKSPACE_LOCALES } from "../workspace-locale";
import { registerRuntimeInstance } from "./runtime-instance-registry";
import { stepTask } from "./step-task";
import { executeTool } from "./execute-tool";
import { toolMessage } from "./tool-localization";
import type { ModelSelectionPlan } from "./model-select";

test.after(() => closeDatabase());
const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
const plan = (): ModelSelectionPlan => {
  const primary = {
    provider: "replit",
    modelId: "gpt-5.6-sol",
    usedFallback: false,
    source: "agent_pin" as const,
    tier: "economy" as const,
  };
  return { primary, routes: [primary], freeOnly: false };
};
async function fixture(t: TestContext) {
  await dbReady;
  const runtime = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    config,
  );
  t.after(() => runtime.stopHeartbeat());
  const leaseOwner = `task:tool-envelope:${randomUUID()}`;
  const leaseExpiresAt = new Date(Date.now() + 15 * 60_000);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Controlled tool envelope owner",
      role: "Fixture",
      systemPrompt: "Fixture only",
      modelMode: "manual",
      modelId: "gpt-5.6-sol",
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: leaseExpiresAt,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Respect the advertised tools",
      brief: "Record one reviewed note and finish this task.",
      ownerAgentId: agent.id,
      status: "in_progress",
      leaseOwner,
      leaseExpiresAt,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, agent.id));
  const runtimeAttemptId = randomUUID(),
    logicalExecutionId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: runtimeAttemptId,
    taskId: task.id,
    agentId: agent.id,
    workerInstanceId: runtime.id,
    leaseOwner,
    attemptNumber: 1,
    cycleNumber: 0,
    state: "claimed",
    logicalExecutionId,
  });
  return {
    task: {
      ...task,
      leaseOwner,
      runtimeAttemptId,
      runtimeInstanceId: runtime.id,
      logicalExecutionId,
    },
    agent,
  };
}
const call = (name: string, args: object, suffix = "") => ({
  id: `${name}-${suffix || randomUUID()}`,
  type: "function" as const,
  function: { name, arguments: JSON.stringify(args) },
});

for (const locale of WORKSPACE_LOCALES) {
  for (const local of [false, true]) {
    test(`${locale}: ${local ? "local" : "remote"} first truncated response pauses without dispatch or an identical retry`, async (t) => {
      const f = await fixture(t);
      let calls = 0,
        dispatches = 0;
      await stepTask(f.task, {
        locale,
        runtimeOperationsConfig: config,
        selectModelPlan: () => {
          const primary = local
            ? {
                ...plan().primary,
                provider: "ollama",
                modelId: "ollama:owned-small:latest",
              }
            : plan().primary;
          return { primary, routes: [primary], freeOnly: local };
        },
        createCompletion: async (params) => {
          await params.beforeRequest?.();
          calls++;
          return {
            provider: local ? "ollama" : "replit",
            completion: {
              id: randomUUID(),
              object: "chat.completion",
              created: 1,
              model: params.model,
              choices: [
                {
                  index: 0,
                  finish_reason: "length",
                  logprobs: null,
                  message: {
                    role: "assistant",
                    content: null,
                    refusal: null,
                    tool_calls: [
                      call("complete_task", {
                        resultSummary: "Must not certify",
                      }),
                    ],
                  },
                },
              ],
              usage: {
                prompt_tokens: 11,
                completion_tokens: 3,
                total_tokens: 14,
              },
            },
          };
        },
        runTool: async () => {
          dispatches++;
          throw new Error("Incomplete response must never dispatch");
        },
      });
      assert.equal(calls, 1);
      assert.equal(dispatches, 0);
      const [task] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, f.task.id));
      const [attempt] = await db
        .select()
        .from(taskAttemptsTable)
        .where(eq(taskAttemptsTable.id, f.task.runtimeAttemptId));
      assert.equal(task.status, "blocked");
      assert.equal(task.blockedReason, "runtime_failure");
      assert.equal(task.resultSummary, null);
      assert.equal(task.nextAttemptAt, null);
      assert.equal(task.tokensUsed, 14);
      assert.equal(attempt.state, "blocked");
      assert.equal(attempt.failureKind, "model_response_incomplete");
      assert.equal(
        task.lastError,
        toolMessage(
          locale,
          local
            ? "taskResponseIncompleteLocal"
            : "taskResponseIncompleteRemote",
        ),
      );
      const receipts = await db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.taskId, f.task.id));
      assert.equal(receipts.length, 1);
      assert.equal(receipts[0]!.totalTokens, 14);
    });
  }
}

for (const locale of WORKSPACE_LOCALES) {
  test(`${locale}: the task outcome is sent in the recent user message below unchanged policy`, async (t) => {
    const f = await fixture(t);
    let sent: Parameters<typeof createChatCompletion>[0]["messages"] = [];
    let calls = 0;
    const createCompletion: typeof createChatCompletion = async (params) => {
      await params.beforeRequest?.();
      calls++;
      sent = structuredClone(params.messages);
      return {
        provider: "replit",
        completion: {
          id: randomUUID(),
          object: "chat.completion",
          created: 1,
          model: params.model,
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              logprobs: null,
              message: {
                role: "assistant",
                content: null,
                refusal: null,
                tool_calls: [
                  call("complete_task", {
                    resultSummary: "Controlled prompt delivery",
                  }),
                ],
              },
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
        },
      };
    };
    const runTool: typeof executeTool = async (_ctx, name) => {
      assert.equal(name, "complete_task");
      return {
        content: "Controlled fixture completion",
        createdTasks: [],
        createdAgents: [],
        toolOutcome: "succeeded",
        durableTaskLifecycleIntent: {
          kind: "complete",
          resultSummary: "Controlled prompt delivery",
          continuous: false,
          cycleCompletedAt: new Date(),
          nextRunAt: null,
          judgeVerdict: "pass",
        },
      };
    };
    await stepTask(f.task, {
      locale,
      runtimeOperationsConfig: config,
      createCompletion,
      runTool,
      selectModelPlan: plan,
    });
    assert.equal(
      calls,
      1,
      "presenting the task must not add an inference call",
    );
    assert.deepEqual(
      sent.map((m) => m.role),
      ["system", "user"],
    );
    const system = String(sent[0].content),
      user = String(sent[1].content);
    assert.ok(
      user.includes(f.task.brief),
      "the exact task brief belongs in the recent user message",
    );
    assert.ok(user.includes('<task_context trust="untrusted-data">'));
    assert.ok(
      !system.includes(f.task.brief),
      "do not duplicate the task brief in the system prefix",
    );
    assert.ok(!system.includes("<task_context"));
    assert.ok(system.includes("<instruction_hierarchy>"));
    assert.ok(system.includes("<safety_and_approvals>"));
    assert.ok(
      system.includes(f.agent.systemPrompt),
      "custom expertise must remain intact",
    );
    const [durable] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, f.task.id));
    assert.equal(durable.status, "completed");
    const usage = await db
      .select()
      .from(usageEventsTable)
      .where(eq(usageEventsTable.taskId, f.task.id));
    assert.equal(
      usage.reduce((sum, row) => sum + row.totalTokens, 0),
      14,
    );
  });
}

for (const locale of WORKSPACE_LOCALES) {
  test(`${locale}: every recovery and tool round appends history after one exact task context`, async (t) => {
    const f = await fixture(t);
    const brief =
      "Use calculate for 17 × 23, report 391, then complete this one task. Do not delegate, create agents, browse or write files.";
    await db
      .update(tasksTable)
      .set({ brief })
      .where(eq(tasksTable.id, f.task.id));
    f.task.brief = brief;
    const previousRounds = process.env.MAX_AGENT_TOOL_ROUNDS;
    process.env.MAX_AGENT_TOOL_ROUNDS = "4";
    t.after(() => {
      if (previousRounds === undefined)
        delete process.env.MAX_AGENT_TOOL_ROUNDS;
      else process.env.MAX_AGENT_TOOL_ROUNDS = previousRounds;
    });
    const requests: Parameters<typeof createChatCompletion>[0]["messages"][] =
      [];
    const executions: string[] = [];
    await stepTask(f.task, {
      locale,
      runtimeOperationsConfig: config,
      selectModelPlan: plan,
      createCompletion: async (params) => {
        await params.beforeRequest?.();
        requests.push(structuredClone(params.messages));
        const round = requests.length;
        const tools =
          round === 1
            ? [call("load_tools_names", { names: ["calculate"] })]
            : round === 2
              ? [call("calculate", { operation: "multiply", values: [17, 23] })]
              : round === 3
                ? []
                : [call("complete_task", { resultSummary: "17 × 23 = 391" })];
        return {
          provider: "replit",
          completion: {
            id: randomUUID(),
            object: "chat.completion",
            created: 1,
            model: params.model,
            choices: [
              {
                index: 0,
                finish_reason: tools.length ? "tool_calls" : "stop",
                logprobs: null,
                message: {
                  role: "assistant",
                  content: round === 3 ? "The calculation returned 391." : null,
                  refusal: null,
                  ...(tools.length ? { tool_calls: tools } : {}),
                },
              },
            ],
            usage: {
              prompt_tokens: 11,
              completion_tokens: 3,
              total_tokens: 14,
            },
          },
        };
      },
      runTool: async (ctx, name, ...args) => {
        executions.push(name);
        if (name === "calculate") return executeTool(ctx, name, ...args);
        assert.equal(name, "complete_task");
        return {
          content: "Controlled fixture completion",
          createdTasks: [],
          createdAgents: [],
          toolOutcome: "succeeded",
          durableTaskLifecycleIntent: {
            kind: "complete",
            resultSummary: "17 × 23 = 391",
            continuous: false,
            cycleCompletedAt: new Date(),
            nextRunAt: null,
            judgeVerdict: "pass",
          },
        };
      },
    });
    assert.equal(
      requests.length,
      4,
      "recovery must retain the original four-round limit",
    );
    assert.deepEqual(executions, ["calculate", "complete_task"]);
    const originalTaskMessage = String(requests[0][1].content);
    const originalContext = originalTaskMessage.match(
      /<task_context trust="untrusted-data">[\s\S]*?<\/task_context>/,
    )?.[0];
    assert.ok(originalContext);
    assert.ok(originalContext.includes(brief));
    for (const [index, request] of requests.entries()) {
      assert.deepEqual(
        request[0],
        requests[0][0],
        "policy and custom expertise must be unchanged",
      );
      assert.deepEqual(
        request[1],
        requests[0][1],
        `round ${index + 1}: preserve the exact task before its history`,
      );
      if (index > 0) {
        const previous = requests[index - 1];
        assert.deepEqual(
          request.slice(0, previous.length),
          previous,
          `round ${index + 1}: append real results and recovery without replaying the task`,
        );
      }
      assert.equal(
        request
          .map((message) => String(message.content))
          .join("\n")
          .split(originalContext).length - 1,
        1,
        `round ${index + 1}: do not duplicate task context or increase its token cost`,
      );
    }
    const blockedResult = requests[1].find(
      (message) => message.role === "tool",
    );
    assert.ok(
      String(blockedResult?.content).includes(
        toolMessage(locale, "toolSchemaUnavailable", {
          tool: "load_tools_names",
        }),
      ),
    );
    assert.ok(
      requests[2].some(
        (message) =>
          message.role === "tool" && String(message.content).includes("391"),
      ),
      "moving task context must retain the real calculate output",
    );
    assert.ok(
      requests[3].some(
        (message) =>
          message.role === "assistant" &&
          message.content === "The calculation returned 391.",
      ),
    );
    assert.ok(
      requests[3].some(
        (message) =>
          message.role === "user" &&
          message.content === toolMessage(locale, "taskOpenInstruction"),
      ),
      "the localized passive-response correction must survive",
    );
    const [durable] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, f.task.id));
    assert.equal(durable.status, "completed");
    assert.equal(durable.resultSummary, "17 × 23 = 391");
    const usage = await db
      .select()
      .from(usageEventsTable)
      .where(eq(usageEventsTable.taskId, f.task.id));
    assert.equal(usage.length, 4);
    assert.equal(
      usage.reduce((sum, row) => sum + row.totalTokens, 0),
      56,
    );
  });
}

for (const locale of WORKSPACE_LOCALES) {
  for (const autonomyMode of ["finite", "continuous"] as const) {
    for (const scenario of ["recover_once", "pause_after_retry"] as const) {
      test(`${locale}: ${autonomyMode} ${scenario} never executes a truncated call and retains tool evidence`, async (t) => {
        const f = await fixture(t);
        await db
          .update(tasksTable)
          .set({
            autonomyMode,
            cadenceSeconds: autonomyMode === "continuous" ? 60 : null,
          })
          .where(eq(tasksTable.id, f.task.id));
        f.task.autonomyMode = autonomyMode;
        f.task.cadenceSeconds = autonomyMode === "continuous" ? 60 : null;
        const previousRounds = process.env.MAX_AGENT_TOOL_ROUNDS;
        process.env.MAX_AGENT_TOOL_ROUNDS = "4";
        t.after(() => {
          if (previousRounds === undefined)
            delete process.env.MAX_AGENT_TOOL_ROUNDS;
          else process.env.MAX_AGENT_TOOL_ROUNDS = previousRounds;
        });
        const requests: Parameters<
          typeof createChatCompletion
        >[0]["messages"][] = [];
        const executions: string[] = [];
        const localPlan = (): ModelSelectionPlan => {
          const local = {
            ...plan().primary,
            provider: "ollama",
            modelId: "ollama:owned-small:latest",
          };
          return { primary: local, routes: [local], freeOnly: true };
        };
        await stepTask(f.task, {
          locale,
          runtimeOperationsConfig: config,
          selectModelPlan: localPlan,
          createCompletion: async (params) => {
            await params.beforeRequest?.();
            requests.push(structuredClone(params.messages));
            const round = requests.length;
            const incomplete =
              round === 2 || (scenario === "pause_after_retry" && round >= 3);
            return {
              provider: "ollama",
              completion: {
                id: randomUUID(),
                object: "chat.completion",
                created: 1,
                model: params.model,
                choices: [
                  {
                    index: 0,
                    finish_reason: incomplete ? "length" : "tool_calls",
                    logprobs: null,
                    message: {
                      role: "assistant",
                      content:
                        round === 1
                          ? "UNVERIFIED MODEL NARRATION. ".repeat(120)
                          : null,
                      refusal: null,
                      tool_calls: [
                        round === 1
                          ? call("calculate", {
                              operation: "multiply",
                              values: [17, 23],
                            })
                          : call("complete_task", {
                              resultSummary: "17 × 23 = 391",
                            }),
                      ],
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 11,
                  completion_tokens: 3,
                  total_tokens: 14,
                },
              },
            };
          },
          runTool: async (ctx, name, ...args) => {
            executions.push(name);
            if (name === "calculate") return executeTool(ctx, name, ...args);
            assert.equal(name, "complete_task");
            return {
              content: "Controlled fixture completion",
              createdTasks: [],
              createdAgents: [],
              toolOutcome: "succeeded",
              durableTaskLifecycleIntent: {
                kind: "complete",
                resultSummary: "17 × 23 = 391",
                continuous: autonomyMode === "continuous",
                cycleCompletedAt: new Date(),
                nextRunAt:
                  autonomyMode === "continuous"
                    ? new Date(Date.now() + 60_000)
                    : null,
                judgeVerdict: "pass",
              },
            };
          },
        });
        assert.equal(
          requests.length,
          3,
          "one changed-payload recovery, never an identical or unbounded retry",
        );
        assert.deepEqual(
          executions,
          scenario === "recover_once"
            ? ["calculate", "complete_task"]
            : ["calculate"],
        );
        assert.deepEqual(
          requests[2][0],
          requests[0][0],
          "policy and custom expertise stay exact",
        );
        assert.deepEqual(
          requests[2][1],
          requests[0][1],
          "the complete original owner task stays before compacted history",
        );
        const beforeCalculation = requests[1].find(
          (message) => message.role === "tool",
        );
        assert.ok(String(beforeCalculation?.content).includes("391"));
        assert.deepEqual(
          requests[2].find((message) => message.role === "tool"),
          beforeCalculation,
          "actual tool result and its call id survive compaction",
        );
        const beforeCall = requests[1].find(
          (message) =>
            message.role === "assistant" && message.tool_calls?.length,
        );
        const afterCall = requests[2].find(
          (message) =>
            message.role === "assistant" && message.tool_calls?.length,
        );
        assert.ok(
          beforeCall?.role === "assistant" && afterCall?.role === "assistant",
        );
        assert.deepEqual(
          afterCall.tool_calls,
          beforeCall.tool_calls,
          "tool arguments and ids survive",
        );
        assert.ok(
          !requests[2].some((message) =>
            String(message.content).includes("UNVERIFIED MODEL NARRATION"),
          ),
        );
        const [durable] = await db
          .select()
          .from(tasksTable)
          .where(eq(tasksTable.id, f.task.id));
        const [attempt] = await db
          .select()
          .from(taskAttemptsTable)
          .where(eq(taskAttemptsTable.id, f.task.runtimeAttemptId));
        const usage = await db
          .select()
          .from(usageEventsTable)
          .where(eq(usageEventsTable.taskId, f.task.id));
        assert.equal(usage.length, 3);
        assert.equal(
          usage.reduce((sum, row) => sum + row.totalTokens, 0),
          42,
        );
        assert.equal(durable.tokensUsed, 42);
        assert.equal(durable.autonomyMode, autonomyMode);
        assert.equal(
          durable.cadenceSeconds,
          autonomyMode === "continuous" ? 60 : null,
        );
        if (scenario === "pause_after_retry") {
          assert.equal(durable.status, "blocked");
          assert.equal(durable.resultSummary, null);
          assert.equal(durable.cycleCount, 0);
          assert.equal(durable.nextAttemptAt, null);
          assert.equal(attempt.state, "blocked");
          assert.ok(durable.lastError);
        } else {
          assert.equal(
            durable.status,
            autonomyMode === "continuous" ? "in_progress" : "completed",
          );
          assert.equal(
            durable.cycleCount,
            autonomyMode === "continuous" ? 1 : 0,
          );
          assert.equal(durable.resultSummary, "17 × 23 = 391");
        }
      });
    }
  }
}

for (const locale of WORKSPACE_LOCALES) {
  for (const scenario of ["not_loaded", "loaded_in_same_response"] as const) {
    test(`${locale}: ${scenario} cannot execute an optional tool until a later advertised request`, async (t) => {
      const f = await fixture(t);
      const previousRounds = process.env.MAX_AGENT_TOOL_ROUNDS;
      process.env.MAX_AGENT_TOOL_ROUNDS = "4";
      t.after(() => {
        if (previousRounds === undefined)
          delete process.env.MAX_AGENT_TOOL_ROUNDS;
        else process.env.MAX_AGENT_TOOL_ROUNDS = previousRounds;
      });
      let calls = 0;
      const executions: { name: string; round: number }[] = [];
      const envelopes: string[][] = [];
      const corrections: string[] = [];
      const createCompletion: typeof createChatCompletion = async (params) => {
        await params.beforeRequest?.();
        calls++;
        envelopes.push((params.tools ?? []).map((tool) => tool.function.name));
        corrections.push(
          ...params.messages
            .filter((m) => m.role === "tool")
            .map((m) => String(m.content)),
        );
        const tools =
          calls === 1
            ? [
                ...(scenario === "loaded_in_same_response"
                  ? [call("load_tools", { names: ["log_note"] })]
                  : []),
                call("log_note", { summary: "must not run yet" }),
              ]
            : calls === 2 && scenario === "not_loaded"
              ? [call("load_tools", { names: ["log_note"] })]
              : calls === (scenario === "not_loaded" ? 3 : 2)
                ? [
                    call("log_note", { summary: "reviewed note" }),
                    call("complete_task", {
                      resultSummary: "Controlled result",
                    }),
                  ]
                : [
                    call("complete_task", {
                      resultSummary: "Controlled result",
                    }),
                  ];
        return {
          provider: "replit",
          completion: {
            id: `controlled-${randomUUID()}`,
            object: "chat.completion",
            created: 1,
            model: params.model,
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                logprobs: null,
                message: {
                  role: "assistant",
                  content: null,
                  refusal: null,
                  tool_calls: tools,
                },
              },
            ],
            usage: {
              prompt_tokens: 11,
              completion_tokens: 3,
              total_tokens: 14,
            },
          },
        };
      };
      const runTool: typeof executeTool = async (_ctx, name) => {
        executions.push({ name, round: calls });
        return {
          content: "Controlled fixture output",
          createdTasks: [],
          createdAgents: [],
          toolOutcome: "succeeded",
          ...(name === "complete_task"
            ? {
                durableTaskLifecycleIntent: {
                  kind: "complete",
                  resultSummary: "Controlled result",
                  continuous: false,
                  cycleCompletedAt: new Date(),
                  nextRunAt: null,
                  judgeVerdict: "pass",
                },
              }
            : {}),
        };
      };
      await stepTask(f.task, {
        locale,
        runtimeOperationsConfig: config,
        createCompletion,
        runTool,
        selectModelPlan: plan,
      });
      const allowedRound = scenario === "not_loaded" ? 3 : 2;
      assert.deepEqual(executions, [
        { name: "log_note", round: allowedRound },
        { name: "complete_task", round: allowedRound },
      ]);
      assert.equal(
        calls,
        allowedRound,
        "recovery must stay within the original four rounds",
      );
      assert.deepEqual(envelopes[0], [
        "calculate",
        "complete_task",
        "load_tools",
      ]);
      assert.ok(envelopes[allowedRound - 1].includes("log_note"));
      const events = await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.taskId, f.task.id));
      const blocked = events.filter(
        (e) => e.detail?.runtimeEvent === "tool_call_not_advertised",
      );
      assert.equal(blocked.length, 1);
      assert.equal(blocked[0].detail?.guard, "model_request_tool_schema");
      assert.equal(blocked[0].detail?.blockedTool, "log_note");
      assert.deepEqual(blocked[0].detail?.advertisedTools, envelopes[0]);
      assert.equal(
        blocked[0].summary,
        toolMessage(locale, "toolSchemaUnavailable", { tool: "log_note" }),
      );
      assert.ok(
        corrections.some((content) => content.includes(blocked[0].summary)),
      );
      const [persisted] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, f.task.id));
      assert.equal(persisted.status, "completed");
      const usage = await db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.taskId, f.task.id));
      assert.equal(usage.length, calls);
      assert.equal(
        usage.reduce((sum, u) => sum + u.totalTokens, 0),
        calls * 14,
      );
      assert.ok(usage.every((u) => u.usageReported === true));
    });
  }
}

test("unknown model tools cause bounded recovery with no dispatch and retain every reported token", async (t) => {
  const f = await fixture(t);
  let calls = 0,
    dispatches = 0;
  await stepTask(f.task, {
    locale: "en",
    runtimeOperationsConfig: config,
    selectModelPlan: plan,
    createCompletion: async (params) => {
      await params.beforeRequest?.();
      calls++;
      return {
        provider: "replit",
        completion: {
          id: randomUUID(),
          object: "chat.completion",
          created: 1,
          model: params.model,
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              logprobs: null,
              message: {
                role: "assistant",
                content: null,
                refusal: null,
                tool_calls: [call("not_an_authorized_tool", {})],
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        },
      };
    },
    runTool: async () => {
      dispatches++;
      return {
        content: "Must not execute",
        createdTasks: [],
        createdAgents: [],
        toolOutcome: "succeeded",
      };
    },
  });
  assert.equal(calls, 2);
  assert.equal(dispatches, 0);
  const [persisted] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, f.task.id));
  assert.equal(persisted.status, "in_progress");
  assert.equal(persisted.consecutiveFailures, 1);
  assert.ok(persisted.nextAttemptAt);
  assert.match(persisted.lastError ?? "", /tool_compatibility/u);
  const events = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.taskId, f.task.id));
  assert.equal(
    events.filter((e) => e.detail?.runtimeEvent === "tool_call_not_advertised")
      .length,
    2,
  );
  const usage = await db
    .select()
    .from(usageEventsTable)
    .where(eq(usageEventsTable.taskId, f.task.id));
  assert.equal(usage.length, 2);
  assert.equal(
    usage.reduce((sum, u) => sum + u.totalTokens, 0),
    14,
  );
});
