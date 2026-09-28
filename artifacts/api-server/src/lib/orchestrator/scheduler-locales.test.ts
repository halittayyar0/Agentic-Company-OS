import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before, type TestContext } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  activityEventsTable,
  agentsTable,
  db,
  dbReady,
  taskAttemptsTable,
  tasksTable,
} from "@workspace/db";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import {
  WORKSPACE_LOCALES,
  writeWorkspaceLocale,
  type WorkspaceLocale,
} from "../workspace-locale";
import {
  registerRuntimeInstance,
  type RuntimeInstanceHandle,
} from "./runtime-instance-registry";
import { setEmergencyStop } from "./runtime-emergency-stop";

const expected = {
  tr: {
    claimed: "Görev sırası alındı",
    accepted: "Görev teslim alındı; çalışma başlatıldı.",
    recovered: "Kesintiye uğrayan çalışma kurtarıldı ve yeniden sıraya alındı.",
    recoveryNote:
      "Kesintiye uğrayan çalışmanın sahipliği bırakıldı; görev yeniden sıraya alındı.",
    steps: "Operatör adım sınırı aşıldı (3/2).",
    tokens: "Token bütçesi aşıldı (1500/1000).",
    cost: "Sağlayıcı-raporlu maliyet bütçesi aşıldı ($1.250000/1).",
    budgetPrefix: "Görev güvenlik bütçesi nedeniyle durduruldu: ",
    paused:
      "Kesintiye uğrayan çalışma kurtarıldı; acil durdurma nedeniyle yürütme bekliyor.",
    pausedNote:
      "Kesintiye uğrayan çalışmanın sahipliği bırakıldı; acil durdurma kaldırılana kadar yürütme bekliyor.",
  },
  en: {
    claimed: "Task claimed",
    accepted: "Task accepted; work has started.",
    recovered: "Interrupted work was recovered and queued again.",
    recoveryNote:
      "Ownership of the interrupted work was released; the task was queued again.",
    steps: "Operator step limit reached (3/2).",
    tokens: "Token budget reached (1500/1000).",
    cost: "Provider-reported cost budget reached ($1.250000/1).",
    budgetPrefix: "Task stopped at its safety budget: ",
    paused:
      "Interrupted work was recovered; execution remains paused by the emergency stop.",
    pausedNote:
      "Ownership of the interrupted work was released; execution is paused until the emergency stop is lifted.",
  },
  de: {
    claimed: "Aufgabe übernommen",
    accepted: "Aufgabe angenommen; die Arbeit hat begonnen.",
    recovered:
      "Die unterbrochene Arbeit wurde wiederhergestellt und erneut eingereiht.",
    recoveryNote:
      "Die Zuständigkeit für die unterbrochene Arbeit wurde freigegeben; die Aufgabe wurde erneut eingereiht.",
    steps: "Schrittlimit des Betreibers erreicht (3/2).",
    tokens: "Tokenbudget erreicht (1500/1000).",
    cost: "Vom Anbieter gemeldetes Kostenbudget erreicht ($1.250000/1).",
    budgetPrefix: "Aufgabe wegen ihres Sicherheitsbudgets angehalten: ",
    paused:
      "Die unterbrochene Arbeit wurde wiederhergestellt; die Ausführung bleibt durch den Notstopp pausiert.",
    pausedNote:
      "Die Zuständigkeit für die unterbrochene Arbeit wurde freigegeben; die Ausführung bleibt bis zur Aufhebung des Notstopps pausiert.",
  },
  ru: {
    claimed: "Задача принята в работу",
    accepted: "Задача принята; работа начата.",
    recovered: "Прерванная работа восстановлена и снова поставлена в очередь.",
    recoveryNote:
      "Право выполнения прерванной работы освобождено; задача снова поставлена в очередь.",
    steps: "Достигнут установленный оператором лимит шагов (3/2).",
    tokens: "Достигнут бюджет токенов (1500/1000).",
    cost: "Достигнут бюджет расходов по данным провайдера ($1.250000/1).",
    budgetPrefix: "Задача остановлена из-за ограничения бюджета: ",
    paused:
      "Прерванная работа восстановлена; выполнение остаётся приостановленным из-за аварийной остановки.",
    pausedNote:
      "Право выполнения прерванной работы освобождено; выполнение приостановлено до отмены аварийной остановки.",
  },
  "zh-CN": {
    claimed: "已领取任务",
    accepted: "已接受任务；工作已开始。",
    recovered: "中断的工作已恢复并重新排队。",
    recoveryNote: "已释放中断工作的执行权；任务已重新排队。",
    steps: "已达到操作员设置的步骤上限（3/2）。",
    tokens: "已达到令牌预算上限（1500/1000）。",
    cost: "已达到提供商报告的费用预算上限（$1.250000/1）。",
    budgetPrefix: "任务因安全预算限制而停止：",
    paused: "中断的工作已恢复；紧急停止仍使执行保持暂停。",
    pausedNote: "已释放中断工作的执行权；解除紧急停止前，执行将保持暂停。",
  },
  "zh-TW": {
    claimed: "已領取任務",
    accepted: "已接受任務；工作已開始。",
    recovered: "中斷的工作已恢復並重新排入佇列。",
    recoveryNote: "已釋放中斷工作的執行權；任務已重新排入佇列。",
    steps: "已達到操作員設定的步驟上限（3/2）。",
    tokens: "已達到權杖預算上限（1500/1000）。",
    cost: "已達到供應商回報的費用預算上限（$1.250000/1）。",
    budgetPrefix: "任務因安全預算限制而停止：",
    paused: "中斷的工作已恢復；緊急停止仍使執行維持暫停。",
    pausedNote: "已釋放中斷工作的執行權；解除緊急停止前，執行將維持暫停。",
  },
  ar: {
    claimed: "تم تولي المهمة",
    accepted: "تم قبول المهمة وبدأ العمل.",
    recovered: "تمت استعادة العمل المنقطع وإعادته إلى قائمة الانتظار.",
    recoveryNote:
      "تم تحرير ملكية تنفيذ العمل المنقطع وإعادة المهمة إلى قائمة الانتظار.",
    steps: "تم بلوغ حد الخطوات الذي حدده المشغّل (3/2).",
    tokens: "تم بلوغ ميزانية الرموز (1500/1000).",
    cost: "تم بلوغ ميزانية التكلفة التي أبلغ عنها المزوّد ($1.250000/1).",
    budgetPrefix: "توقفت المهمة بسبب حد ميزانية الأمان: ",
    paused:
      "تمت استعادة العمل المنقطع؛ ولا يزال التنفيذ معلقًا بسبب الإيقاف الطارئ.",
    pausedNote:
      "تم تحرير ملكية تنفيذ العمل المنقطع؛ ويظل التنفيذ معلقًا حتى رفع الإيقاف الطارئ.",
  },
} satisfies Record<WorkspaceLocale, Record<string, string>>;

