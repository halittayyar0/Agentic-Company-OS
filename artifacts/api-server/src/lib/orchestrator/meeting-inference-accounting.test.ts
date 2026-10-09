import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  companyChannelsTable,
  companyChannelMembersTable,
  companyMessagesTable,
  projectMeetingsTable,
  projectMeetingTranscriptTable,
  projectMeetingTurnRequestsTable,
  inferenceAttemptsTable,
  inferenceResponseEvidenceTable,
  usageEventsTable,
  activityEventsTable,
  messagesTable,
  taskAttemptsTable,
  operationReceiptsTable,
} from "@workspace/db";
import { runCompanyMeetingTurn } from "./run-company-meeting";
import { runProjectMeetingTurn } from "./run-project-meeting";
import { runJudge } from "./judge";
import { InferenceAccountingError } from "./inference-accounting";
import { runAgentTurn } from "./run-agent-turn";
import { stepTask } from "./step-task";
import { registerRuntimeInstance } from "./runtime-instance-registry";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";

// Real SDK + owned loopback transport. No external model or account is used.
let server: http.Server | undefined;
let respond: http.RequestListener;
const previousKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const previousUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
test.after(async () => {
  if (previousKey === undefined)
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = previousKey;
  if (previousUrl === undefined)
    delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = previousUrl;
  server?.closeAllConnections();
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  await closeDatabase();
});
const entries = [
  "company",
  "project",
  "completion",
  "approval",
  "chat",
  "task",
] as const;
type Entry = (typeof entries)[number];
type Fault =
  | "receipt_outage"
  | "lost_ack"
  | "unknown_usage"
  | "empty_receipt_outage"
  | "malformed_receipt_outage"
  | "late_owner"
  | "late_owner_receipt_outage";

