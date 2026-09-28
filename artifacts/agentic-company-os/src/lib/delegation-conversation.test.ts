import assert from "node:assert/strict";
import test from "node:test";
import type { ActivityEvent } from "@workspace/api-client-react";
import {
  buildDelegationMessages,
  type DelegationTaskRecord,
} from "./delegation-conversation";

const task: DelegationTaskRecord = {
  id: 41,
  title: "Pazar raporunu çıkar",
  brief: "Üç doğrulanmış kaynakla pazar raporunu hazırla.",
  status: "completed",
  ownerAgentId: 2,
  assignedByAgentId: 1,
  resultSummary: "Rapor üç kaynakla tamamlandı.",
  createdAt: "2026-08-28T09:00:00.000Z",
  updatedAt: "2026-08-28T10:00:00.000Z",
  completedAt: "2026-08-28T10:00:00.000Z",
  lastError: null,
};

function activity(
  value: Partial<ActivityEvent> &
    Pick<ActivityEvent, "id" | "type" | "summary">,
): ActivityEvent {
  return {
    agentId: 2,
    taskId: 41,
    detail: null,
    severity: "info",
    createdAt: "2026-08-28T09:30:00.000Z",
    ...value,
  };
}

test("delegation dialogue uses the persisted brief and real agent events", () => {
  const messages = buildDelegationMessages(task, [
    activity({
      id: 1,
      type: "task_delegated",
      summary: "CEO görevi devretti.",
      agentId: 1,
      createdAt: "2026-08-28T09:00:01.000Z",
    }),
    activity({
      id: 2,
      type: "task_status_changed",
      summary: "Görev teslim alındı; çalışma başlatıldı.",
      detail: { delegationLifecycle: "accepted", status: "in_progress" },
    }),
    activity({
      id: 3,
      type: "progress_update",
      summary: "İki kaynak doğrulandı.",
      createdAt: "2026-08-28T09:40:00.000Z",
    }),
    activity({
      id: 4,
      type: "task_status_changed",
      summary: "Görev tamamlandı: Rapor üç kaynakla tamamlandı.",
      detail: { delegationLifecycle: "completed", status: "completed" },
      createdAt: "2026-08-28T10:00:00.000Z",
    }),
  ]);

  assert.deepEqual(
    messages.map(({ kind, speakerAgentId, recipientAgentId, content }) => ({
      kind,
      speakerAgentId,
      recipientAgentId,
      content,
    })),
    [
      {
        kind: "assignment",
        speakerAgentId: 1,
        recipientAgentId: 2,
        content: "Üç doğrulanmış kaynakla pazar raporunu hazırla.",
      },
      {
        kind: "accepted",
        speakerAgentId: 2,
        recipientAgentId: 1,
        content: "Görev teslim alındı; çalışma başlatıldı.",
      },
      {
        kind: "progress",
        speakerAgentId: 2,
        recipientAgentId: 1,
        content: "İki kaynak doğrulandı.",
      },
      {
        kind: "completed",
        speakerAgentId: 2,
        recipientAgentId: 1,
        content: "Görev tamamlandı: Rapor üç kaynakla tamamlandı.",
      },
    ],
  );
});

test("system failures are not presented as agent speech", () => {
  const messages = buildDelegationMessages(
    { ...task, status: "blocked", completedAt: null, resultSummary: null },
    [
      activity({
        id: 7,
        type: "error",
        summary: "Çalışma güvenlik bütçesinde durduruldu.",
        severity: "critical",
      }),
    ],
  );

  assert.equal(messages[1]?.kind, "system");
  assert.equal(messages[1]?.speakerAgentId, null);
  assert.equal(messages[1]?.recipientAgentId, null);
});

test("a direct user-created task is not misrepresented as agent delegation", () => {
  assert.deepEqual(
    buildDelegationMessages({ ...task, assignedByAgentId: null }, []),
    [],
  );
});

test("foreign task activity cannot impersonate a delegation and duplicates are removed", () => {
  const foreign = activity({
    id: 81,
    taskId: 99,
    type: "note",
    summary: "foreign",
  });
  const own = activity({ id: 82, type: "note", summary: "own" });
  const records = buildDelegationMessages(task, [foreign, own, own]);
  assert.equal(records.filter((r) => r.content === "own").length, 1);
  assert.equal(
    records.some((r) => r.content === "foreign"),
    false,
  );
});
test("current blocked state uses the task snapshot time and preserves the source error", () => {
  const records = buildDelegationMessages(
    {
      ...task,
      status: "blocked",
      completedAt: null,
      lastError: "Original error",
    },
    [
      activity({
        id: 90,
        type: "task_status_changed",
        summary: "Earlier pending",
        createdAt: task.createdAt,
      }),
    ],
  );
  const current = records.find((r) => r.status === "blocked");
  assert.ok(current);
  assert.equal(current.createdAt, task.updatedAt);
  assert.equal(current.content, "Original error");
  assert.equal(current.source, "task");
  assert.equal(current.speakerAgentId, null);
  assert.equal(records[0].activityId, null);
  assert.equal(records[0].createdAt, task.updatedAt);
});

test("historical agent associations survive an ownership change", () => {
  const records = buildDelegationMessages(task, [
    activity({
      id: 91,
      agentId: 8,
      type: "note",
      summary: "Previous owner's note",
    }),
  ]);
  const record = records.find((r) => r.activityId === 91);
  assert.equal(record?.associatedAgentId, 8);
  assert.equal(record?.speakerAgentId, null);
});
