import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, sql } from "drizzle-orm";

const ALLOWED_DATABASES = new Set(["agentic_os_task4_test", "agentic_os_ci"]);

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${timeoutMs}ms`)),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test(
  "PostgreSQL production heartbeat and recovery lock ordering cannot deadlock or steal a renewed attempt",
  { timeout: 30_000 },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      t.skip(
        "DATABASE_URL is absent; real PostgreSQL two-connection race proof is environment-blocked",
      );
      return;
    }
    assert.equal(
      process.env.POSTGRES_RACE_TEST_DISPOSABLE,
      "1",
      "PostgreSQL race tests require POSTGRES_RACE_TEST_DISPOSABLE=1",
    );
    const databaseName = decodeURIComponent(
      new URL(databaseUrl).pathname.replace(/^\//u, ""),
    );
    assert.ok(
      ALLOWED_DATABASES.has(databaseName),
      `refusing PostgreSQL race test against non-disposable database ${databaseName}`,
    );

    // Importing @workspace/db starts the checked-in migration bootstrap. Keep
    // every database-owning module behind the disposable-database guard so a
    // mistyped local command cannot mutate an arbitrary PostgreSQL database
    // before this test refuses to run.
    const { agentsTable, db, dbReady, taskAttemptsTable, tasksTable } =
      await import("@workspace/db");
    const { readRuntimeOperationsConfig } =
      await import("../runtime-operations-config");
    const { registerRuntimeInstance } =
      await import("./runtime-instance-registry");
    const { claimDueTasks, reviveAndReleaseStaleWorkCore } =
      await import("./scheduler");
    const { startTaskLeaseHeartbeat } = await import("./task-lease-heartbeat");

    await dbReady;
    const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
    const runtime = await registerRuntimeInstance(
      {
        role: "worker",
        schedulerEnabled: true,
        capabilities: { scheduler: true },
        buildVersion: `postgres-race-${randomUUID()}`,
      },
      config,
    );
    t.after(() => runtime.stopHeartbeat());
    const [agent] = await db
      .insert(agentsTable)
      .values({
        name: `Postgres race ${randomUUID()}`,
        role: "Test",
        systemPrompt: "Test only",
        createdByUser: true,
      })
      .returning();
    const [task] = await db
      .insert(tasksTable)
      .values({
        title: `Postgres lock order ${randomUUID()}`,
        brief: "Heartbeat must win without a deadlock.",
        ownerAgentId: agent.id,
        status: "pending",
        createdByUser: true,
      })
      .returning();
    t.after(async () => {
      await db
        .update(tasksTable)
        .set({
          status: "cancelled",
          leaseOwner: null,
          leaseExpiresAt: null,
        })
        .where(eq(tasksTable.id, task.id));
      await db
        .update(agentsTable)
        .set({
          isActive: false,
          status: "archived",
          runLeaseOwner: null,
          runLeaseExpiresAt: null,
        })
        .where(eq(agentsTable.id, agent.id));
    });
    const claimed = (await claimDueTasks(runtime, config)).find(
      (candidate) => candidate.id === task.id,
    );
    assert.ok(claimed);
    await db
      .update(taskAttemptsTable)
      .set({ state: "running" })
      .where(eq(taskAttemptsTable.id, claimed.runtimeAttemptId));
    const expiredAt = new Date(Date.now() - 60_000);
    await db
      .update(tasksTable)
      .set({ leaseExpiresAt: expiredAt })
      .where(eq(tasksTable.id, task.id));
    await db
      .update(agentsTable)
      .set({ runLeaseExpiresAt: expiredAt })
      .where(eq(agentsTable.id, agent.id));

    type DatabaseTransaction = typeof db.transaction;
    type TransactionCallback = Parameters<DatabaseTransaction>[0];
    type Transaction = Parameters<TransactionCallback>[0];
    const mutableDb = db as typeof db & { transaction: DatabaseTransaction };
    const originalTransaction = mutableDb.transaction;
    const heartbeatHasAgentLock = deferred();
    const releaseHeartbeat = deferred();
    const recoveryTransactionStarted = deferred();
    let recoveryPhase = false;
    let heartbeatPid: number | null = null;
    let recoveryPid: number | null = null;
    mutableDb.transaction = ((
      callback: TransactionCallback,
      ...rest: unknown[]
    ) =>
      (originalTransaction as (...values: unknown[]) => unknown).apply(db, [
        async (tx: Transaction) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`SET LOCAL statement_timeout = '8s'`);
          const pidResult = await tx.execute(
            sql<{ pid: number | string }>`SELECT pg_backend_pid() AS pid`,
          );
          const pid = Number(pidResult.rows[0]?.pid);
          assert.ok(Number.isSafeInteger(pid));
          if (recoveryPhase) {
            recoveryPid ??= pid;
            recoveryTransactionStarted.resolve();
          } else {
            heartbeatPid ??= pid;
          }
          return callback(tx);
        },
        ...rest,
      ])) as DatabaseTransaction;

    const heartbeat = startTaskLeaseHeartbeat({
      taskId: task.id,
      agentId: agent.id,
      attemptId: claimed.runtimeAttemptId,
      leaseOwner: claimed.leaseOwner,
      config,
      afterAgentLockBeforeTaskLock: async () => {
        heartbeatHasAgentLock.resolve();
        await releaseHeartbeat.promise;
      },
    });
    let heartbeatAssertion: Promise<void> | null = null;
    let recovery: Promise<void> | null = null;
    try {
      heartbeatAssertion = heartbeat.assertOwned();
      await withDeadline(
        heartbeatHasAgentLock.promise,
        5_000,
        "production heartbeat agent-lock barrier",
      );
      recoveryPhase = true;
      recovery = reviveAndReleaseStaleWorkCore();
      await withDeadline(
        recoveryTransactionStarted.promise,
        5_000,
        "production recovery transaction start",
      );
      assert.ok(heartbeatPid !== null);
      assert.ok(recoveryPid !== null);
      assert.notEqual(
        heartbeatPid,
        recoveryPid,
        "the race proof must use two PostgreSQL backend connections",
      );
      let observedLock:
        | {
            observer_pid: number | string;
            pid: number | string;
            wait_event_type: string | null;
            state: string | null;
            query: string;
          }
        | undefined;
      const observationDeadline = Date.now() + 5_000;
      while (Date.now() < observationDeadline) {
        const observation = await db.execute(
          sql<{
            observer_pid: number | string;
            pid: number | string;
            wait_event_type: string | null;
            state: string | null;
            query: string;
          }>`
            SELECT pg_backend_pid() AS observer_pid,
                   pid,
                   wait_event_type,
                   state,
                   query
            FROM pg_stat_activity
            WHERE pid = ${recoveryPid}
          `,
        );
        const row = observation.rows[0] as
          | {
              observer_pid: number | string;
              pid: number | string;
              wait_event_type: string | null;
              state: string | null;
              query: string;
            }
          | undefined;
        if (row?.wait_event_type === "Lock" && row.state === "active") {
          observedLock = row;
          break;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(
        observedLock,
        "an independent PostgreSQL observer must see recovery blocked on a production lock",
      );
      const observerPid = Number(observedLock.observer_pid);
      assert.ok(Number.isSafeInteger(observerPid));
      assert.notEqual(observerPid, heartbeatPid);
      assert.notEqual(observerPid, recoveryPid);
      assert.match(observedLock.query, /runtime_controls/iu);
      assert.match(observedLock.query, /for update/iu);
      const laterRelationLocks = await db.execute(
        sql<{ relname: string; mode: string }>`
          SELECT relation.relname,
                 locks.mode
          FROM pg_locks AS locks
          INNER JOIN pg_class AS relation
            ON relation.oid = locks.relation
          WHERE locks.pid = ${recoveryPid}
            AND locks.granted = true
            AND relation.relname IN (
              'runtime_instances',
              'agents',
              'approval_requests',
              'tasks',
              'task_attempts'
            )
        `,
      );
      assert.deepEqual(
        laterRelationLocks.rows,
        [],
        "recovery must hold no later canonical relation lock before runtime_controls is granted",
      );
      releaseHeartbeat.resolve();
      const [heartbeatResult, recoveryResult] = await withDeadline(
        Promise.allSettled([heartbeatAssertion, recovery]),
        10_000,
        "production heartbeat/recovery race",
      );
      assert.equal(
        heartbeatResult.status,
        "fulfilled",
        `production heartbeat rejected independently: ${heartbeatResult.status === "rejected" ? String(heartbeatResult.reason) : ""}`,
      );
      assert.equal(
        recoveryResult.status,
        "fulfilled",
        `production recovery core rejected independently: ${recoveryResult.status === "rejected" ? String(recoveryResult.reason) : ""}`,
      );
    } finally {
      releaseHeartbeat.resolve();
      await heartbeat.stop();
      mutableDb.transaction = originalTransaction;
      await Promise.allSettled(
        [heartbeatAssertion, recovery].filter(
          (candidate): candidate is Promise<void> => candidate !== null,
        ),
      );
    }

    const [renewedTask] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    const [renewedAgent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, agent.id));
    const [runningAttempt] = await db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, claimed.runtimeAttemptId));
    assert.equal(renewedTask.leaseOwner, claimed.leaseOwner);
    assert.ok(
      renewedTask.leaseExpiresAt &&
        renewedTask.leaseExpiresAt.getTime() > Date.now(),
    );
    assert.equal(renewedAgent.runLeaseOwner, claimed.leaseOwner);
    assert.ok(
      renewedAgent.runLeaseExpiresAt &&
        renewedAgent.runLeaseExpiresAt.getTime() > Date.now(),
    );
    assert.equal(runningAttempt.state, "running");
  },
);
