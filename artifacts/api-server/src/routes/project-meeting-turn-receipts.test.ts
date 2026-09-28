import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  dbReady,
  agentsTable,
  tasksTable,
  projectMeetingsTable,
  projectMeetingTranscriptTable,
  projectMeetingTurnRequestsTable,
} from "@workspace/db";
import { createProjectMeetingsRouter } from "./project-meetings";
import { setProjectMeetingCompletionRunnerForTests } from "../lib/orchestrator/run-project-meeting";
import { setEmergencyStop } from "../lib/orchestrator/runtime-emergency-stop";

const json = async (response: Response) =>
  (await response.json()) as Record<string, unknown>;

test("meeting turn identities fence replays, closed meetings, leases and API replicas", async (t) => {
  await dbReady;
  const agents = await db
    .insert(agentsTable)
    .values(
      [0, 1, 2].map((i) => ({
        name: "Receipt fixture " + i,
        role: "Test",
        systemPrompt: "Test",
        createdByUser: true,
      })),
    )
    .returning();
  const [project] = await db
    .insert(tasksTable)
    .values({
      title: "Receipt fixture",
      brief: "Private project",
      ownerAgentId: agents[0].id,
      createdByUser: true,
    })
    .returning();
  const servers = [0, 1].map(() => {
    const app = express();
    app.use(express.json());
    app.use("/api", createProjectMeetingsRouter());
    return app.listen(0, "127.0.0.1");
  });
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => server.once("listening", resolve)),
    ),
  );
  const bases = servers.map((server) => {
    const a = server.address();
    assert.ok(a && typeof a === "object");
    return "http://127.0.0.1:" + a.port + "/api";
  });
  const request = (path: string, method = "GET", body?: unknown, replica = 0) =>
    fetch(bases[replica] + path, {
      method,
      headers: { "content-type": "application/json" },
      body:
        body === undefined
          ? undefined
          : JSON.stringify(
              path.endsWith("/start")
                ? body
                : {
                    requestId: randomUUID(),
                    ...(body as Record<string, unknown>),
                  },
            ),
    });
  const prefix = "/projects/" + project.id + "/meetings";
  const create = async (participantIds = [agents[0].id]) => {
    const res = await request(prefix, "POST", {
      title: "Review " + randomUUID(),
      agenda: "Exact agenda",
      participantAgentIds: participantIds,
    });
    assert.equal(res.status, 201);
    return (await json(res)).meetingId as number;
  };
  const start = (meetingId: number, input: unknown, replica = 0) =>
    request(prefix + "/" + meetingId + "/start", "POST", input, replica);
  const receipt = (meetingId: number, requestId: string, replica = 0) =>
    request(
      prefix + "/" + meetingId + "/turn-requests/" + requestId,
      "GET",
      undefined,
      replica,
    );
  const transcript = async (meetingId: number) =>
    db
      .select()
      .from(projectMeetingTranscriptTable)
      .where(eq(projectMeetingTranscriptTable.meetingId, meetingId));
  function hold() {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => {
        enter = r;
      }),
      done = new Promise<void>((r) => {
        release = r;
      });
    setProjectMeetingCompletionRunnerForTests(async () => {
      enter();
      await done;
      return { content: "Late source reply", modelId: "test:model" };
    });
    t.after(release);
    return { entered, release };
  }
  t.after(async () => {
    setProjectMeetingCompletionRunnerForTests(null);
    await setEmergencyStop({
      enabled: false,
      reason: null,
      updatedBy: "meeting-test-cleanup",
    });
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
    await db.delete(tasksTable).where(eq(tasksTable.id, project.id));
    await db.delete(agentsTable).where(
      inArray(
        agentsTable.id,
        agents.map((a) => a.id),
      ),
    );
  });
  await t.test(
    "identity is mandatory and exact replay observes a single completed provider turn",
    async () => {
      const id = await create();
      let calls = 0;
      setProjectMeetingCompletionRunnerForTests(async () => {
        calls++;
        return { content: "Stored original", modelId: "test:model" };
      });
      assert.equal((await start(id, { prompt: "missing ID" })).status, 400);
      assert.equal((await transcript(id)).length, 0);
      const input = { requestId: randomUUID(), prompt: "Exact operator text" };
      const first = await start(id, input);
      assert.equal(first.status, 200);
      const body = await first.json();
      const replay = await start(id, input, 1);
      assert.equal(replay.status, 200);
      assert.deepEqual(await replay.json(), body);
      assert.equal(calls, 1);
      assert.equal((await transcript(id)).length, 2);
      assert.equal(
        (await start(id, { ...input, prompt: "Different" })).status,
        409,
      );
      const observed = await json(await receipt(id, input.requestId, 1));
      assert.equal(observed.state, "complete");
      assert.equal(observed.httpStatus, 200);
      assert.deepEqual(observed.response, body);
      assert.equal(
        (
          await request(
            "/projects/" +
              (project.id + 999) +
              "/meetings/" +
              id +
              "/turn-requests/" +
              input.requestId,
          )
        ).status,
        404,
      );
    },
  );
  await t.test(
    "concurrent replay across router instances does not append or dispatch again",
    async () => {
      const id = await create(),
        held = hold(),
        input = { requestId: randomUUID(), prompt: "Only one founder record" };
      const pending = start(id, input);
      await held.entered;
      try {
        assert.equal((await start(id, input, 1)).status, 202);
        assert.equal(
          (
            await start(
              id,
              { requestId: randomUUID(), prompt: "Second start" },
              1,
            )
          ).status,
          409,
        );
        assert.equal(
          (await json(await receipt(id, input.requestId, 1))).state,
          "running",
        );
        assert.equal((await transcript(id)).length, 1);
      } finally {
        held.release();
      }
      assert.equal((await pending).status, 200);
    },
  );
  await t.test(
    "capacity is shared by API replicas and rejected requests append nothing",
    async () => {
      const ids = await Promise.all(agents.map((agent) => create([agent.id])));
      let release!: () => void,
        entered!: () => void,
        calls = 0;
      const blocked = new Promise<void>((resolve) => {
          release = resolve;
        }),
        ready = new Promise<void>((resolve) => {
          entered = resolve;
        });
      setProjectMeetingCompletionRunnerForTests(async () => {
        calls++;
        if (calls === 2) entered();
        await blocked;
        return { content: "Bounded turn", modelId: "test:model" };
      });
      const requests = ids
        .slice(0, 2)
        .map((id, i) =>
          start(id, { requestId: randomUUID(), prompt: "Shared capacity" }, i),
        );
      try {
        await ready;
        const rejected = { requestId: randomUUID(), prompt: "Over capacity" };
        assert.equal((await start(ids[2], rejected, 1)).status, 429);
        assert.equal((await receipt(ids[2], rejected.requestId)).status, 404);
        assert.equal((await transcript(ids[2])).length, 0);
        assert.equal(calls, 2);
      } finally {
        release();
      }
      for (const response of await Promise.all(requests))
        assert.equal(response.status, 200);
    },
  );
  await t.test(
    "replacement agent ownership survives an old provider response and cleanup",
    async () => {
      const id = await create(),
        held = hold(),
        input = { requestId: randomUUID(), prompt: "Replaced lease" };
      const pending = start(id, input);
      await held.entered;
      try {
        await db
          .update(agentsTable)
          .set({
            runLeaseOwner: "replacement-owner",
            runLeaseExpiresAt: sql`clock_timestamp() + interval '1 minute'`,
          })
          .where(eq(agentsTable.id, agents[0].id));
      } finally {
        held.release();
      }
      assert.equal((await pending).status, 409);
      assert.equal(
        (await transcript(id)).filter((r) => r.speakerType === "agent").length,
        0,
      );
      const [replacement] = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, agents[0].id));
      assert.equal(replacement.runLeaseOwner, "replacement-owner");
      assert.equal(replacement.status, "working");
      await db
        .update(agentsTable)
        .set({
          runLeaseOwner: null,
          runLeaseExpiresAt: null,
          status: "idle",
          currentTaskId: null,
          currentAction: null,
        })
        .where(eq(agentsTable.id, agents[0].id));
    },
  );
  for (const close of ["cancelled", "completed"] as const)
    await t.test(
      "late response cannot write to or reopen a " + close + " meeting",
      async () => {
        const id = await create();
        if (close === "completed") {
          assert.equal(
            (
              await start(id, {
                requestId: randomUUID(),
                participantAgentIds: [],
              })
            ).status,
            200,
          );
        }
        const held = hold(),
          input = {
            requestId: randomUUID(),
            prompt: "May close during model response",
          };
        const pending = start(id, input);
        await held.entered;
        try {
          const closed =
            close === "cancelled"
              ? await request(
                  prefix + "/" + id,
                  "PATCH",
                  { status: "cancelled" },
                  1,
                )
              : await request(
                  prefix + "/" + id + "/complete",
                  "POST",
                  { summary: "Closed by operator" },
                  1,
                );
          assert.equal(closed.status, 200);
        } finally {
          held.release();
        }
        assert.equal((await pending).status, 409);
        assert.equal(
          (await transcript(id)).filter((r) => r.speakerType === "agent")
            .length,
          0,
        );
        const [meeting] = await db
          .select()
          .from(projectMeetingsTable)
          .where(eq(projectMeetingsTable.id, id));
        assert.equal(meeting.status, close);
        assert.equal(
          (await json(await receipt(id, input.requestId))).state,
          "unconfirmed",
        );
      },
    );
  await t.test(
    "expired agent ownership cannot persist a late reply",
    async () => {
      const id = await create(),
        held = hold(),
        input = { requestId: randomUUID(), prompt: "Expired agent" };
      const pending = start(id, input);
      await held.entered;
      try {
        await db
          .update(agentsTable)
          .set({
            runLeaseExpiresAt: sql`clock_timestamp() - interval '1 second'`,
          })
          .where(eq(agentsTable.id, agents[0].id));
      } finally {
        held.release();
      }
      assert.equal((await pending).status, 409);
      assert.equal(
        (await transcript(id)).filter((r) => r.speakerType === "agent").length,
        0,
      );
      assert.equal(
        (await json(await receipt(id, input.requestId))).state,
        "complete",
      );
    },
  );
  await t.test(
    "expired request stays unconfirmed, can be read without writes and never restarts",
    async () => {
      const id = await create(),
        held = hold(),
        input = { requestId: randomUUID(), prompt: "Expired request" };
      const pending = start(id, input);
      await held.entered;
      try {
        await db
          .update(projectMeetingTurnRequestsTable)
          .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
          .where(
            eq(projectMeetingTurnRequestsTable.requestId, input.requestId),
          );
        const read = await json(await receipt(id, input.requestId, 1));
        assert.equal(read.state, "unconfirmed");
        const [stored] = await db
          .select()
          .from(projectMeetingTurnRequestsTable)
          .where(
            eq(projectMeetingTurnRequestsTable.requestId, input.requestId),
          );
        assert.equal(stored.state, "running");
        assert.equal((await start(id, input, 1)).status, 409);
      } finally {
        held.release();
      }
      assert.equal((await pending).status, 409);
      assert.equal(
        (await transcript(id)).filter((r) => r.speakerType === "agent").length,
        0,
      );
    },
  );
  await t.test(
    "stop during a model turn preserves input and rejects the late reply",
    async () => {
      const id = await create(),
        held = hold(),
        input = { requestId: randomUUID(), prompt: "Persist before stop" };
      const pending = start(id, input);
      await held.entered;
      try {
        await setEmergencyStop({
          enabled: true,
          reason: null,
          updatedBy: "meeting-test",
        });
      } finally {
        held.release();
      }
      assert.equal((await pending).status, 423);
      assert.equal((await transcript(id)).length, 1);
      assert.equal(
        (await json(await receipt(id, input.requestId))).state,
        "unconfirmed",
      );
      await setEmergencyStop({
        enabled: false,
        reason: null,
        updatedBy: "meeting-test",
      });
    },
  );
  await t.test(
    "releasing emergency stop cannot revive remaining meeting participants",
    async () => {
      const id = await create([agents[0].id, agents[1].id]);
      let release!: () => void,
        enter!: () => void,
        calls = 0;
      const wait = new Promise<void>((r) => {
          release = r;
        }),
        entered = new Promise<void>((r) => {
          enter = r;
        });
      setProjectMeetingCompletionRunnerForTests(async () => {
        calls++;
        enter();
        await wait;
        return { content: "Old turn", modelId: "test:model" };
      });
      const input = { requestId: randomUUID(), prompt: "Stop then resume" },
        pending = start(id, input);
      await entered;
      try {
        await setEmergencyStop({
          enabled: true,
          reason: null,
          updatedBy: "meeting-test",
        });
        await setEmergencyStop({
          enabled: false,
          reason: null,
          updatedBy: "meeting-test",
        });
      } finally {
        release();
      }
      assert.equal((await pending).status, 409);
      assert.equal(calls, 1);
      assert.equal(
        (await transcript(id)).filter((r) => r.speakerType === "agent").length,
        0,
      );
      assert.equal(
        (await json(await receipt(id, input.requestId))).state,
        "unconfirmed",
      );
    },
  );
  await t.test(
    "accepted identities remain observable after meeting deletion",
    async () => {
      const id = await create([]),
        input = { requestId: randomUUID(), prompt: "No model needed" };
      const first = await start(id, input);
      assert.equal(first.status, 200);
      const original = await first.json();
      await db
        .delete(projectMeetingsTable)
        .where(eq(projectMeetingsTable.id, id));
      const replay = await start(id, input, 1);
      assert.equal(replay.status, 200);
      assert.deepEqual(await replay.json(), original);
      assert.equal((await receipt(id, input.requestId)).status, 200);
      assert.equal(
        (await start(id, { ...input, prompt: "Changed after deletion" }))
          .status,
        409,
      );
    },
  );
  await t.test(
    "database checks reject incomplete success receipts",
    async () => {
      await assert.rejects(
        db.insert(projectMeetingTurnRequestsTable).values({
          requestId: randomUUID(),
          projectId: project.id,
          meetingId: 999,
          state: "complete",
          requestHash: "a".repeat(64),
          leaseOwner: randomUUID(),
          leaseExpiresAt: new Date(),
        }),
      );
      const active = await db
        .select()
        .from(projectMeetingTurnRequestsTable)
        .where(
          and(
            eq(projectMeetingTurnRequestsTable.projectId, project.id),
            eq(projectMeetingTurnRequestsTable.state, "running"),
          ),
        );
      assert.equal(active.length, 0);
    },
  );
});
