import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import type { createChatCompletion } from "@workspace/ai-server";
import type { ModelRouteCandidate } from "./model-select";
import type { StepTaskDependencies } from "./step-task";
import type { RunAgentTurnDependencies } from "./run-agent-turn";
import { WORKSPACE_LOCALES } from "../workspace-locale";
import { getToolCopy, toolMessage } from "./tool-localization";
import { terminalMessage } from "../vm/terminal-localization";

delete process.env.DATABASE_URL;
delete process.env.RUNTIME_ROLE;
process.env.NODE_ENV = "test";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
process.env.MODEL_RETRY_ATTEMPTS_PER_ROUTE = "1";
process.env.MODEL_RETRY_BASE_DELAY_MS = "0";
process.env.MAX_AGENT_TOOL_ROUNDS = "4";
const {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  taskAttemptsTable,
  activityEventsTable,
  operationReceiptsTable,
} = await import("@workspace/db");
const { registerRuntimeInstance } = await import("./runtime-instance-registry");
const { readRuntimeOperationsConfig } =
  await import("../runtime-operations-config");
const { runAgentTurn } = await import("./run-agent-turn");
const { stepTask } = await import("./step-task");
const { executeTool, heartbeatJudgeTaskLease } = await import("./execute-tool");
const { specialistPermissionsPreset } = await import("./permission-presets");
const { deriveExclusiveTurnPolicy } = await import("./exclusive-turn-policy");
await dbReady;
const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "combined" });
const runtime = await registerRuntimeInstance(
  {
    role: "combined",
    schedulerEnabled: true,
    capabilities: { http: true, scheduler: true },
  },
  config,
);
test.after(async () => {
  runtime.stopHeartbeat();
  await closeDatabase();
});

