import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  emptyTerminalSession,
  readTerminalSession,
  writeTerminalSession,
  validTerminalResult,
  sameTerminalRecord,
} from "./terminal-session";
import { loadComputerCopy } from "./computer-copy";
import { LOCALES } from "./i18n";

const result = {
  ok: true,
  exitCode: 0,
  stdout: "原文\r\nمتن",
  stderr: "",
  note: null,
  durationMs: 3,
  cwd: "/work",
};
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
test("terminal recovery retains exact mode, command and drafts without claiming an interrupted request failed", () => {
  const store = storage();
  const session = emptyTerminalSession(2);
  session.drafts.sandbox = "  write 日本語.txt متن\n";
  session.drafts.founder = "echo host";
  session.record = {
    agentId: 2,
    id: randomUUID(),
    command: session.drafts.sandbox,
    mode: "sandbox",
    startedAt: new Date().toISOString(),
    status: "pending",
  };
  assert.equal(writeTerminalSession(session, store), true);
  const loaded = readTerminalSession(2, store);
  assert.equal(loaded.damaged, false);
  assert.equal(loaded.session.record?.status, "unknown");
  assert.equal(loaded.session.record?.command, session.drafts.sandbox);
  assert.deepEqual(loaded.session.drafts, session.drafts);
  assert.equal(readTerminalSession(3, store).session.record, null);
  session.record.status = "returned";
  session.record.result = result;
  assert.equal(writeTerminalSession(session, store), true);
  assert.deepEqual(
    readTerminalSession(2, store).session.record?.result,
    result,
  );
});
test("damaged or unavailable local recovery and malformed command responses fail closed", () => {
  assert.equal(
    readTerminalSession(2, { getItem: () => "{", setItem() {} }).damaged,
    true,
  );
  const broken = {
    getItem(): string {
      throw Error("denied");
    },
    setItem() {
      throw Error("quota");
    },
  };
  assert.equal(readTerminalSession(2, broken).damaged, true);
  assert.equal(writeTerminalSession(emptyTerminalSession(2), broken), false);
  for (const response of [
    null,
    {},
    { ...result, privateConfig: "must-not-be-persisted" },
    { ...result, ok: true, exitCode: 1 },
    { ...result, stdout: "x".repeat(262145) },
    { ...result, durationMs: NaN },
    { ...result, note: {} },
  ])
    assert.equal(validTerminalResult(response), false);
  const store = storage();
  const wrong = emptyTerminalSession(2);
  wrong.record = {
    id: randomUUID(),
    agentId: 3,
    command: "touch file",
    mode: "founder",
    startedAt: new Date().toISOString(),
    status: "unknown",
  };
  writeTerminalSession(wrong, store);
  assert.equal(readTerminalSession(2, store).damaged, true);
});
test("computer and terminal copy has all seven language packs without missing controls", async () => {
  const english = await loadComputerCopy("en");
  for (const locale of LOCALES) {
    const copy = await loadComputerCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(english).sort());
    assert.ok(Object.values(copy).every((value) => value.trim().length > 0));
    assert.ok(copy.agentLabel.includes("{name}"));
    if (locale !== "en")
      assert.notEqual(copy.unconfirmedHelp, english.unconfirmedHelp);
  }
});

test("non-string recovery statuses are damaged and cannot strand the Terminal", () => {
  for (const status of [["pending"], ["unknown"], ["returned"], null, {}, 0]) {
    const raw = JSON.stringify({
      agentId: 2,
      drafts: { sandbox: "review me", founder: "" },
      record: {
        id: randomUUID(),
        agentId: 2,
        command: "touch must-not-repeat.txt",
        mode: "sandbox",
        startedAt: new Date().toISOString(),
        status,
      },
    });
    const loaded = readTerminalSession(2, { getItem: () => raw });
    assert.equal(loaded.damaged, true, JSON.stringify(status));
    assert.equal(loaded.session.record, null);
  }
});

test("version 2 intents retain their reviewed language and distinguish otherwise equal records", () => {
  for (const locale of LOCALES) {
    const store = storage();
    const session = emptyTerminalSession(2);
    session.record = {
      protocolVersion: 2,
      locale,
      id: randomUUID(),
      agentId: 2,
      command: "echo 原文",
      mode: "sandbox",
      startedAt: new Date().toISOString(),
      status: "pending",
    };
    assert.equal(writeTerminalSession(session, store), true);
    const recovered = readTerminalSession(2, store);
    assert.equal(recovered.damaged, false);
    assert.equal(recovered.session.record?.status, "unknown");
    assert.equal(recovered.session.record?.locale, locale);
    assert.equal(
      sameTerminalRecord(recovered.session.record, session.record),
      true,
    );
    assert.equal(
      sameTerminalRecord(recovered.session.record, {
        ...session.record,
        locale: locale === "en" ? "de" : "en",
      }),
      false,
    );
  }
});

test("recovery preserves old protocols and rejects locale smuggling or missing new locale", () => {
  const baseline = {
    id: randomUUID(),
    agentId: 2,
    command: "echo legacy",
    mode: "sandbox",
    startedAt: new Date().toISOString(),
    status: "unknown",
  };
  const read = (record: unknown) =>
    readTerminalSession(2, {
      getItem: () =>
        JSON.stringify({
          agentId: 2,
          drafts: { sandbox: "new draft", founder: "" },
          record,
        }),
    });
  for (const record of [baseline, { ...baseline, protocolVersion: 1 }]) {
    const result = read(record);
    assert.equal(result.damaged, false);
    assert.deepEqual(result.session.record, record);
  }
  for (const record of [
    { ...baseline, locale: "en" },
    { ...baseline, protocolVersion: 1, locale: "en" },
    { ...baseline, protocolVersion: 2 },
    { ...baseline, protocolVersion: 2, locale: "constructor" },
    { ...baseline, protocolVersion: 2, locale: null },
    { ...baseline, protocolVersion: 3, locale: "en" },
  ])
    assert.equal(read(record).damaged, true);
});
