import assert from "node:assert/strict";
import test from "node:test";
import { loadOperatorCopy } from "./operator-copy";
import { LOCALES } from "./i18n";
import { readOperatorReceipt, readOperatorResponse } from "./operator-request";
import {
  emptyTerminalSession,
  readTerminalSession,
  writeTerminalSession,
  sameTerminalRecord,
  validTerminalResult,
} from "./terminal-session";

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const expected = { agentId: 2, requestId, kind: "terminal_sandbox" as const };
const result = {
  ok: true,
  exitCode: 0,
  stdout: "原文 العربية\n",
  stderr: "",
  durationMs: 10,
  note: null,
  cwd: "/",
};
const receipt = {
  ...expected,
  state: "complete",
  createdAt: "2026-09-27T10:00:00.000Z",
  expiresAt: "2026-09-27T10:03:00.000Z",
  dispatchedAt: "2026-09-27T10:00:01.000Z",
  completedAt: "2026-09-27T10:00:02.000Z",
  failureCode: null,
  terminal: { ok: true, exitCode: 0, durationMs: 10 },
  resultAvailability: "available",
  result,
};
test("operator results require exact scope, coherent metadata and matching result envelopes", () => {
  assert.deepEqual(readOperatorReceipt(receipt, expected), receipt);
  assert.deepEqual(readOperatorResponse({ receipt, result }, expected), {
    receipt,
    result,
  });
  for (const corrupt of [
    { ...receipt, agentId: 3 },
    { ...receipt, requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    { ...receipt, kind: "terminal_host" },
    { ...receipt, ownerId: "private" },
    { ...receipt, state: "reserved" },
    { ...receipt, terminal: { ...receipt.terminal, exitCode: 1 } },
    { ...receipt, resultAvailability: "unavailable" },
    { ...receipt, failureCode: "execution_error" },
  ])
    assert.throws(() => readOperatorReceipt(corrupt, expected));
  assert.throws(() =>
    readOperatorResponse(
      { receipt, result: { ...result, stdout: "different request" } },
      expected,
    ),
  );
  assert.throws(() =>
    readOperatorResponse({ receipt, result, privateLease: "secret" }, expected),
  );
  const unavailable = {
    ...receipt,
    result: null,
    resultAvailability: "unavailable",
  };
  assert.equal(
    readOperatorReceipt(unavailable, expected).state,
    "complete",
    "lost encryption key never becomes permission to replay",
  );
  const browser = {
    ...receipt,
    kind: "browser_input" as const,
    terminal: null,
    result: null,
    resultAvailability: "not_applicable",
  };
  assert.equal(
    readOperatorReceipt(browser, { ...expected, kind: "browser_input" }).state,
    "complete",
  );
  assert.throws(() =>
    readOperatorReceipt(
      { ...browser, result: { leaseId: requestId } },
      { ...expected, kind: "browser_input" },
    ),
  );
});
test("local records distinguish legacy IDs, require readback and correlate complete original intent", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const session = emptyTerminalSession(2);
  session.record = {
    id: requestId,
    agentId: 2,
    command: "  echo 原文 ",
    mode: "sandbox",
    status: "pending",
    startedAt: receipt.createdAt,
    protocolVersion: 1,
  };
  assert.equal(writeTerminalSession(session, storage), true);
  const current = readTerminalSession(2, storage);
  assert.equal(current.damaged, false);
  assert.equal(current.session.record?.protocolVersion, 1);
  assert.equal(current.session.record?.status, "unknown");
  const legacy = { ...session, record: { ...session.record } };
  delete legacy.record.protocolVersion;
  assert.equal(writeTerminalSession(legacy, storage), true);
  assert.equal(
    readTerminalSession(2, storage).session.record?.protocolVersion,
    undefined,
  );
  assert.equal(
    writeTerminalSession(session, { getItem: () => null, setItem() {} }),
    false,
    "silent storage drops must prevent dispatch",
  );
  assert.equal(
    sameTerminalRecord(session.record, {
      ...session.record,
      status: "unknown",
    }),
    true,
  );
  assert.equal(
    sameTerminalRecord(session.record, {
      ...session.record,
      command: "other source",
    }),
    false,
  );
  assert.equal(
    sameTerminalRecord(session.record, { ...session.record, mode: "founder" }),
    false,
  );
  assert.equal(sameTerminalRecord(session.record, legacy.record), false);
});
test("terminal accepts the real host output ceiling and rejects impossible metadata", () => {
  assert.equal(
    validTerminalResult({ ...result, stdout: "x".repeat(262144) }),
    true,
  );
  assert.equal(
    validTerminalResult({ ...result, stdout: "x".repeat(262145) }),
    false,
  );
  assert.equal(validTerminalResult({ ...result, durationMs: 1.5 }), false);
  assert.equal(
    validTerminalResult({ ...result, ok: false, exitCode: 2147483648 }),
    false,
  );
});
test("operator recovery copy is complete in all seven selected language packs", async () => {
  const english = await loadOperatorCopy("en");
  for (const locale of LOCALES) {
    const copy = await loadOperatorCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(english).sort());
    assert.ok(
      Object.values(copy).every(
        (value) => typeof value === "string" && value.trim().length > 0,
      ),
    );
  }
});