const routes: ModelRouteCandidate[] = [
  "primary-{model}-$&",
  "fallback-原文",
].map((modelId, i) => ({
  modelId,
  provider: "replit",
  usedFallback: i > 0,
  source: i ? "fallback" : "automatic",
  tier: "economy",
}));
const plan = () => ({ primary: routes[0], routes, freeOnly: false });
const question = "  Original {model} $&\n\n  العربية 原文\t  ";
function reply(
  model: string,
): Awaited<ReturnType<typeof createChatCompletion>> {
  return {
    provider: "replit",
    completion: {
      id: randomUUID(),
      object: "chat.completion",
      created: 1,
      model,
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
              {
                id: randomUUID(),
                type: "function",
                function: {
                  name: "request_user_input",
                  arguments: JSON.stringify({ question }),
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  };
}
async function fixture(
  mode: "chat" | "task" = "task",
  failures = 0,
  active = true,
) {
  const leaseOwner = `status:${randomUUID()}`;
  const expires = new Date(Date.now() + 120_000);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Source 原文 {model} $&",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      permissions: specialistPermissionsPreset,
      isActive: active,
      ...(mode === "task"
        ? {
            status: "working" as const,
            runLeaseOwner: leaseOwner,
            runLeaseExpiresAt: expires,
          }
        : {}),
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Source task",
      brief: "Inspect safely",
      ownerAgentId: agent.id,
      status: "in_progress",
      createdByUser: true,
      consecutiveFailures: failures,
      ...(mode === "task" ? { leaseOwner, leaseExpiresAt: expires } : {}),
    })
    .returning();
  const runtimeAttemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  if (mode === "task") {
    await db
      .update(agentsTable)
      .set({ currentTaskId: task.id })
      .where(eq(agentsTable.id, agent.id));
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
  }
  return {
    agent,
    task: {
      ...task,
      leaseOwner,
      runtimeAttemptId,
      logicalExecutionId,
      runtimeInstanceId: runtime.id,
    },
  };
}

for (const locale of WORKSPACE_LOCALES) {
  test(`${locale}: chat captures language before acceptance and localizes initial and planning status`, async () => {
    const { agent } = await fixture("chat");
    let initial: string | null = null;
    let planning: string | null = null;
    let prompt = "";
    const deps: RunAgentTurnDependencies = {
      locale,
      runtimeHandle: runtime,
      onAccepted: async (tx) => {
        const [live] = await tx
          .select()
          .from(agentsTable)
          .where(eq(agentsTable.id, agent.id));
        initial = live.currentAction;
        deps.locale = locale === "ar" ? "en" : "ar";
      },
      createCompletion: async (params) => {
        const [live] = await db
          .select()
          .from(agentsTable)
          .where(eq(agentsTable.id, agent.id));
        planning = live.currentAction;
        prompt = String(params.messages[0].content);
        throw Object.assign(new Error("private upstream detail"), {
          status: 401,
        });
      },
    };
    const result = await runAgentTurn(
      agent,
      "source",
      undefined,
      undefined,
      deps,
    );
    assert.equal(initial, getToolCopy(locale).chatAnalyzing);
    assert.match(planning!, new RegExp("1/\\d+"));
    assert.equal(
      planning!.split("1/")[0],
      toolMessage(locale, "chatPlanning", { round: 1, total: 1 }).split(
        "1/",
      )[0],
    );
    assert.ok(prompt.includes(`<workspace_language locale="${locale}">`));
    assert.equal(result.outcome, "provider_error");
    assert.ok(!result.agentMessage.content.includes("private upstream detail"));
    const [released] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, agent.id));
    assert.equal(released.runLeaseOwner, null);
  });

  test(`${locale}: model fallback retains first status language and source after a preference change`, async () => {
    const { agent, task } = await fixture();
    let initial: Promise<string | null> | undefined;
    const actions: Array<string | null> = [];
    const models: string[] = [];
    const deps: StepTaskDependencies = {
      locale,
      runtimeOperationsConfig: config,
      selectModelPlan: plan,
      afterInitialLeaseHeartbeat: () => {
        initial = db
          .select()
          .from(agentsTable)
          .where(eq(agentsTable.id, agent.id))
          .then(([live]) => live.currentAction);
        deps.locale = locale === "ar" ? "en" : "ar";
      },
      createCompletion: async (params) => {
        models.push(params.model);
        const [live] = await db
          .select()
          .from(agentsTable)
          .where(eq(agentsTable.id, agent.id));
        actions.push(live.currentAction);
        if (params.model === routes[0].modelId)
          throw Object.assign(new Error("private upstream detail"), {
            status: 401,
          });
        await params.beforeRequest?.();
        return reply(params.model);
      },
    };
    await stepTask(task, deps);
    assert.equal(await initial, getToolCopy(locale).taskAnalyzing);
    assert.deepEqual(
      models,
      routes.map((route) => route.modelId),
    );
    assert.deepEqual(
      actions,
      models.map((model) => toolMessage(locale, "taskModelRunning", { model })),
    );
    const [saved] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    assert.equal(saved.status, "blocked");
    assert.equal(saved.blockedReason, "user_input");
    assert.equal(saved.userInputQuestion, question);
    assert.equal(saved.lastError, getToolCopy(locale).teamInputWaiting);
    assert.equal(saved.modelFallbackCount, 1);
    assert.equal(saved.leaseOwner, null);
    const events = await db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, task.id));
    assert.equal(
      events.find(
        (event) => event.detail?.runtimeEvent === "model_route_failed",
      )?.summary,
      toolMessage(locale, "modelRouteFailed", { model: routes[1].modelId }),
    );
    assert.equal(
      events.find(
        (event) => event.detail?.runtimeEvent === "model_fallback_activated",
      )?.summary,
      toolMessage(locale, "modelFallback", { model: routes[1].modelId }),
    );
    const receipts = await db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.taskId, task.id));
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].state, "succeeded");
    assert.equal(receipts[0].resultData?.executionLocale, locale);
  });

  for (const [status, key, kind] of [
    [429, "failureRateLimit", "rate_limit"],
    [408, "failureTimeout", "timeout"],
    [401, "failureAuthentication", "authentication"],
    [402, "failurePayment", "payment_required"],
    [404, "failureModelUnavailable", "model_unavailable"],
    [422, "failureToolCompatibility", "tool_compatibility"],
    [503, "failureProviderUnavailable", "provider_unavailable"],
  ] as const) {
    test(`${locale}: exhausted ${kind} remains queued with localized evidence and exact machine identity`, async () => {
      const { task } = await fixture();
      let calls = 0;
      await stepTask(task, {
        locale,
        runtimeOperationsConfig: config,
        selectModelPlan: plan,
        createCompletion: async () => {
          calls++;
          throw Object.assign(
            new Error("unsupported private upstream detail"),
            { status },
          );
        },
      });
      const [saved] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, task.id));
      assert.equal(calls, 2);
      assert.equal(saved.status, "in_progress");
      assert.equal(saved.consecutiveFailures, 1);
      assert.ok(saved.nextAttemptAt);
      assert.equal(saved.leaseOwner, null);
      const expected = routes
        .map((route) =>
          toolMessage(locale, "modelFailure", {
            reason: getToolCopy(locale)[key],
            source: `${route.provider}/${route.modelId}: ${kind}`,
          }),
        )
        .join("; ");
      assert.equal(saved.lastError, expected);
      assert.ok(!saved.lastError.includes("private upstream detail"));
      const [attempt] = await db
        .select()
        .from(taskAttemptsTable)
        .where(eq(taskAttemptsTable.id, task.runtimeAttemptId));
      assert.equal(attempt.state, "retrying");
      assert.equal(attempt.failureKind, "model_routes_exhausted");
      assert.equal(attempt.sanitizedError, expected);
      const events = await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.taskId, task.id));
      const event = events.find(
        (row) => row.detail?.runtimeEvent === "task_retry_scheduled",
      );
      assert.equal(
        event?.summary,
        toolMessage(locale, "taskProviderRetry", {
          at: saved.nextAttemptAt.toISOString(),
        }),
      );
      assert.deepEqual(
        (event?.detail?.modelAttempts as Array<{ kind: string }>).map(
          (item) => item.kind,
        ),
        [kind, kind],
      );
    });
  }

  for (const blocked of [false, true]) {
    test(`${locale}: runtime ${blocked ? "circuit breaker" : "retry"} translates summaries without changing retry policy`, async () => {
      const { task } = await fixture("task", blocked ? 4 : 0);
      await stepTask(task, {
        locale,
        runtimeOperationsConfig: config,
        selectModelPlan: plan,
        createCompletion: async () => {
          throw null;
        },
      });
      const [saved] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, task.id));
      assert.equal(saved.lastError, getToolCopy(locale).taskUnknownError);
      assert.equal(saved.status, blocked ? "blocked" : "in_progress");
      assert.equal(saved.blockedReason, blocked ? "runtime_failure" : null);
      assert.equal(saved.nextAttemptAt === null, blocked);
      assert.equal(saved.leaseOwner, null);
      const events = await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.taskId, task.id));
      const event = events.find(
        (row) =>
          row.detail?.runtimeEvent ===
          (blocked
            ? "task_blocked_after_runtime_failures"
            : "task_retry_scheduled"),
      );
      assert.equal(
        event?.summary,
        blocked
          ? toolMessage(locale, "taskBlocked", { count: 5 })
          : toolMessage(locale, "taskRuntimeRetry", {
              at: saved.nextAttemptAt!.toISOString(),
            }),
      );
    });
  }

  test(`${locale}: inactive owner records localized failure without invoking a model`, async () => {
    const { task } = await fixture("task", 0, false);
    let calls = 0;
    await stepTask(task, {
      locale,
      runtimeOperationsConfig: config,
      createCompletion: async () => {
        calls++;
        throw new Error("must not call");
      },
    });
    assert.equal(calls, 0);
    const [saved] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    assert.equal(saved.status, "failed");
    assert.equal(saved.leaseOwner, null);
    const [attempt] = await db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, task.runtimeAttemptId));
    assert.equal(attempt.failureKind, "owner_inactive");
    assert.equal(attempt.sanitizedError, getToolCopy(locale).taskOwnerMissing);
    const events = await db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, task.id));
    assert.deepEqual(
      events.filter((row) => row.type === "error").map((row) => row.summary),
      [getToolCopy(locale).taskOwnerMissing],
    );
    assert.deepEqual(
      events
        .filter((row) => row.type === "operations_changed")
        .map((row) => row.detail?.kind),
      ["attempt_state_changed"],
    );
  });

  test(`${locale}: unsupported tools reject explicitly and scope/validation prose is localized`, async () => {
    const { agent } = await fixture("chat");
    const name = "unknown-{tool}-$&-原文";
    const ctx = { agent, taskId: null, locale };
    const unknown = await executeTool(ctx, name, "{}");
    assert.equal(unknown.toolOutcome, "rejected");
    assert.equal(
      unknown.content,
      toolMessage(locale, "toolUnknown", { tool: name }),
    );
    const malformed = await executeTool(ctx, name, "{");
    assert.equal(malformed.toolOutcome, "rejected");
    assert.equal(malformed.content, terminalMessage(locale, "invalidToolJson"));
    const policy = deriveExclusiveTurnPolicy("Only use files")!;
    assert.ok(policy);
    const scoped = await executeTool(
      { ...ctx, exclusiveTurnPolicy: policy },
      name,
      "{}",
    );
    assert.equal(scoped.toolOutcome, "rejected");
    assert.equal(
      scoped.content,
      terminalMessage(locale, "exclusiveTools", {
        toolName: name,
        tools: policy.allowedTools.join(", "),
      }),
    );
    const receipts = await db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.agentId, agent.id));
    assert.equal(receipts.length, 0);
  });
}

