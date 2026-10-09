import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  db,
  dbReady,
  closeDatabase,
  inferenceAttemptsTable,
  usageEventsTable,
  inferenceResponseEvidenceTable,
  inferenceUsageCorrectionsTable,
} from "@workspace/db";
import type { createChatCompletion } from "@workspace/ai-server";
import {
  runAccountedCompletion,
  InferenceAccountingError,
} from "./inference-accounting";
test.after(() => closeDatabase());

async function fixture(t: test.TestContext) {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Owned accounting fixture",
      role: "Fixture",
      systemPrompt: "Fixture",
    })
    .returning();
  t.after(async () => {
    const owned = await db
      .select()
      .from(inferenceAttemptsTable)
      .where(eq(inferenceAttemptsTable.agentId, agent.id));
    for (const a of owned)
      await db
        .delete(inferenceUsageCorrectionsTable)
        .where(eq(inferenceUsageCorrectionsTable.attemptId, a.id));
    for (const a of owned)
      await db
        .delete(inferenceResponseEvidenceTable)
        .where(eq(inferenceResponseEvidenceTable.attemptId, a.id));
    await db
      .delete(usageEventsTable)
      .where(eq(usageEventsTable.agentId, agent.id));
    await db
      .delete(inferenceAttemptsTable)
      .where(eq(inferenceAttemptsTable.agentId, agent.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });
  const context = {
    agentId: agent.id,
    taskId: null,
    provider: "openrouter",
    modelId: "fixture",
    kind: "chat" as const,
  };
  let calls = 0;
  const complete: typeof createChatCompletion = async (params) => {
    assert.equal(params.disableRetries, true);
    await params.beforeRequest?.();
    calls++;
    return {
      provider: "openrouter",
      completion: {
        id: "fixture",
        object: "chat.completion",
        created: 1,
        model: "fixture",
        choices: [],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      },
    };
  };
  const run = (runner = complete) =>
    runAccountedCompletion(context, { model: "fixture", messages: [] }, runner);
  return {
    agent,
    context,
    complete,
    run,
    calls: () => calls,
    attempts: () =>
      db
        .select()
        .from(inferenceAttemptsTable)
        .where(eq(inferenceAttemptsTable.agentId, agent.id)),
    events: () =>
      db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.agentId, agent.id)),
  };
}

test("a completion is durable before returning, with one ordinary keyed receipt", async (t) => {
  const f = await fixture(t);
  const result = await f.run();
  assert.equal(result.usage.totalTokens, 5);
  assert.equal(f.calls(), 1);
  const attempts = await f.attempts(),
    events = await f.events();
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].state, "accounted");
  assert.equal(events.length, 1);
  assert.equal(events[0].ordinaryInferenceId, attempts[0].id);
  assert.match(
    String(
      (attempts[0] as unknown as Record<string, unknown>).invocationOwnerId,
    ),
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
  );
});

test("the wrapper owns its response observer, and a late callback records evidence without replaying or replacing the failed receipt", async (t) => {
  const f = await fixture(t);
  let observe: Parameters<typeof createChatCompletion>[0]["onResponseUsage"],
    requests = 0,
    untrustedCallbacks = 0;
  await assert.rejects(
    runAccountedCompletion(
      f.context,
      {
        model: "fixture",
        messages: [],
        onResponseUsage: async () => {
          untrustedCallbacks++;
        },
      },
      async (params) => {
        await params.beforeRequest?.();
        requests++;
        observe = params.onResponseUsage;
        throw new Error("owned timeout");
      },
    ),
    InferenceAccountingError,
  );
  const original = await f.events();
  assert.ok(observe);
  await observe({
    provider: "openrouter",
    model: "fixture",
    responseId: "resp_late",
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
  });
  const [attempt] = await f.attempts();
  assert.equal(
    (
      await db
        .select()
        .from(inferenceResponseEvidenceTable)
        .where(eq(inferenceResponseEvidenceTable.attemptId, attempt.id))
    ).length,
    1,
  );
  assert.deepEqual(await f.events(), original);
  assert.equal(attempt.state, "accounted");
  assert.equal(requests, 1);
  assert.equal(untrustedCallbacks, 0);
});
test("evidence before failed settlement and its lost acknowledgement cannot downgrade recovered accounting or revive output", async (t) => {
  const f = await fixture(t),
    original = db.transaction.bind(db);
  let transactions = 0,
    requests = 0;
  t.mock.method(
    db,
    "transaction",
    async (callback: Parameters<typeof db.transaction>[0]) => {
      const result = await original(callback);
      if (++transactions === 5)
        throw new Error("owned failed settlement acknowledgement lost");
      return result;
    },
  );
  await assert.rejects(
    f.run(async (params) => {
      await params.beforeRequest?.();
      requests++;
      await params.onResponseUsage?.({
        provider: "openrouter",
        model: "fixture",
        responseId: "resp_early",
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      });
      throw new Error("owned interrupted result");
    }),
    InferenceAccountingError,
  );
  const [attempt] = await f.attempts(),
    [receipt] = await f.events();
  assert.equal(attempt.state, "accounted");
  assert.equal(receipt.outcome, "failed");
  assert.equal(receipt.usageReported, false);
  assert.equal(receipt.totalTokens, 0);
  assert.equal((await f.events()).length, 1);
  assert.equal(requests, 1);
  assert.equal(transactions, 6);
});

