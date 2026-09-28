import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import copy from "../../lib/operations-copy/operations-tr";
import { OperationsCopyProvider } from "./operations-copy-context";
import { LocaleProvider } from "../i18n/locale-provider";
import { loadShellMessages } from "../../lib/i18n";
await loadShellMessages("tr");
function renderToStaticMarkup(node: React.ReactNode) {
  return renderMarkup(
    <LocaleProvider>
      <OperationsCopyProvider copy={copy} locale="tr">
        {node}
      </OperationsCopyProvider>
    </LocaleProvider>,
  );
}

import { MissionLog } from "./mission-log";
import { AttemptLedger } from "./attempt-ledger";
import { OperationEvidenceInspector } from "./operation-evidence-inspector";
import { OperationsDataBoundary } from "./operations-data-boundary";
import { createReceiptReconciliationSchema } from "./receipt-reconciliation-model";
import { FleetOperationsRoom } from "./fleet-operations-room";
import { OperationsSummaryStrip } from "./operations-summary-strip";
import { ReceiptLedger } from "./receipt-ledger";
import { RuntimeTruthBadge } from "./runtime-truth-badge";
import { TeamConstellation } from "./team-constellation";
import { TwentyFourHourRing } from "./twenty-four-hour-ring";
import type {
  AgentLane,
  MissionLogEntry,
  OperationsRoomModel,
  TwentyFourHourRing as RingModel,
} from "../../lib/operations-view-model";

const receiptReconciliationSchema = createReceiptReconciliationSchema(copy);
const truth: OperationsRoomModel["truth"] = {
  healthyWorkerCount: 2,
  live: false,
  backendState: "live",
  transportState: "disconnected",
  transportAgeMs: 28_000,
  durableDataAgeMs: 120_000,
  reasons: [],
};

const roomBoundary = {
  window: {
    startAt: "2026-08-31T12:00:00.000Z",
    endAt: "2026-09-01T12:00:00.000Z",
    hours: 24,
    timezone: "UTC" as const,
  },
  limits: null,
  truncation: {
    attempts: false,
    receipts: false,
    incidents: false,
    milestones: false,
    fleetHealthSamples: false,
  },
};

const ring: RingModel = {
  startAt: "2026-08-31T12:00:00.000Z",
  endAt: "2026-09-01T12:00:00.000Z",
  totalBuckets: 1_440,
  counts: { healthy: 1_320, degraded: 60, incident: 10, unknown: 50 },
  healthyPercent: 91.666,
  complete: false,
  verifiedTwentyFourHours: false,
  segments: [
    {
      state: "healthy",
      startAt: "2026-08-31T12:00:00.000Z",
      endAt: "2026-09-01T10:00:00.000Z",
      startIndex: 0,
      endIndex: 1_319,
      durationMinutes: 1_320,
    },
    {
      state: "degraded",
      startAt: "2026-09-01T10:00:00.000Z",
      endAt: "2026-09-01T11:00:00.000Z",
      startIndex: 1_320,
      endIndex: 1_379,
      durationMinutes: 60,
    },
    {
      state: "incident",
      startAt: "2026-09-01T11:00:00.000Z",
      endAt: "2026-09-01T11:10:00.000Z",
      startIndex: 1_380,
      endIndex: 1_389,
      durationMinutes: 10,
    },
    {
      state: "unknown",
      startAt: "2026-09-01T11:10:00.000Z",
      endAt: "2026-09-01T12:00:00.000Z",
      startIndex: 1_390,
      endIndex: 1_439,
      durationMinutes: 50,
    },
  ],
};

test("truth badge never renders disconnected transport as live", () => {
  const html = renderToStaticMarkup(<RuntimeTruthBadge truth={truth} />);
  assert.match(html, /Bağlantı koptu/);
  assert.match(html, /data-transport="disconnected"/);
  assert.doesNotMatch(html, /aria-label="Canlı"/);
  assert.doesNotMatch(html, /text-emerald/);
  assert.match(html, /text-rose/);
});

test("24-hour ring exposes persisted, degraded, incident and unknown minutes", () => {
  const html = renderToStaticMarkup(<TwentyFourHourRing ring={ring} />);
  assert.match(html, /24 saatlik sağlık penceresi/);
  assert.match(html, /1\.320 sağlıklı dakika/);
  assert.match(html, /50 bilinmeyen/);
  assert.match(html, /10 olay dakikası/);
  assert.match(html, /60 dk Kısıtlı/);
  assert.doesNotMatch(html, /24 saat doğrulandı/);
});

