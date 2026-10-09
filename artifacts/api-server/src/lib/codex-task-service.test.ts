import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  db,
  closeDatabase,
  codexTaskSessionsTable,
  usageEventsTable,
  tasksTable,
  sourceChangesTable,
  agentsTable,
} from "@workspace/db";
import { fixture, nativeFixturePorts } from "./testing/codex-task-fixture";
import {
  runGovernedCodexTask,
  resolveCodexTaskWorkspace,
} from "./codex-task-service";
import { recordCodexTaskUsage } from "./codex-task-usage";
import { getCodexTaskCopy } from "./codex-task-copy";
import { getSandboxRoot } from "./vm/sandbox";

const originalSandboxRoot = process.env.AGENT_SANDBOX_ROOT;
const ownedSandboxRoot = await realpath(
  await mkdtemp(
    path.join(await realpath(os.tmpdir()), "acos-codex-workspace-selection-"),
  ),
);
process.env.AGENT_SANDBOX_ROOT = ownedSandboxRoot;
test.after(async () => {
  if (originalSandboxRoot === undefined) delete process.env.AGENT_SANDBOX_ROOT;
  else process.env.AGENT_SANDBOX_ROOT = originalSandboxRoot;
  assert.equal(path.dirname(ownedSandboxRoot), await realpath(os.tmpdir()));
  await rm(ownedSandboxRoot, { recursive: true, force: true });
});

test.after(() => closeDatabase());

test("backend workspace selection revalidates localized ownership and uses only the task's draft sandbox", async (t) => {
  const f = await fixture(t);
  const changeId = randomUUID();
  const labels: string[] = [];
  const context = {
    ...f.context,
    assertTaskLease: async (label: string) => {
      labels.push(label);
      await f.context.assertTaskLease!(label);
    },
  };
  for (const locale of [
    "tr",
    "en",
    "de",
    "ru",
    "zh-CN",
    "zh-TW",
    "ar",
  ] as const) {
    assert.equal(
      await resolveCodexTaskWorkspace({ ...context, locale }),
      getSandboxRoot(f.agent.id),
    );
    assert.equal(labels.at(-1), getCodexTaskCopy(locale).workspace);
  }
  await db.insert(sourceChangesTable).values({
    id: changeId,
    taskId: f.task.id,
    agentId: f.agent.id,
    sourcePath: "DO-NOT-USE-HUMAN-CHECKOUT",
    baseCommit: "fixture",
    request: "Fixture",
    state: "draft",
  });
  try {
    assert.equal(
      await resolveCodexTaskWorkspace(context),
      path.join(getSandboxRoot(f.agent.id), "source-changes", changeId),
    );
    await db
      .update(sourceChangesTable)
      .set({ state: "verified" })
      .where(eq(sourceChangesTable.id, changeId));
    await assert.rejects(resolveCodexTaskWorkspace(context), {
      kind: "unsupported_capability",
    });
    const [otherAgent] = await db
      .insert(agentsTable)
      .values({
        name: "Other workspace owner",
        role: "Fixture",
        systemPrompt: "Fixture",
      })
      .returning();
    try {
      await db
        .update(sourceChangesTable)
        .set({ state: "draft", agentId: otherAgent.id })
        .where(eq(sourceChangesTable.id, changeId));
      await assert.rejects(resolveCodexTaskWorkspace(context), {
        kind: "unsupported_capability",
      });
    } finally {
      await db
        .delete(sourceChangesTable)
        .where(eq(sourceChangesTable.id, changeId));
      await db.delete(agentsTable).where(eq(agentsTable.id, otherAgent.id));
    }
  } finally {
    await db
      .delete(sourceChangesTable)
      .where(eq(sourceChangesTable.id, changeId));
  }
  const deniedRoot = getSandboxRoot(f.agent.id + 1000000);
  await assert.rejects(
    resolveCodexTaskWorkspace({
      ...context,
      agent: { ...f.agent, id: f.agent.id + 1000000 },
      assertTaskLease: async () => {
        throw new Error("fixture_lease_lost");
      },
    }),
    /fixture_lease_lost/,
  );
  await assert.rejects(stat(deniedRoot), { code: "ENOENT" });
});

