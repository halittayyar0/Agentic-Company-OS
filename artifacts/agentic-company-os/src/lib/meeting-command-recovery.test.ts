import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareMeetingCommand,
  readMeetingCommand,
  acknowledgeMeetingCommand,
  meetingCommandKey,
  dispatchMeetingCommand,
  assertMeetingCommandResult,
  clearDamagedMeetingCommand,
  readMeetingCommandReceipt,
} from "./meeting-command-recovery";

function store() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
test("manual commands save exact intent, serialize per project and remove only the matching identity", () => {
  const s = store(),
    input = { title: "原文 العربية", participantAgentIds: [2, 3] };
  const intent = prepareMeetingCommand(
    {
      projectId: 1,
      meetingId: null,
      actionItemId: null,
      kind: "create",
      input,
    },
    s,
  );
  input.title = "changed";
  input.participantAgentIds.reverse();
  assert.equal(readMeetingCommand(1, s)?.input.title, "原文 العربية");
  assert.throws(() =>
    prepareMeetingCommand(
      {
        projectId: 1,
        meetingId: 3,
        actionItemId: null,
        kind: "decision",
        input: { content: "Duplicate" },
      },
      s,
    ),
  );
  acknowledgeMeetingCommand({ ...intent, requestId: crypto.randomUUID() }, s);
  assert.ok(readMeetingCommand(1, s));
  assert.equal(readMeetingCommand(2, s), null);
  acknowledgeMeetingCommand(intent, s);
  assert.equal(readMeetingCommand(1, s), null);
});

test("receipt observation is read-only, correlates nested scope and retains an immutable rejection", async (t) => {
  const s = store(),
    intent = prepareMeetingCommand(
      {
        projectId: 1,
        meetingId: 2,
        actionItemId: null,
        kind: "complete",
        input: { summary: "Close" },
      },
      s,
    );
  const response = {
    requestId: intent.requestId,
    projectId: 1,
    meetingId: 2,
    kind: "complete",
    entityId: null,
    ok: false,
    code: "MEETING_STATE_CHANGED",
  };
  const receipt = {
    requestId: intent.requestId,
    projectId: 1,
    meetingId: 2,
    kind: "complete",
    httpStatus: 409,
    createdAt: new Date().toISOString(),
    response,
  };
  let payload: unknown = receipt;
  const methods: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      methods.push(init.method ?? "GET");
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
  assert.deepEqual(
    (await readMeetingCommandReceipt(intent)).response,
    response,
  );
  assert.deepEqual(readMeetingCommand(1, s), intent);
  for (const patch of [
    { meetingId: 9 },
    { projectId: 9 },
    { httpStatus: 200 },
    { response: { ...response, entityId: 2 } },
    { createdAt: "invalid" },
  ]) {
    payload = { ...receipt, ...patch };
    await assert.rejects(readMeetingCommandReceipt(intent));
  }
  assert.ok(methods.every((method) => method === "GET"));
});

test("manual dispatch rejects invalid fields and a saved identity changed before retry", async (t) => {
  const s = store();
  assert.throws(() =>
    prepareMeetingCommand(
      {
        projectId: 1,
        meetingId: 2,
        actionItemId: null,
        kind: "complete",
        input: {
          summary: "Close",
          decisions: Array.from({ length: 60 }, () => ({
            content: "文".repeat(6000),
          })),
        },
      },
      s,
    ),
  );
  assert.equal(
    s.data.size,
    0,
    "byte limits must be checked before persisting a request",
  );
  assert.throws(() =>
    prepareMeetingCommand(
      {
        projectId: 1,
        meetingId: 2,
        actionItemId: null,
        kind: "update",
        input: {},
      },
      s,
    ),
  );
  assert.throws(() =>
    prepareMeetingCommand(
      {
        projectId: 1,
        meetingId: 2,
        actionItemId: null,
        kind: "update",
        input: { status: "completed" },
      },
      s,
    ),
  );
  const intent = prepareMeetingCommand(
    {
      projectId: 1,
      meetingId: 2,
      actionItemId: null,
      kind: "decision",
      input: { content: "Exact" },
    },
    s,
  );
  s.data.set(
    meetingCommandKey(1),
    JSON.stringify({ ...intent, input: { content: "Different" } }),
  );
  let posts = 0;
  t.mock.method(globalThis, "fetch", async () => {
    posts++;
    throw Error();
  });
  await assert.rejects(dispatchMeetingCommand(intent, s));
  assert.equal(posts, 0);
});
test("damaged, unavailable and silently failed storage cannot dispatch or overwrite", () => {
  const s = store();
  s.data.set(meetingCommandKey(1), "broken");
  assert.throws(() =>
    prepareMeetingCommand(
      {
        projectId: 1,
        meetingId: null,
        actionItemId: null,
        kind: "create",
        input: { title: "New" },
      },
      s,
    ),
  );
  assert.equal(s.data.get(meetingCommandKey(1)), "broken");
  assert.throws(() => clearDamagedMeetingCommand(1, "different", s));
  clearDamagedMeetingCommand(1, "broken", s);
  s.setItem = () => {};
  assert.throws(() =>
    prepareMeetingCommand(
      {
        projectId: 1,
        meetingId: null,
        actionItemId: null,
        kind: "create",
        input: { title: "New" },
      },
      s,
    ),
  );
});
test("result correlation checks project, kind, meeting, action and success before releasing an intent", () => {
  const s = store(),
    intent = prepareMeetingCommand(
      {
        projectId: 1,
        meetingId: 2,
        actionItemId: 8,
        kind: "action-update",
        input: { status: "done" },
      },
      s,
    );
  const result = {
    requestId: intent.requestId,
    projectId: 1,
    meetingId: 2,
    kind: "action-update",
    entityId: 8,
    ok: true,
  };
  assert.doesNotThrow(() => assertMeetingCommandResult(result, intent));
  for (const patch of [
    { projectId: 9 },
    { meetingId: 9 },
    { kind: "decision" },
    { entityId: 9 },
    { requestId: crypto.randomUUID() },
    { ok: false },
    { entityId: null },
  ])
    assert.throws(() =>
      assertMeetingCommandResult({ ...result, ...patch }, intent),
    );
  s.removeItem = () => {};
  assert.throws(() => acknowledgeMeetingCommand(intent, s));
  assert.ok(readMeetingCommand(1, s));
});
test("dispatch preserves the original identity on network failure and validates before accepting success", async (t) => {
  const s = store(),
    intent = prepareMeetingCommand(
      {
        projectId: 1,
        meetingId: 2,
        actionItemId: null,
        kind: "decision",
        input: { content: "Exact" },
      },
      s,
    );
  const calls: unknown[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      throw Error("connection lost");
    },
  );
  await assert.rejects(dispatchMeetingCommand(intent, s));
  await assert.rejects(dispatchMeetingCommand(intent, s));
  assert.deepEqual(calls, [
    { requestId: intent.requestId, content: "Exact" },
    { requestId: intent.requestId, content: "Exact" },
  ]);
  assert.deepEqual(readMeetingCommand(1, s), intent);
});