test("complete sampled coverage with incidents is not presented as missing data or an endurance certificate", () => {
  const html = renderToStaticMarkup(
    <TwentyFourHourRing
      ring={{
        ...ring,
        complete: true,
        verifiedTwentyFourHours: false,
        counts: { ...ring.counts, degraded: 110, unknown: 0 },
      }}
    />,
  );
  assert.match(html, /Tüm dakika dilimlerinde sağlık kaydı var/);
  assert.match(html, /dayanıklılık testi sonucu değildir/);
  assert.doesNotMatch(html, /24 saat doğrulandı/);
});

test("failed refresh marks an otherwise live snapshot as historical", () => {
  const html = renderToStaticMarkup(
    <RuntimeTruthBadge
      truth={{ ...truth, live: true, transportState: "live" }}
      snapshotStale
    />,
  );
  assert.match(html, /Son görünüm güncellenemedi/);
  assert.doesNotMatch(html, /Canlı ·/);
  assert.match(html, /data-snapshot-stale="true"/);
});

test("summary strip answers queue, wake, work, intervention and usage at a glance", () => {
  const model = {
    ...roomBoundary,
    generatedAt: "2026-09-01T12:00:00.000Z",
    cursor: "41",
    truth,
    healthRing: ring,
    lanes: [],
    missions: [],
    queue: {
      dueDepth: 4,
      oldestDueAgeMs: 62_000,
      nextWakeAt: "2026-09-01T12:03:00.000Z",
    },
    taskCounts: {
      active: 7,
      sleeping: 2,
      recovering: 1,
      blocked: 3,
      awaitingApproval: 2,
    },
    operationCounts: { reserved: 0, running: 0, unresolvedUnknown: 0 },
    attempts: [],
    receipts: [],
    usage: {
      taskTokens: 12_345,
      reportedCostUsd: 1.25,
      usageEvents: 10,
      costReportedEvents: 8,
      providerMetricsCoverage: "partial" as const,
    },
  } satisfies OperationsRoomModel;
  const html = renderToStaticMarkup(
    <OperationsSummaryStrip
      model={model}
      now={new Date("2026-09-01T12:00:00Z")}
    />,
  );

  for (const label of [
    "Aktif iş",
    "Bekleyen sıra",
    "En eski bekleyen",
    "Sonraki uyanış",
    "Müdahale",
    "Token kullanımı",
  ]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /5/);
  assert.match(html, /12\.345/);
});

test("team constellation keeps every member and their current evidence visible", () => {
  const lanes: AgentLane[] = [
    {
      state: "working",
      members: [
        {
          agentId: 2,
          name: "Mina",
          role: "Operasyon",
          avatar: "avatar-2",
          status: "working",
          presence: "working",
          currentAction: "Kaynakları doğruluyor",
          lastActiveAt: "2026-09-01T11:59:58.000Z",
          activeAttemptId: "attempt-2",
          nextWakeAt: null,
          laneState: "working",
          activeForMs: 2_000,
        },
      ],
    },
    {
      state: "awaiting_approval",
      members: [],
    },
    { state: "recovering", members: [] },
    { state: "blocked", members: [] },
    { state: "idle", members: [] },
    { state: "offline", members: [] },
    { state: "unknown", members: [] },
  ];
  const html = renderToStaticMarkup(<TeamConstellation lanes={lanes} />);
  assert.match(html, /Mina/);
  assert.match(html, /Kaynakları doğruluyor/);
  assert.match(html, /attempt-2/);
  assert.match(html, /1 uzman/);
});

test("mission log exposes durable evidence identifiers", () => {
  const missions: MissionLogEntry[] = [
    {
      id: "event-7",
      evidenceId: "event-7",
      source: "incident",
      kind: "worker_recovered",
      severity: "warning",
      occurredAt: "2026-09-01T11:59:00.000Z",
      taskId: 1,
      agentId: 2,
      attemptId: "attempt-2",
      receiptId: null,
    },
  ];
  const html = renderToStaticMarkup(<MissionLog missions={missions} />);
  assert.match(html, /Görev kaydı/);
  assert.match(html, /Worker yeniden devrede/);
  assert.match(html, /event-7/);
});

