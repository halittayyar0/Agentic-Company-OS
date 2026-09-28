import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareOperationIntent,
  operationIntentKey,
} from "./operation-recovery";
import {
  dispatchOperationIntent,
  readOperationReceipt,
} from "./operation-recovery-api";

test("exact receipt review validates scope and immutable audit consistency; no-store encoded GET only", async () => {
  const original = globalThis.fetch;
  const audit = {
    receiptId: "receipt/原文",
    state: "unknown",
    decision: "confirmed_applied",
    note: "Original evidence",
    actorId: "operator",
    reconciledAt: "2026-09-27T10:00:00.000Z",
  };
  const receipt = {
    id: audit.receiptId,
    state: "unknown",
    reconciliation: {
      eligible: false,
      decision: audit.decision,
      reconciledAt: audit.reconciledAt,
    },
  };
  let body: unknown = { projectId: 101, receipt, audit };
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(body);
  };
  try {
    const result = await readOperationReceipt(101, audit.receiptId);
    assert.equal(result.kind, "recorded");
    if (result.kind === "recorded") assert.deepEqual(result.audit, audit);
    assert.equal(
      calls[0].url,
      "/api/tasks/101/operations/receipts/receipt%2F%E5%8E%9F%E6%96%87",
    );
    assert.equal(calls[0].init?.method, "GET");
    assert.equal(calls[0].init?.cache, "no-store");
    for (const bad of [
      { projectId: 102, receipt, audit },
      { projectId: 101, receipt: { ...receipt, id: "other" }, audit },
      { projectId: 101, receipt, audit: null },
      {
        projectId: 101,
        receipt,
        audit: { ...audit, decision: "confirmed_not_applied" },
      },
      {
        projectId: 101,
        receipt: {
          ...receipt,
          reconciliation: { ...receipt.reconciliation, eligible: true },
        },
        audit,
      },
      { projectId: 101, receipt, audit: { ...audit, note: "界".repeat(667) } },
    ]) {
      body = bad;
      await assert.rejects(readOperationReceipt(101, audit.receiptId));
    }
    body = {
      projectId: 101,
      receipt: {
        ...receipt,
        reconciliation: { eligible: true, decision: null, reconciledAt: null },
      },
      audit: null,
    };
    assert.equal(
      (await readOperationReceipt(101, audit.receiptId)).kind,
      "eligible",
    );
    for (const state of ["reserved", "running", "succeeded", "failed"]) {
      body = {
        projectId: 101,
        receipt: {
          ...receipt,
          state,
          reconciliation: {
            eligible: false,
            decision: null,
            reconciledAt: null,
          },
        },
        audit: null,
      };
      assert.equal(
        (await readOperationReceipt(101, audit.receiptId)).kind,
        "ineligible",
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("dispatch sends only an unchanged saved intent; malformed replies remain unresolved", async () => {
  const data = new Map<string, string>();
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
  const intent = prepareOperationIntent(
    {
      projectId: 101,
      receiptId: "receipt/a",
      decision: "confirmed_not_applied",
      note: " Original note ",
    },
    store,
  );
  let calls = 0;
  let bad = false;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), "/api/ops/receipts/receipt%2Fa/reconcile");
    assert.equal(
      init?.body,
      JSON.stringify({ decision: intent.decision, note: intent.note }),
    );
    return Response.json({
      receiptId: bad ? "other" : intent.receiptId,
      state: "unknown",
      decision: intent.decision,
      note: intent.note,
      actorId: "operator",
      reconciledAt: "2026-09-27T10:00:00.000Z",
    });
  };
  try {
    await assert.rejects(
      dispatchOperationIntent({ ...intent, note: "Changed" }, store),
    );
    assert.equal(calls, 0);
    await dispatchOperationIntent(intent, store);
    assert.equal(calls, 1);
    bad = true;
    await assert.rejects(dispatchOperationIntent(intent, store));
    data.delete(operationIntentKey(101));
    await assert.rejects(dispatchOperationIntent(intent, store));
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});
