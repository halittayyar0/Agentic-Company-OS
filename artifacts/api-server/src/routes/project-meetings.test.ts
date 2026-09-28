import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  agentsTable,
  db,
  dbReady,
  projectMeetingsTable,
  tasksTable,
} from "@workspace/db";
import app from "../app";
import { setProjectMeetingCompletionRunnerForTests } from "../lib/orchestrator/run-project-meeting";

type Json = Record<string, unknown>;

async function responseJson(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

test("project meetings are root-scoped, durable, executable, and preserve failed starts", async (t) => {
  await dbReady;
  const marker = randomUUID();
  const agents = await db
    .insert(agentsTable)
    .values(
      Array.from({ length: 7 }, (_, index) => ({
        name: `Meeting agent ${index}-${marker}`,
        role: index === 0 ? "Project owner" : `Specialist ${index}`,
        systemPrompt: "Answer only with evidence from the supplied context.",
        createdByUser: true,
      })),
    )
    .returning();
  const owner = agents[0]!;
  const participants = agents.slice(1);
  const [projectA, projectB] = await db
    .insert(tasksTable)
    .values([
      {
        title: `Root project A ${marker}`,
        brief: "Private brief for project A.",
        ownerAgentId: owner.id,
        createdByUser: true,
      },
      {
        title: `Root project B ${marker}`,
        brief: "Private brief for project B.",
        ownerAgentId: owner.id,
        createdByUser: true,
      },
    ])
    .returning();
  const [childTask] = await db
    .insert(tasksTable)
    .values({
      title: `Child work ${marker}`,
      brief: "Not a project meeting owner.",
      ownerAgentId: owner.id,
      parentTaskId: projectA.id,
      createdByUser: true,
    })
    .returning();

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const api = `http://127.0.0.1:${address.port}/api`;
  const request = (path: string, method = "GET", body?: unknown) =>
    fetch(`${api}${path}`, {
      method,
      headers:
        body === undefined ? undefined : { "content-type": "application/json" },
      body:
        body === undefined
          ? undefined
          : JSON.stringify({ requestId: randomUUID(), ...(body as Json) }),
    });

  t.after(async () => {
    setProjectMeetingCompletionRunnerForTests(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db
      .delete(tasksTable)
      .where(inArray(tasksTable.id, [childTask.id, projectA.id, projectB.id]));
    await db.delete(agentsTable).where(
      inArray(
        agentsTable.id,
        agents.map((agent) => agent.id),
      ),
    );
  });

  const rejectedChild = await request(
    `/projects/${childTask.id}/meetings`,
    "POST",
    {
      title: "Must not be created",
      participantAgentIds: [],
    },
  );
  assert.equal(rejectedChild.status, 409);
  assert.match(await rejectedChild.text(), /root project/i);
  await assert.rejects(
    db.insert(projectMeetingsTable).values({
      taskId: childTask.id,
      title: "Database-level child meeting bypass",
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.cause instanceof Error &&
      /root project/i.test(error.cause.message),
  );

  const createResponse = await request(
    `/projects/${projectA.id}/meetings`,
    "POST",
    {
      title: "Project A launch meeting",
      agenda: "Review the launch evidence and agree on next actions.",
      participantAgentIds: participants.map((agent) => agent.id),
    },
  );
  assert.equal(createResponse.status, 201);
  const createOutcome = await responseJson(createResponse);
  const created = await responseJson(
    await request(
      `/projects/${projectA.id}/meetings/${createOutcome.meetingId}`,
    ),
  );
  const meeting = created.meeting as {
    id: number;
    taskId: number;
    status: string;
  };
  assert.equal(meeting.taskId, projectA.id);
  assert.equal(meeting.status, "draft");
  assert.equal((created.participants as unknown[]).length, 6);
  await assert.rejects(
    db
      .update(tasksTable)
      .set({ parentTaskId: projectB.id })
      .where(eq(tasksTable.id, projectA.id)),
    (error: unknown) =>
      error instanceof Error &&
      error.cause instanceof Error &&
      /cannot become a child/i.test(error.cause.message),
  );

  const bypassedCompletion = await request(
    `/projects/${projectA.id}/meetings/${meeting.id}`,
    "PATCH",
    { status: "completed" },
  );
  assert.equal(
    bypassedCompletion.status,
    400,
    "completion must use the atomic synthesis endpoint",
  );

  const duplicateParticipants = await request(
    `/projects/${projectA.id}/meetings`,
    "POST",
    {
      title: "Duplicate participants",
      participantAgentIds: [participants[0]!.id, participants[0]!.id],
    },
  );
  assert.equal(duplicateParticipants.status, 400);

  const crossProjectRead = await request(
    `/projects/${projectB.id}/meetings/${meeting.id}`,
  );
  assert.equal(crossProjectRead.status, 404);
  assert.match(await crossProjectRead.text(), /not found in this project/i);
  const projectBList = await request(`/projects/${projectB.id}/meetings`);
  assert.equal(projectBList.status, 200);
  assert.deepEqual(await projectBList.json(), []);

  const founderTranscript = await request(
    `/projects/${projectA.id}/meetings/${meeting.id}/transcript`,
    "POST",
    { speakerType: "founder", content: "Use the signed-off launch brief." },
  );
  assert.equal(founderTranscript.status, 201);
  const agentTranscript = await request(
    `/projects/${projectA.id}/meetings/${meeting.id}/transcript`,
    "POST",
    {
      speakerType: "agent",
      speakerAgentId: participants[0]!.id,
      content: "The evidence checklist is ready for review.",
    },
  );
  assert.equal(
    agentTranscript.status,
    400,
    "public transcript writes must not fabricate agent speech",
  );
  const decision = await request(
    `/projects/${projectA.id}/meetings/${meeting.id}/decisions`,
    "POST",
    {
      content: "Use the evidence checklist as the release gate.",
      ownerAgentId: participants[0]!.id,
    },
  );
  assert.equal(decision.status, 201);
  const action = await request(
    `/projects/${projectA.id}/meetings/${meeting.id}/action-items`,
    "POST",
    {
      title: "Verify every release artifact",
      ownerAgentId: participants[1]!.id,
    },
  );
  assert.equal(action.status, 201);
  const actionOutcome = await responseJson(action);
  const actionDetail = await responseJson(
    await request(`/projects/${projectA.id}/meetings/${meeting.id}`),
  );
  const actionBody = (actionDetail.actionItems as Json[]).find(
    (item) => item.id === actionOutcome.entityId,
  )!;
  assert.equal(actionBody.status, "open");
  assert.equal(actionBody.completedAt, null);

  const observedPrompts: string[] = [];
  setProjectMeetingCompletionRunnerForTests(
    async ({ agent, messages, maxTokens }) => {
      assert.equal(maxTokens, 220);
      observedPrompts.push(
        messages.map((message) => message.content).join("\n"),
      );
      return {
        content: `Scoped answer from ${agent.name}`,
        modelId: "test:model",
      };
    },
  );
  const startResponse = await request(
    `/projects/${projectA.id}/meetings/${meeting.id}/start`,
    "POST",
    {
      prompt: "Which launch risk needs an owner now?",
      participantAgentIds: participants.map((agent) => agent.id),
      maxTokensPerResponse: 220,
    },
  );
  assert.equal(startResponse.status, 200);
  const started = await responseJson(startResponse);
  assert.equal((started.meeting as { status: string }).status, "in_progress");
  assert.equal((started.agentTranscriptIds as number[]).length, 6);
  assert.equal(observedPrompts.length, 6);
  assert.match(observedPrompts[0]!, new RegExp(projectA.title));
  assert.match(observedPrompts[0]!, /Private brief for project A/);
  assert.match(observedPrompts[0]!, /Review the launch evidence/);
  assert.match(observedPrompts[0]!, /Use the signed-off launch brief/);
  assert.match(observedPrompts[1]!, /Scoped answer from Meeting agent 1/);
  assert.doesNotMatch(observedPrompts[0]!, /Private brief for project B/);

  const completeResponse = await request(
    `/projects/${projectA.id}/meetings/${meeting.id}/complete`,
    "POST",
    {
      summary: "The team chose an evidence-gated launch.",
      decisions: [
        {
          content: "Release only after the evidence gate passes.",
          ownerAgentId: participants[0]!.id,
        },
      ],
      actionItems: [
        {
          title: "Run the release gate",
          ownerAgentId: participants[1]!.id,
        },
      ],
    },
  );
  assert.equal(completeResponse.status, 200);
  assert.equal((await responseJson(completeResponse)).ok, true);
  const completed = await responseJson(
    await request(`/projects/${projectA.id}/meetings/${meeting.id}`),
  );
  assert.equal((completed.meeting as { status: string }).status, "completed");
  assert.equal(
    (completed.meeting as { summary: string }).summary,
    "The team chose an evidence-gated launch.",
  );
  const completedActions = completed.actionItems as Array<{
    status: string;
    completedAt: string | null;
  }>;
  assert.ok(completedActions.every((item) => item.status === "open"));
  assert.ok(completedActions.every((item) => item.completedAt === null));

  const guardedMeetingResponse = await request(
    `/projects/${projectA.id}/meetings`,
    "POST",
    {
      title: "Concurrent turn guard",
      agenda: "Only one active start may own this meeting.",
      participantAgentIds: [participants[0]!.id],
    },
  );
  assert.equal(guardedMeetingResponse.status, 201);
  const guardedMeeting = {
    id: (await responseJson(guardedMeetingResponse)).meetingId as number,
  };
  let enterRunner!: () => void;
  let releaseRunner!: () => void;
  const runnerEntered = new Promise<void>((resolve) => {
    enterRunner = resolve;
  });
  const runnerReleased = new Promise<void>((resolve) => {
    releaseRunner = resolve;
  });
  setProjectMeetingCompletionRunnerForTests(async ({ agent }) => {
    enterRunner();
    await runnerReleased;
    return {
      content: `Guarded answer from ${agent.name}`,
      modelId: "test:model",
    };
  });
  const firstGuardedStart = request(
    `/projects/${projectA.id}/meetings/${guardedMeeting.id}/start`,
    "POST",
    { prompt: "Hold this turn open." },
  );
  await runnerEntered;
  const duplicateGuardedStart = await request(
    `/projects/${projectA.id}/meetings/${guardedMeeting.id}/start`,
    "POST",
    { prompt: "This duplicate must not be persisted." },
  );
  const duplicateGuardedBody = await responseJson(duplicateGuardedStart);
  releaseRunner();
  const firstGuardedResponse = await firstGuardedStart;
  assert.equal(firstGuardedResponse.status, 200);
  assert.equal(duplicateGuardedStart.status, 409);
  assert.equal(duplicateGuardedBody.code, "MEETING_TURN_IN_PROGRESS");
  const guardedDetailResponse = await request(
    `/projects/${projectA.id}/meetings/${guardedMeeting.id}`,
  );
  const guardedDetail = await responseJson(guardedDetailResponse);
  const guardedTranscript = guardedDetail.transcript as Array<{
    content: string;
  }>;
  assert.equal(
    guardedTranscript.filter(
      (entry) => entry.content === "This duplicate must not be persisted.",
    ).length,
    0,
  );

  const failedMeetingResponse = await request(
    `/projects/${projectA.id}/meetings`,
    "POST",
    {
      title: "Provider failure meeting",
      agenda: "This agenda must survive a provider outage.",
      participantAgentIds: [participants[0]!.id],
    },
  );
  assert.equal(failedMeetingResponse.status, 201);
  const failedMeeting = {
    id: (await responseJson(failedMeetingResponse)).meetingId as number,
  };
  setProjectMeetingCompletionRunnerForTests(async () => {
    throw new Error(
      "No model provider is configured with a tool-capable model.",
    );
  });
  const failedStart = await request(
    `/projects/${projectA.id}/meetings/${failedMeeting.id}/start`,
    "POST",
    { prompt: "Keep this exact founder turn." },
  );
  assert.equal(failedStart.status, 503);
  const failedBody = await responseJson(failedStart);
  assert.match(String(failedBody.error), /preserved/i);
  const persistedDraft = failedBody.meeting as {
    status: string;
    agenda: string;
  };
  assert.equal(persistedDraft.status, "draft");
  assert.equal(
    persistedDraft.agenda,
    "This agenda must survive a provider outage.",
  );
  assert.ok(
    (failedBody.transcript as Array<{ content: string }>).some(
      (entry) => entry.content === "Keep this exact founder turn.",
    ),
  );

  const storedMeetings = await db.select().from(projectMeetingsTable);
  assert.ok(storedMeetings.some((row) => row.id === meeting.id));
  assert.ok(storedMeetings.some((row) => row.id === failedMeeting.id));
});