test("attempt ledger names the specialist and preserves exact durable attempt evidence", () => {
  const html = renderToStaticMarkup(
    <AttemptLedger
      selectedAttemptId="attempt-exact-2"
      onSelectAttempt={() => undefined}
      members={[
        {
          agentId: 2,
          name: "Mina",
          role: "Operasyon",
          avatar: "avatar-2",
          status: "working",
          presence: "working",
          currentAction: "Doğruluyor",
          lastActiveAt: "2026-09-01T11:59:00.000Z",
          activeAttemptId: "attempt-exact-2",
          nextWakeAt: null,
        },
      ]}
      attempts={[
        {
          id: "attempt-exact-2",
          taskId: 7,
          agentId: 2,
          workerInstanceId: "worker-b",
          logicalExecutionId: "logical-1",
          attemptNumber: 2,
          cycleNumber: 4,
          state: "running",
          startedAt: "2026-09-01T11:58:00.000Z",
          lastHeartbeatAt: "2026-09-01T11:59:58.000Z",
          finishedAt: null,
          provider: "openrouter",
          modelId: "model-x",
          failureKind: null,
          recoveryOfAttemptId: "attempt-previous",
          promptTokens: 100,
          completionTokens: 25,
          totalTokens: 125,
          reportedCostUsd: 0.02,
        },
      ]}
    />,
  );
  assert.match(html, /Dayanıklı iş akışı/);
  assert.match(html, /Mina/);
  assert.match(html, /attempt-exact-2/);
  assert.match(html, /worker-b/);
  assert.match(html, /125 token/);
  assert.match(html, /Toparlanma denemesi/);
  assert.match(html, /aria-pressed="true"/);
});

test("data boundary names timezone, bounded limits and every truncated evidence family", () => {
  const html = renderToStaticMarkup(
    <OperationsDataBoundary
      window={{
        startAt: "2026-08-31T12:00:00.000Z",
        endAt: "2026-09-01T12:00:00.000Z",
        hours: 24,
        timezone: "UTC",
      }}
      limits={{
        attempts: 200,
        receipts: 200,
        invocationsPerReceipt: 5,
        incidents: 100,
        milestones: 100,
        samples: 1_440,
      }}
      truncation={{
        attempts: true,
        receipts: false,
        incidents: true,
        milestones: false,
        fleetHealthSamples: true,
      }}
    />,
  );

  assert.match(html, /Sınırlı kanıt görünümü/);
  assert.match(html, /Denemeler: 200 kayıt sınırına ulaşıldı/);
  assert.match(html, /Olaylar: 100 kayıt sınırına ulaşıldı/);
  assert.match(html, /Sağlık örnekleri: 1\.440 kayıt sınırına ulaşıldı/);
  assert.match(html, /Kayıt zaman dilimi: UTC/);
  assert.match(html, /Gösterim: Europe\/Istanbul/);
});

test("one evidence inspector binds logical execution, invocation and receipt without unrelated calls", () => {
  const html = renderToStaticMarkup(
    <OperationEvidenceInspector
      chain={{
        logicalExecutionId: "logical-exact",
        attempt: {
          id: "attempt-exact",
          taskId: 7,
          agentId: 2,
          workerInstanceId: "worker-a",
          logicalExecutionId: "logical-exact",
          attemptNumber: 2,
          cycleNumber: 4,
          state: "lost",
          startedAt: "2026-09-01T11:58:00.000Z",
          lastHeartbeatAt: "2026-09-01T11:58:01.000Z",
          finishedAt: "2026-09-01T11:58:02.000Z",
          provider: "openrouter",
          modelId: "model-x",
          failureKind: "worker_lost_after_effect",
          recoveryOfAttemptId: null,
          promptTokens: 100,
          completionTokens: 25,
          totalTokens: 125,
          reportedCostUsd: 0.02,
        },
        receipts: [
          {
            receipt: {
              id: "receipt-exact",
              taskId: 7,
              agentId: 2,
              originAttemptId: "attempt-exact",
              executionKind: "task_step",
              sideEffectClass: "at_most_once",
              state: "unknown",
              toolName: "browser_click",
              reservedAt: "2026-09-01T11:58:00.000Z",
              startedAt: "2026-09-01T11:58:01.000Z",
              finishedAt: "2026-09-01T11:58:02.000Z",
              failureKind: "worker_lost_after_effect",
              reconciliation: {
                eligible: true,
                decision: null,
                reconciledAt: null,
              },
              invocations: [],
            },
            invocations: [
              {
                id: "invocation-exact",
                state: "unknown",
                attemptId: "attempt-exact",
                workerInstanceId: "worker-a",
                claimedAt: "2026-09-01T11:58:00.000Z",
                lastHeartbeatAt: "2026-09-01T11:58:01.000Z",
                effectStartedAt: "2026-09-01T11:58:01.000Z",
                finishedAt: "2026-09-01T11:58:02.000Z",
                failureKind: "worker_lost_after_effect",
              },
            ],
          },
        ],
      }}
    />,
  );

  assert.match(html, /Kanıt zinciri/);
  assert.match(html, /logical-exact/);
  assert.match(html, /attempt-exact/);
  assert.match(html, /invocation-exact/);
  assert.match(html, /receipt-exact/);
  assert.match(html, /Etki sınırı başladı/);
  assert.doesNotMatch(html, /invocation-other/);
});