const originalDirectory = process.cwd();
const budgetNames = [
  "MAX_TASK_STEPS",
  "MAX_TASK_TOKENS",
  "MAX_TASK_REPORTED_COST_USD",
] as const;
const originalBudget = budgetNames.map((name) => process.env[name]);
const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
let directory: string;
let temporaryRoot: string;
let runtime: RuntimeInstanceHandle;
let scheduler: typeof import("./scheduler");

before(async () => {
  temporaryRoot = await realpath(os.tmpdir());
  directory = await mkdtemp(
    path.join(temporaryRoot, "acos-scheduler-locales-"),
  );
  await writeFile(
    path.join(directory, "pnpm-workspace.yaml"),
    "packages: []\n",
  );
  process.chdir(directory);
  process.env.MAX_TASK_STEPS = "2";
  process.env.MAX_TASK_TOKENS = "1000";
  process.env.MAX_TASK_REPORTED_COST_USD = "1";
  scheduler = await import("./scheduler");
  await dbReady;
  runtime = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    config,
  );
});

after(async () => {
  runtime?.stopHeartbeat();
  process.chdir(originalDirectory);
  for (const [index, name] of budgetNames.entries()) {
    if (originalBudget[index] === undefined) delete process.env[name];
    else process.env[name] = originalBudget[index];
  }
  if (directory) {
    const resolved = await realpath(directory);
    assert.equal(path.dirname(resolved), temporaryRoot);
    assert.ok(path.basename(resolved).startsWith("acos-scheduler-locales-"));
    await rm(resolved, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

async function createOwner(t: TestContext) {
  const [owner] = await db
    .insert(agentsTable)
    .values({
      name: `Locale owner ${randomUUID()}`,
      role: "Test",
      systemPrompt: "No model calls",
      createdByUser: true,
    })
    .returning();
  t.after(async () => {
    await db
      .update(tasksTable)
      .set({
        status: "cancelled",
        blockedReason: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(eq(tasksTable.ownerAgentId, owner.id));
    await db
      .update(taskAttemptsTable)
      .set({ state: "lost", finishedAt: new Date() })
      .where(
        and(
          eq(taskAttemptsTable.agentId, owner.id),
          inArray(taskAttemptsTable.state, ["claimed", "running"]),
        ),
      );
    await db
      .update(agentsTable)
      .set({
        isActive: false,
        status: "archived",
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
        currentTaskId: null,
        currentAction: null,
      })
      .where(eq(agentsTable.id, owner.id));
  });
  return owner;
}

test("scheduler captures the saved language before claiming and preserves the accepted event", async (t) => {
  for (const locale of WORKSPACE_LOCALES) {
    await t.test(locale, async (subtest) => {
      await writeWorkspaceLocale(locale);
      const owner = await createOwner(subtest);
      const manager = await createOwner(subtest);
      const [task] = await db
        .insert(tasksTable)
        .values({
          title: `Literal task {name} 原文 ${locale}`,
          brief: "Claim only; no model or tool execution",
          ownerAgentId: owner.id,
          assignedByAgentId: manager.id,
          createdByUser: true,
        })
        .returning();
      const claimed = await scheduler.claimDueTasks(runtime, config, {
        beforeCandidateTransaction: async () => {
          await writeWorkspaceLocale(locale === "en" ? "ar" : "en");
        },
      });
      assert.deepEqual(
        claimed.map((row) => row.id),
        [task.id],
      );
      const [agent] = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, owner.id));
      const events = await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.taskId, task.id));
      assert.equal(agent.currentAction, expected[locale].claimed);
      assert.equal(agent.runLeaseOwner, claimed[0].leaseOwner);
      assert.equal(claimed[0].title, task.title);
      const accepted = events.filter(
        (event) => event.detail?.delegationLifecycle === "accepted",
      );
      assert.equal(accepted.length, 1);
      assert.equal(accepted[0].summary, expected[locale].accepted);
      assert.equal(accepted[0].detail?.fromAgentId, owner.id);
      assert.equal(accepted[0].detail?.toAgentId, manager.id);
      assert.deepEqual(await scheduler.claimDueTasks(runtime, config), []);
      const [persisted] = await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.id, accepted[0].id));
      assert.deepEqual(persisted, accepted[0]);
    });
  }
});

