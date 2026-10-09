import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { eq, inArray, sql } from "drizzle-orm";

test(
  "PostgreSQL retains a family fence across concurrent workers and an owned process crash",
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
      inferenceAttemptsTable,
      usageEventsTable,
    } = await import("@workspace/db");
    await dbReady;
    const ownedWorkers: Array<() => Promise<void>> = [];
    const agents = await db
      .insert(agentsTable)
      .values(
        ["Producer", "Same family peer", "Unrelated peer"].map((name) => ({
          name: `Owned accounting ${name}`,
          role: "Fixture",
          systemPrompt: "Fixture",
        })),
      )
      .returning();
    const [root, unrelated] = await db
      .insert(tasksTable)
      .values([
        {
          title: "Owned shared root",
          brief: "Fixture",
          ownerAgentId: agents[0].id,
        },
        {
          title: "Owned unrelated root",
          brief: "Fixture",
          ownerAgentId: agents[2].id,
        },
      ])
      .returning();
    const [child] = await db
      .insert(tasksTable)
      .values({
        title: "Owned child",
        brief: "Fixture",
        ownerAgentId: agents[1].id,
        parentTaskId: root.id,
      })
      .returning();
    const ids = agents.map((a) => a.id);
    t.after(async () => {
      for (const stop of ownedWorkers) await stop();
      await db
        .delete(usageEventsTable)
        .where(inArray(usageEventsTable.agentId, ids));
      await db
        .delete(inferenceAttemptsTable)
        .where(inArray(inferenceAttemptsTable.agentId, ids));
      await db.delete(tasksTable).where(eq(tasksTable.id, child.id));
      await db
        .delete(tasksTable)
        .where(inArray(tasksTable.id, [root.id, unrelated.id]));
      await db.delete(agentsTable).where(inArray(agentsTable.id, ids));
      await closeDatabase();
    });
    const worker = fileURLToPath(
      new URL("./fixtures/inference-accounting-worker.ts", import.meta.url),
    );
    function launch(
      mode: "park" | "complete",
      agentId: number,
      taskId: number,
    ) {
      const environment: NodeJS.ProcessEnv = {
        DATABASE_URL: databaseUrl,
        POSTGRES_RACE_TEST_DISPOSABLE: "1",
        ALLOW_AGENT_CODEX_TASKS: "false",
        RUNTIME_ROLE: "combined",
      };
      for (const key of [
        "SystemRoot",
        "PATH",
        "TEMP",
        "TMP",
        "TMPDIR",
        "CHATGPT_STORAGE_DIRECTORY",
      ]) {
        if (process.env[key]) environment[key] = process.env[key];
      }
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
          env: environment,
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
      const message = new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new Error("Owned accounting fixture exceeded startup deadline"),
              ),
            15000,
          );
          child.once("message", (value) => {
            clearTimeout(timer);
            resolve(value as Record<string, unknown>);
          });
          child.once("error", () => {
            clearTimeout(timer);
            reject(new Error("Owned accounting fixture failed to start"));
          });
          child.once("close", () => {
            clearTimeout(timer);
            reject(
              new Error("Owned accounting fixture exited before evidence"),
            );
          });
        },
      );
      async function stop() {
        if (!closed) child.kill();
        await exited;
      }
      ownedWorkers.push(stop);
      return { message, exited, stop };
    }
    const producer = launch("park", agents[0].id, root.id);
    assert.deepEqual(await producer.message, { kind: "dispatched", calls: 1 });
    const livePeer = launch("complete", agents[1].id, child.id);
    assert.deepEqual(await livePeer.message, {
      kind: "result",
      calls: 0,
      reason: "unsettled",
      accountingStatus: "pending",
    });
    assert.equal(await livePeer.exited, 0);
    const { readInferenceAccountingStatus } =
      await import("../inference-accounting-status");
    const pendingStatus = await readInferenceAccountingStatus("task", child.id);
    assert.equal(pendingStatus?.status, "pending");
    assert.equal(pendingStatus?.rootTaskId, root.id);
    assert.equal(pendingStatus?.unsettledCount, 1);
    await producer.stop();
    const [marker] = await db
      .select()
      .from(inferenceAttemptsTable)
      .where(eq(inferenceAttemptsTable.agentId, agents[0].id));
    assert.equal(marker.state, "dispatched");
    assert.equal(
      (
        await db
          .select()
          .from(usageEventsTable)
          .where(eq(usageEventsTable.agentId, agents[0].id))
      ).length,
      0,
    );
    await db
      .update(inferenceAttemptsTable)
      .set({ requestDeadlineAt: new Date(Date.now() - 1000) })
      .where(eq(inferenceAttemptsTable.id, marker.id));
    const replacement = launch("complete", agents[1].id, child.id);
    assert.deepEqual(await replacement.message, {
      kind: "result",
      calls: 0,
      reason: "unsettled",
      accountingStatus: "recovery_required",
    });
    assert.equal(await replacement.exited, 0);
    const other = launch("complete", agents[2].id, unrelated.id);
    assert.deepEqual(await other.message, {
      kind: "result",
      calls: 1,
      accountingStatus: null,
    });
    assert.equal(await other.exited, 0);
    const receipts = await db
      .select()
      .from(usageEventsTable)
      .where(inArray(usageEventsTable.agentId, ids));
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].agentId, agents[2].id);
    assert.equal(receipts[0].totalTokens, 2);
    const uncertainStatus = await readInferenceAccountingStatus(
      "task",
      root.id,
    );
    assert.equal(uncertainStatus?.status, "recovery_required");
    assert.equal(uncertainStatus?.attempts[0].id, marker.id);
    assert.equal(uncertainStatus?.attempts[0].usage, null);
    const unrelatedStatus = await readInferenceAccountingStatus(
      "task",
      unrelated.id,
    );
    assert.equal(unrelatedStatus?.status, "clear");
    assert.equal(unrelatedStatus?.attempts[0].usage?.totalTokens, 2);
    assert.equal(unrelatedStatus?.attempts[0].usage?.reportedCostUsd, null);
    // Exercise the real queue UPDATE and activity FK insertion while an
    // independent session owns the production claim's control/agent locks.
    await db.insert(usageEventsTable).values({
      agentId: agents[2].id,
      taskId: unrelated.id,
      kind: "judge",
      modelId: "fixture",
      provider: "fixture",
      promptTokens: 100000,
      totalTokens: 100000,
      usageReported: true,
    });
    const { default: pg } = await import("pg");
    const claimant = new pg.Client({ connectionString: databaseUrl });
    await claimant.connect();
    let budgetWork: Promise<void> | undefined;
    try {
      await claimant.query("BEGIN");
      await claimant.query("SET LOCAL statement_timeout='5s'");
      const pid = Number(
        (await claimant.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
      );
      await claimant.query(
        "SELECT id FROM runtime_controls WHERE id=1 FOR UPDATE",
      );
      await claimant.query("SELECT id FROM agents WHERE id=$1 FOR UPDATE", [
        agents[2].id,
      ]);
      const { enforceTaskBudgets } = await import("./scheduler");
      budgetWork = enforceTaskBudgets();
      // Preserve a rejection until the test awaits it after releasing the peer.
      void budgetWork.catch(() => {});
      const deadline = Date.now() + 5000;
      let blocked = false;
      while (Date.now() < deadline && !blocked) {
        const peers = await db.execute(
          sql`SELECT pid FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`,
        );
        blocked = peers.rows.length > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(
        blocked,
        true,
        "An independent production scheduler transaction must contend with the owned claim",
      );
      // Previously the scheduler already owned this task and waited on our
      // agent FK lock, so this actual query reproduced PostgreSQL 40P01.
      await claimant.query("SELECT id FROM tasks WHERE id=$1 FOR UPDATE", [
        unrelated.id,
      ]);
      await claimant.query("COMMIT");
      await budgetWork;
      const [limited] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, unrelated.id));
      assert.equal(limited.status, "blocked");
      assert.equal(limited.blockedReason, "budget");
    } finally {
      await claimant.query("ROLLBACK").catch(() => undefined);
      await claimant.end();
      await budgetWork?.catch(() => undefined);
    }
    const migrations = await db.execute(
      sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`,
    );
    assert.equal(migrations.rows[0].count, 44);
  },
);
