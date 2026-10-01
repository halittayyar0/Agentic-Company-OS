import assert from "node:assert/strict";
import test from "node:test";
import type { ActivityEvent, Task } from "@workspace/api-client-react";
import {
  buildRunTrace,
  filterRunTraceEvents,
  summarizeRunTraceDetail,
} from "./run-trace";

function task(value: Partial<Task> = {}): Task {
  return {
    id: 77,
    title: "Pazar görünümünü çıkar",
    brief: "Doğrulanmış kaynaklarla haftalık görünümü hazırla.",
    status: "pending",
    priority: "normal",
    ownerAgentId: 2,
    assignedByAgentId: null,
    createdByUser: true,
    parentTaskId: null,
    progressPercent: 0,
    tokensUsed: 0,
    estimatedCostUsd: null,
    resultSummary: null,
    executionModelId: null,
    lastModelId: null,
    lastModelProvider: null,
    modelFallbackCount: 0,
    autonomyMode: "finite",
    cadenceSeconds: null,
    lastHeartbeatAt: null,
    recoveryCount: 0,
    cycleCount: 0,
    lastCycleCompletedAt: null,
    lastSteppedAt: null,
    stepAttempts: 0,
    consecutiveFailures: 0,
    nextAttemptAt: null,
    lastError: null,
    blockedReason: null,
    dueAt: null,
    createdAt: "2026-08-29T08:00:00.000Z",
    updatedAt: "2026-08-29T08:00:00.000Z",
    completedAt: null,
    ...value,
  };
}

function activity(
  value: Partial<ActivityEvent> &
    Pick<ActivityEvent, "id" | "type" | "summary">,
): ActivityEvent {
  return {
    agentId: 2,
    taskId: 77,
    detail: null,
    severity: "info",
    createdAt: "2026-08-29T08:10:00.000Z",
    ...value,
  };
}

function stage(trace: ReturnType<typeof buildRunTrace>, id: string) {
  const value = trace.stages.find((item) => item.id === id);
  assert.ok(value, `missing ${id} stage`);
  return value;
}

test("completion reviews expose their recorded evidence without raw result contents", () => {
  const trace = buildRunTrace({
    task: task(),
    activities: [
      activity({
        id: 99,
        type: "judge_review",
        summary: "Completion rejected",
        detail: {
          verdict: "block",
          completionEvidence: {
            source: "persisted_runtime_metadata",
            taskId: 77,
            cycleNumber: 0,
            receiptTotal: 1,
            receiptCounts: [
              { state: "failed", reconciliationDecision: null, count: 1 },
            ],
            receiptsTruncated: false,
            receipts: [
              {
                id: "receipt-1",
                tool: "vm_run_command",
                state: "failed",
                executionKind: "task_step",
                sideEffectClass: "at_most_once",
                reconciliationDecision: null,
                finishedAt: null,
                ok: false,
                exitCode: 1,
                stdout: "RAW_SECRET",
              },
            ],
            childTotal: 0,
            childCounts: [],
            childrenTruncated: false,
            children: [],
            command: "RAW_SECRET",
          },
        },
      }),
    ],
  });
  assert.equal(trace.events[0].completionReview?.receiptTotal, 1);
  assert.equal(trace.events[0].completionReview?.receipts[0].exitCode, 1);
  assert.ok(!JSON.stringify(trace.events).includes("RAW_SECRET"));
});