for (const locale of WORKSPACE_LOCALES) {
  test(`${locale}: authored judge heartbeat uses the captured execution language`, async () => {
    const { agent, task } = await fixture();
    let action: string | undefined;
    await heartbeatJudgeTaskLease({
      agent,
      taskId: task.id,
      taskLeaseOwner: task.leaseOwner,
      locale,
      assertTaskLease: async (value) => {
        action = value;
      },
    });
    assert.equal(action, getToolCopy(locale).judgeRunning);
  });

  for (const scenario of ["passive", "batch", "lifecycle", "tool"] as const) {
    test(`${locale}: authored model continuation ${scenario} retains the captured language`, async () => {
      const { task } = await fixture();
      process.env.MAX_AGENT_TOOL_CALLS_PER_ROUND = "4";
      let calls = 0;
      const sent: string[] = [];
      const original = "Original source {model} $& 原文";
      const deps: StepTaskDependencies = {
        locale,
        runtimeOperationsConfig: config,
        selectModelPlan: plan,
        createCompletion: async (params) => {
          await params.beforeRequest?.();
          sent.push(
            ...params.messages
              .filter((message) => message.role === "user")
              .map((message) => String(message.content)),
          );
          calls++;
          deps.locale = locale === "ar" ? "de" : "ar";
          const result = reply(params.model);
          const message = result.completion.choices[0].message;
          if (scenario === "passive" && calls <= 2) {
            message.tool_calls = [];
            message.content = original;
          }
          if (scenario === "batch" && calls === 1)
            message.tool_calls = Array.from({ length: 5 }, (_, i) => ({
              id: `batch-${i}`,
              type: "function" as const,
              function: {
                name: "log_note",
                arguments: '{"summary":"must not execute"}',
              },
            }));
          if (scenario === "tool" && calls <= 2)
            message.tool_calls = [
              {
                id: `bad-tool-${calls}`,
                type: "function",
                function: { name: "vm_read_file", arguments: "{" },
              },
            ];
          if (scenario === "lifecycle" && calls <= 2)
            message.tool_calls = [
              {
                id: `bad-${calls}`,
                type: "function",
                function: { name: "complete_task", arguments: "{" },
              },
            ];
          return result;
        },
      };
      await stepTask(task, deps);
      const c = getToolCopy(locale);
      const expected =
        scenario === "passive"
          ? [c.taskOpenInstruction, c.taskPassiveFallbackInstruction]
          : scenario === "tool"
            ? [c.taskToolRetryInstruction, c.taskToolFallbackInstruction]
            : scenario === "batch"
              ? [
                  toolMessage(locale, "taskBatchFallbackInstruction", {
                    count: 5,
                    limit: 4,
                  }),
                ]
              : [c.taskLifecycleFallbackInstruction];
      assert.ok(sent.includes(c.taskAdvanceInstruction), JSON.stringify(sent));
      for (const text of expected)
        assert.ok(sent.includes(text), JSON.stringify(sent));
      assert.equal(calls, scenario === "batch" ? 2 : 3);
      const receipts = await db
        .select()
        .from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.taskId, task.id));
      assert.equal(receipts.length, 1);
      assert.equal(receipts[0].resultData?.executionLocale, locale);
    });
  }
}