test("all three finite budget reasons use the saved language without stopping continuous work", async (t) => {
  for (const locale of WORKSPACE_LOCALES) {
    await t.test(locale, async (subtest) => {
      await writeWorkspaceLocale(locale);
      const owner = await createOwner(subtest);
      const values = {
        ownerAgentId: owner.id,
        brief: "Budget proof",
        createdByUser: true,
      };
      const [steps, tokens, cost, continuous] = await db
        .insert(tasksTable)
        .values([
          { ...values, title: "Step budget", stepAttempts: 3 },
          { ...values, title: "Token budget", tokensUsed: 1500 },
          { ...values, title: "Cost budget", estimatedCostUsd: "1.250000" },
          {
            ...values,
            title: "Continuous budget telemetry",
            autonomyMode: "continuous",
            stepAttempts: 3,
            tokensUsed: 1500,
            estimatedCostUsd: "1.250000",
            cadenceSeconds: 60,
          },
        ])
        .returning();
      await scheduler.enforceTaskBudgets();
      for (const [task, reason] of [
        [steps, expected[locale].steps],
        [tokens, expected[locale].tokens],
        [cost, expected[locale].cost],
      ] as const) {
        const [blocked] = await db
          .select()
          .from(tasksTable)
          .where(eq(tasksTable.id, task.id));
        const events = await db
          .select()
          .from(activityEventsTable)
          .where(eq(activityEventsTable.taskId, task.id));
        assert.equal(blocked.status, "blocked");
        assert.equal(blocked.blockedReason, "budget");
        assert.equal(blocked.nextAttemptAt, null);
        assert.equal(blocked.lastError, reason);
        assert.equal(events.length, 1);
        assert.equal(events[0].summary, expected[locale].budgetPrefix + reason);
        assert.equal(events[0].severity, "critical");
        assert.equal(
          events[0].detail?.usageSource,
          "max(task_aggregate,usage_events_ledger)",
        );
      }
      const [stillContinuous] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, continuous.id));
      assert.equal(stillContinuous.status, "pending");
      assert.equal(stillContinuous.lastError, null);
      await writeWorkspaceLocale(locale === "en" ? "ar" : "en");
      const before = await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.agentId, owner.id));
      await scheduler.enforceTaskBudgets();
      const after = await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.agentId, owner.id));
      assert.deepEqual(after, before);
    });
  }
});

