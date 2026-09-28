import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import {
  decryptRuntimeEnvelope,
  encryptRuntimeEnvelope,
} from "./runtime-control-crypto";

test("split API dispatches to the owner worker, records metadata only, and never retries an unacked effect", async (t) => {
  const previous = {
    role: process.env.RUNTIME_ROLE,
    key: process.env.RUNTIME_CONTROL_KEY,
    databaseUrl: process.env.DATABASE_URL,
  };
  process.env.RUNTIME_ROLE = "api";
  process.env.RUNTIME_CONTROL_KEY = "runtime-control-api-test-key-32-bytes";
  delete process.env.DATABASE_URL;
  const secret = process.env.RUNTIME_CONTROL_KEY;
  try {
    const {
      agentsTable,
      closeDatabase,
      db,
      dbReady,
      runtimeControlCommandsTable,
      runtimeInstancesTable,
    } = await import("@workspace/db");
    const {
      acknowledgeRuntimeControl,
      configureRuntimeControlTimingForTest,
      dispatchBrowserRuntimeCommand,
      pollRuntimeControl,
      resetRuntimeControlApiForTest,
    } = await import("./runtime-control-api");
    await dbReady;
    configureRuntimeControlTimingForTest({
      pollWaitMs: 500,
      workerFreshMs: 1_000,
      commandTimeoutMs: 120,
    });
    const [agent] = await db
      .insert(agentsTable)
      .values({
        name: "Runtime control test",
        role: "Specialist",
        systemPrompt: "test",
        createdByUser: true,
      })
      .returning({ id: agentsTable.id });
    assert.ok(agent);
    const runtimeId = "33333333-3333-4333-8333-333333333333";
    const [runtime] = await db
      .insert(runtimeInstancesTable)
      .values({
        id: runtimeId,
        role: "worker",
        state: "healthy",
        hostname: "test-host",
        processId: 3303,
        buildVersion: "test",
        schedulerEnabled: true,
      })
      .returning({ startedAt: runtimeInstancesTable.startedAt });
    assert.ok(runtime);

    const firstPoll = pollRuntimeControl({
      runtimeId,
      startedAt: runtime.startedAt,
      sessions: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const takeoverResult = dispatchBrowserRuntimeCommand<{
      owner: "operator";
      leaseId: string;
    }>(
      { kind: "browser_take_over", agentId: agent.id },
      { allowSessionAllocation: true },
    );
    const takeoverDelivery = await firstPoll;
    assert.ok(takeoverDelivery);
    const takeoverPayload = decryptRuntimeEnvelope<{
      kind: string;
      agentId: number;
      expectedSession: null;
    }>(takeoverDelivery.envelope, secret);
    assert.deepEqual(takeoverPayload, {
      kind: "browser_take_over",
      agentId: agent.id,
      expectedSession: null,
    });
    const session = {
      agentId: agent.id,
      sessionId: "browser-session-test",
      sessionEpoch: 1,
    };
    await acknowledgeRuntimeControl(runtimeId, {
      id: takeoverDelivery.id,
      ok: true,
      resultEnvelope: encryptRuntimeEnvelope(
        { owner: "operator", leaseId: "lease-test" },
        secret,
      ),
      session,
    });
    assert.deepEqual(await takeoverResult, {
      owner: "operator",
      leaseId: "lease-test",
    });

    const sensitiveText = "OTP-SENTINEL-938201";
    const unacked = dispatchBrowserRuntimeCommand({
      kind: "browser_input",
      agentId: agent.id,
      leaseId: "lease-test",
      input: { action: "type_text", text: sensitiveText },
    });
    const effectDelivery = await pollRuntimeControl({
      runtimeId,
      startedAt: runtime.startedAt,
      sessions: [session],
    });
    assert.ok(effectDelivery);
    const effectPayload = decryptRuntimeEnvelope<{
      input: { text: string };
      expectedSession: { sessionId: string; sessionEpoch: number };
    }>(effectDelivery.envelope, secret);
    assert.equal(effectPayload.input.text, sensitiveText);
    assert.deepEqual(effectPayload.expectedSession, {
      sessionId: session.sessionId,
      sessionEpoch: session.sessionEpoch,
    });
    await assert.rejects(unacked, /otomatik tekrar yapilmayacak/u);

    const commands = await db.select().from(runtimeControlCommandsTable);
    const effectRow = commands.find((row) => row.id === effectDelivery.id);
    assert.equal(effectRow?.state, "unknown");
    assert.equal(JSON.stringify(commands).includes(sensitiveText), false);

    await t.test(
      "an uncertain effect or unauthenticated result remains unknown after a worker acknowledgement",
      async () => {
        configureRuntimeControlTimingForTest({ commandTimeoutMs: 3000 });
        for (const corrupt of [false, true]) {
          const pending = dispatchBrowserRuntimeCommand({
            kind: "browser_input",
            agentId: agent.id,
            leaseId: "lease-test",
            input: { action: "type_text", text: sensitiveText },
          });
          const rejected = assert.rejects(
            pending,
            (error: unknown) =>
              error instanceof Error &&
              "code" in error &&
              error.code === "BROWSER_RUNTIME_OUTCOME_UNKNOWN",
          );
          const delivered = await pollRuntimeControl({
            runtimeId,
            startedAt: runtime.startedAt,
            sessions: [session],
          });
          assert.ok(delivered);
          await acknowledgeRuntimeControl(
            runtimeId,
            corrupt
              ? {
                  id: delivered.id,
                  ok: true,
                  resultEnvelope: {
                    ...encryptRuntimeEnvelope(
                      { path: "type_text", deleted: true },
                      secret,
                    ),
                    ciphertext: "invalid",
                  },
                  session,
                }
              : {
                  id: delivered.id,
                  ok: false,
                  failureKind: "BrowserActionOutcomeUnknownError",
                  sanitizedError: "Browser action outcome unknown.",
                  session,
                },
          );
          await rejected;
          const rows = await db.select().from(runtimeControlCommandsTable);
          assert.equal(
            rows.find((row) => row.id === delivered.id)?.state,
            "unknown",
          );
          assert.equal(JSON.stringify(rows).includes(sensitiveText), false);
        }
        configureRuntimeControlTimingForTest({ commandTimeoutMs: 120 });
      },
    );

    await t.test(
      "does not hand a stale delivery to a waiting worker when dispatch CAS loses",
      async () => {
        configureRuntimeControlTimingForTest({
          pollWaitMs: 80,
          commandTimeoutMs: 30,
        });
        await db.execute(sql`
          create or replace function expire_runtime_control_command_for_test()
          returns trigger
          language plpgsql
          as $$
          begin
            new.state := 'expired';
            new.finished_at := current_timestamp;
            new.failure_kind := 'forced_expired_for_test';
            return new;
          end;
          $$
        `);
        await db.execute(sql`
          drop trigger if exists expire_runtime_control_command_for_test
          on runtime_control_commands
        `);
        await db.execute(sql`
          create trigger expire_runtime_control_command_for_test
          before insert on runtime_control_commands
          for each row execute function expire_runtime_control_command_for_test()
        `);

        try {
          const waitingPoll = pollRuntimeControl({
            runtimeId,
            startedAt: runtime.startedAt,
            sessions: [session],
          });
          await new Promise((resolve) => setTimeout(resolve, 10));
          const commandResult = dispatchBrowserRuntimeCommand({
            kind: "browser_input",
            agentId: agent.id,
            leaseId: "lease-test",
            input: { action: "keydown", key: "Enter" },
          });
          let outsideEffects = 0;
          const delivery = await waitingPoll;
          if (delivery) outsideEffects += 1;

          await assert.rejects(commandResult, (error: unknown) => {
            return (
              error instanceof Error &&
              "code" in error &&
              error.code === "BROWSER_RUNTIME_TIMEOUT"
            );
          });
          assert.equal(delivery, null);
          assert.equal(outsideEffects, 0);
        } finally {
          await db.execute(sql`
            drop trigger if exists expire_runtime_control_command_for_test
            on runtime_control_commands
          `);
          await db.execute(
            sql`drop function if exists expire_runtime_control_command_for_test()`,
          );
        }
      },
    );

    await t.test(
      "removes only the timed-out queued delivery before a later worker poll can execute it",
      async () => {
        configureRuntimeControlTimingForTest({
          pollWaitMs: 5,
          commandTimeoutMs: 200,
        });
        const knownCommandIds = new Set(
          (
            await db
              .select({ id: runtimeControlCommandsTable.id })
              .from(runtimeControlCommandsTable)
          ).map((row) => row.id),
        );
        const commandResult = dispatchBrowserRuntimeCommand({
          kind: "browser_input",
          agentId: agent.id,
          leaseId: "lease-test",
          input: { action: "keydown", key: "Enter" },
        });
        void commandResult.catch(() => undefined);
        let expiredCommandId: string | undefined;
        for (let attempt = 0; attempt < 50 && !expiredCommandId; attempt += 1) {
          const rows = await db
            .select({ id: runtimeControlCommandsTable.id })
            .from(runtimeControlCommandsTable);
          expiredCommandId = rows.find(
            (row) => !knownCommandIds.has(row.id),
          )?.id;
          if (!expiredCommandId) {
            await new Promise((resolve) => setTimeout(resolve, 2));
          }
        }
        assert.ok(expiredCommandId);

        configureRuntimeControlTimingForTest({ commandTimeoutMs: 1_000 });
        const survivingResult = dispatchBrowserRuntimeCommand({
          kind: "browser_control_state",
          agentId: agent.id,
        });
        void survivingResult.catch(() => undefined);
        await assert.rejects(commandResult, (error: unknown) => {
          return (
            error instanceof Error &&
            "code" in error &&
            error.code === "BROWSER_RUNTIME_TIMEOUT"
          );
        });

        let outsideEffects = 0;
        const delivery = await pollRuntimeControl({
          runtimeId,
          startedAt: runtime.startedAt,
          sessions: [session],
        });
        assert.ok(delivery);
        const payload = decryptRuntimeEnvelope<{ kind: string }>(
          delivery.envelope,
          secret,
        );
        if (delivery.id === expiredCommandId) outsideEffects += 1;
        assert.notEqual(delivery.id, expiredCommandId);
        assert.equal(payload.kind, "browser_control_state");
        assert.equal(outsideEffects, 0);
        await acknowledgeRuntimeControl(runtimeId, {
          id: delivery.id,
          ok: true,
          resultEnvelope: encryptRuntimeEnvelope({ owner: "operator" }, secret),
          session,
        });
        await survivingResult;
      },
    );

    const secondRuntimeId = "44444444-4444-4444-8444-444444444444";
    const [secondRuntime] = await db
      .insert(runtimeInstancesTable)
      .values({
        id: secondRuntimeId,
        role: "worker",
        state: "healthy",
        hostname: "second-test-host",
        processId: 4404,
        buildVersion: "test",
        schedulerEnabled: true,
      })
      .returning({ startedAt: runtimeInstancesTable.startedAt });
    assert.ok(secondRuntime);
    configureRuntimeControlTimingForTest({
      pollWaitMs: 25,
      workerFreshMs: 50,
    });
    await new Promise((resolve) => setTimeout(resolve, 55));
    const secondWorkerPoll = pollRuntimeControl({
      runtimeId: secondRuntimeId,
      startedAt: secondRuntime.startedAt,
      sessions: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await assert.rejects(
      dispatchBrowserRuntimeCommand(
        { kind: "browser_take_over", agentId: agent.id },
        { allowSessionAllocation: true },
      ),
      /sahibi olan worker/u,
    );
    assert.equal(
      await secondWorkerPoll,
      null,
      "an unreachable durable owner must never fall through to another live worker",
    );

    configureRuntimeControlTimingForTest({ pollWaitMs: 5 });
    assert.equal(
      await pollRuntimeControl({
        runtimeId,
        startedAt: runtime.startedAt,
        sessions: [session],
      }),
      null,
    );
    resetRuntimeControlApiForTest();
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
