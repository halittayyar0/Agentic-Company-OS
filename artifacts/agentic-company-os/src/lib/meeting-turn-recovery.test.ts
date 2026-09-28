import assert from "node:assert/strict";
import test from "node:test";
import { LOCALES } from "./i18n";
import { loadMeetingTurnCopy } from "./meeting-turn-copy";
import {
  prepareMeetingTurn,
  readMeetingTurnIntent,
  acknowledgeMeetingTurn,
  dispatchMeetingTurn,
  readMeetingTurnReceipt,
  meetingTurnKey,
  MeetingTurnRecoveryError,
  assertMeetingTurnResult,
  listMeetingTurnRecords,
  clearDamagedMeetingTurn,
} from "./meeting-turn-recovery";

function store() {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
const code = (value: string) => (error: unknown) =>
  error instanceof MeetingTurnRecoveryError && error.code === value;

test("recorded replies reject malformed display content before recovery can acknowledge them", () => {
  const intent = prepareMeetingTurn(1, 2, { prompt: "Original" }, store());
  const outcome = {
    requestId: intent.requestId,
    meeting: { id: 2, taskId: 1, status: "in_progress" },
    participants: [],
    decisions: [],
    actionItems: [],
    skippedParticipants: [],
    agentTranscriptIds: [10],
    transcript: [
      {
        id: 10,
        meetingId: 2,
        speakerType: "agent",
        speakerName: "Original 原文",
        content: "Saved reply",
      },
    ],
    execution: {
      requestedParticipantCount: 1,
      attemptedParticipantCount: 1,
      maxRespondersPerStart: 8,
      maxConcurrentMeetingStarts: 2,
      maxTokensPerResponse: 300,
    },
  };
  assert.doesNotThrow(() => assertMeetingTurnResult(outcome, intent));
  for (const override of [
    { content: {} },
    { speakerName: {} },
    { speakerType: "unknown" },
  ]) {
    assert.throws(
      () =>
        assertMeetingTurnResult(
          {
            ...outcome,
            transcript: [{ ...outcome.transcript[0], ...override }],
          },
          intent,
        ),
      code("unconfirmed"),
    );
  }
});

test("project turn inbox discovers unlisted and damaged records without crossing project namespaces", () => {
  const s = store();
  const first = prepareMeetingTurn(101, 901, { prompt: "Original 原文" }, s);
  prepareMeetingTurn(102, 901, { prompt: "Other project" }, s);
  s.data.set("acos.meeting-turn.v1:101:broken", "damaged text");
  s.data.set("acos.meeting-turn.v1:101:0901", JSON.stringify(first));
  s.data.set("acos.meeting-command.v1:101", "manual command");
  const found = listMeetingTurnRecords(101, {}, s);
  assert.equal(found.records.length, 3);
  assert.equal(found.records.filter((r) => r.kind === "valid").length, 1);
  assert.equal(found.records.filter((r) => r.kind === "damaged").length, 2);
  assert.equal(found.hasMore, false);
  assert.equal(found.scanIncomplete, false);
  assert.equal(s.data.size, 5);
});
test("inbox bounds scans and pages without hiding that more local records exist", () => {
  const s = store();
  for (let n = 1; n <= 23; n++)
    prepareMeetingTurn(101, n, { prompt: `Record ${n}` }, s);
  const first = listMeetingTurnRecords(101, { scanLimit: 10 }, s);
  assert.equal(first.scanIncomplete, true);
  assert.equal(first.records.length, 10);
  const page = listMeetingTurnRecords(101, {}, s);
  assert.equal(page.records.length, 20);
  assert.equal(page.hasMore, true);
  assert.equal(
    listMeetingTurnRecords(101, { offset: 20 }, s).records.length,
    3,
  );
  const failed = {
    ...s,
    key: () => {
      throw Error("Denied");
    },
  };
  assert.throws(() => listMeetingTurnRecords(101, {}, failed), code("storage"));
  assert.throws(
    () =>
      listMeetingTurnRecords(
        101,
        {},
        {
          ...s,
          getItem: () => {
            throw Error("Denied");
          },
        },
      ),
    code("storage"),
  );
});
test("damaged turns clear only the reviewed raw value and key; valid or changed identities survive", () => {
  const s = store(),
    key = meetingTurnKey(101, 901);
  s.data.set(key, "broken");
  clearDamagedMeetingTurn(101, key, "broken", s);
  assert.equal(s.data.get(key), undefined);
  const intent = prepareMeetingTurn(101, 901, { prompt: "Saved" }, s);
  assert.throws(
    () => clearDamagedMeetingTurn(101, key, "broken", s),
    code("pending"),
  );
  assert.throws(
    () => clearDamagedMeetingTurn(101, key, s.data.get(key)!, s),
    code("pending"),
  );
  assert.throws(
    () => clearDamagedMeetingTurn(102, key, s.data.get(key)!, s),
    code("invalid"),
  );
  assert.deepEqual(readMeetingTurnIntent(101, 901, s), intent);
  const malformedKey = "acos.meeting-turn.v1:101:invalid";
  s.data.set(malformedKey, "original");
  clearDamagedMeetingTurn(101, malformedKey, "original", s);
  assert.equal(s.data.has(malformedKey), false);
});
test("strict top-level validation and exact acknowledgement preserve changed input even under the same UUID", () => {
  const s = store(),
    intent = prepareMeetingTurn(101, 901, { prompt: "Original" }, s),
    key = meetingTurnKey(101, 901);
  s.data.set(key, JSON.stringify({ ...intent, extra: "unsupported" }));
  assert.throws(() => readMeetingTurnIntent(101, 901, s), code("invalid"));
  const changed = { ...intent, input: { prompt: "Newer evidence" } };
  s.data.set(key, JSON.stringify(changed));
  assert.throws(() => acknowledgeMeetingTurn(intent, s), code("pending"));
  assert.deepEqual(readMeetingTurnIntent(101, 901, s), changed);
});

test("meeting recovery copies cover seven languages including distinct Chinese scripts", async () => {
  const base = await loadMeetingTurnCopy("en");
  for (const locale of LOCALES) {
    const copy = await loadMeetingTurnCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(base).sort());
    assert.ok(Object.values(copy).every((v) => v.trim()));
  }
  assert.notDeepEqual(
    await loadMeetingTurnCopy("zh-CN"),
    await loadMeetingTurnCopy("zh-TW"),
  );
});
test("saved turns retain exact input and isolate project and meeting identity", () => {
  const s = store(),
    input = {
      prompt: "原文\nتعليمات",
      participantAgentIds: [7, 3],
      maxTokensPerResponse: 300,
    };
  const intent = prepareMeetingTurn(1, 2, input, s);
  input.prompt = "Changed draft";
  input.participantAgentIds.reverse();
  assert.deepEqual(readMeetingTurnIntent(1, 2, s), intent);
  assert.equal(intent.input.prompt, "原文\nتعليمات");
  assert.deepEqual(intent.input.participantAgentIds, [7, 3]);
  assert.equal(readMeetingTurnIntent(2, 2, s), null);
  assert.equal(readMeetingTurnIntent(1, 3, s), null);
  assert.throws(
    () => prepareMeetingTurn(1, 2, { prompt: "Duplicate" }, s),
    code("pending"),
  );
  acknowledgeMeetingTurn({ ...intent, requestId: crypto.randomUUID() }, s);
  assert.deepEqual(readMeetingTurnIntent(1, 2, s), intent);
  acknowledgeMeetingTurn(intent, s);
  assert.equal(readMeetingTurnIntent(1, 2, s), null);
});
test("invalid input cannot poison storage; malformed or unavailable storage blocks a new turn", () => {
  const s = store();
  for (const input of [
    { prompt: " " },
    { prompt: "x".repeat(12001) },
    { participantAgentIds: [1, 1] },
    { maxTokensPerResponse: 601 },
  ]) {
    assert.throws(() => prepareMeetingTurn(1, 2, input, s), code("invalid"));
    assert.equal(s.data.size, 0);
  }
  s.data.set(meetingTurnKey(1, 2), "broken");
  assert.throws(
    () => prepareMeetingTurn(1, 2, { prompt: "new" }, s),
    code("invalid"),
  );
  assert.equal(s.data.get(meetingTurnKey(1, 2)), "broken");
  s.data.clear();
  s.setItem = () => {
    throw Error("Full");
  };
  assert.throws(
    () => prepareMeetingTurn(1, 2, { prompt: "saved first" }, s),
    code("storage"),
  );
  s.setItem = () => {};
  assert.throws(
    () => prepareMeetingTurn(1, 2, { prompt: "no-op write" }, s),
    code("storage"),
  );
});
test("failed or silent removal retains the marker and reports storage failure", () => {
  const s = store(),
    intent = prepareMeetingTurn(1, 2, { prompt: "preserved" }, s);
  s.removeItem = () => {};
  assert.throws(() => acknowledgeMeetingTurn(intent, s), code("storage"));
  s.removeItem = () => {
    throw Error("blocked");
  };
  assert.throws(() => acknowledgeMeetingTurn(intent, s), code("storage"));
  assert.deepEqual(readMeetingTurnIntent(1, 2, s), intent);
});
test("dispatch preserves identity after a lost acknowledgement and reads never replay", async (t) => {
  const s = store(),
    descriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: s,
  });
  t.after(() => {
    if (descriptor)
      Object.defineProperty(globalThis, "sessionStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  });
  const intent = prepareMeetingTurn(1, 2, {
    prompt: "Exact request",
    participantAgentIds: [3],
  });
  let writes = 0;
  const outcome = {
    requestId: intent.requestId,
    meeting: { id: 2, taskId: 1, status: "in_progress" },
    participants: [],
    transcript: [],
    decisions: [],
    actionItems: [],
    agentTranscriptIds: [],
    skippedParticipants: [],
    execution: {
      requestedParticipantCount: 1,
      attemptedParticipantCount: 1,
      maxRespondersPerStart: 8,
      maxConcurrentMeetingStarts: 2,
      maxTokensPerResponse: 300,
    },
  };
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, options: RequestInit) => {
      if (options.method === "POST") {
        writes++;
        assert.deepEqual(JSON.parse(options.body as string), {
          ...intent.input,
          requestId: intent.requestId,
        });
        throw Error("Lost response");
      }
      return Response.json({
        requestId: intent.requestId,
        projectId: 1,
        meetingId: 2,
        state: "complete",
        httpStatus: 503,
        response: outcome,
      });
    },
  );
  await assert.rejects(dispatchMeetingTurn(intent), /Lost response/);
  assert.deepEqual(readMeetingTurnIntent(1, 2), intent);
  assert.equal((await readMeetingTurnReceipt(intent)).httpStatus, 503);
  assert.equal(writes, 1);
  assert.deepEqual(readMeetingTurnIntent(1, 2), intent);
  await assert.rejects(
    dispatchMeetingTurn({ ...intent, input: { prompt: "Changed" } }),
    code("invalid"),
  );
  assert.equal(writes, 1);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      requestId: crypto.randomUUID(),
      projectId: 1,
      meetingId: 2,
      state: "complete",
      httpStatus: 200,
      response: outcome,
    }),
  );
  await assert.rejects(readMeetingTurnReceipt(intent), code("invalid"));
  assert.deepEqual(readMeetingTurnIntent(1, 2), intent);
});