test("a request-model mismatch is rejected before reservation or transport", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    runAccountedCompletion(
      f.context,
      { model: "different-model", messages: [] },
      f.complete,
    ),
    (error) =>
      error instanceof InferenceAccountingError && error.reason === "conflict",
  );
  assert.equal(f.calls(), 0);
  assert.deepEqual(await f.attempts(), []);
  assert.deepEqual(await f.events(), []);
});
test("a result from the wrong provider cannot settle another route's reservation", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.run(async (params) => ({
      ...(await f.complete(params)),
      provider: "ollama",
    })),
    InferenceAccountingError,
  );
  assert.equal(f.calls(), 1);
  assert.deepEqual(await f.events(), []);
  await assert.rejects(f.run(), InferenceAccountingError);
  assert.equal(f.calls(), 1);
});

test("the admitted requested route stays fixed while the caller mutates its input during preparation", async (t) => {
  const f = await fixture(t),
    params = { model: "fixture", messages: [] };
  const context = {
    ...f.context,
    assertOwnership: async () => {
      params.model = "changed-after-admission";
      context.modelId = "changed-after-admission";
    },
  };
  await runAccountedCompletion(context, params, async (forwarded) => {
    assert.equal(forwarded.model, "fixture");
    return f.complete(forwarded);
  });
  assert.equal(f.calls(), 1);
  assert.equal((await f.attempts())[0].modelId, "fixture");
  assert.equal((await f.events())[0].modelId, "fixture");
});

for (const boundary of ["reservation", "dispatch"])
  test(`lost ${boundary} acknowledgement sends no request and leaves a durable fence`, async (t) => {
    const f = await fixture(t);
    const original = db.transaction.bind(db);
    let transactions = 0;
    t.mock.method(
      db,
      "transaction",
      async (callback: Parameters<typeof db.transaction>[0]) => {
        const result = await original(callback);
        if (++transactions === (boundary === "reservation" ? 1 : 2))
          throw new Error("owned lost acknowledgement");
        return result;
      },
    );
    await assert.rejects(f.run(), InferenceAccountingError);
    assert.equal(f.calls(), 0);
    assert.equal((await f.attempts()).length, 1);
    await assert.rejects(f.run(), InferenceAccountingError);
    assert.equal(f.calls(), 0);
  });