for (const locale of WORKSPACE_LOCALES) {
  for (const mode of ["chat", "task"] as const) {
    test(`${locale}: exclusive scope instruction reaches the ${mode} model in the captured language`, async () => {
      const { agent, task } = await fixture(mode);
      const source = "Only read files. Original {tools} $& 原文";
      const policy = deriveExclusiveTurnPolicy(source)!;
      assert.ok(policy);
      const expectedTools =
        mode === "task"
          ? [
              ...policy.allowedTools,
              "update_task_progress",
              "complete_task",
              "request_user_input",
            ]
          : policy.allowedTools;
      let prompt = "";
      let calls = 0;
      const createCompletion: typeof createChatCompletion = async (params) => {
        await params.beforeRequest?.();
        calls++;
        prompt = String(params.messages[0].content);
        assert.ok(
          JSON.stringify(params.messages).includes(
            mode === "chat" ? source : source.replaceAll("&", "&amp;"),
          ),
        );
        const response = reply(params.model);
        if (mode === "chat") {
          response.completion.choices[0].message.tool_calls = [];
          response.completion.choices[0].message.content =
            "Original answer 原文";
        }
        return response;
      };
      if (mode === "chat") {
        const deps: RunAgentTurnDependencies = {
          locale,
          runtimeHandle: runtime,
          createCompletion,
          onAccepted: async () => {
            deps.locale = locale === "en" ? "ar" : "en";
          },
        };
        await runAgentTurn(agent, source, undefined, undefined, deps);
      } else {
        await db
          .update(tasksTable)
          .set({ brief: source })
          .where(eq(tasksTable.id, task.id));
        const deps: StepTaskDependencies = {
          locale,
          runtimeOperationsConfig: config,
          selectModelPlan: plan,
          createCompletion,
          afterInitialLeaseHeartbeat: () => {
            deps.locale = locale === "en" ? "ar" : "en";
          },
        };
        await stepTask({ ...task, brief: source }, deps);
      }
      assert.equal(calls, 1);
      assert.ok(
        prompt.includes(
          toolMessage(locale, "exclusiveTurnInstruction", {
            tools: expectedTools.join(", "),
          }),
        ),
        prompt,
      );
      assert.ok(prompt.includes(expectedTools.join(", ")), prompt);
      assert.ok(
        prompt.includes('<turn_scope enforcement="server" mode="exclusive">'),
      );
    });
  }
}