async function fixture(t: test.TestContext, entry: Entry, fault: Fault) {
  await dbReady;
  let calls = 0;
  let ownershipLost = false;
  const primaryError = new Error("Owned late review ownership loss");
  let loseOwnership: () => Promise<void> = async () => {};
  respond = async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      model: string;
    };
    calls++;
    if (fault.startsWith("late_owner")) await loseOwnership();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: randomUUID(),
        object: "chat.completion",
        created: 1,
        model: payload.model,
        choices:
          fault === "empty_receipt_outage"
            ? []
            : fault === "malformed_receipt_outage"
              ? [{ index: 0, finish_reason: "stop", message: null }]
              : [
                  {
                    index: 0,
                    finish_reason: "stop",
                    message: {
                      role: "assistant",
                      ...(entry === "task"
                        ? {
                            tool_calls: [
                              {
                                id: randomUUID(),
                                type: "function",
                                function: {
                                  name: "request_user_input",
                                  arguments: JSON.stringify({
                                    question: "Owned question",
                                  }),
                                },
                              },
                            ],
                          }
                        : {}),
                      content:
                        entry === "completion" || entry === "approval"
                          ? JSON.stringify({
                              verdict: "pass",
                              reasoning: "Owned fixture",
                            })
                          : "Owned fixture answer",
                    },
                  },
                ],
        ...(fault === "unknown_usage"
          ? {}
          : {
              usage: {
                prompt_tokens: 2,
                completion_tokens: 3,
                total_tokens: 5,
              },
            }),
      }),
    );
  };
  if (!server) {
    server = http.createServer((request, response) =>
      respond(request, response),
    );
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
  }
  const address = server.address();
  assert.ok(address && typeof address === "object");
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "owned-loopback-only";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Owned ${entry} accounting`,
      role: "Fixture",
      systemPrompt: "Fixture",
      modelMode: "auto",
      createdByUser: true,
    })
    .returning();
  loseOwnership = async () => {
    ownershipLost = true;
    await db
      .update(agentsTable)
      .set({
        runLeaseOwner: "replacement-owner",
        runLeaseExpiresAt: new Date(Date.now() + 120_000),
      })
      .where(eq(agentsTable.id, agent.id));
  };
  let run: () => Promise<unknown>;
  let retry: (() => Promise<unknown>) | undefined;
  let published: () => Promise<number>;
  if (entry === "company") {
    const [channel] = await db
      .insert(companyChannelsTable)
      .values({ key: randomUUID(), name: "Owned room" })
      .returning();
    await db
      .insert(companyChannelMembersTable)
      .values({ channelId: channel.id, agentId: agent.id });
    const [founder] = await db
      .insert(companyMessagesTable)
      .values({
        channelId: channel.id,
        senderType: "founder",
        source: "operator",
        content: "Owned founder input",
      })
      .returning();
    run = () =>
      runCompanyMeetingTurn({
        agent,
        channelId: channel.id,
        founderMessageId: founder.id,
        founderContent: founder.content,
        locale: "en",
      });
    published = async () =>
      (
        await db
          .select()
          .from(companyMessagesTable)
          .where(eq(companyMessagesTable.senderAgentId, agent.id))
      ).length;
  } else if (entry === "project") {
    const [project] = await db
      .insert(tasksTable)
      .values({
        title: "Owned project",
        brief: "Fixture",
        ownerAgentId: agent.id,
        createdByUser: true,
      })
      .returning();
    const [meeting] = await db
      .insert(projectMeetingsTable)
      .values({
        taskId: project.id,
        title: "Owned meeting",
        status: "in_progress",
      })
      .returning();
    const fence = {
      requestId: randomUUID(),
      leaseOwner: randomUUID(),
      projectId: project.id,
      meetingId: meeting.id,
    };
    await db.insert(projectMeetingTurnRequestsTable).values({
      ...fence,
      requestHash: "a".repeat(64),
      state: "running",
      leaseExpiresAt: new Date(Date.now() + 120_000),
    });
    loseOwnership = async () => {
      ownershipLost = true;
      await db
        .update(projectMeetingTurnRequestsTable)
        .set({ state: "unconfirmed" })
        .where(eq(projectMeetingTurnRequestsTable.requestId, fence.requestId));
    };
    run = () =>
      runProjectMeetingTurn({
        agent,
        project,
        meeting,
        founderContent: "Owned input",
        fence,
      });
    published = async () =>
      (
        await db
          .select()
          .from(projectMeetingTranscriptTable)
          .where(eq(projectMeetingTranscriptTable.speakerAgentId, agent.id))
      ).length;
  } else if (entry === "chat" || entry === "task") {
    const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "combined" });
    const runtime = await registerRuntimeInstance(
      {
        role: "combined",
        schedulerEnabled: true,
        capabilities: { http: true, scheduler: true },
      },
      config,
    );
    t.after(() => runtime.stopHeartbeat());
    if (entry === "chat") {
      run = () =>
        runAgentTurn(agent, "Owned input", undefined, undefined, {
          runtimeHandle: runtime,
          locale: "en",
        });
      published = async () =>
        (
          await db
            .select()
            .from(messagesTable)
            .where(eq(messagesTable.agentId, agent.id))
        ).filter((row) => row.role === "agent").length;
    } else {
      const leaseOwner = `owned-matrix:${randomUUID()}`;
      const expiry = new Date(Date.now() + 120_000);
      const [task] = await db
        .insert(tasksTable)
        .values({
          title: "Owned task",
          brief: "Fixture",
          status: "in_progress",
          ownerAgentId: agent.id,
          leaseOwner,
          leaseExpiresAt: expiry,
          createdByUser: true,
        })
        .returning();
      await db
        .update(agentsTable)
        .set({
          status: "working",
          currentTaskId: task.id,
          runLeaseOwner: leaseOwner,
          runLeaseExpiresAt: expiry,
        })
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
      run = () =>
        stepTask(
          {
            ...task,
            leaseOwner,
            runtimeAttemptId,
            logicalExecutionId,
            runtimeInstanceId: runtime.id,
          },
          { locale: "en", runtimeOperationsConfig: config },
        );
      retry = async () => {
        // A distinct valid claim cannot discard the family's unsettled receipt.
        // Only this owned fixture installs the synthetic scheduler claim.
        const nextOwner = "fresh-matrix:" + randomUUID();
        const expires = new Date(Date.now() + 120_000);
        const [fresh] = await db
          .update(tasksTable)
          .set({
            status: "in_progress",
            blockedReason: null,
            leaseOwner: nextOwner,
            leaseExpiresAt: expires,
          })
          .where(eq(tasksTable.id, task.id))
          .returning();
        await db
          .update(agentsTable)
          .set({
            status: "working",
            currentTaskId: task.id,
            runLeaseOwner: nextOwner,
            runLeaseExpiresAt: expires,
          })
          .where(eq(agentsTable.id, agent.id));
        const nextId = randomUUID(),
          nextLogicalId = randomUUID();
        await db.insert(taskAttemptsTable).values({
          id: nextId,
          taskId: task.id,
          agentId: agent.id,
          workerInstanceId: runtime.id,
          leaseOwner: nextOwner,
          attemptNumber: 2,
          cycleNumber: 0,
          state: "claimed",
          logicalExecutionId: nextLogicalId,
        });
        return stepTask(
          {
            ...fresh,
            leaseOwner: nextOwner,
            runtimeAttemptId: nextId,
            logicalExecutionId: nextLogicalId,
            runtimeInstanceId: runtime.id,
          },
          { locale: "en", runtimeOperationsConfig: config },
        );
      };
      published = async () =>
        (
          await db
            .select()
            .from(operationReceiptsTable)
            .where(eq(operationReceiptsTable.taskId, task.id))
        ).filter((row) => row.state === "succeeded").length;
    }
  } else {
    run = () =>
      runJudge({
        agent,
        taskId: null,
        purpose: entry,
        beforeAttempt: async () => {
          if (ownershipLost) throw primaryError;
        },
        originalBrief: "Fixture",
        actionSummary: "Fixture",
        locale: "en",
      });
    published = async () =>
      (
        await db
          .select()
          .from(activityEventsTable)
          .where(eq(activityEventsTable.agentId, agent.id))
      ).filter((row) => row.type === "judge_review").length;
  }
  return {
    agent,
    run,
    published,
    primaryError,
    retry: () => (retry ? retry() : run()),
    calls: () => calls,
  };
}

for (const entry of entries) {
  for (const fault of [
    "receipt_outage",
    "lost_ack",
    "unknown_usage",
  ] as const) {
    test(`${entry}: ${fault} never replays inference and publishes only after durable settlement`, async (t) => {
      const f = await fixture(t, entry, fault);
      const original = db.transaction.bind(db);
      let inserts = 0;
      let lostAck = false;
      t.mock.method(
        db,
        "transaction",
        async (callback: Parameters<typeof db.transaction>[0]) => {
          let insertedReceipt = false;
          const result = await original(async (tx) =>
            callback(
              new Proxy(tx, {
                get(target, key) {
                  if (key === "insert")
                    return (table: unknown) => {
                      if (table === usageEventsTable) {
                        inserts++;
                        if (fault === "receipt_outage")
                          return {
                            values: () => ({
                              onConflictDoNothing: () => ({
                                returning: () =>
                                  Promise.reject(
                                    new Error("Owned receipt outage"),
                                  ),
                              }),
                            }),
                          };
                        insertedReceipt = true;
                      }
                      return target.insert(table as never);
                    };
                  const value = Reflect.get(target, key, target);
                  return typeof value === "function"
                    ? value.bind(target)
                    : value;
                },
              }),
            ),
          );
          if (fault === "lost_ack" && insertedReceipt && !lostAck) {
            lostAck = true;
            throw new Error("Owned receipt commit acknowledgement lost");
          }
          return result;
        },
      );
      if (
        fault !== "lost_ack" &&
        (entry === "completion" || entry === "approval")
      ) {
        await assert.rejects(f.run(), InferenceAccountingError);
      } else {
        const result = (await f.run()) as Record<string, unknown>;
        if (
          fault !== "lost_ack" &&
          (entry === "company" || entry === "project")
        )
          assert.equal(result.skipReason, "model_error");
      }
      assert.equal(f.calls(), 1);
      assert.equal(await f.published(), fault === "lost_ack" ? 1 : 0);
      const attempts = await db
        .select()
        .from(inferenceAttemptsTable)
        .where(eq(inferenceAttemptsTable.agentId, f.agent.id));
      const receipts = await db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.agentId, f.agent.id));
      const evidence = await db
        .select()
        .from(inferenceResponseEvidenceTable)
        .where(eq(inferenceResponseEvidenceTable.attemptId, attempts[0].id));
      assert.equal(attempts.length, 1);
      assert.equal(
        attempts[0].state,
        fault === "lost_ack"
          ? "accounted"
          : fault === "receipt_outage"
            ? "dispatched"
            : "uncertain",
      );
      assert.equal(receipts.length, fault === "receipt_outage" ? 0 : 1);
      assert.equal(evidence.length, fault === "unknown_usage" ? 0 : 1);
      if (fault === "lost_ack") {
        assert.equal(lostAck, true);
        assert.equal(inserts, 2);
        assert.equal(receipts[0].totalTokens, 5);
        assert.equal(receipts[0].usageReported, true);
        assert.equal(receipts[0].reportedCostUsd, null);
      } else {
        // Restored persistence cannot turn absent accounting into permission to replay.
        t.mock.restoreAll();
        if (entry === "completion" || entry === "approval")
          await assert.rejects(f.run(), InferenceAccountingError);
        else if (entry === "company" || entry === "project")
          assert.equal(
            ((await f.run()) as { skipReason: string }).skipReason,
            "model_error",
          );
        else await f.retry();
        assert.equal(f.calls(), 1);
        assert.equal(await f.published(), 0);
      }
    });
  }
}

for (const entry of entries) {
  for (const fault of [
    "empty_receipt_outage",
    "malformed_receipt_outage",
    "late_owner",
    "late_owner_receipt_outage",
  ] as const) {
    test(
      entry +
        ": " +
        fault +
        " cannot publish, execute tools or dispatch fallback from unaccounted or unowned output",
      async (t) => {
        const f = await fixture(t, entry, fault);
        const outage = fault.endsWith("receipt_outage");
        const lateOwner = fault.startsWith("late_owner");
        const original = db.transaction.bind(db);
        if (outage)
          t.mock.method(
            db,
            "transaction",
            async (callback: Parameters<typeof db.transaction>[0]) =>
              original(async (tx) =>
                callback(
                  new Proxy(tx, {
                    get(target, key) {
                      if (key === "insert")
                        return (table: unknown) =>
                          table === usageEventsTable
                            ? {
                                values: () => ({
                                  onConflictDoNothing: () => ({
                                    returning: () =>
                                      Promise.reject(
                                        new Error("Owned extra receipt outage"),
                                      ),
                                  }),
                                }),
                              }
                            : target.insert(table as never);
                      const value = Reflect.get(target, key, target);
                      return typeof value === "function"
                        ? value.bind(target)
                        : value;
                    },
                  }),
                ),
              ),
          );
        if (entry === "completion" || entry === "approval") {
          if (lateOwner)
            await assert.rejects(f.run(), (error) => error === f.primaryError);
          else await assert.rejects(f.run(), InferenceAccountingError);
        } else if (entry === "chat" && lateOwner) {
          await assert.rejects(f.run(), {
            message: "Agent chat lease was lost before finalization",
          });
        } else {
          const result = (await f.run()) as Record<string, unknown>;
          if (entry === "company" || entry === "project")
            assert.equal(
              result.skipReason,
              entry === "company" && lateOwner && !outage
                ? "unavailable"
                : "model_error",
            );
        }
        assert.equal(f.calls(), 1);
        assert.equal(await f.published(), 0);
        const attempts = await db
          .select()
          .from(inferenceAttemptsTable)
          .where(eq(inferenceAttemptsTable.agentId, f.agent.id));
        assert.equal(attempts.length, 1);
        assert.equal(attempts[0].state, outage ? "dispatched" : "accounted");
        const receipts = await db
          .select()
          .from(usageEventsTable)
          .where(eq(usageEventsTable.agentId, f.agent.id));
        assert.equal(receipts.length, outage ? 0 : 1);
        if (!outage) {
          assert.equal(receipts[0].totalTokens, 5);
          assert.equal(receipts[0].reportedCostUsd, null);
          assert.equal(receipts[0].usageReported, true);
        }
        const evidence = await db
          .select()
          .from(inferenceResponseEvidenceTable)
          .where(eq(inferenceResponseEvidenceTable.attemptId, attempts[0].id));
        assert.equal(evidence.length, 1);
        if (!lateOwner) {
          t.mock.restoreAll();
          if (entry === "completion" || entry === "approval")
            await assert.rejects(f.run(), InferenceAccountingError);
          else await f.retry();
          assert.equal(f.calls(), 1);
          assert.equal(await f.published(), 0);
        }
      },
    );
  }
}
