import assert from "node:assert/strict";
import test from "node:test";
import {
  configureDirectOpenAI,
  configureOpenRouter,
  configureOllama,
  createChatCompletion,
  resolveOllamaEndpoint,
} from "@workspace/ai-server";
import { eq } from "drizzle-orm";
import { encryptRuntimeEnvelope } from "./runtime-control-crypto";

test("split provider configuration revisions are monotonic and merge concurrent patches", async () => {
  const previous = {
    role: process.env.RUNTIME_ROLE,
    key: process.env.RUNTIME_CONTROL_KEY,
    databaseUrl: process.env.DATABASE_URL,
  };
  process.env.RUNTIME_ROLE = "api";
  process.env.RUNTIME_CONTROL_KEY = "provider-runtime-config-test-key-32-bytes";
  delete process.env.DATABASE_URL;
  try {
    const {
      closeDatabase,
      db,
      dbReady,
      providerRuntimeConfigAcksTable,
      providerRuntimeConfigTable,
      runtimeInstancesTable,
    } = await import("@workspace/db");
    const {
      installProviderRuntimeConfigGuard,
      prepareProviderRuntimeConfig,
      resetProviderRuntimeConfigForTest,
      setProviderRuntimeIdentity,
      updateProviderRuntimeConfig,
      syncProviderRuntimeConfig,
    } = await import("./provider-runtime-config");
    await dbReady;
    const envelope = encryptRuntimeEnvelope(
      { openrouterApiKey: null, openaiApiKey: null },
      process.env.RUNTIME_CONTROL_KEY,
    );
    await db.insert(providerRuntimeConfigTable).values({
      singletonId: 1,
      revision: 1,
      ...envelope,
    });

    const updates = await Promise.all([
      updateProviderRuntimeConfig({ openrouterApiKey: "openrouter-test-key" }),
      updateProviderRuntimeConfig({ openaiApiKey: "openai-test-key" }),
    ]);
    assert.deepEqual(
      updates.map((update) => update.revision).sort((a, b) => a - b),
      [2, 3],
    );
    const latest = updates.find((update) => update.revision === 3);
    assert.equal(latest?.config.openrouterApiKey, "openrouter-test-key");
    assert.equal(latest?.config.openaiApiKey, "openai-test-key");

    const [stored] = await db.select().from(providerRuntimeConfigTable);
    assert.equal(stored?.revision, 3);
    assert.equal(stored?.ciphertext.includes("openrouter-test-key"), false);
    assert.equal(stored?.ciphertext.includes("openai-test-key"), false);
    await assert.rejects(
      updateProviderRuntimeConfig(
        { openaiApiKey: "stale-key" },
        process.env,
        1,
      ),
      (error: unknown) =>
        (error as { code?: string }).code === "LLM_CONFIG_CHANGED",
    );
    const [afterConflict] = await db.select().from(providerRuntimeConfigTable);
    assert.equal(afterConflict?.revision, 3);
    assert.equal(afterConflict?.ciphertext, stored?.ciphertext);

    const runtimeId = "55555555-5555-4555-8555-555555555555";
    const [runtime] = await db
      .insert(runtimeInstancesTable)
      .values({
        id: runtimeId,
        role: "worker",
        state: "healthy",
        hostname: "provider-config-test",
        processId: 5505,
        buildVersion: "test",
        schedulerEnabled: true,
      })
      .returning({ startedAt: runtimeInstancesTable.startedAt });
    assert.ok(runtime);

    const prepared = await prepareProviderRuntimeConfig(process.env);
    configureOpenRouter({ apiKey: null });
    configureDirectOpenAI({ apiKey: prepared.openaiApiKey ?? null });
    installProviderRuntimeConfigGuard(process.env);
    await setProviderRuntimeIdentity(
      { id: runtimeId, startedAt: runtime.startedAt },
      process.env,
    );
    const rotated = await updateProviderRuntimeConfig({
      openrouterApiKey: null,
      openaiApiKey: "rotated-openai-test-key",
    });
    assert.equal(rotated.revision, 4);

    const originalFetch = globalThis.fetch;
    let networkCalls = 0;
    let inferenceCalls = 0;
    let authorization = "";
    globalThis.fetch = (async (input, init) => {
      networkCalls += 1;
      const request =
        input instanceof Request
          ? input
          : new Request(input, init as RequestInit);
      authorization = request.headers.get("authorization") ?? "";
      const [ackBeforeNetwork] = await db
        .select()
        .from(providerRuntimeConfigAcksTable)
        .where(eq(providerRuntimeConfigAcksTable.runtimeInstanceId, runtimeId));
      assert.equal(ackBeforeNetwork?.attemptedRevision, 4);
      assert.equal(ackBeforeNetwork?.appliedRevision, 4);
      assert.equal(ackBeforeNetwork?.state, "applied");
      if (new URL(request.url).hostname === "openrouter.ai") {
        assert.equal(request.headers.has("authorization"), false);
        return new Response(JSON.stringify({ data: [], total_count: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      inferenceCalls += 1;
      return new Response(
        JSON.stringify({
          id: "chatcmpl-provider-revision",
          object: "chat.completion",
          created: 1,
          model: "gpt-5.6-terra",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "OK" },
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const mutableDb = db as typeof db & { insert: typeof db.insert };
    const originalInsert = mutableDb.insert;
    const ackFailure = new Error("synthetic provider ack outage");
    mutableDb.insert = (() => {
      throw ackFailure;
    }) as typeof db.insert;
    try {
      await assert.rejects(
        createChatCompletion({
          model: "openai:gpt-5.6-terra",
          messages: [{ role: "user", content: "must remain local" }],
          maxTokens: 8,
        }),
        ackFailure,
      );
      assert.equal(networkCalls, 0);
    } finally {
      mutableDb.insert = originalInsert;
    }

    await createChatCompletion({
      model: "openai:gpt-5.6-terra",
      messages: [{ role: "user", content: "revision applied" }],
      maxTokens: 8,
    });
    assert.equal(networkCalls, 2);
    assert.equal(inferenceCalls, 1);
    assert.equal(authorization, "Bearer rotated-openai-test-key");

    globalThis.fetch = originalFetch;
    const localAddress = "http://192.168.1.2:11434/v1";
    const localRevision = await updateProviderRuntimeConfig({
      ollamaBaseUrl: localAddress,
    });
    assert.equal(localRevision.revision, 5);
    assert.equal(localRevision.config.ollamaBaseUrl, localAddress);
    await assert.rejects(
      updateProviderRuntimeConfig({ ollamaBaseUrl: "https://public.example" }),
    );
    const [localStored] = await db.select().from(providerRuntimeConfigTable);
    assert.equal(localStored?.revision, 5);
    assert.equal(localStored?.ciphertext.includes(localAddress), false);
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(input, init as RequestInit);
      const [ack] = await db
        .select()
        .from(providerRuntimeConfigAcksTable)
        .where(eq(providerRuntimeConfigAcksTable.runtimeInstanceId, runtimeId));
      assert.equal(ack?.appliedRevision, 5);
      assert.equal(ack?.state, "applied");
      assert.notEqual(new URL(request.url).pathname, "/v1/chat/completions");
      return Response.json(
        new URL(request.url).hostname === "openrouter.ai"
          ? { data: [] }
          : { models: [] },
      );
    }) as typeof fetch;
    try {
      await syncProviderRuntimeConfig(process.env);
      assert.equal(resolveOllamaEndpoint()?.openAIBaseUrl, localAddress);
    } finally {
      globalThis.fetch = originalFetch;
      configureOllama({ baseUrl: null });
    }
    resetProviderRuntimeConfigForTest();
    configureOpenRouter({ apiKey: null });
    configureDirectOpenAI({ apiKey: null });
    await closeDatabase();
  } finally {
    if (previous.role === undefined) delete process.env.RUNTIME_ROLE;
    else process.env.RUNTIME_ROLE = previous.role;
    if (previous.key === undefined) delete process.env.RUNTIME_CONTROL_KEY;
    else process.env.RUNTIME_CONTROL_KEY = previous.key;
    if (previous.databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous.databaseUrl;
  }
});
