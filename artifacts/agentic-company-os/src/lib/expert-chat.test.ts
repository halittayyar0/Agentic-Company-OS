import assert from "node:assert/strict";
import test from "node:test";
import { LOCALES } from "./i18n";
import { loadExpertChatCopy } from "./expert-chat-copy";
import {
  clearChatIntent,
  fetchChatPage,
  readChatIntent,
  readChatDraft,
  saveChatIntent,
  saveChatDraft,
  validateChatReceipt,
  type ChatIntent,
} from "./expert-chat";

const intent: ChatIntent = {
  agentId: 2,
  input: {
    requestId: "11111111-1111-4111-8111-111111111111",
    kind: "ask",
    locale: "zh-TW",
    expectedConfig: "a".repeat(64),
    content: "Original 原文\nتعليمات",
    modelMode: "auto",
  },
};
const message = (id: number, role = "user") => ({
  id,
  agentId: 2,
  role,
  content: intent.input.content,
  taskId: null,
  modelId: null,
  createdAt: "2026-09-27T08:00:00Z",
});
test("all chat languages cover the same nonempty composition, recovery and history states", async () => {
  const reference = await loadExpertChatCopy("en");
  for (const locale of LOCALES) {
    const copy = await loadExpertChatCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(reference).sort());
    assert.ok(
      Object.values(copy).every(
        (value) => typeof value === "string" && value.trim().length > 0,
      ),
    );
  }
});
test("pending identity and draft are isolated by expert and damaged storage fails closed", () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: storage,
  });
  try {
    assert.equal(saveChatIntent(intent), true);
    assert.deepEqual(readChatIntent(2), { intent, damaged: false });
    assert.deepEqual(readChatIntent(3), { intent: null, damaged: false });
    assert.equal(saveChatDraft(2, "Different draft", "continuous"), true);
    assert.deepEqual(readChatDraft(2), {
      content: "Different draft",
      kind: "continuous",
    });
    assert.deepEqual(readChatIntent(2).intent, intent);
    for (const invalid of [
      {},
      { ...intent, agentId: 3 },
      { ...intent, input: { ...intent.input, content: " " } },
      { ...intent, input: { ...intent.input, locale: "zh" } },
      { ...intent, input: { ...intent.input, expectedConfig: "short" } },
      { ...intent, input: { ...intent.input, taskId: 7 } },
      {
        ...intent,
        input: { ...intent.input, kind: "delegate", content: "x".repeat(8001) },
      },
    ]) {
      data.set("acos.expert-send.v1:2", JSON.stringify(invalid));
      assert.equal(readChatIntent(2).damaged, true);
    }
    assert.equal(clearChatIntent(2), true);
    storage.setItem = () => {
      throw new Error("Unavailable storage");
    };
    assert.equal(saveChatIntent(intent), false);
    storage.getItem = () => {
      throw new Error("Unavailable storage");
    };
    assert.equal(readChatIntent(2).damaged, true);
    assert.equal(clearChatIntent(2), false);
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis, "sessionStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
test("receipt validation rejects mismatched or fabricated completion and preserves system outcomes", () => {
  const pending = {
    requestId: intent.input.requestId,
    agentId: 2,
    kind: "ask",
    replayed: false,
    deliveryState: "unconfirmed",
    outcome: "unconfirmed",
    createdAgents: [],
    createdTasks: [],
  };
  assert.equal(
    validateChatReceipt(pending, intent).deliveryState,
    "unconfirmed",
  );
  const complete = {
    ...pending,
    deliveryState: "complete",
    outcome: "reply",
    userMessage: message(1),
    agentMessage: message(2, "agent"),
  };
  assert.equal(validateChatReceipt(complete, intent).outcome, "reply");
  for (const invalid of [
    { ...complete, agentId: 3 },
    { ...complete, requestId: "other" },
    { ...complete, userMessage: message(1, "agent") },
    { ...complete, agentMessage: undefined },
    { ...complete, agentMessage: { ...message(2, "agent"), taskId: 3 } },
    { ...complete, outcome: "provider_error" },
    { ...complete, usedProvider: {} },
    { ...complete, usedModel: "not-the-recorded-model" },
    {
      ...pending,
      deliveryState: "rejected",
      outcome: "rejected",
      userMessage: message(1),
      failureCode: "AGENT_BUSY",
    },
  ])
    assert.throws(() => validateChatReceipt(invalid, intent));
  assert.equal(
    validateChatReceipt(
      {
        ...complete,
        outcome: "provider_error",
        agentMessage: message(2, "system"),
      },
      intent,
    ).agentMessage?.role,
    "system",
  );
});
test("history accepts only a bounded direct conversation and its exact older cursor", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify([message(2), message(1)]), {
        headers: { "X-Next-Before-Id": "1" },
      });
    assert.deepEqual(
      (await fetchChatPage(2)).messages.map((row) => row.id),
      [1, 2],
    );
    for (const [rows, cursor] of [
      [[{ ...message(1), agentId: 3 }], "1"],
      [[{ ...message(1), taskId: 9 }], "1"],
      [[message(1), message(1)], "1"],
      [[message(2)], "1"],
      [[message(1)], "1.5"],
    ] as const) {
      globalThis.fetch = async () =>
        new Response(JSON.stringify(rows), {
          headers: { "X-Next-Before-Id": cursor },
        });
      await assert.rejects(fetchChatPage(2));
    }
    globalThis.fetch = async () => new Response(JSON.stringify([message(2)]));
    await assert.rejects(fetchChatPage(2, 2));
  } finally {
    globalThis.fetch = original;
  }
});