test("source workspace invalidation while awaiting native approval stops the owned peer without granting the action", async (t) => {
  const f = await fixture(t),
    id = randomUUID();
  await db
    .delete(codexTaskSessionsTable)
    .where(eq(codexTaskSessionsTable.taskId, f.task.id));
  let stops = 0;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await db.insert(sourceChangesTable).values({
      id,
      agentId: f.agent.id,
      taskId: f.task.id,
      sourcePath: "PRIVATE_original",
      request: "Fixture",
      baseCommit: "1".repeat(40),
      state: "draft",
    });
    const running = runGovernedCodexTask(
      f.context,
      { prompt: "Fixture", signal: abort.signal },
      {
        environment: {
          ALLOW_AGENT_CODEX_TASKS: "true",
          ALLOW_AGENT_PROCESS_EXEC: "true",
          ACOS_CODEX_EXECUTABLE: process.execPath,
          CHATGPT_STORAGE_DIRECTORY: path.join(f.root, "private"),
        },
        runtime: {
          store: async () => f.store,
          sessions: async () => ({
            renewRegistration: async () =>
              (await f.store.readActiveRegistration())!,
          }),
        },
        resolveWorkspace: async () => f.workspace,
        processPorts: (input) => {
          const ports = nativeFixturePorts(
            t,
            { ...f, session: input.session! },
            "completed",
          );
          return {
            ...ports,
            launch: async (prepared, binding) => {
              const owned = await ports.launch(prepared, binding);
              return {
                ...owned,
                stop: async () => {
                  stops++;
                  await owned.stop();
                },
              };
            },
          };
        },
      },
    );
    void running.catch(() => {});
    await f.pending(running);
    await db
      .update(sourceChangesTable)
      .set({ state: "checking", revision: 2 })
      .where(eq(sourceChangesTable.id, id));
    timer = setTimeout(() => abort.abort(), 3000);
    await assert.rejects(running, (error: any) => {
      assert.equal(error.kind, "ownership_lost");
      assert.equal(error.requestStarted, true);
      assert.deepEqual(error.actionReceipts, []);
      return true;
    });
    assert.equal(stops, 1);
    const [session] = await db
      .select()
      .from(codexTaskSessionsTable)
      .where(eq(codexTaskSessionsTable.taskId, f.task.id));
    assert.equal(session.state, "uncertain");
    assert.equal(session.cleanupState, "verified");
  } finally {
    if (timer) clearTimeout(timer);
    abort.abort();
    await db.delete(sourceChangesTable).where(eq(sourceChangesTable.id, id));
  }
});