test("reconciliation note is required, trimmed and bounded to 2,000 characters", () => {
  assert.equal(
    receiptReconciliationSchema.safeParse({
      decision: "confirmed_applied",
      note: "   ",
    }).success,
    false,
  );
  const valid = receiptReconciliationSchema.safeParse({
    decision: "confirmed_not_applied",
    note: "  Harici kayıt kontrol edildi.  ",
  });
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.equal(valid.data.note, "Harici kayıt kontrol edildi.");
  }
  assert.equal(
    receiptReconciliationSchema.safeParse({
      decision: "confirmed_not_applied",
      note: "x".repeat(2_001),
    }).success,
    false,
  );
});

test("receipt ledger makes unresolved effects explicit without pretending a replay is safe", () => {
  const html = renderToStaticMarkup(
    <ReceiptLedger
      receipts={[
        {
          id: "receipt-unknown-1",
          taskId: 7,
          agentId: 2,
          originAttemptId: "attempt-exact-2",
          executionKind: "task_step",
          sideEffectClass: "at_most_once",
          state: "unknown",
          toolName: "browser_click",
          reservedAt: "2026-09-01T11:58:00.000Z",
          startedAt: "2026-09-01T11:58:01.000Z",
          finishedAt: "2026-09-01T11:58:02.000Z",
          failureKind: "worker_lost_after_effect",
          reconciliation: {
            eligible: true,
            decision: null,
            reconciledAt: null,
          },
          invocations: [
            {
              id: "invocation-1",
              state: "unknown",
              attemptId: "attempt-exact-2",
              workerInstanceId: "worker-b",
              claimedAt: "2026-09-01T11:58:00.000Z",
              lastHeartbeatAt: "2026-09-01T11:58:01.000Z",
              effectStartedAt: "2026-09-01T11:58:01.000Z",
              finishedAt: "2026-09-01T11:58:02.000Z",
              failureKind: "worker_lost_after_effect",
            },
          ],
        },
      ]}
    />,
  );
  assert.match(html, /Etki makbuzları/);
  assert.match(html, /Bilinmiyor/);
  assert.match(html, /Tekrar oynatılmaz/);
  assert.match(html, /receipt-unknown-1/);
  assert.match(html, /invocation-1/);
});

test("fleet room shows effective worker truth and unresolved effects", () => {
  const model = {
    ...roomBoundary,
    generatedAt: "2026-09-01T12:00:00.000Z",
    cursor: "55",
    truth,
    healthRing: ring,
    lanes: [],
    missions: [],
    queue: { dueDepth: 0, oldestDueAgeMs: null, nextWakeAt: null },
    taskCounts: {
      active: 2,
      sleeping: 1,
      recovering: 0,
      blocked: 0,
      awaitingApproval: 0,
    },
    operationCounts: { reserved: 3, running: 2, unresolvedUnknown: 1 },
    attempts: [],
    receipts: [],
    usage: {
      taskTokens: 200,
      reportedCostUsd: 0,
      usageEvents: 1,
      costReportedEvents: 0,
      providerMetricsCoverage: "partial" as const,
    },
  } satisfies OperationsRoomModel;
  const html = renderToStaticMarkup(
    <FleetOperationsRoom
      model={model}
      now={new Date("2026-09-01T12:00:00Z")}
      instances={[
        {
          id: "worker-public-a",
          role: "worker",
          persistedState: "healthy",
          effectiveState: "stale",
          buildVersion: "0.1.0",
          capabilities: { scheduler: true },
          schedulerEnabled: true,
          startedAt: "2026-09-01T10:00:00.000Z",
          lastHeartbeatAt: "2026-09-01T11:59:30.000Z",
          heartbeatAgeMs: 30_000,
          lastSchedulerTickAt: "2026-09-01T11:59:29.000Z",
          schedulerTickAgeMs: 31_000,
          drainingAt: null,
          stoppedAt: null,
        },
      ]}
    />,
  );
  assert.match(html, /Operasyon merkezi/);
  assert.match(html, /worker-public-a/);
  assert.match(html, /Kayıtlı: Sağlıklı/);
  assert.match(html, /Hesaplanan: Gecikmiş/);
  assert.match(html, /Sonucu belirsiz/);
  assert.match(html, />1</);
});
