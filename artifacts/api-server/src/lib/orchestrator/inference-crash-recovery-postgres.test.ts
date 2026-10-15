import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";

test(
  "PostgreSQL recovers only provably unstarted or fully evidenced requests after worker loss",
  { timeout: 60000 },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      assert.notEqual(
        process.env.POSTGRES_RACE_TEST_FAIL_IF_SKIPPED,
        "1",
        "Disposable PostgreSQL is required",
      );
      t.skip(
        "No disposable PostgreSQL supplied; no database was imported or migrated",
      );
      return;
    }
    assert.equal(process.env.POSTGRES_RACE_TEST_DISPOSABLE, "1");
    const target = new URL(databaseUrl);
    assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
    assert.ok(
      ["agentic_os_ci", "agentic_inference_test"].includes(
        target.pathname.slice(1),
      ),
    );
    const {
      db,
      dbReady,
      closeDatabase,
      agentsTable,
      tasksTable,
      inferenceAttemptsTable: attempts,
      inferenceResponseEvidenceTable: evidence,
      inferenceUsageCorrectionsTable: corrections,
      usageEventsTable: receipts,
    } = await import("@workspace/db");
    const { reconcileSavedInferenceEvidence: recover } =
      await import("./inference-usage-correction");
    await dbReady;
    t.after(() => closeDatabase());
    const worker = fileURLToPath(
      new URL("./fixtures/inference-accounting-worker.ts", import.meta.url),
    );
    function launch(mode: string, agentId: number, taskId: number) {
      const child = spawn(
        process.execPath,
        [
          "--import",
          import.meta.resolve("tsx"),
          worker,
          mode,
          String(agentId),
          String(taskId),
        ],
        {
          env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
            POSTGRES_RACE_TEST_DISPOSABLE: "1",
            ALLOW_AGENT_CODEX_TASKS: "false",
            RUNTIME_ROLE: "combined",
          },
          windowsHide: true,
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        },
      );
      let closed = false;
      const exited = new Promise<number | null>((resolve) =>
        child.once("close", (code) => {
          closed = true;
          resolve(code);
        }),
      );
      const nextMessage = () =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new Error("Owned crash barrier exceeded startup deadline"),
              ),
            15000,
          );
          child.once("message", (value) => {
            clearTimeout(timer);
            resolve(value as Record<string, unknown>);
          });
          child.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.once("close", () => {
            clearTimeout(timer);
            reject(new Error("Owned crash fixture exited before barrier"));
          });
        });
      const message = nextMessage();
      const stop = async () => {
        if (!closed) child.kill();
        await exited;
      };
      t.after(stop);
      return { child, message, nextMessage, exited, stop };
    }
    for (const [phase, kill] of [
      ["reserved", true],
      ["dispatched", true],
      ["evidenced", true],
      ["reserved", false],
      ["evidenced", false],
    ] as const) {
      await t.test(
        `${phase}: ${kill ? "worker crash" : "late original invocation"}`,
        async (s) => {
          const agents = await db
            .insert(agentsTable)
            .values(
              ["producer", "peer"].map((name) => ({
                name: `Owned ${phase} ${name}`,
                role: "Fixture",
                systemPrompt: "Fixture",
              })),
            )
            .returning();
          const [root] = await db
            .insert(tasksTable)
            .values({
              title: `Owned ${phase} root`,
              brief: "Fixture",
              ownerAgentId: agents[0].id,
            })
            .returning();
          const [peer] = await db
            .insert(tasksTable)
            .values({
              title: `Owned ${phase} peer`,
              brief: "Fixture",
              ownerAgentId: agents[1].id,
              parentTaskId: root.id,
            })
            .returning();
          const ids = agents.map((a) => a.id);
          s.after(async () => {
            const markers = await db
              .select()
              .from(attempts)
              .where(inArray(attempts.agentId, ids));
            for (const marker of markers) {
              await db
                .delete(corrections)
                .where(eq(corrections.attemptId, marker.id));
              await db
                .delete(evidence)
                .where(eq(evidence.attemptId, marker.id));
            }
            await db.delete(receipts).where(inArray(receipts.agentId, ids));
            await db.delete(attempts).where(inArray(attempts.agentId, ids));
            await db.delete(tasksTable).where(eq(tasksTable.id, peer.id));
            await db.delete(tasksTable).where(eq(tasksTable.id, root.id));
            await db.delete(agentsTable).where(inArray(agentsTable.id, ids));
          });
          const producer = launch(
            phase === "dispatched" ? "park" : `park-${phase}`,
            agents[0].id,
            root.id,
          );
          assert.deepEqual(await producer.message, {
            kind: phase,
            calls: phase === "reserved" ? 0 : 1,
          });
          const [before] = await db
            .select()
            .from(attempts)
            .where(eq(attempts.agentId, agents[0].id));
          assert.equal(
            before.state,
            phase === "reserved" ? "reserved" : "dispatched",
          );
          assert.equal(
            (
              await db
                .select()
                .from(receipts)
                .where(eq(receipts.ordinaryInferenceId, before.id))
            ).length,
            0,
          );
          assert.equal(
            await recover(),
            0,
            "A live invocation must retain ownership of settlement",
          );
          if (kill) await producer.stop();
          // Explicit fixture clock boundary, never a longer production deadline.
          await db
            .update(attempts)
            .set({ requestDeadlineAt: new Date(Date.now() - 1000) })
            .where(eq(attempts.id, before.id));
          assert.equal(await recover(), phase === "dispatched" ? 0 : 1);
          const [after] = await db
            .select()
            .from(attempts)
            .where(eq(attempts.id, before.id));
          assert.equal(
            after.state,
            phase === "reserved"
              ? "not_dispatched"
              : phase === "evidenced"
                ? "accounted"
                : "dispatched",
          );
          const ledger = await db
            .select()
            .from(receipts)
            .where(eq(receipts.ordinaryInferenceId, before.id));
          assert.equal(ledger.length, phase === "evidenced" ? 1 : 0);
          if (phase === "evidenced") {
            assert.equal(ledger[0].totalTokens, 2);
            assert.equal(ledger[0].usageReported, true);
            assert.equal(ledger[0].outcome, "failed");
            assert.equal(ledger[0].failureKind, "inference_interrupted");
          }
          if (!kill) {
            const late = producer.nextMessage();
            producer.child.send({ continue: true });
            assert.deepEqual(
              await late,
              phase === "reserved"
                ? {
                    kind: "result",
                    calls: 0,
                    reason: "conflict",
                    accountingStatus: "recovery_required",
                  }
                : { kind: "result", calls: 1, accountingStatus: null },
            );
            assert.equal(await producer.exited, 0);
            assert.deepEqual(
              await db
                .select()
                .from(receipts)
                .where(eq(receipts.ordinaryInferenceId, before.id)),
              ledger,
              "A late invocation cannot replace the recovered outcome or add usage",
            );
          }
          assert.equal(await recover(), 0, "Recovery must be idempotent");
          const replacement = launch("complete", agents[1].id, peer.id);
          assert.deepEqual(
            await replacement.message,
            phase === "dispatched"
              ? {
                  kind: "result",
                  calls: 0,
                  reason: "unsettled",
                  accountingStatus: "recovery_required",
                }
              : { kind: "result", calls: 1, accountingStatus: null },
          );
          assert.equal(await replacement.exited, 0);
        },
      );
    }
  },
);
