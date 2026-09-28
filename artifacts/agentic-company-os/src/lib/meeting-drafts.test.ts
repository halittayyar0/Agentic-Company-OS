import assert from "node:assert/strict";
import test from "node:test";
import { LOCALES } from "./i18n";
import { loadMeetingCopy } from "./meeting-copy";
import {
  emptyMeetingSession,
  emptyMeetingDraft,
  meetingDraftKey,
  readMeetingDrafts,
  writeMeetingDrafts,
} from "./meeting-drafts";
const storage = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};
test("meeting copy has complete matching keys and placeholders in seven languages", async () => {
  const base = await loadMeetingCopy("en");
  const slots = (value: string) =>
    [...value.matchAll(/\{(\w+)\}/g)].map((v) => v[1]).sort();
  for (const locale of LOCALES) {
    const copy = await loadMeetingCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(base).sort());
    for (const key of Object.keys(base) as (keyof typeof base)[]) {
      assert.ok(copy[key].trim(), locale + key);
      assert.deepEqual(slots(copy[key]), slots(base[key]), locale + key);
    }
  }
  assert.notDeepEqual(
    await loadMeetingCopy("zh-CN"),
    await loadMeetingCopy("zh-TW"),
  );
});
test("meeting drafts round-trip exact Unicode, selections and meeting scope", () => {
  const s = storage(),
    session = emptyMeetingSession(7);
  session.title = "原文 — العربية";
  session.agenda = "Line one\nLine two";
  session.createOpen = true;
  session.participantIds = [5, 2];
  session.selectedMeetingId = 8;
  session.drafts[8] = {
    ...emptyMeetingDraft,
    transcriptDraft: "  Do not trim my draft  ",
    decisionDraft: "Decision",
    decisionOwnerId: 2,
    actionDraft: "Action",
    completionSummary: "Summary",
  };
  session.drafts[9] = {
    ...emptyMeetingDraft,
    transcriptDraft: "Other meeting",
  };
  assert.equal(writeMeetingDrafts(session, s), true);
  assert.deepEqual(readMeetingDrafts(7, s), {
    session,
    damaged: false,
    storageError: false,
  });
  assert.deepEqual(readMeetingDrafts(8, s).session, emptyMeetingSession(8));
});
test("damaged drafts are not mistaken for empty storage or overwritten on read", () => {
  const s = storage();
  for (const raw of [
    "broken",
    JSON.stringify({ ...emptyMeetingSession(7), projectId: 8 }),
    JSON.stringify({ ...emptyMeetingSession(7), participantIds: [2, 2] }),
    JSON.stringify({
      ...emptyMeetingSession(7),
      drafts: { bad: emptyMeetingDraft },
    }),
  ]) {
    s.data.set(meetingDraftKey(7), raw);
    const result = readMeetingDrafts(7, s);
    assert.equal(result.damaged, true);
    assert.equal(result.storageError, true);
    assert.equal(s.data.get(meetingDraftKey(7)), raw);
  }
});
test("blocked, no-op and oversized storage writes never claim persistence", () => {
  const s = storage(),
    session = emptyMeetingSession(7);
  session.drafts[8] = { ...emptyMeetingDraft, actionDraft: "x".repeat(501) };
  assert.equal(writeMeetingDrafts(session, s), false);
  assert.equal(s.data.size, 0);
  delete session.drafts[8];
  s.setItem = () => {};
  assert.equal(writeMeetingDrafts(session, s), false);
  s.setItem = () => {
    throw Error("Full");
  };
  assert.equal(writeMeetingDrafts(session, s), false);
  s.getItem = () => {
    throw Error("Unavailable");
  };
  assert.equal(readMeetingDrafts(7, s).storageError, true);
});