test("a stalled usage acknowledgement times out without publishing or later resurrecting the session", async (t) => {
  const f = await fixture(t);
  await db
    .delete(codexTaskSessionsTable)
    .where(eq(codexTaskSessionsTable.taskId, f.task.id));
  let release!: () => void,
    written!: () => void,
    inserts = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const acknowledged = new Promise<void>((resolve) => {
    written = resolve;
  });
  const running = runGovernedCodexTask(
    f.context,
    { prompt: "Fixture" },
    {
      environment: {
        ALLOW_AGENT_CODEX_TASKS: "true",
        ALLOW_AGENT_PROCESS_EXEC: "true",
        ACOS_CODEX_EXECUTABLE: process.execPath,
        CHATGPT_STORAGE_DIRECTORY: path.join(f.root, "private"),
      },
      runtime: {
        store: async () => f.store,
        sessions: async () => ({
          renewRegistration: async () =>
            (await f.store.readActiveRegistration())!,
        }),
      },
      resolveWorkspace: async () => f.workspace,
      processPorts: (input) =>
        nativeFixturePorts(t, { ...f, session: input.session! }, "completed"),
      checkpointTimeoutMs: 40,
      recordUsage: async (input) => {
        inserts++;
        await gate;
        try {
          await recordCodexTaskUsage(input);
        } finally {
          written();
        }
      },
    },
  );
  void running.catch(() => {});
  const approval = await f.pending(running);
  await f.decide(approval.id, {
    decision: "approved",
    expectedArgsHash: approval.scope?.argsHash,
  });
  try {
    await assert.rejects(running, (error: any) => {
      assert.equal(error.kind, "timeout");
      assert.equal(error.requestStarted, true);
      assert.equal(error.usage.totalTokens, 8);
      assert.equal(error.actionReceipts.length, 1);
      return true;
    });
    assert.equal(inserts, 1);
    assert.equal(
      (
        await db
          .select()
          .from(codexTaskSessionsTable)
          .where(eq(codexTaskSessionsTable.taskId, f.task.id))
      )[0].state,
      "uncertain",
    );
    release();
    await acknowledged;
    assert.equal(
      (
        await db
          .select()
          .from(codexTaskSessionsTable)
          .where(eq(codexTaskSessionsTable.taskId, f.task.id))
      )[0].state,
      "uncertain",
    );
    assert.equal(
      (
        await db
          .select()
          .from(usageEventsTable)
          .where(eq(usageEventsTable.taskId, f.task.id))
      ).length,
      1,
    );
  } finally {
    release();
  }
});
for (const mode of ["completed", "lost_after_consumption"])
  test(`backend service wires ${mode} native turn to real approvals, durable usage and session`, async (t) => {
    const f = await fixture(t);
    // This owned setup session has never run a turn. Production recovery never
    // deletes or takes over a live session; only the fixture resets its seed.
    await db
      .delete(codexTaskSessionsTable)
      .where(eq(codexTaskSessionsTable.taskId, f.task.id));
    let boundary = 0;
    const running = runGovernedCodexTask(
      f.context,
      { prompt: "Complete the fixture" },
      {
        environment: {
          ALLOW_AGENT_CODEX_TASKS: "true",
          ALLOW_AGENT_PROCESS_EXEC: "true",
          ACOS_CODEX_EXECUTABLE: process.execPath,
          CHATGPT_STORAGE_DIRECTORY: path.join(f.root, "private"),
          RUNTIME_ROLE: "combined",
        },
        runtime: {
          store: async () => f.store,
          sessions: async () => ({
            renewRegistration: async () =>
              (await f.store.readActiveRegistration())!,
          }),
        },
        resolveWorkspace: async () => f.workspace,
        processPorts: (input) =>
          nativeFixturePorts(t, { ...f, session: input.session! }, mode),
        beforeTurnBoundary: async () => {
          boundary++;
        },
      },
    );
    void running.catch(() => {});
    const approval = await f.pending(running);
    assert.equal(
      (
        await f.decide(approval.id, {
          decision: "approved",
          expectedArgsHash: approval.scope?.argsHash,
        })
      ).status,
      200,
    );
    if (mode === "completed") {
      const result = await running;
      assert.equal(result.status, "completed");
      assert.equal(result.deliverableVerified, false);
    } else await assert.rejects(running, { requestStarted: true });
    assert.equal(boundary, 1);
    const [session] = await db
      .select()
      .from(codexTaskSessionsTable)
      .where(eq(codexTaskSessionsTable.taskId, f.task.id));
    assert.equal(session.state, mode === "completed" ? "ready" : "uncertain");
    assert.equal(session.cleanupState, "verified");
    assert.ok(session.cleanupAt instanceof Date);
    const events = await db
      .select()
      .from(usageEventsTable)
      .where(eq(usageEventsTable.taskId, f.task.id));
    assert.equal(events.length, 1);
    assert.equal(events[0].totalTokens, 8);
    assert.equal(events[0].usageReported, true);
    assert.equal(events[0].reportedCostUsd, null);
    assert.match(events[0].inferenceKey ?? "", /^codex:[a-f0-9]{64}$/);
    assert.equal(
      events[0].outcome,
      mode === "completed" ? "completed" : "failed",
    );
  });

test("disabled backend coding refuses before workspace, account or process access", async () => {
  let reads = 0;
  await assert.rejects(
    runGovernedCodexTask(
      {} as never,
      { prompt: "Fixture" },
      {
        environment: {},
        resolveWorkspace: async () => {
          reads++;
          return process.cwd();
        },
      },
    ),
    { kind: "unsupported_capability", requestStarted: false },
  );
  assert.equal(reads, 0);
});

test("a task budget exhausted during native profile inspection prevents inference and accounting", async (t) => {
  const f = await fixture(t);
  await db
    .delete(codexTaskSessionsTable)
    .where(eq(codexTaskSessionsTable.taskId, f.task.id));
  let boundary = 0;
  const running = runGovernedCodexTask(
    f.context,
    { prompt: "Fixture" },
    {
      environment: {
        ALLOW_AGENT_CODEX_TASKS: "true",
        ALLOW_AGENT_PROCESS_EXEC: "true",
        ACOS_CODEX_EXECUTABLE: process.execPath,
        CHATGPT_STORAGE_DIRECTORY: path.join(f.root, "private"),
      },
      runtime: {
        store: async () => f.store,
        sessions: async () => ({
          renewRegistration: async () =>
            (await f.store.readActiveRegistration())!,
        }),
      },
      resolveWorkspace: async () => f.workspace,
      processPorts: (input) => {
        const ports = nativeFixturePorts(
          t,
          { ...f, session: input.session! },
          "completed",
        );
        return {
          ...ports,
          prepare: async (binding) => {
            const prepared = await ports.prepare(binding);
            await db
              .update(tasksTable)
              .set({ tokensUsed: 1_000_000 })
              .where(eq(tasksTable.id, f.task.id));
            return prepared;
          },
        };
      },
      beforeTurnBoundary: async () => {
        boundary++;
      },
    },
  );
  await assert.rejects(running);
  assert.equal(boundary, 0);
  assert.equal(
    (
      await db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.taskId, f.task.id))
    ).length,
    0,
  );
});