test("provider success followed by ledger insertion failure cannot return or dispatch again", async (t) => {
  const f = await fixture(t);
  const original = db.transaction.bind(db);
  t.mock.method(
    db,
    "transaction",
    async (callback: Parameters<typeof db.transaction>[0]) =>
      original(async (tx) =>
        callback(
          new Proxy(tx, {
            get(target, key) {
              if (key === "insert")
                return (table: unknown) =>
                  table === usageEventsTable
                    ? {
                        values: () => ({
                          onConflictDoNothing: () => ({
                            returning: () =>
                              Promise.reject(
                                new Error("owned settlement outage"),
                              ),
                          }),
                        }),
                      }
                    : target.insert(table as never);
              const value = Reflect.get(target, key, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          }),
        ),
      ),
  );
  await assert.rejects(f.run(), InferenceAccountingError);
  assert.equal(f.calls(), 1);
  assert.equal((await f.events()).length, 0);
  assert.equal((await f.attempts())[0].state, "dispatched");
  await assert.rejects(f.run(), InferenceAccountingError);
  assert.equal(f.calls(), 1);
});

test("lost settlement acknowledgement retries only persistence and returns a single matching receipt", async (t) => {
  const f = await fixture(t);
  const original = db.transaction.bind(db);
  let transactions = 0;
  t.mock.method(
    db,
    "transaction",
    async (callback: Parameters<typeof db.transaction>[0]) => {
      const result = await original(callback);
      if (++transactions === 3)
        throw new Error("owned lost settlement acknowledgement");
      return result;
    },
  );
  const result = await f.run();
  assert.equal(result.usage.totalTokens, 5);
  assert.equal(f.calls(), 1);
  assert.equal((await f.events()).length, 1);
  assert.equal((await f.attempts())[0].state, "accounted");
});

test("concurrent same-agent calls cannot bypass an unsettled request, while an unrelated scope works", async (t) => {
  const f = await fixture(t),
    other = await fixture(t);
  let release!: () => void, started!: () => void;
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    entered = new Promise<void>((resolve) => {
      started = resolve;
    });
  const first = f.run(async (params) => {
    const result = await f.complete(params);
    started();
    await held;
    return result;
  });
  void first.catch(() => {});
  try {
    await entered;
    await assert.rejects(f.run(), InferenceAccountingError);
    assert.equal(f.calls(), 1);
    await other.run();
    assert.equal(other.calls(), 1);
  } finally {
    release();
  }
  await first;
  assert.equal((await f.events()).length, 1);
});

test("a positively pre-dispatch rejection releases its reservation without inventing usage", async (t) => {
  const f = await fixture(t),
    failure = new Error("owned local pre-dispatch rejection");
  await assert.rejects(
    f.run(async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(f.calls(), 0);
  assert.equal((await f.events()).length, 0);
  assert.equal((await f.attempts())[0].state, "not_dispatched");
  await f.run();
  assert.equal(f.calls(), 1);
});

test("reported zero is settled; absent usage remains uncertain across new calls", async (t) => {
  const zero = await fixture(t),
    unknown = await fixture(t);
  await zero.run(async (params) => {
    const result = await zero.complete(params);
    result.completion.usage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };
    return result;
  });
  assert.equal((await zero.attempts())[0].state, "accounted");
  await assert.rejects(
    unknown.run(async (params) => {
      const result = await unknown.complete(params);
      delete result.completion.usage;
      return result;
    }),
    InferenceAccountingError,
  );
  assert.equal((await unknown.events())[0].usageReported, false);
  assert.equal((await unknown.attempts())[0].state, "uncertain");
  await assert.rejects(unknown.run(), InferenceAccountingError);
  assert.equal(unknown.calls(), 1);
});

test("ownership lost during local preparation releases the definitely unstarted reservation", async (t) => {
  const f = await fixture(t),
    failure = new Error("owned authority lost before dispatch");
  let checks = 0;
  await assert.rejects(
    runAccountedCompletion(
      {
        ...f.context,
        assertOwnership: async () => {
          if (++checks === 2) throw failure;
        },
      },
      { model: "fixture", messages: [] },
      f.complete,
    ),
    (error) => error === failure,
  );
  assert.equal(f.calls(), 0);
  assert.equal((await f.attempts())[0].state, "not_dispatched");
  await f.run();
  assert.equal(f.calls(), 1);
});

test("a failed dispatched provider with unknown usage cannot enter provider fallback", async (t) => {
  const f = await fixture(t);
  let requests = 0;
  await assert.rejects(
    f.run(async (params) => {
      await params.beforeRequest?.();
      requests++;
      throw Object.assign(new Error("owned rate limit"), { status: 429 });
    }),
    (error) =>
      error instanceof InferenceAccountingError && error.reason === "unknown",
  );
  assert.equal(requests, 1);
  assert.equal((await f.attempts())[0].state, "uncertain");
  await assert.rejects(f.run(), InferenceAccountingError);
  assert.equal(f.calls(), 0);
});

test("an unstarted ownership failure remains primary even if releasing its reservation fails", async (t) => {
  const f = await fixture(t),
    failure = new Error("owned primary ownership failure");
  let checks = 0;
  t.mock.method(db, "update", () => {
    throw new Error("owned release storage failure");
  });
  await assert.rejects(
    runAccountedCompletion(
      {
        ...f.context,
        assertOwnership: async () => {
          if (++checks === 2) throw failure;
        },
      },
      { model: "fixture", messages: [] },
      f.complete,
    ),
    (error) => error === failure,
  );
  assert.equal(f.calls(), 0);
  assert.equal((await f.attempts())[0].state, "reserved");
});

test("conflicting receipt after a lost acknowledgement retains a durable uncertainty fence", async (t) => {
  const f = await fixture(t);
  const original = db.transaction.bind(db);
  let transactions = 0;
  t.mock.method(
    db,
    "transaction",
    async (callback: Parameters<typeof db.transaction>[0]) => {
      const result = await original(callback);
      if (++transactions === 3) {
        // Owned fault injection only: contradict the stored receipt before a
        // lost-ack replay. Production never edits immutable usage receipts.
        await db
          .update(usageEventsTable)
          .set({ totalTokens: 99 })
          .where(eq(usageEventsTable.agentId, f.agent.id));
        throw new Error("owned lost acknowledgement with conflicting evidence");
      }
      return result;
    },
  );
  await assert.rejects(
    f.run(),
    (error) =>
      error instanceof InferenceAccountingError && error.reason === "conflict",
  );
  assert.equal(f.calls(), 1);
  assert.ok((await f.attempts())[0].evidenceConflictAt);
  await assert.rejects(f.run(), InferenceAccountingError);
  assert.equal(f.calls(), 1);
});