test("both expired-attempt and legacy lease recovery persist localized messages without replay", async (t) => {
  for (const locale of WORKSPACE_LOCALES) {
    for (const withAttempt of [true, false]) {
      for (const emergencyStopped of [false, true]) {
        await t.test(
          `${locale} ${withAttempt ? "attempt" : "legacy"} ${emergencyStopped ? "paused" : "due"}`,
          async (subtest) => {
            await writeWorkspaceLocale(locale);
            if (emergencyStopped) {
              await setEmergencyStop({
                enabled: true,
                reason: "Scheduler locale fixture",
              });
              subtest.after(() =>
                setEmergencyStop({ enabled: false, reason: null }),
              );
            }
            const owner = await createOwner(subtest);
            const expired = new Date(Date.now() - 60_000);
            const leaseOwner = `locale-recovery:${randomUUID()}`;
            const [task] = await db
              .insert(tasksTable)
              .values({
                ownerAgentId: owner.id,
                title: "Recover the exact interrupted work",
                brief: "No external effects",
                createdByUser: true,
                status: "in_progress",
                stepAttempts: 1,
                leaseOwner,
                leaseExpiresAt: expired,
              })
              .returning();
            await db
              .update(agentsTable)
              .set({
                status: "working",
                currentTaskId: task.id,
                runLeaseOwner: leaseOwner,
                runLeaseExpiresAt: expired,
              })
              .where(eq(agentsTable.id, owner.id));
            const attemptId = randomUUID();
            if (withAttempt) {
              await db.insert(taskAttemptsTable).values({
                id: attemptId,
                taskId: task.id,
                agentId: owner.id,
                workerInstanceId: runtime.id,
                leaseOwner,
                attemptNumber: 1,
                cycleNumber: 0,
                state: "running",
                startedAt: new Date(expired.getTime() - 30_000),
                lastHeartbeatAt: expired,
              });
            }
            const started = Date.now();
            await scheduler.reviveAndReleaseStaleWorkCore(15_000, {
              afterExpiredTaskCandidatesSelected: async () => {
                await writeWorkspaceLocale(locale === "en" ? "ar" : "en");
              },
            });
            const [recovered] = await db
              .select()
              .from(tasksTable)
              .where(eq(tasksTable.id, task.id));
            const [agent] = await db
              .select()
              .from(agentsTable)
              .where(eq(agentsTable.id, owner.id));
            const events = await db
              .select()
              .from(activityEventsTable)
              .where(eq(activityEventsTable.taskId, task.id));
            assert.equal(recovered.status, "in_progress");
            assert.equal(recovered.leaseOwner, null);
            assert.equal(recovered.recoveryCount, 1);
            if (emergencyStopped) {
              assert.equal(recovered.nextAttemptAt, task.nextAttemptAt);
              assert.deepEqual(
                await scheduler.claimDueTasks(runtime, config),
                [],
              );
            } else {
              assert.ok(
                recovered.nextAttemptAt &&
                  recovered.nextAttemptAt.getTime() >= started,
              );
            }
            assert.equal(
              recovered.lastError,
              emergencyStopped
                ? expected[locale].pausedNote
                : expected[locale].recoveryNote,
            );
            assert.equal(agent.runLeaseOwner, null);
            assert.equal(agent.currentTaskId, null);
            const recovery = events.filter(
              (event) => event.detail?.reason === "expired_lease",
            );
            assert.equal(recovery.length, 1);
            assert.equal(
              recovery[0].summary,
              emergencyStopped
                ? expected[locale].paused
                : expected[locale].recovered,
            );
            assert.equal(
              recovery[0].detail?.lostAttemptId,
              withAttempt ? attemptId : null,
            );
            if (withAttempt) {
              const [attempt] = await db
                .select()
                .from(taskAttemptsTable)
                .where(eq(taskAttemptsTable.id, attemptId));
              assert.equal(attempt.state, "lost");
              assert.equal(attempt.failureKind, "lease_expired");
            }
            await scheduler.reviveAndReleaseStaleWorkCore();
            const [again] = await db
              .select()
              .from(tasksTable)
              .where(eq(tasksTable.id, task.id));
            const persisted = await db
              .select()
              .from(activityEventsTable)
              .where(eq(activityEventsTable.taskId, task.id));
            assert.equal(again.recoveryCount, 1);
            assert.equal(again.lastError, recovered.lastError);
            assert.deepEqual(persisted, events);
          },
        );
      }
    }
  }
});
