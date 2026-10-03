import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db, dbReady, closeDatabase } from "@workspace/db";
import { createPostgresChatGPTRegistrationStore } from "./chatgpt-registration-store";
import { createChatGPTConnectionRuntime } from "./chatgpt-connection-runtime";

test("runtime shutdown cancels private callbacks and refuses delayed or future connection admission", async () => {
  await dbReady;
  try {
    const store = await createPostgresChatGPTRegistrationStore(
      db,
      "fixture-runtime-key-not-a-human-secret",
    );
    const runtime = createChatGPTConnectionRuntime({
      store: async () => store,
    });
    const controller = await runtime.controller();
    const attempt = await controller.beginSignIn();
    const callback = new URL(attempt.authorizeUrl).searchParams.get(
      "redirect_uri",
    )!;
    await runtime.close();
    await assert.rejects(fetch(callback), /fetch failed/);
    await assert.rejects(runtime.controller(), /runtime_closed/);
    await assert.rejects(runtime.store(), /runtime_closed/);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const delayed = createChatGPTConnectionRuntime({
      store: async () => {
        await gate;
        return store;
      },
    });
    const pending = delayed.controller();
    const rejection = assert.rejects(pending, /runtime_closed/);
    const closing = delayed.close();
    release();
    await Promise.all([closing, rejection]);
    assert.equal(await store.readRegistration(randomUUID()), null);
  } finally {
    await closeDatabase();
  }
});
