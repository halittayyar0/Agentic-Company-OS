import assert from "node:assert/strict";
import test from "node:test";
import { loadWorkforceCopy } from "./workforce-copy";
import { LOCALES } from "./i18n";
import {
  readWorkforceIntent,
  saveWorkforceIntent,
  clearWorkforceIntent,
  workforceRejection,
  type WorkforceIntent,
} from "./workforce-installation";

test("all team interface packs cover the same recovery and installation states", async () => {
  const keys = Object.keys(await loadWorkforceCopy("en")).sort();
  for (const locale of LOCALES) {
    const copy = await loadWorkforceCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), keys);
    for (const value of Object.values(copy)) assert.ok(value.trim());
  }
});

test("transport errors never imply rollback; only known server rejections release the installation intent", () => {
  assert.equal(workforceRejection(new Error("Network failed")), null);
  assert.equal(
    workforceRejection({ status: 503, data: { error: "Server busy" } }),
    null,
  );
  assert.equal(
    workforceRejection({
      status: 409,
      data: { code: "WORKFORCE_INSTALLATION_REQUEST_CONFLICT" },
    }),
    null,
  );
  assert.equal(
    workforceRejection({
      data: { code: "WORKFORCE_BLUEPRINT_VERSION_CHANGED" },
    }),
    "versionChanged",
  );
  assert.equal(
    workforceRejection({ data: { code: "EMERGENCY_STOP_ACTIVE" } }),
    "stopped",
  );
});

test("a pending intent survives serialization, rejects malformed storage and fails closed when persistence is denied", () => {
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  let saved: string | null = null;
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: () => saved,
      setItem: (_key: string, value: string) => {
        saved = value;
      },
      removeItem: () => {
        saved = null;
      },
    },
  });
  try {
    const intent: WorkforceIntent = {
      blueprintKey: "product-shipping-crew",
      data: {
        requestId: "11111111-1111-4111-8111-111111111111",
        blueprintVersion: 1,
        locale: "zh-TW",
        managerAgentId: 1,
        outcome: "Review this exact outcome",
        autonomyMode: "continuous",
        cadenceSeconds: 3600,
      },
    };
    assert.equal(saveWorkforceIntent(intent), true);
    assert.deepEqual(readWorkforceIntent(), intent);
    clearWorkforceIntent();
    assert.equal(readWorkforceIntent(), null);
    for (const value of [
      "{",
      "null",
      "{}",
      JSON.stringify({ data: intent.data }),
      JSON.stringify({
        ...intent,
        data: { ...intent.data, requestId: "changed" },
      }),
      JSON.stringify({ ...intent, data: { ...intent.data, locale: "xx" } }),
    ]) {
      saved = value;
      assert.equal(readWorkforceIntent(), null);
    }
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("Denied");
      },
    });
    assert.equal(saveWorkforceIntent(intent), false);
    assert.equal(readWorkforceIntent(), null);
  } finally {
    if (original) Object.defineProperty(globalThis, "sessionStorage", original);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