test("project history and receipts reject another project and direct conversation", async () => {
  const scoped: ChatIntent = {
    ...intent,
    input: { ...intent.input, taskId: 7 },
  };
  const receipt = {
    requestId: scoped.input.requestId,
    agentId: 2,
    taskId: 7,
    kind: "ask",
    replayed: false,
    deliveryState: "complete",
    outcome: "reply",
    createdAgents: [],
    createdTasks: [],
    userMessage: { ...message(1), taskId: 7 },
    agentMessage: { ...message(2, "agent"), taskId: 7 },
  };
  assert.equal(validateChatReceipt(receipt, scoped).outcome, "reply");
  for (const wrong of [undefined, 8])
    assert.throws(() =>
      validateChatReceipt({ ...receipt, taskId: wrong }, scoped),
    );
  assert.throws(() => validateChatReceipt(receipt, intent));
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      assert.match(String(url), /taskId=7/);
      return new Response(JSON.stringify([{ ...message(1), taskId: 7 }]));
    };
    assert.equal(
      (await fetchChatPage(2, undefined, undefined, 7)).messages[0].taskId,
      7,
    );
    globalThis.fetch = async () => new Response(JSON.stringify([message(1)]));
    await assert.rejects(fetchChatPage(2, undefined, undefined, 7));
  } finally {
    globalThis.fetch = original;
  }
});

test("project outboxes and drafts cannot overwrite another scope or a newer identity", () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    },
  });
  try {
    const scoped: ChatIntent = {
      ...intent,
      input: { ...intent.input, taskId: 7 },
    };
    assert.equal(saveChatIntent(intent), true);
    assert.equal(saveChatIntent(scoped), true);
    assert.equal(readChatIntent(2).intent?.input.taskId, undefined);
    assert.equal(readChatIntent(2, 7).intent?.input.taskId, 7);
    assert.equal(readChatIntent(2, 8).intent, null);
    assert.equal(saveChatDraft(2, "Direct", "ask"), true);
    assert.equal(saveChatDraft(2, "Project", "ask", 7), true);
    assert.equal(readChatDraft(2)?.content, "Direct");
    assert.equal(readChatDraft(2, 7)?.content, "Project");
    assert.equal(
      clearChatIntent(2, 7, "22222222-2222-4222-8222-222222222222"),
      false,
    );
    assert.ok(readChatIntent(2, 7).intent);
    assert.equal(clearChatIntent(2, 7, scoped.input.requestId), true);
    assert.ok(readChatIntent(2).intent);
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis, "sessionStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
