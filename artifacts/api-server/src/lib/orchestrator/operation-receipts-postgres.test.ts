import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray, sql } from "drizzle-orm";

const ALLOWED_DATABASES = new Set(["agentic_os_task5_test", "agentic_os_ci"]);

function rendezvous(participants: number): { arrive: () => Promise<void> } {
  let arrived = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    async arrive(): Promise<void> {
      arrived += 1;
      if (arrived === participants) release();
      await withDeadline(ready, 5_000, "PostgreSQL connection rendezvous");
    },
  };
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
  "PostgreSQL converges receipt, browser-affinity, and reconciliation races across independent adapters",
  { timeout: 90_000 },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      if (process.env.POSTGRES_RACE_TEST_FAIL_IF_SKIPPED === "1") {
        assert.fail(
          "DATABASE_URL is required when PostgreSQL race enforcement is enabled",
        );
      }
      t.skip(
        "DATABASE_URL is absent; real PostgreSQL operation-receipt race proof is environment-blocked",
      );
      return;
    }
    assert.equal(
      process.env.POSTGRES_RACE_TEST_DISPOSABLE,
      "1",
      "PostgreSQL race tests require POSTGRES_RACE_TEST_DISPOSABLE=1",
    );
    const parsedDatabaseUrl = new URL(databaseUrl);
    assert.ok(
      parsedDatabaseUrl.protocol === "postgres:" ||
        parsedDatabaseUrl.protocol === "postgresql:",
      "PostgreSQL race tests require a postgres: or postgresql: DATABASE_URL",
    );
    const databaseName = decodeURIComponent(
      parsedDatabaseUrl.pathname.replace(/^\//u, ""),
    );
    assert.ok(
      ALLOWED_DATABASES.has(databaseName),
      `refusing PostgreSQL race test against non-disposable database ${databaseName}`,
    );

    // Database-owning modules stay behind the disposable target guard so a
    // mistyped local command cannot bootstrap migrations on an arbitrary DB.
    const {
      activityEventsTable,
      agentsTable,
      approvalRequestsTable,
      closeDatabase,
      db,
      dbReady,
      messagesTable,
      operationInvocationsTable,
      operationReceiptsTable,
      runtimeInstancesTable,
      taskAttemptsTable,
      tasksTable,
    } = await import("@workspace/db");
    const {
      canonicalArgumentHash,
      claimOperationInvocation,
      markOperationRunning,
      markOperationUnknown,
      OperationInvocationStateError,
      OperationReconciliationConflictError,
      recoverInterruptedOperation,
      reconcileOperation,
      reserveOperation,
    } = await import("./operation-receipts");
    await dbReady;

    const [{ drizzle }, pgModule] = await Promise.all([
      import("drizzle-orm/node-postgres"),
      import("pg"),
    ]);
    const { Pool } = pgModule.default;
    const adapterPools = [
      new Pool({
        connectionString: databaseUrl,
        max: 1,
        application_name: "agentic-company-os-task5-race-a",
      }),
      new Pool({
        connectionString: databaseUrl,
        max: 1,
        application_name: "agentic-company-os-task5-race-b",
      }),
    ] as const;
    const independentAdapters = adapterPools.map(
      (pool) => drizzle(pool) as unknown as typeof db,
    ) as [typeof db, typeof db];

    const agentIds = new Set<number>();
    const messageIds = new Set<number>();
    const taskIds = new Set<number>();
    const approvalIds = new Set<number>();
    const runtimeInstanceIds = new Set<string>();
    const receiptIds = new Set<string>();
    t.after(async () => {
      try {
        if (agentIds.size > 0) {
          await db
            .delete(activityEventsTable)
            .where(inArray(activityEventsTable.agentId, [...agentIds]));
        }
        if (receiptIds.size > 0) {
          await db
            .delete(operationInvocationsTable)
            .where(
              inArray(operationInvocationsTable.receiptId, [...receiptIds]),
            );
          await db
            .delete(operationReceiptsTable)
            .where(inArray(operationReceiptsTable.id, [...receiptIds]));
        }
        if (approvalIds.size > 0) {
          await db
            .delete(approvalRequestsTable)
            .where(inArray(approvalRequestsTable.id, [...approvalIds]));
        }
        if (messageIds.size > 0) {
          await db
            .delete(messagesTable)
            .where(inArray(messagesTable.id, [...messageIds]));
        }
        if (taskIds.size > 0) {
          await db
            .delete(taskAttemptsTable)
            .where(inArray(taskAttemptsTable.taskId, [...taskIds]));
          await db
            .delete(tasksTable)
            .where(inArray(tasksTable.id, [...taskIds]));
        }
        if (runtimeInstanceIds.size > 0) {
          await db
            .delete(runtimeInstancesTable)
            .where(inArray(runtimeInstancesTable.id, [...runtimeInstanceIds]));
        }
        if (agentIds.size > 0) {
          await db
            .delete(agentsTable)
            .where(inArray(agentsTable.id, [...agentIds]));
        }
      } finally {
        await Promise.all(adapterPools.map((pool) => pool.end()));
        await closeDatabase();
      }
    });

    type DatabaseTransaction = typeof db.transaction;
    type TransactionCallback = Parameters<DatabaseTransaction>[0];
    type Transaction = Parameters<TransactionCallback>[0];
    async function runRace<T>(
      work: (tx: Transaction) => Promise<T>,
    ): Promise<{ results: [T, T]; backendPids: [number, number] }> {
      const gate = rendezvous(2);
      const backendPids: number[] = [];
      const runOne = (adapter: typeof db): Promise<T> =>
        adapter.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
          await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
          const pidResult = await tx.execute(
            sql<{ pid: number | string }>`SELECT pg_backend_pid() AS pid`,
          );
          const pid = Number(pidResult.rows[0]?.pid);
          assert.ok(Number.isSafeInteger(pid));
          backendPids.push(pid);
          await gate.arrive();
          return work(tx);
        });
      const results = await withDeadline(
        Promise.all([
          runOne(independentAdapters[0]),
          runOne(independentAdapters[1]),
        ]),
        20_000,
        "two-connection PostgreSQL race",
      );
      assert.equal(backendPids.length, 2);
      assert.notEqual(
        backendPids[0],
        backendPids[1],
        "the race must occupy two independent PostgreSQL backend connections",
      );
      return {
        results: results as [T, T],
        backendPids: backendPids as [number, number],
      };
    }

    async function runSettledRace<T>(
      work: (tx: Transaction, participant: 0 | 1) => Promise<T>,
    ): Promise<{
      results: [PromiseSettledResult<T>, PromiseSettledResult<T>];
      backendPids: [number, number];
    }> {
      const gate = rendezvous(2);
      const backendPids: number[] = [];
      const runOne = (adapter: typeof db, participant: 0 | 1): Promise<T> =>
        adapter.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
          await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
          const pidResult = await tx.execute(
            sql<{ pid: number | string }>`SELECT pg_backend_pid() AS pid`,
          );
          const pid = Number(pidResult.rows[0]?.pid);
          assert.ok(Number.isSafeInteger(pid));
          backendPids.push(pid);
          await gate.arrive();
          return work(tx, participant);
        });
      const results = await withDeadline(
        Promise.allSettled([
          runOne(independentAdapters[0], 0),
          runOne(independentAdapters[1], 1),
        ]),
        20_000,
        "two-connection settled PostgreSQL race",
      );
      assert.equal(backendPids.length, 2);
      assert.notEqual(
        backendPids[0],
        backendPids[1],
        "the race must occupy two independent PostgreSQL backend connections",
      );
      return {
        results: results as [PromiseSettledResult<T>, PromiseSettledResult<T>],
        backendPids: backendPids as [number, number],
      };
    }

    const suffix = randomUUID();
    const leaseOwner = `receipt-agent-${suffix}`;
    const claimNow = new Date();
    const [agent] = await db
      .insert(agentsTable)
      .values({
        name: `Postgres receipt race ${suffix}`,
        role: "Test",
        systemPrompt: "PostgreSQL receipt race only",
        createdByUser: true,
        runLeaseOwner: leaseOwner,
        runLeaseExpiresAt: new Date(claimNow.getTime() + 60_000),
      })
      .returning();
    const agentId = agent.id;
    agentIds.add(agentId);
    const [message] = await db
      .insert(messagesTable)
      .values({
        agentId,
        role: "user",
        content: `PostgreSQL receipt race ${suffix}`,
      })
      .returning();
    const messageId = message.id;
    messageIds.add(messageId);

    const reservationInput = {
      canonicalVersion: 1 as const,
      executionKind: "chat_turn" as const,
      logicalExecutionId: randomUUID(),
      toolName: "vm_run_command",
      args: { commandHash: `sha256:${suffix.replaceAll("-", "")}` },
      physical: {
        attemptId: null,
        workerInstanceId: null,
        modelToolCallId: `model-call-${suffix}`,
        callSlot: "provider:0:tool:0",
      },
      taskId: null,
      agentId,
      approvalId: null,
      sourceMessageId: messageId,
      originAttemptId: null,
      sideEffectClass: "at_most_once" as const,
      now: claimNow,
    };
    const reservationRace = await runRace((tx) =>
      reserveOperation(reservationInput, tx),
    );
    assert.deepEqual(
      reservationRace.results
        .map((candidate) => candidate.execute)
        .sort((left, right) => Number(left) - Number(right)),
      [false, true],
    );
    assert.equal(
      new Set(reservationRace.results.map((candidate) => candidate.receipt.id))
        .size,
      1,
      "both reservations must converge on one logical receipt",
    );
    const receiptId = reservationRace.results[0].receipt.id;
    receiptIds.add(receiptId);
    const storedReceipts = await db
      .select({ id: operationReceiptsTable.id })
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, receiptId));
    assert.equal(storedReceipts.length, 1);

    const claimRace = await runRace((tx) =>
      claimOperationInvocation(
        {
          receiptId,
          executionKind: "chat_turn",
          attemptId: null,
          workerInstanceId: null,
          modelToolCallId: `model-call-${suffix}`,
          leaseOwner: `invocation-${randomUUID()}`,
          leaseExpiresAt: new Date(claimNow.getTime() + 30_000),
          taskLeaseOwner: null,
          agentLeaseOwner: leaseOwner,
          now: claimNow,
        },
        tx,
      ),
    );
    assert.deepEqual(
      claimRace.results
        .map((candidate) => candidate.claimed)
        .sort((left, right) => Number(left) - Number(right)),
      [false, true],
    );
    const claimedInvocationIds = new Set(
      claimRace.results.map((candidate) => candidate.invocation?.id),
    );
    assert.equal(claimedInvocationIds.size, 1);
    assert.ok(!claimedInvocationIds.has(undefined));
    const activeInvocations = await db
      .select({ id: operationInvocationsTable.id })
      .from(operationInvocationsTable)
      .where(inArray(operationInvocationsTable.state, ["claimed", "running"]));
    assert.equal(
      activeInvocations.filter((candidate) =>
        claimedInvocationIds.has(candidate.id),
      ).length,
      1,
      "exactly one active physical invocation may own the receipt",
    );

    const recoveryNow = new Date(claimNow.getTime() + 120_000);
    const recoveryRace = await runRace((tx) =>
      recoverInterruptedOperation(
        {
          receiptId,
          now: recoveryNow,
          runtimeStaleBefore: recoveryNow,
        },
        tx,
      ),
    );
    assert.ok(
      recoveryRace.results.every((candidate) =>
        ["reclaimable", "terminal"].includes(candidate.disposition),
      ),
    );
    assert.ok(
      recoveryRace.results.some(
        (candidate) => candidate.disposition === "reclaimable",
      ),
    );
    const remainingActiveInvocations = await db
      .select({ id: operationInvocationsTable.id })
      .from(operationInvocationsTable)
      .where(inArray(operationInvocationsTable.state, ["claimed", "running"]));
    assert.equal(
      remainingActiveInvocations.filter((candidate) =>
        claimedInvocationIds.has(candidate.id),
      ).length,
      0,
      "stale recovery must retire the only active invocation",
    );

    async function createUnknownChatFixture(label: string) {
      const fixtureSuffix = randomUUID();
      const now = new Date();
      const agentLeaseOwner = `unknown-agent-${fixtureSuffix}`;
      const [fixtureAgent] = await db
        .insert(agentsTable)
        .values({
          name: `Postgres reconciliation ${label} ${fixtureSuffix}`,
          role: "Test",
          systemPrompt: "PostgreSQL reconciliation race only",
          createdByUser: true,
          status: "working",
          runLeaseOwner: agentLeaseOwner,
          runLeaseExpiresAt: new Date(now.getTime() + 90_000),
        })
        .returning();
      agentIds.add(fixtureAgent.id);
      const [fixtureMessage] = await db
        .insert(messagesTable)
        .values({
          agentId: fixtureAgent.id,
          role: "user",
          content: `PostgreSQL reconciliation ${label} ${fixtureSuffix}`,
        })
        .returning();
      messageIds.add(fixtureMessage.id);

      const reservation = await reserveOperation({
        canonicalVersion: 1,
        executionKind: "chat_turn",
        logicalExecutionId: randomUUID(),
        toolName: "vm_run_command",
        args: { commandHash: `sha256:${fixtureSuffix.replaceAll("-", "")}` },
        physical: {
          attemptId: null,
          workerInstanceId: null,
          modelToolCallId: `unknown-${fixtureSuffix}`,
          callSlot: `provider:0:tool:${label}`,
        },
        taskId: null,
        agentId: fixtureAgent.id,
        approvalId: null,
        sourceMessageId: fixtureMessage.id,
        originAttemptId: null,
        sideEffectClass: "at_most_once",
        now,
      });
      assert.equal(reservation.execute, true);
      receiptIds.add(reservation.receipt.id);
      const invocationLeaseOwner = `unknown-invocation-${fixtureSuffix}`;
      const claim = await claimOperationInvocation({
        receiptId: reservation.receipt.id,
        executionKind: "chat_turn",
        attemptId: null,
        workerInstanceId: null,
        modelToolCallId: `unknown-${fixtureSuffix}`,
        leaseOwner: invocationLeaseOwner,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        taskLeaseOwner: null,
        agentLeaseOwner,
        now,
      });
      assert.ok(claim.claimed && claim.invocation);
      await markOperationRunning({
        receiptId: reservation.receipt.id,
        invocationId: claim.invocation.id,
        leaseOwner: invocationLeaseOwner,
        now: new Date(now.getTime() + 1_000),
      });
      await markOperationUnknown({
        receiptId: reservation.receipt.id,
        invocationId: claim.invocation.id,
        leaseOwner: invocationLeaseOwner,
        failureKind: "postgres_race_unknown",
        sanitizedError:
          "PostgreSQL race fixture intentionally lost the outcome.",
        now: new Date(now.getTime() + 2_000),
      });
      return {
        agentId: fixtureAgent.id,
        receiptId: reservation.receipt.id,
        now,
      };
    }

    async function reconciliationEvents(
      fixtureAgentId: number,
      fixtureReceiptId: string,
    ) {
      const events = await db
        .select({
          type: activityEventsTable.type,
          detail: activityEventsTable.detail,
        })
        .from(activityEventsTable)
        .where(eq(activityEventsTable.agentId, fixtureAgentId));
      return events.filter(
        (event) =>
          event.type === "task_status_changed" &&
          event.detail?.runtimeEvent === "operation_reconciled" &&
          event.detail.receiptId === fixtureReceiptId,
      );
    }

    await t.test(
      "the real task-step wrapper converges after both post-effect finalization writes fail",
      async () => {
        const { runDurableExternalEffect } = await import("./execute-tool");
        const fixtureSuffix = randomUUID();
        const now = new Date();
        const runtimeId = `postgres-wrapper-task-${fixtureSuffix}`;
        const taskLeaseOwner = `postgres-wrapper-task-${fixtureSuffix}`;
        const attemptId = randomUUID();
        const logicalExecutionId = randomUUID();
        runtimeInstanceIds.add(runtimeId);
        await db.insert(runtimeInstancesTable).values({
          id: runtimeId,
          role: "worker",
          state: "healthy",
          hostname: "postgres-wrapper-task",
          processId: 24_201,
          buildVersion: "test",
          schedulerEnabled: true,
          lastHeartbeatAt: now,
        });
        const [wrapperAgent] = await db
          .insert(agentsTable)
          .values({
            name: `Postgres wrapper task ${fixtureSuffix}`,
            role: "Test",
            systemPrompt: "PostgreSQL production wrapper test only",
            createdByUser: true,
            status: "working",
            runLeaseOwner: taskLeaseOwner,
            runLeaseExpiresAt: new Date(now.getTime() + 90_000),
          })
          .returning();
        agentIds.add(wrapperAgent.id);
        const [wrapperTask] = await db
          .insert(tasksTable)
          .values({
            title: `Postgres wrapper task ${fixtureSuffix}`,
            brief: "Exercise real post-effect recovery.",
            ownerAgentId: wrapperAgent.id,
            status: "in_progress",
            leaseOwner: taskLeaseOwner,
            leaseExpiresAt: new Date(now.getTime() + 90_000),
            stepAttempts: 1,
            createdByUser: true,
          })
          .returning();
        taskIds.add(wrapperTask.id);
        await db
          .update(agentsTable)
          .set({ currentTaskId: wrapperTask.id })
          .where(eq(agentsTable.id, wrapperAgent.id));
        await db.insert(taskAttemptsTable).values({
          id: attemptId,
          taskId: wrapperTask.id,
          agentId: wrapperAgent.id,
          workerInstanceId: runtimeId,
          leaseOwner: taskLeaseOwner,
          attemptNumber: 1,
          cycleNumber: 0,
          state: "running",
          logicalExecutionId,
        });

        let effects = 0;
        let completeAttempts = 0;
        let unknownAttempts = 0;
        const attached = new Set<string>();
        const persistenceOutage = new Error(
          "synthetic PostgreSQL wrapper finalization outage",
        );
        const context = {
          agent: wrapperAgent,
          taskId: wrapperTask.id,
          taskLeaseOwner,
          runtimeAttemptId: attemptId,
          assertTaskLease: async () => undefined,
          operationIdentity: {
            executionKind: "task_step" as const,
            logicalExecutionId,
            runtimeInstanceId: runtimeId,
            originAttemptId: attemptId,
            sourceMessageId: null,
            modelToolCallId: `postgres-wrapper-call-${fixtureSuffix}`,
            callSlot: "round:0:tool:0",
            agentLeaseOwner: taskLeaseOwner,
          },
          attachOperationInvocation: (operation: { invocationId: string }) => {
            attached.add(operation.invocationId);
          },
          detachOperationInvocation: (invocationId: string) => {
            attached.delete(invocationId);
          },
        };
        const effectInput = {
          toolName: "vm_run_command",
          normalizedArgs: { command: `echo ${fixtureSuffix}` },
          execute: async (boundary: { startEffect: () => Promise<void> }) => {
            await boundary.startEffect();
            effects += 1;
            return {
              result: {
                content: "postgres task effect completed",
                createdTasks: [],
                createdAgents: [],
                toolOutcome: "succeeded" as const,
              },
              resultData: { ok: true, exitCode: 0, durationMs: 1 },
            };
          },
          onError: async () => ({
            content: "postgres task effect finalization failed",
            createdTasks: [],
            createdAgents: [],
            toolOutcome: "rejected" as const,
          }),
        };
        const first = await runDurableExternalEffect(context, effectInput, {
          completeOperation: async () => {
            completeAttempts += 1;
            throw persistenceOutage;
          },
          markOperationUnknown: async () => {
            unknownAttempts += 1;
            throw persistenceOutage;
          },
        });
        assert.equal(first.toolOutcome, "unknown");
        assert.ok(first.receiptId);
        receiptIds.add(first.receiptId);
        assert.equal(effects, 1);
        assert.equal(completeAttempts, 1);
        assert.equal(unknownAttempts, 1);
        assert.equal(attached.size, 0);
        const [runningInvocation] = await db
          .select()
          .from(operationInvocationsTable)
          .where(eq(operationInvocationsTable.receiptId, first.receiptId));
        assert.equal(runningInvocation.state, "running");

        const recoveryNow = new Date(Date.now() + 1_000);
        const expiredAt = new Date(recoveryNow.getTime() - 1);
        await Promise.all([
          db
            .update(tasksTable)
            .set({ leaseExpiresAt: expiredAt })
            .where(eq(tasksTable.id, wrapperTask.id)),
          db
            .update(agentsTable)
            .set({ runLeaseExpiresAt: expiredAt })
            .where(eq(agentsTable.id, wrapperAgent.id)),
          db
            .update(operationInvocationsTable)
            .set({ leaseExpiresAt: expiredAt })
            .where(eq(operationInvocationsTable.id, runningInvocation.id)),
          db
            .update(runtimeInstancesTable)
            .set({ state: "healthy", lastHeartbeatAt: recoveryNow })
            .where(eq(runtimeInstancesTable.id, runtimeId)),
        ]);
        const recovered = await recoverInterruptedOperation({
          receiptId: first.receiptId,
          now: recoveryNow,
          runtimeStaleBefore: new Date(recoveryNow.getTime() - 15_000),
        });
        assert.equal(recovered.disposition, "unknown");
        const replay = await runDurableExternalEffect(context, effectInput);
        assert.equal(replay.toolOutcome, "unknown");
        assert.equal(replay.receiptId, first.receiptId);
        assert.equal(effects, 1);
      },
    );

    await t.test(
      "the real approved-action wrapper converges after both post-effect finalization writes fail",
      async () => {
        const [
          { executeApprovedAction, runDurableExternalEffect },
          configModule,
        ] = await Promise.all([
          import("./execute-tool"),
          import("../runtime-operations-config"),
        ]);
        const fixtureSuffix = randomUUID();
        const now = new Date();
        const runtimeId = `postgres-wrapper-approval-${fixtureSuffix}`;
        runtimeInstanceIds.add(runtimeId);
        await db.insert(runtimeInstancesTable).values({
          id: runtimeId,
          role: "worker",
          state: "healthy",
          hostname: "postgres-wrapper-approval",
          processId: 24_202,
          buildVersion: "test",
          schedulerEnabled: true,
          lastHeartbeatAt: now,
        });
        const [wrapperAgent] = await db
          .insert(agentsTable)
          .values({
            name: `Postgres wrapper approval ${fixtureSuffix}`,
            role: "Test",
            systemPrompt: "PostgreSQL approved wrapper test only",
            createdByUser: true,
          })
          .returning();
        agentIds.add(wrapperAgent.id);
        const [wrapperTask] = await db
          .insert(tasksTable)
          .values({
            title: `Postgres wrapper approval ${fixtureSuffix}`,
            brief: "Exercise real approved post-effect recovery.",
            ownerAgentId: wrapperAgent.id,
            status: "awaiting_approval",
            createdByUser: true,
          })
          .returning();
        taskIds.add(wrapperTask.id);
        const args = { command: `echo ${fixtureSuffix}` };
        const [approval] = await db
          .insert(approvalRequestsTable)
          .values({
            taskId: wrapperTask.id,
            agentId: wrapperAgent.id,
            category: "other",
            title: "Postgres wrapper approval",
            description: "Exercise the real approved durable wrapper.",
            status: "approved",
            resolvedAt: now,
            expiresAt: new Date(now.getTime() + 5 * 60_000),
            scope: {
              toolName: "vm_run_command",
              argsHash: canonicalArgumentHash(args),
              target: null,
            },
            actionPayload: {
              toolName: "vm_run_command",
              args,
              taskDisposition: "resume",
            },
          })
          .returning();
        approvalIds.add(approval.id);

        let effects = 0;
        let completeAttempts = 0;
        let unknownAttempts = 0;
        const persistenceOutage = new Error(
          "synthetic PostgreSQL approved finalization outage",
        );
        const first = await executeApprovedAction(
          approval.id,
          configModule.readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" }),
          {
            runtimeInstanceId: runtimeId,
            executeAction: async (context) =>
              runDurableExternalEffect(
                context,
                {
                  toolName: "vm_run_command",
                  normalizedArgs: args,
                  execute: async ({ startEffect }) => {
                    await startEffect();
                    effects += 1;
                    return {
                      result: {
                        content: "postgres approved effect completed",
                        createdTasks: [],
                        createdAgents: [],
                        toolOutcome: "succeeded",
                      },
                      resultData: { ok: true, exitCode: 0, durationMs: 1 },
                    };
                  },
                  onError: async () => ({
                    content: "postgres approved finalization failed",
                    createdTasks: [],
                    createdAgents: [],
                    toolOutcome: "rejected",
                  }),
                },
                {
                  completeOperation: async () => {
                    completeAttempts += 1;
                    throw persistenceOutage;
                  },
                  markOperationUnknown: async () => {
                    unknownAttempts += 1;
                    throw persistenceOutage;
                  },
                },
              ),
          },
        );
        assert.equal(first.status, "approval_outcome_unknown");
        assert.equal(first.claimed, true);
        assert.equal(effects, 1);
        assert.equal(completeAttempts, 1);
        assert.equal(unknownAttempts, 1);
        const [runningReceipt] = await db
          .select()
          .from(operationReceiptsTable)
          .where(eq(operationReceiptsTable.approvalId, approval.id));
        receiptIds.add(runningReceipt.id);
        assert.equal(runningReceipt.state, "running");
        const [runningInvocation] = await db
          .select()
          .from(operationInvocationsTable)
          .where(eq(operationInvocationsTable.receiptId, runningReceipt.id));
        assert.equal(runningInvocation.state, "running");

        const recoveryNow = new Date(Date.now() + 1_000);
        const expiredAt = new Date(recoveryNow.getTime() - 1);
        await Promise.all([
          db
            .update(tasksTable)
            .set({ leaseExpiresAt: expiredAt })
            .where(eq(tasksTable.id, wrapperTask.id)),
          db
            .update(agentsTable)
            .set({ runLeaseExpiresAt: expiredAt })
            .where(eq(agentsTable.id, wrapperAgent.id)),
          db
            .update(operationInvocationsTable)
            .set({ leaseExpiresAt: expiredAt })
            .where(eq(operationInvocationsTable.id, runningInvocation.id)),
          db
            .update(runtimeInstancesTable)
            .set({ state: "healthy", lastHeartbeatAt: recoveryNow })
            .where(eq(runtimeInstancesTable.id, runtimeId)),
        ]);
        const recovered = await recoverInterruptedOperation({
          receiptId: runningReceipt.id,
          now: recoveryNow,
          runtimeStaleBefore: new Date(recoveryNow.getTime() - 15_000),
        });
        assert.equal(recovered.disposition, "unknown");
        const replay = await executeApprovedAction(
          approval.id,
          configModule.readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" }),
          {
            runtimeInstanceId: runtimeId,
            executeAction: async () => {
              effects += 1;
              throw new Error("approved replay must remain blocked");
            },
          },
        );
        assert.equal(replay.status, "approval_outcome_unknown");
        assert.equal(replay.claimed, false);
        assert.equal(effects, 1);
      },
    );

    await t.test(
      "task-step reservation and invocation claim share one deadlock-free canonical lock order",
      async () => {
        for (let index = 0; index < 8; index += 1) {
          const raceSuffix = randomUUID();
          const now = new Date();
          const runtimeId = `task-step-lock-order-${raceSuffix}`;
          const taskLeaseOwner = `task-step-owner-${raceSuffix}`;
          const logicalExecutionId = randomUUID();
          const attemptId = randomUUID();
          runtimeInstanceIds.add(runtimeId);
          await db.insert(runtimeInstancesTable).values({
            id: runtimeId,
            role: "worker",
            state: "healthy",
            hostname: "postgres-task-step-lock-order",
            processId: 24_100 + index,
            buildVersion: "test",
            schedulerEnabled: true,
            lastHeartbeatAt: now,
          });
          const [raceAgent] = await db
            .insert(agentsTable)
            .values({
              name: `Postgres task-step lock ${raceSuffix}`,
              role: "Test",
              systemPrompt: "PostgreSQL lock-order race only",
              createdByUser: true,
              status: "working",
              runLeaseOwner: taskLeaseOwner,
              runLeaseExpiresAt: new Date(now.getTime() + 90_000),
            })
            .returning();
          agentIds.add(raceAgent.id);
          const [raceTask] = await db
            .insert(tasksTable)
            .values({
              title: `Postgres task-step lock ${raceSuffix}`,
              brief: "Reservation and claim must use one lock order.",
              ownerAgentId: raceAgent.id,
              status: "in_progress",
              leaseOwner: taskLeaseOwner,
              leaseExpiresAt: new Date(now.getTime() + 90_000),
              createdByUser: true,
            })
            .returning();
          taskIds.add(raceTask.id);
          await db
            .update(agentsTable)
            .set({ currentTaskId: raceTask.id })
            .where(eq(agentsTable.id, raceAgent.id));
          await db.insert(taskAttemptsTable).values({
            id: attemptId,
            taskId: raceTask.id,
            agentId: raceAgent.id,
            workerInstanceId: runtimeId,
            leaseOwner: taskLeaseOwner,
            attemptNumber: 1,
            cycleNumber: 0,
            state: "running",
            logicalExecutionId,
          });
          const physical = {
            attemptId,
            workerInstanceId: runtimeId,
            modelToolCallId: `lock-order-existing-${raceSuffix}`,
            callSlot: "provider:0:tool:0",
          };
          const existing = await reserveOperation({
            canonicalVersion: 1,
            executionKind: "task_step",
            logicalExecutionId,
            toolName: "log_note",
            args: { summary: `existing-${raceSuffix}` },
            physical,
            taskId: raceTask.id,
            agentId: raceAgent.id,
            approvalId: null,
            sourceMessageId: null,
            originAttemptId: attemptId,
            sideEffectClass: "transactional",
            now,
          });
          receiptIds.add(existing.receipt.id);

          const gate = rendezvous(2);
          const [reserved, claimed] = await withDeadline(
            Promise.all([
              independentAdapters[0].transaction(async (tx) => {
                await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
                await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
                await gate.arrive();
                return reserveOperation(
                  {
                    canonicalVersion: 1,
                    executionKind: "task_step",
                    logicalExecutionId,
                    toolName: "post_company_message",
                    args: { content: `new-${raceSuffix}` },
                    physical: {
                      ...physical,
                      modelToolCallId: `lock-order-new-${raceSuffix}`,
                      callSlot: "provider:0:tool:1",
                    },
                    taskId: raceTask.id,
                    agentId: raceAgent.id,
                    approvalId: null,
                    sourceMessageId: null,
                    originAttemptId: attemptId,
                    sideEffectClass: "transactional",
                    now,
                  },
                  tx,
                );
              }),
              independentAdapters[1].transaction(async (tx) => {
                await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
                await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
                await gate.arrive();
                return claimOperationInvocation(
                  {
                    receiptId: existing.receipt.id,
                    executionKind: "task_step",
                    attemptId,
                    workerInstanceId: runtimeId,
                    modelToolCallId: physical.modelToolCallId,
                    leaseOwner: `lock-order-operation-${raceSuffix}`,
                    leaseExpiresAt: new Date(now.getTime() + 60_000),
                    taskLeaseOwner,
                    agentLeaseOwner: taskLeaseOwner,
                    now,
                  },
                  tx,
                );
              }),
            ]),
            20_000,
            "task-step reserve/claim canonical lock-order race",
          );
          assert.equal(reserved.execute, true);
          assert.equal(claimed.claimed, true);
          assert.ok(claimed.invocation);
          receiptIds.add(reserved.receipt.id);
        }
      },
    );

    await t.test(
      "an exact browser-bound approval cannot be executed or claimed by a second runtime",
      async () => {
        const browserSuffix = randomUUID();
        const now = new Date();
        const boundRuntimeId = `browser-bound-${browserSuffix}`;
        const otherRuntimeId = `browser-other-${browserSuffix}`;
        runtimeInstanceIds.add(boundRuntimeId);
        runtimeInstanceIds.add(otherRuntimeId);
        await db.insert(runtimeInstancesTable).values([
          {
            id: boundRuntimeId,
            role: "worker",
            state: "healthy",
            hostname: "postgres-browser-bound-a",
            processId: 24_001,
            buildVersion: "test",
            schedulerEnabled: true,
            lastHeartbeatAt: now,
          },
          {
            id: otherRuntimeId,
            role: "worker",
            state: "healthy",
            hostname: "postgres-browser-bound-b",
            processId: 24_002,
            buildVersion: "test",
            schedulerEnabled: true,
            lastHeartbeatAt: now,
          },
        ]);
        const agentLeaseOwner = `browser-agent-${browserSuffix}`;
        const [browserAgent] = await db
          .insert(agentsTable)
          .values({
            name: `Postgres browser affinity ${browserSuffix}`,
            role: "Test",
            systemPrompt: "PostgreSQL browser-affinity race only",
            createdByUser: true,
            status: "working",
            runLeaseOwner: agentLeaseOwner,
            runLeaseExpiresAt: new Date(now.getTime() + 90_000),
          })
          .returning();
        agentIds.add(browserAgent.id);
        const [browserTask] = await db
          .insert(tasksTable)
          .values({
            title: `Postgres browser affinity ${browserSuffix}`,
            brief: "Only the immutable browser runtime may own the effect.",
            ownerAgentId: browserAgent.id,
            status: "awaiting_approval",
            createdByUser: true,
            leaseOwner: agentLeaseOwner,
            leaseExpiresAt: new Date(now.getTime() + 90_000),
            lastHeartbeatAt: now,
          })
          .returning();
        taskIds.add(browserTask.id);

        const args = { ref: 7_331 };
        const argsHash = canonicalArgumentHash(args);
        const browserBinding = {
          runtimeInstanceId: boundRuntimeId,
          sessionId: `browser-session-${browserSuffix}`,
          sessionEpoch: 7,
          snapshotMarker: `browser-snapshot-${browserSuffix}`,
          bindingHash: `sha256:${"b".repeat(64)}`,
        };
        const [approval] = await db
          .insert(approvalRequestsTable)
          .values({
            taskId: browserTask.id,
            agentId: browserAgent.id,
            category: "external_contact",
            title: "Approve exact browser click",
            description: "The capability is bound to one runtime and session.",
            scope: { toolName: "browser_click", argsHash },
            actionPayload: { toolName: "browser_click", args },
            status: "approved",
            resolvedAt: now,
            expiresAt: new Date(now.getTime() + 60_000),
            browserRuntimeInstanceId: boundRuntimeId,
            browserSessionId: browserBinding.sessionId,
            browserSessionEpoch: browserBinding.sessionEpoch,
            browserSnapshotMarker: browserBinding.snapshotMarker,
            browserBindingHash: browserBinding.bindingHash,
          })
          .returning();
        approvalIds.add(approval.id);
        const reservation = await reserveOperation({
          canonicalVersion: 1,
          executionKind: "approved_action",
          logicalExecutionId: `approval:${approval.id}`,
          toolName: "browser_click",
          args,
          physical: {
            attemptId: null,
            workerInstanceId: boundRuntimeId,
            modelToolCallId: null,
            callSlot: "approved-action:0",
          },
          taskId: browserTask.id,
          agentId: browserAgent.id,
          approvalId: approval.id,
          sourceMessageId: null,
          originAttemptId: null,
          sideEffectClass: "approval_at_most_once",
          now,
        });
        assert.equal(reservation.execute, true);
        receiptIds.add(reservation.receipt.id);

        const [
          { executeApprovedAction },
          { readRuntimeOperationsConfig },
          browser,
        ] = await Promise.all([
          import("./execute-tool"),
          import("../runtime-operations-config"),
          import("../vm/browser"),
        ]);
        assert.equal(
          (await browser.inspectBrowserSession(browserAgent.id)).active,
          false,
        );
        let dispatchedEffects = 0;
        const wrongRuntimeExecution = await executeApprovedAction(
          approval.id,
          readRuntimeOperationsConfig(),
          {
            runtimeInstanceId: otherRuntimeId,
            executeAction: async () => {
              dispatchedEffects += 1;
              throw new Error("a mismatched runtime must never dispatch");
            },
          },
        );
        assert.equal(wrongRuntimeExecution.status, "queued");
        assert.equal(wrongRuntimeExecution.claimed, false);
        assert.equal(dispatchedEffects, 0);
        assert.equal(
          (await browser.inspectBrowserSession(browserAgent.id)).active,
          false,
          "runtime mismatch must not create a replacement browser session",
        );

        let wrongBackendPid: number | null = null;
        await assert.rejects(
          independentAdapters[1].transaction(async (tx) => {
            const pidResult = await tx.execute(
              sql<{ pid: number | string }>`SELECT pg_backend_pid() AS pid`,
            );
            wrongBackendPid = Number(pidResult.rows[0]?.pid);
            return claimOperationInvocation(
              {
                receiptId: reservation.receipt.id,
                executionKind: "approved_action",
                attemptId: null,
                workerInstanceId: otherRuntimeId,
                modelToolCallId: null,
                leaseOwner: `browser-other-invocation-${browserSuffix}`,
                leaseExpiresAt: new Date(now.getTime() + 45_000),
                taskLeaseOwner: null,
                agentLeaseOwner,
                browserBinding: {
                  ...browserBinding,
                  runtimeInstanceId: otherRuntimeId,
                },
                now,
              },
              tx,
            );
          }),
          OperationInvocationStateError,
        );

        let boundBackendPid: number | null = null;
        const correctClaim = await independentAdapters[0].transaction(
          async (tx) => {
            const pidResult = await tx.execute(
              sql<{ pid: number | string }>`SELECT pg_backend_pid() AS pid`,
            );
            boundBackendPid = Number(pidResult.rows[0]?.pid);
            return claimOperationInvocation(
              {
                receiptId: reservation.receipt.id,
                executionKind: "approved_action",
                attemptId: null,
                workerInstanceId: boundRuntimeId,
                modelToolCallId: null,
                leaseOwner: `browser-bound-invocation-${browserSuffix}`,
                leaseExpiresAt: new Date(now.getTime() + 45_000),
                taskLeaseOwner: null,
                agentLeaseOwner,
                browserBinding,
                now,
              },
              tx,
            );
          },
        );
        assert.equal(correctClaim.claimed, true);
        assert.equal(correctClaim.invocation?.workerInstanceId, boundRuntimeId);
        assert.ok(Number.isSafeInteger(wrongBackendPid));
        assert.ok(Number.isSafeInteger(boundBackendPid));
        assert.notEqual(wrongBackendPid, boundBackendPid);
        const [unconsumedApproval] = await db
          .select()
          .from(approvalRequestsTable)
          .where(eq(approvalRequestsTable.id, approval.id));
        assert.equal(unconsumedApproval.consumedAt, null);
        assert.deepEqual(unconsumedApproval.actionPayload, {
          toolName: "browser_click",
          args,
        });
      },
    );

    await t.test(
      "concurrent identical reconciliation decisions are idempotent with one event",
      async () => {
        const fixture = await createUnknownChatFixture("same-decision");
        const reconciliationNow = new Date(fixture.now.getTime() + 3_000);
        const race = await runRace((tx) =>
          reconcileOperation(
            {
              receiptId: fixture.receiptId,
              decision: "confirmed_applied",
              note: "The authoritative external system confirms the effect.",
              actorId: "postgres-race-operator",
              now: reconciliationNow,
            },
            tx,
          ),
        );
        assert.equal(
          new Set(race.results.map((receipt) => receipt.id)).size,
          1,
        );
        assert.equal(
          new Set(
            race.results.map((receipt) => receipt.reconciledAt?.getTime()),
          ).size,
          1,
        );
        assert.ok(
          race.results.every(
            (receipt) => receipt.reconciliationDecision === "confirmed_applied",
          ),
        );
        assert.equal(
          (await reconciliationEvents(fixture.agentId, fixture.receiptId))
            .length,
          1,
          "idempotent callers must not duplicate operator audit events",
        );
      },
    );

    await t.test(
      "opposite reconciliation decisions produce one winner and one deterministic conflict",
      async () => {
        const fixture = await createUnknownChatFixture("opposite-decision");
        const decisions = [
          "confirmed_applied",
          "confirmed_not_applied",
        ] as const;
        const race = await runSettledRace((tx, participant) =>
          reconcileOperation(
            {
              receiptId: fixture.receiptId,
              decision: decisions[participant],
              note: `Authoritative evidence for ${decisions[participant]}.`,
              actorId: "postgres-race-operator",
              now: new Date(fixture.now.getTime() + 3_000 + participant),
            },
            tx,
          ),
        );
        const fulfilled = race.results.filter(
          (result) => result.status === "fulfilled",
        );
        const rejected = race.results.filter(
          (result) => result.status === "rejected",
        );
        assert.equal(fulfilled.length, 1);
        assert.equal(rejected.length, 1);
        const winner = fulfilled[0];
        const conflict = rejected[0];
        assert.ok(winner && winner.status === "fulfilled");
        assert.ok(conflict && conflict.status === "rejected");
        assert.ok(
          conflict.reason instanceof OperationReconciliationConflictError,
        );
        assert.match(
          (conflict.reason as Error).message,
          /different immutable reconciliation decision/iu,
        );
        const [persisted] = await db
          .select()
          .from(operationReceiptsTable)
          .where(eq(operationReceiptsTable.id, fixture.receiptId));
        assert.equal(
          persisted.reconciliationDecision,
          winner.value.reconciliationDecision,
        );
        assert.equal(
          (await reconciliationEvents(fixture.agentId, fixture.receiptId))
            .length,
          1,
          "the losing decision must not emit an operator audit event",
        );
      },
    );
  },
);