test("failed usage persistence retains the observed turn but cannot publish a ready session or retry its insert", async (t) => {
  const f = await fixture(t);
  await db
    .delete(codexTaskSessionsTable)
    .where(eq(codexTaskSessionsTable.taskId, f.task.id));
  let inserts = 0;
  const running = runGovernedCodexTask(
    f.context,
    { prompt: "Fixture" },
    {
      environment: {
        ALLOW_AGENT_CODEX_TASKS: "true",
        ALLOW_AGENT_PROCESS_EXEC: "true",
        ACOS_CODEX_EXECUTABLE: process.execPath,
        CHATGPT_STORAGE_DIRECTORY: path.join(f.root, "private"),
      },
      runtime: {
        store: async () => f.store,
        sessions: async () => ({
          renewRegistration: async () =>
            (await f.store.readActiveRegistration())!,
        }),
      },
      resolveWorkspace: async () => f.workspace,
      processPorts: (input) =>
        nativeFixturePorts(t, { ...f, session: input.session! }, "completed"),
      recordUsage: async () => {
        inserts++;
        throw new Error("fixture-private-ledger-diagnostic");
      },
    },
  );
  void running.catch(() => {});
  const approval = await f.pending(running);
  await f.decide(approval.id, {
    decision: "approved",
    expectedArgsHash: approval.scope?.argsHash,
  });
  await assert.rejects(running, (error: unknown) => {
    assert.ok(
      error &&
        typeof error === "object" &&
        "kind" in error &&
        "usage" in error &&
        "requestStarted" in error,
    );
    assert.equal(error.kind, "accounting_failed");
    assert.ok("cleanupState" in error);
    assert.equal(error.cleanupState, "verified");
    assert.equal(error.requestStarted, true);
    assert.deepEqual(error.usage, {
      promptTokens: 5,
      completionTokens: 3,
      totalTokens: 8,
    });
    assert.doesNotMatch(String(error), /fixture-private/);
    return true;
  });
  assert.equal(inserts, 1);
  assert.equal(
    (
      await db
        .select()
        .from(codexTaskSessionsTable)
        .where(eq(codexTaskSessionsTable.taskId, f.task.id))
    )[0].state,
    "uncertain",
  );
  assert.equal((await f.row()).state, "receipted");
});

test("the shared task family budget blocks coding before workspace or credential access", async (t) => {
  const f = await fixture(t);
  const [sibling] = await db
    .insert(tasksTable)
    .values({
      title: "Sibling spend",
      brief: "Fixture",
      ownerAgentId: f.agent.id,
      parentTaskId: f.task.id,
      tokensUsed: 1_000_000,
    })
    .returning();
  let reads = 0;
  try {
    await assert.rejects(
      runGovernedCodexTask(
        f.context,
        { prompt: "Fixture" },
        {
          environment: {
            ALLOW_AGENT_CODEX_TASKS: "true",
            ALLOW_AGENT_PROCESS_EXEC: "true",
            ACOS_CODEX_EXECUTABLE: process.execPath,
          },
          resolveWorkspace: async () => {
            reads++;
            return f.workspace;
          },
          runtime: {
            store: async () => {
              reads++;
              return f.store;
            },
            sessions: async () => {
              throw new Error("No credential renewal expected");
            },
          },
        },
      ),
    );
    assert.equal(reads, 0);
    assert.equal(
      (
        await db
          .select()
          .from(usageEventsTable)
          .where(eq(usageEventsTable.taskId, f.task.id))
      ).length,
      0,
    );
  } finally {
    await db.delete(tasksTable).where(eq(tasksTable.id, sibling.id));
  }
});
