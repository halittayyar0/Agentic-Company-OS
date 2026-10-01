import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import type { WorkspaceLocale } from "../workspace-locale";

delete process.env.DATABASE_URL;
delete process.env.RUNTIME_ROLE;
process.env.NODE_ENV = "test";
process.env.AGENT_BROWSER_ALLOW_PRIVATE_NETWORKS = "true";
process.env.AGENT_BROWSER_HEADLESS = "true";
const root = await fsp.mkdtemp(
  path.join(os.tmpdir(), "acos-approved-browser-"),
);
process.env.AGENT_SANDBOX_ROOT = root;
const {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  approvalRequestsTable,
  operationReceiptsTable,
  operationInvocationsTable,
  activityEventsTable,
} = await import("@workspace/db");
const {
  executeTool,
  executeApprovedAction,
  finalizeSucceededApprovedActionReceipt,
  persistApprovedActionOutcomeUnknown,
  runDurableExternalEffect,
} = await import("./execute-tool");
const {
  reserveOperation,
  canonicalArgumentHash,
  canonicalizeJson,
  recoverInterruptedOperation,
} = await import("./operation-receipts");
const browser = await import("../vm/browser");
const { specialistPermissionsPreset } = await import("./permission-presets");
const { WORKSPACE_LOCALES } = await import("../workspace-locale");
const { terminalMessage, getTerminalCopy } =
  await import("../vm/terminal-localization");
const { registerRuntimeInstance } = await import("./runtime-instance-registry");
const { readRuntimeOperationsConfig } =
  await import("../runtime-operations-config");
const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
await dbReady;
const runtime = await registerRuntimeInstance(
  {
    role: "worker",
    schedulerEnabled: true,
    capabilities: { http: false, scheduler: true },
  },
  config,
);
const literal = "  原文 {text} $&\n\n  نص عربي  \n  ";
const note = "  Operator {decision} $&\n\n  保留 القرار  ";
const completed: Record<WorkspaceLocale, string> = {
  tr: "Onaylı eylem tamamlandı: {tool}.",
  en: "Approved action completed: {tool}.",
  de: "Genehmigte Aktion abgeschlossen: {tool}.",
  ru: "Одобренное действие завершено: {tool}.",
  "zh-CN": "已批准的操作已完成：{tool}。",
  "zh-TW": "已核准的操作已完成：{tool}。",
  ar: "اكتمل الإجراء الموافق عليه: {tool}.",
};
const effects = new Map<string, string[]>();
const effectInputSequences = new Map<string, (string | undefined)[]>();
const server = createServer(async (request, response) => {
  const target = new URL(request.url!, "http://localhost");
  const id = target.searchParams.get("id")!;
  if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    response.writeHead(400).end("Invalid fixture ID");
    return;
  }
  if (target.pathname === "/effect") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    effectInputSequences
      .get(id)!
      .push(request.headers["x-fixture-input"] as string | undefined);
    effects
      .get(id)!
      .push(
        request.method === "POST"
          ? Buffer.concat(chunks).toString("utf8")
          : "click",
      );
    response.end("effect recorded");
    return;
  }
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(
    `<!doctype html><title>原文 {title} $&</title><button onclick="location.href='/effect?id=${id}'">Approved click</button><output id="input-events">Input events: 0</output><textarea aria-label="Approved input" oninput="this.dataset.inputCount=String(Number(this.dataset.inputCount||0)+1);document.getElementById('input-events').textContent='Input events: '+this.dataset.inputCount;fetch('/effect?id=${id}',{method:'POST',headers:{'X-Fixture-Input':this.dataset.inputCount},body:this.value})"></textarea>`,
  );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const baseUrl = `http://127.0.0.1:${address.port}`;

test.after(async () => {
  await runtime.stopHeartbeat();
  await browser.closeAllSessions();
  await closeDatabase();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fsp.rm(root, { recursive: true, force: true });
});