test("completed status does not invent planning, execution, review, or a delivered result", () => {
  const trace = buildRunTrace({
    task: task({ status: "completed" }),
    activities: [],
  });
  assert.equal(stage(trace, "intake").source, "task");
  assert.equal(stage(trace, "route").evidence, "owned");
  for (const id of ["plan", "execute", "review"]) {
    assert.equal(stage(trace, id).state, "missing");
    assert.equal(stage(trace, id).timestamp, null);
  }
  assert.equal(stage(trace, "deliver").evidence, "markedCompleted");
  assert.deepEqual(trace.stats.uniqueAgentIds, [2]);
});
test("selected tool intent is classified without being treated as execution", () => {
  const trace = buildRunTrace({
    task: task({ status: "in_progress" }),
    activities: [
      activity({
        id: 1,
        type: "note",
        summary: "Selected tool",
        detail: { selectedTool: "browser_navigate" },
      }),
    ],
  });
  assert.equal(trace.stats.toolEventCount, 1);
  assert.equal(stage(trace, "execute").state, "missing");
  assert.equal(stage(trace, "plan").state, "missing");
  assert.deepEqual(
    filterRunTraceEvents(trace.events, "tools").map((e) => e.id),
    [1],
  );
});
test("record categories link the observed activity and do not infer a passing verdict", () => {
  const trace = buildRunTrace({
    task: task({ status: "blocked", resultSummary: "Stored result" }),
    activities: [
      activity({
        id: 1,
        type: "task_status_changed",
        summary: "planning",
        detail: { status: "planning" },
      }),
      activity({
        id: 2,
        type: "vm_command",
        summary: "failed command",
        severity: "critical",
      }),
      activity({
        id: 3,
        type: "judge_review",
        summary: "review without verdict",
      }),
      activity({
        id: 4,
        type: "approval_requested",
        summary: "approval needed",
        severity: "warning",
      }),
    ],
  });
  assert.equal(stage(trace, "plan").activityId, 1);
  assert.equal(stage(trace, "execute").activityId, 2);
  assert.equal(stage(trace, "review").activityId, 4);
  assert.equal(stage(trace, "review").evidence, "reviewRecorded");
  assert.equal(stage(trace, "deliver").evidence, "summaryStored");
  assert.equal(trace.stats.errorCount, 1);
  assert.equal(trace.stats.warningCount, 1);
  assert.deepEqual(
    filterRunTraceEvents(trace.events, "issues").map((e) => e.id),
    [2, 4],
  );
  assert.equal("durationMs" in trace.stats, false);
});
test("only the requested task and direct child identities enter the projection", () => {
  const own = activity({ id: 2, type: "note", summary: "own" });
  const trace = buildRunTrace({
    task: task(),
    activities: [
      own,
      own,
      activity({
        id: 3,
        taskId: 99,
        agentId: 99,
        type: "vm_command",
        summary: "foreign",
      }),
    ],
    subtasks: [
      task({ id: 78, parentTaskId: 77, ownerAgentId: 3 }),
      task({ id: 99, parentTaskId: 12, ownerAgentId: 99 }),
    ],
  });
  assert.deepEqual(
    trace.events.map((e) => e.id),
    [2],
  );
  assert.deepEqual(trace.stats.uniqueAgentIds, [2, 3]);
});
test("the activity projection is bounded to the newest 200 and ordered deterministically", () => {
  const trace = buildRunTrace({
    task: task(),
    activities: Array.from({ length: 220 }, (_, i) =>
      activity({ id: i + 1, type: "note", summary: String(i) }),
    ).reverse(),
  });
  assert.equal(trace.events.length, 200);
  assert.equal(trace.events[0].id, 21);
  assert.equal(trace.events.at(-1).id, 220);
});
test("identifiers are never silently shortened and unknown nested fields stay excluded", () => {
  const detail = summarizeRunTraceDetail({
    modelId: "a".repeat(181),
    selectedTool: " tool ",
    attempt: 3,
    outputStored: true,
    private: { secret: "secret" },
  });
  assert.deepEqual(detail, [
    { key: "outputStored", value: "true" },
    { key: "attempt", value: "3" },
  ]);
});

test("structured detail projection removes raw commands, typed content and URL queries", () => {
  const detail = summarizeRunTraceDetail({
    selectedTool: "browser_navigate",
    surface: "browser",
    status: "succeeded",
    durationMs: 417,
    url: "https://alice:password@example.com/report?token=TOP_SECRET#private",
    command: "curl https://secret.invalid",
    typedContent: "customer password",
    content: "private message",
    answer: "one-time code",
    prompt: "hidden system prompt",
    headers: { authorization: "Bearer secret" },
    args: { text: "do not expose" },
    scope: {
      toolName: "browser_navigate",
      target: "https://example.com/?secret=yes",
      preview: "private preview",
      argsHash: "private-hash",
    },
  });
  const serialized = JSON.stringify(detail);

  assert.match(serialized, /browser_navigate/);
  assert.match(serialized, /417 ms/);
  assert.match(serialized, /https:\/\/example\.com\/report/);
  for (const secret of [
    "TOP_SECRET",
    "alice",
    "password",
    "curl",
    "customer password",
    "private message",
    "one-time code",
    "hidden system prompt",
    "authorization",
    "do not expose",
    "private preview",
    "private-hash",
    "secret=yes",
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.deepEqual(
    detail.map((item) => item.key),
    [
      "status",
      "selectedTool",
      "surface",
      "durationMs",
      "url",
      "scope.toolName",
    ],
  );
});

test("a retained URL is complete after redaction, never a silently clipped location", () => {
  const url = "https://example.com/" + "a".repeat(300);
  assert.deepEqual(
    summarizeRunTraceDetail({ url: url + "?secret=private#fragment" }),
    [{ key: "url", value: url }],
  );
  assert.deepEqual(
    summarizeRunTraceDetail({ url: "https://example.com/" + "a".repeat(2050) }),
    [],
  );
});
