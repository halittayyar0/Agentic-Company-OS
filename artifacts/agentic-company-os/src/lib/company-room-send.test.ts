import assert from "node:assert/strict";
import test from "node:test";
import { LOCALES } from "./i18n";
import { loadCompanyRoomCopy } from "./company-room-copy";
import {
  clearRoomIntent,
  mentionPattern,
  readRoomIntent,
  roomSendRejection,
  saveRoomIntent,
  type RoomSendIntent,
} from "./company-room-send";

test("all room languages cover the same nonempty recovery, routing and history states", async () => {
  const keys = Object.keys(await loadCompanyRoomCopy("en")).sort();
  for (const locale of LOCALES) {
    const copy = await loadCompanyRoomCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), keys);
    for (const value of Object.values(copy)) assert.ok(value.trim());
  }
});

test("mention removal preserves longer names, email addresses and adjacent source text", () => {
  assert.equal(mentionPattern("Ali").test("@Alice"), false);
  assert.equal(mentionPattern("Ali").test("mail@Ali.example"), false);
  assert.equal(mentionPattern("A+B [Ops]").test("(@A+B [Ops])"), true);
  for (const name of ["Ali", "研究员", "الباحث", "Мария", "Ada Lovelace"]) {
    const text = `Keep (@${name}), then @${name}. Original 原文`;
    assert.equal(
      text.replace(mentionPattern(name, true), "$1"),
      "Keep (), then . Original 原文",
    );
  }
});

test("only known pre-dispatch rejection codes permit releasing a pending send", () => {
  for (const error of [
    new Error("Network"),
    { status: 400 },
    { status: 503, data: { error: "Failed" } },
    null,
  ])
    assert.equal(roomSendRejection(error), null);
  assert.equal(
    roomSendRejection({ data: { code: "COMPANY_MEMBER_CHANGED" } }),
    "invalidMention",
  );
  assert.equal(
    roomSendRejection({ data: { code: "COMPANY_REQUEST_CONFLICT" } }),
    "conflict",
  );
  assert.equal(
    roomSendRejection({ data: { code: "EMERGENCY_STOP_ACTIVE" } }),
    "stopped",
  );
});

test("a pending room send round-trips exactly and fails closed on damaged or unavailable storage", () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  let raw: string | null = null;
  const storage = {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
    removeItem: () => {
      raw = null;
    },
  };
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: storage,
  });
  try {
    const intent: RoomSendIntent = {
      requestId: "11111111-1111-4111-8111-111111111111",
      locale: "zh-TW",
      content: "@研究员 Original 原文",
      mentionedAgentIds: [4, 2],
    };
    assert.equal(saveRoomIntent(intent), true);
    assert.deepEqual(readRoomIntent(), intent);
    clearRoomIntent();
    assert.equal(readRoomIntent(), null);
    for (const invalid of [
      null,
      {},
      { ...intent, requestId: "new" },
      { ...intent, locale: "zh" },
      { ...intent, content: " " },
      { ...intent, content: "x".repeat(4001) },
      { ...intent, mentionedAgentIds: [1, 1] },
      { ...intent, mentionedAgentIds: [-1] },
      { ...intent, mentionedAgentIds: ["4"] },
    ]) {
      raw = JSON.stringify(invalid);
      assert.equal(readRoomIntent(), null);
    }
    raw = "{";
    assert.equal(readRoomIntent(), null);
    storage.setItem = () => {
      throw new Error("Quota denied");
    };
    assert.equal(saveRoomIntent(intent), false);
    storage.getItem = () => {
      throw new Error("Storage denied");
    };
    assert.equal(readRoomIntent(), null);
    storage.removeItem = () => {
      throw new Error("Storage denied");
    };
    assert.doesNotThrow(clearRoomIntent);
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis, "sessionStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