for (const locale of WORKSPACE_LOCALES) {
  for (const toolName of ["browser_click", "browser_type"] as const) {
    for (const mode of [
      "live",
      "completed_recovery",
      "unknown_recovery",
    ] as const) {
      test(`${locale} ${toolName} ${mode} preserves first language and one tool dispatch`, async (t) => {
        const id = randomUUID();
        effects.set(id, []);
        effectInputSequences.set(id, []);
        const [agent] = await db
          .insert(agentsTable)
          .values({
            name: "原文 {name} $&",
            role: "Test",
            systemPrompt: "Test only",
            createdByUser: true,
            permissions: {
              ...specialistPermissionsPreset,
              canBrowse: true,
              canContactExternal: true,
            },
          })
          .returning();
        const [task] = await db
          .insert(tasksTable)
          .values({
            title: "Approved browser",
            brief: "Test one exact approved browser effect",
            ownerAgentId: agent.id,
            status: "awaiting_approval",
            createdByUser: true,
          })
          .returning();
        t.after(async () => {
          await browser.closeSession(agent.id);
          await db
            .update(tasksTable)
            .set({
              status: "cancelled",
              blockedReason: null,
              leaseOwner: null,
              leaseExpiresAt: null,
            })
            .where(eq(tasksTable.id, task.id));
          await db
            .update(agentsTable)
            .set({
              isActive: false,
              runLeaseOwner: null,
              runLeaseExpiresAt: null,
            })
            .where(eq(agentsTable.id, agent.id));
        });
        await browser.navigateTo(agent.id, `${baseUrl}/?id=${id}`);
        const snap = await browser.snapshotPage(agent.id, locale);
        const label =
          toolName === "browser_click" ? "Approved click" : "Approved input";
        const ref = Number(
          snap.lines
            .find((line) => line.includes(label))
            ?.match(/\[ref=(\d+)\]/)?.[1],
        );
        assert.ok(ref);
        const binding = await browser.getExistingBrowserActionBinding(
          agent.id,
          ref,
        );
        assert.ok(binding);
        const args = {
          ref,
          ...(toolName === "browser_type"
            ? { text: literal, submit: false }
            : {}),
          __browserContext: binding,
        };
        const argsHash = canonicalArgumentHash(args);
        const browserBinding = {
          runtimeInstanceId: runtime.id,
          sessionId: binding.sessionId,
          sessionEpoch: binding.sessionEpoch,
          snapshotMarker: binding.snapshotMarker,
        };
        const bindingHash = `sha256:${createHash("sha256")
          .update(canonicalizeJson({ ...browserBinding, toolName, argsHash }))
          .digest("hex")}`;
        const disposition =
          toolName === "browser_click" ? "complete" : "resume";
        const [approval] = await db
          .insert(approvalRequestsTable)
          .values({
            taskId: task.id,
            agentId: agent.id,
            category: "external_contact",
            title: label,
            description: label,
            status: "approved",
            resolvedAt: new Date(),
            expiresAt: new Date(Date.now() + 120_000),
            decisionNote: note,
            scope: { toolName, argsHash, target: binding.pageUrl },
            actionPayload: { toolName, args, taskDisposition: disposition },
            browserRuntimeInstanceId: runtime.id,
            browserSessionId: binding.sessionId,
            browserSessionEpoch: binding.sessionEpoch,
            browserSnapshotMarker: binding.snapshotMarker,
            browserBindingHash: bindingHash,
          })
          .returning();
        const reservation = await reserveOperation({
          canonicalVersion: 1,
          executionKind: "approved_action",
          logicalExecutionId: `approval:${approval.id}`,
          toolName,
          args,
          executionLocale: locale,
          physical: {
            workerInstanceId: runtime.id,
            callSlot: "approved-action:0",
          },
          taskId: task.id,
          agentId: agent.id,
          approvalId: approval.id,
          sourceMessageId: null,
          originAttemptId: null,
          sideEffectClass: "approval_at_most_once",
        });
        const displayLocale = locale === "ar" ? "de" : "ar";
        let action: string | null = null;
        let observedLocale: WorkspaceLocale | undefined;
        let dispatches = 0;
        let effectBoundaries = 0;
        const result = await executeApprovedAction(approval.id, config, {
          locale: displayLocale,
          runtimeInstanceId: runtime.id,
          beforeOperationEffectBoundary: async () => {
            effectBoundaries++;
          },
          afterEffectBeforeFinalization:
            mode === "completed_recovery"
              ? async () => {
                  throw new Error("fixture finalizer interruption");
                }
              : undefined,
          executeAction: async (ctx, name, input) => {
            dispatches++;
            observedLocale = ctx.locale;
            const [liveAgent] = await db
              .select()
              .from(agentsTable)
              .where(eq(agentsTable.id, agent.id));
            action = liveAgent.currentAction;
            if (mode !== "unknown_recovery")
              return executeTool(ctx, name, input);
            // Exercise the production receipt boundary with a real browser effect,
            // then lose both database writes, as a worker crash can do.
            return runDurableExternalEffect(
              ctx,
              {
                toolName,
                normalizedArgs: args,
                browserBinding: { ...browserBinding, bindingHash },
                execute: async ({ startEffect }) => {
                  if (toolName === "browser_click")
                    await browser.clickRef(agent.id, ref, binding, startEffect);
                  else
                    await browser.fillRef(
                      agent.id,
                      ref,
                      literal,
                      binding,
                      startEffect,
                    );
                  return {
                    result: {
                      content: "fixture",
                      createdTasks: [],
                      createdAgents: [],
                      toolOutcome: "succeeded",
                    },
                    resultData: { ok: true },
                  };
                },
                onError: async () => ({
                  content: "fixture write outage",
                  createdTasks: [],
                  createdAgents: [],
                  toolOutcome: "rejected",
                }),
              },
              {
                completeOperation: async () => {
                  throw new Error("fixture completion outage");
                },
                markOperationUnknown: async () => {
                  throw new Error("fixture unknown-write outage");
                },
              },
            );
          },
        });
        assert.equal(result.claimed, true, JSON.stringify(result));
        const deadline = Date.now() + 3000;
        while (!effects.get(id)!.length && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 10));
        if (!effects.get(id)!.length) {
          const [observed] = await db
            .select({
              state: operationReceiptsTable.state,
              failureKind: operationReceiptsTable.failureKind,
              sanitizedError: operationReceiptsTable.sanitizedError,
              resultData: operationReceiptsTable.resultData,
            })
            .from(operationReceiptsTable)
            .where(eq(operationReceiptsTable.id, reservation.receipt.id));
          const page = await browser
            .snapshotPage(agent.id, locale)
            .catch(() => null);
          assert.fail(
            JSON.stringify({
              failure: "Approved fixture effect was not observed",
              result,
              dispatches,
              effectBoundaries,
              receipt: observed,
              inputSequences: effectInputSequences.get(id),
              page: page?.lines.join("\n").slice(0, 2_000),
            }),
          );
        }
        // Browser-native fill may produce several DOM input callbacks. The
        // tool dispatch and effect boundary must each occur once; replay below
        // must add no HTTP effects. Keep checking every delivered source value.
        assert.ok(
          effects
            .get(id)!
            .every(
              (value) =>
                value === (toolName === "browser_click" ? "click" : literal),
            ),
        );
        assert.equal(effectBoundaries, 1);
        const [receipt] = await db
          .select()
          .from(operationReceiptsTable)
          .where(eq(operationReceiptsTable.id, reservation.receipt.id));
        assert.equal(receipt.resultData?.executionLocale, locale);
        assert.equal(receipt.argumentHash, argsHash);
        const [consumed] = await db
          .select()
          .from(approvalRequestsTable)
          .where(eq(approvalRequestsTable.id, approval.id));
        assert.ok(consumed.consumedAt);
        assert.equal(consumed.actionPayload, null);
        assert.deepEqual(consumed.scope, {
          toolName,
          argsHash,
          target: null,
          preview: `CONSUMED: capability sha256:${argsHash}`,
        });
        assert.equal(consumed.browserBindingHash, bindingHash);
        const expectedSummary = completed[locale].replace("{tool}", toolName);
        if (mode !== "live") {
          const expiredAt = new Date(Date.now() - 1000);
          await db
            .update(tasksTable)
            .set({ leaseExpiresAt: expiredAt })
            .where(eq(tasksTable.id, task.id));
          await db
            .update(agentsTable)
            .set({ runLeaseExpiresAt: expiredAt })
            .where(eq(agentsTable.id, agent.id));
          if (mode === "completed_recovery") {
            assert.equal(result.status, "queued");
            assert.equal(receipt.state, "succeeded");
            const recovered = await finalizeSucceededApprovedActionReceipt({
              receiptId: receipt.id,
              recovery: true,
            });
            assert.equal(recovered.disposition, "finalized");
            assert.equal(recovered.summary, expectedSummary);
            assert.equal(
              (
                await finalizeSucceededApprovedActionReceipt({
                  receiptId: receipt.id,
                  recovery: true,
                })
              ).disposition,
              "already_finalized",
            );
          } else {
            assert.equal(result.status, "approval_outcome_unknown");
            assert.equal(receipt.state, "running");
            await db
              .update(operationInvocationsTable)
              .set({ leaseExpiresAt: expiredAt })
              .where(eq(operationInvocationsTable.receiptId, receipt.id));
            assert.equal(
              (
                await recoverInterruptedOperation({
                  receiptId: receipt.id,
                  now: new Date(),
                  runtimeStaleBefore: new Date(Date.now() - 15000),
                })
              ).disposition,
              "unknown",
            );
            await persistApprovedActionOutcomeUnknown({
              locale: displayLocale,
              approvalId: approval.id,
              taskId: task.id,
              agentId: agent.id,
              leaseOwner: null,
              error: null,
            });
            await persistApprovedActionOutcomeUnknown({
              locale: "tr",
              approvalId: approval.id,
              taskId: task.id,
              agentId: agent.id,
              leaseOwner: null,
              error: null,
            });
          }
        }
        const [finalTask] = await db
          .select()
          .from(tasksTable)
          .where(eq(tasksTable.id, task.id));
        const [finalApproval] = await db
          .select()
          .from(approvalRequestsTable)
          .where(eq(approvalRequestsTable.id, approval.id));
        const events = await db
          .select()
          .from(activityEventsTable)
          .where(eq(activityEventsTable.taskId, task.id));
        if (mode === "unknown_recovery") {
          assert.equal(finalTask.status, "blocked");
          assert.equal(
            finalTask.lastError,
            terminalMessage(locale, "receiptUnknown", { id: receipt.id }),
          );
          assert.equal(
            finalApproval.decisionNote,
            `${note}\n[APPROVAL_OUTCOME_UNKNOWN] ${getTerminalCopy(locale).approvedUnknown}`,
          );
          const unknown = events.filter(
            (event) =>
              event.detail?.approvalId === approval.id &&
              event.detail?.outcome === "unknown",
          );
          assert.equal(unknown.length, 1);
          assert.equal(
            unknown[0].summary,
            getTerminalCopy(locale).approvedUnknown,
          );
          assert.equal(
            unknown[0].detail?.error,
            getTerminalCopy(locale).unknownFinalization,
          );
        } else {
          assert.equal(
            finalTask.status,
            disposition === "complete" ? "completed" : "in_progress",
          );
          assert.equal(finalApproval.decisionNote, note);
          const finalized = events.filter(
            (event) => event.type === "approval_resolved",
          );
          assert.equal(finalized.length, 1);
          assert.equal(finalized[0].summary, expectedSummary);
          if (disposition === "complete")
            assert.equal(finalTask.resultSummary, expectedSummary);
        }
        const [beforeReplay] = await db
          .select()
          .from(operationReceiptsTable)
          .where(eq(operationReceiptsTable.id, receipt.id));
        const delivered = [...effects.get(id)!];
        const replay = await executeApprovedAction(approval.id, config, {
          locale: displayLocale,
          runtimeInstanceId: runtime.id,
          executeAction: async () => {
            dispatches++;
            throw new Error("consumed approval must not dispatch again");
          },
        });
        assert.equal(replay.claimed, false);
        assert.equal(dispatches, 1);
        assert.deepEqual(effects.get(id), delivered);
        assert.equal(effectBoundaries, 1);
        const [afterReplay] = await db
          .select()
          .from(operationReceiptsTable)
          .where(eq(operationReceiptsTable.id, receipt.id));
        assert.deepEqual(afterReplay, beforeReplay);
        assert.equal(observedLocale, locale);
        assert.equal(
          action,
          terminalMessage(locale, "approvedAction", { tool: toolName }),
        );
      });
    }
  }
}
