import type { EnduranceInvariantInput } from "./invariants";
import type { EnduranceReport } from "./report-schema";

const MAX_PRIMARY_EVIDENCE_BYTES = 64 * 1024 * 1024;
const MAX_PRIMARY_EVIDENCE_RECORDS = 100_000;
const MAX_INVOCATIONS_PER_RECEIPT = 20;
const FAULT_EVIDENCE_TIMEOUT_MS = 120_000;
const FAULT_EVIDENCE_POLL_TOLERANCE_MS = 5_000;
const OPERATION_KEY = /^op:v1:[a-f0-9]{64}$/u;
const FAULT_SOURCE_KINDS = new Set([
  "durable_event",
  "operations_timeline",
  "health_sample",
  "runtime_snapshot",
  "runtime_control",
  "sse_cursor",
]);

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Primary evidence ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Buffer.byteLength(value, "utf8") > 500
  ) {
    throw new Error(`Primary evidence ${label} is invalid`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new Error(`Primary evidence ${label} is invalid`);
  }
  return Number(value);
}

function iso(value: unknown, label: string): string {
  const result = text(value, label);
  const parsed = new Date(result);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== result) {
    throw new Error(`Primary evidence ${label} is not a canonical timestamp`);
  }
  return result;
}

function nullableIso(value: unknown, label: string): string | null {
  return value === null ? null : iso(value, label);
}

function decimalCursor(value: unknown, label: string): bigint {
  const result = text(value, label);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(result)) {
    throw new Error(`Primary evidence ${label} is not a canonical cursor`);
  }
  return BigInt(result);
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface ReceiptProof {
  sequence: number;
  receiptId: string;
  operationKey: string;
  irreversible: boolean;
  succeeded: boolean;
  toolName: string;
  finishedAt: string | null;
  originAttempt: {
    id: string;
    taskId: number;
    agentId: number;
    cycleNumber: number;
    state: string;
    finishedAt: string | null;
  } | null;
  winningAttempt: ReceiptProof["originAttempt"];
}

interface ResponsibilityProof {
  sequence: number;
  observedAt: string;
  receiptId: string;
  taskId: number;
  agentId: number;
  cycleNumber: number;
  completedAt: string;
}

interface ResponsibilityLagProof {
  sequence: number;
  minute: number;
  lag: number;
  observedAt: string;
}

interface HealthProof {
  bucketAt: string;
  conservativeGap: boolean;
  minute: number;
  sampledAt: string;
  reportedState: string;
  truthState: string;
}

interface FaultObservedProof {
  sequence: number;
  faultId: string;
  faultKind: string;
  scheduledAt: string;
  observedAt: string;
  incidentId: string;
  sourceKind: string;
  sourceId: string;
}

interface FaultRecoveredProof {
  sequence: number;
  faultId: string;
  faultKind: string;
  scheduledAt: string;
  recoveredAt: string;
  incidentId: string;
  sourceKind: string;
  sourceId: string;
}

interface SseProof {
  occurredAt: string;
  faultId: string;
  incidentId: string;
  cursor: bigint;
}

export interface ExpectedPrimaryFaultEvidence {
  id: string;
  kind: string;
  scheduledAt: string;
  durationMs: number;
}

export function validateAndRecomputePrimaryEvidence(input: {
  bytes: Buffer;
  report: EnduranceReport;
  requiredHealthSampleBuckets: number;
  expectedFaults: readonly ExpectedPrimaryFaultEvidence[];
}): EnduranceInvariantInput {
  if (
    input.bytes.length === 0 ||
    input.bytes.length > MAX_PRIMARY_EVIDENCE_BYTES
  ) {
    throw new Error("Primary evidence byte length is outside its safe bound");
  }
  const textBytes = input.bytes.toString("utf8");
  if (!textBytes.endsWith("\n")) {
    throw new Error("Primary evidence JSONL is truncated");
  }
  const lines = textBytes.slice(0, -1).split("\n");
  if (lines.length === 0 || lines.length > MAX_PRIMARY_EVIDENCE_RECORDS) {
    throw new Error("Primary evidence record count is outside its safe bound");
  }

  const startedAtMs = new Date(input.report.startedAt).getTime();
  const completedAtMs = new Date(input.report.completedAt).getTime();
  const receipts = new Map<string, ReceiptProof>();
  const attemptSnapshots = new Map<
    string,
    NonNullable<ReceiptProof["originAttempt"]>
  >();
  const responsibilities: ResponsibilityProof[] = [];
  const coverage = new Set<string>();
  const responsibilityReceiptIds = new Set<string>();
  const lags = new Map<number, ResponsibilityLagProof>();
  const health = new Map<number, HealthProof>();
  const observedFaults = new Map<string, FaultObservedProof>();
  const recoveredFaults = new Map<string, FaultRecoveredProof>();
  const faultSourceIdentities = new Set<string>();
  let awaitingFaultRecovery: string | null = null;
  let disconnected: SseProof | null = null;
  let reconnected: SseProof | null = null;
  let lastLagMinute = 0;
  let lastHealthMinute = 0;
  let disconnectCount = 0;
  let reconnectCount = 0;

  for (const [index, line] of lines.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Primary evidence line ${index + 1} is invalid JSON`);
    }
    const record = object(parsed, `record ${index}`);
    if (
      record.schemaVersion !== 1 ||
      record.runId !== input.report.runId ||
      record.sequence !== index
    ) {
      throw new Error(
        `Primary evidence envelope mismatch at sequence ${index}`,
      );
    }
    const occurredAt = iso(record.occurredAt, `record ${index} occurredAt`);
    const occurredAtMs = new Date(occurredAt).getTime();
    if (occurredAtMs < startedAtMs || occurredAtMs > completedAtMs) {
      throw new Error(`Primary evidence timestamp escaped the run at ${index}`);
    }
    const data = object(record.data, `record ${index} data`);
    switch (record.kind) {
      case "receipt_observed": {
        const receiptId = text(data.receiptId, `receipt ${index} id`);
        if (receipts.has(receiptId)) {
          throw new Error(`Primary evidence duplicate receipt ${receiptId}`);
        }
        if (
          typeof data.irreversible !== "boolean" ||
          typeof data.succeeded !== "boolean"
        ) {
          throw new Error(
            `Primary evidence receipt ${receiptId} flags are invalid`,
          );
        }
        const state = text(data.state, `receipt ${receiptId} state`);
        if (
          !["succeeded", "failed", "unknown"].includes(state) ||
          data.succeeded !== (state === "succeeded")
        ) {
          throw new Error(
            `Primary evidence receipt ${receiptId} state is invalid`,
          );
        }
        const sideEffectClass = text(
          data.sideEffectClass,
          `receipt ${receiptId} side effect class`,
        );
        const irreversible = ["at_most_once", "approval_at_most_once"].includes(
          sideEffectClass,
        );
        if (data.irreversible !== irreversible) {
          throw new Error(
            `Primary evidence receipt ${receiptId} irreversible classification is invalid`,
          );
        }
        const finishedAt = nullableIso(
          data.finishedAt,
          `receipt ${receiptId} finishedAt`,
        );
        if (
          !finishedAt ||
          new Date(finishedAt).getTime() < startedAtMs ||
          new Date(finishedAt).getTime() > occurredAtMs
        ) {
          throw new Error(
            `Primary evidence receipt ${receiptId} completion time is invalid`,
          );
        }
        const origin =
          data.originAttempt === null
            ? null
            : object(data.originAttempt, `receipt ${receiptId} origin attempt`);
        const originAttempt = origin
          ? {
              id: text(origin.id, `receipt ${receiptId} origin id`),
              taskId: integer(
                origin.taskId,
                `receipt ${receiptId} origin taskId`,
                1,
              ),
              agentId: integer(
                origin.agentId,
                `receipt ${receiptId} origin agentId`,
                1,
              ),
              cycleNumber: integer(
                origin.cycleNumber,
                `receipt ${receiptId} origin cycleNumber`,
              ),
              state: text(origin.state, `receipt ${receiptId} origin state`),
              finishedAt: nullableIso(
                origin.finishedAt,
                `receipt ${receiptId} origin finishedAt`,
              ),
            }
          : null;
        if (
          originAttempt &&
          (!originAttempt.finishedAt ||
            !["succeeded", "retrying", "blocked", "lost"].includes(
              originAttempt.state,
            ))
        ) {
          throw new Error(
            `Primary evidence receipt ${receiptId} origin attempt is not durably finalized`,
          );
        }
        if (originAttempt?.finishedAt) {
          const originFinishedAtMs = new Date(
            originAttempt.finishedAt,
          ).getTime();
          if (
            originFinishedAtMs < startedAtMs ||
            originFinishedAtMs > occurredAtMs
          ) {
            throw new Error(
              `Primary evidence receipt ${receiptId} origin attempt escaped the run`,
            );
          }
        }
        const physical =
          data.winningAttempt === null
            ? null
            : object(
                data.winningAttempt,
                `receipt ${receiptId} winning attempt`,
              );
        const winningAttempt = physical
          ? {
              id: text(physical.id, `receipt ${receiptId} winning id`),
              taskId: integer(
                physical.taskId,
                `receipt ${receiptId} winning taskId`,
                1,
              ),
              agentId: integer(
                physical.agentId,
                `receipt ${receiptId} winning agentId`,
                1,
              ),
              cycleNumber: integer(
                physical.cycleNumber,
                `receipt ${receiptId} winning cycleNumber`,
              ),
              state: text(physical.state, `receipt ${receiptId} winning state`),
              finishedAt: nullableIso(
                physical.finishedAt,
                `receipt ${receiptId} winning finishedAt`,
              ),
            }
          : null;
        if (
          winningAttempt &&
          (!winningAttempt.finishedAt ||
            !["succeeded", "retrying", "blocked", "lost"].includes(
              winningAttempt.state,
            ) ||
            new Date(winningAttempt.finishedAt).getTime() < startedAtMs ||
            new Date(winningAttempt.finishedAt).getTime() > occurredAtMs)
        ) {
          throw new Error(
            `Primary evidence receipt ${receiptId} winning attempt is not durably finalized within the run`,
          );
        }
        if (
          originAttempt &&
          winningAttempt &&
          originAttempt.id === winningAttempt.id &&
          !same(originAttempt, winningAttempt)
        ) {
          throw new Error(
            `Primary evidence receipt ${receiptId} contains contradictory snapshots of the same attempt`,
          );
        }
        for (const attempt of [originAttempt, winningAttempt]) {
          if (!attempt) continue;
          const previous = attemptSnapshots.get(attempt.id);
          if (previous && !same(previous, attempt)) {
            throw new Error(
              `Primary evidence contains a contradictory attempt identity for ${attempt.id}`,
            );
          }
          attemptSnapshots.set(attempt.id, attempt);
        }
        if (
          !Array.isArray(data.invocations) ||
          data.invocations.length === 0 ||
          data.invocations.length > MAX_INVOCATIONS_PER_RECEIPT
        ) {
          throw new Error(
            `Primary evidence receipt ${receiptId} invocation evidence is invalid`,
          );
        }
        const invocationIds = new Set<string>();
        const invocations = data.invocations.map((value, invocationIndex) => {
          const invocation = object(
            value,
            `receipt ${receiptId} invocation ${invocationIndex}`,
          );
          const id = text(
            invocation.id,
            `receipt ${receiptId} invocation ${invocationIndex} id`,
          );
          if (invocationIds.has(id)) {
            throw new Error(
              `Primary evidence receipt ${receiptId} contains duplicate invocation IDs`,
            );
          }
          invocationIds.add(id);
          const effectStartedAt = nullableIso(
            invocation.effectStartedAt,
            `receipt ${receiptId} invocation ${invocationIndex} effectStartedAt`,
          );
          const invocationFinishedAt = nullableIso(
            invocation.finishedAt,
            `receipt ${receiptId} invocation ${invocationIndex} finishedAt`,
          );
          for (const timestamp of [effectStartedAt, invocationFinishedAt]) {
            if (
              timestamp &&
              (new Date(timestamp).getTime() < startedAtMs ||
                new Date(timestamp).getTime() > occurredAtMs)
            ) {
              throw new Error(
                `Primary evidence receipt ${receiptId} invocation timestamp escaped the run`,
              );
            }
          }
          if (
            effectStartedAt &&
            invocationFinishedAt &&
            new Date(effectStartedAt).getTime() >
              new Date(invocationFinishedAt).getTime()
          ) {
            throw new Error(
              `Primary evidence receipt ${receiptId} invocation timing is invalid`,
            );
          }
          return {
            id,
            attemptId:
              invocation.attemptId === null
                ? null
                : text(
                    invocation.attemptId,
                    `receipt ${receiptId} invocation ${invocationIndex} attemptId`,
                  ),
            state: text(
              invocation.state,
              `receipt ${receiptId} invocation ${invocationIndex} state`,
            ),
            effectStartedAt,
            finishedAt: invocationFinishedAt,
          };
        });
        if (data.succeeded) {
          const winners = invocations.filter(
            (invocation) => invocation.state === "succeeded",
          );
          if (
            winners.length === 1 &&
            (originAttempt
              ? !winningAttempt ||
                winners[0].attemptId !== winningAttempt.id ||
                winningAttempt.taskId !== originAttempt.taskId ||
                winningAttempt.agentId !== originAttempt.agentId ||
                winningAttempt.cycleNumber !== originAttempt.cycleNumber
              : winningAttempt !== null || winners[0].attemptId !== null)
          ) {
            throw new Error(
              `Primary evidence receipt ${receiptId} winning invocation is not bound to its exact task, agent and cycle owner`,
            );
          }
          if (
            winners.length !== 1 ||
            !winners[0].effectStartedAt ||
            !winners[0].finishedAt ||
            !finishedAt ||
            invocations.some(
              (invocation) =>
                invocation !== winners[0] &&
                (invocation.state !== "failed" ||
                  invocation.effectStartedAt !== null ||
                  invocation.finishedAt === null),
            )
          ) {
            throw new Error(
              `Primary evidence receipt ${receiptId} effect boundary is invalid`,
            );
          }
          if (winners[0].finishedAt !== finishedAt) {
            throw new Error(
              `Primary evidence receipt ${receiptId} completion is not bound to its winning invocation`,
            );
          }
        } else if (
          invocations.some((invocation) => invocation.state === "succeeded")
        ) {
          throw new Error(
            `Primary evidence receipt ${receiptId} contradicts a succeeded invocation`,
          );
        }
        const operationKey = text(
          data.operationKey,
          `receipt ${receiptId} operation key`,
        );
        if (!OPERATION_KEY.test(operationKey)) {
          throw new Error(
            `Primary evidence receipt ${receiptId} operation key is not canonical`,
          );
        }
        receipts.set(receiptId, {
          sequence: index,
          receiptId,
          operationKey,
          irreversible,
          succeeded: state === "succeeded",
          toolName: text(data.toolName, `receipt ${receiptId} toolName`),
          finishedAt,
          originAttempt,
          winningAttempt,
        });
        break;
      }
      case "responsibility_completed": {
        const proof: ResponsibilityProof = {
          sequence: index,
          observedAt: occurredAt,
          receiptId: text(data.receiptId, `responsibility ${index} receiptId`),
          taskId: integer(data.taskId, `responsibility ${index} taskId`, 1),
          agentId: integer(data.agentId, `responsibility ${index} agentId`, 1),
          cycleNumber: integer(
            data.cycleNumber,
            `responsibility ${index} cycleNumber`,
          ),
          completedAt: iso(
            data.completedAt,
            `responsibility ${index} completedAt`,
          ),
        };
        const completedAtMs = new Date(proof.completedAt).getTime();
        if (
          completedAtMs <
            startedAtMs + Math.max(0, proof.cycleNumber - 1) * 60_000 ||
          completedAtMs > occurredAtMs
        ) {
          throw new Error(
            "Primary evidence responsibility completion time is invalid",
          );
        }
        const key = `${proof.taskId}:${proof.agentId}:${proof.cycleNumber}`;
        if (
          coverage.has(key) ||
          responsibilityReceiptIds.has(proof.receiptId)
        ) {
          throw new Error(
            "Primary evidence contains a duplicate agent-cycle responsibility",
          );
        }
        coverage.add(key);
        responsibilityReceiptIds.add(proof.receiptId);
        responsibilities.push(proof);
        break;
      }
      case "responsibility_cycle_lag": {
        const minute = integer(data.minute, `cycle lag ${index} minute`, 1);
        const lag = integer(data.lag, `cycle lag ${index} value`);
        if (minute !== lastLagMinute + 1) {
          throw new Error(
            "Primary evidence cycle lag rows are duplicate, missing, or out of order",
          );
        }
        const expectedAtMs = startedAtMs + minute * 60_000;
        if (
          occurredAtMs < expectedAtMs - 1_000 ||
          occurredAtMs > expectedAtMs + 120_000
        ) {
          throw new Error("Primary evidence cycle lag timestamp is invalid");
        }
        lastLagMinute = minute;
        lags.set(minute, {
          sequence: index,
          minute,
          lag,
          observedAt: occurredAt,
        });
        break;
      }
      case "health_observed": {
        const minute = integer(data.minute, `health ${index} minute`, 1);
        if (minute !== lastHealthMinute + 1) {
          throw new Error(
            "Primary evidence health rows are duplicate, missing, or out of order",
          );
        }
        lastHealthMinute = minute;
        const bucketAt = iso(data.bucketAt, `health ${index} bucketAt`);
        const sampledAt = iso(data.sampledAt, `health ${index} sampledAt`);
        if (sampledAt !== occurredAt) {
          throw new Error("Primary evidence health timestamp is inconsistent");
        }
        const sampledAtMs = new Date(sampledAt).getTime();
        const bucketAtMs = new Date(bucketAt).getTime();
        // Production rows describe the last completed minute. A sampler that
        // runs partway through the following minute legitimately records an
        // age of 60–120 seconds. Database gaps are explicit offline markers,
        // never reconstructed healthy samples, and must bind to the observed
        // database incident and its independently verified recovery window.
        const conservativeGap =
          data.runtimeTruthState === "offline" &&
          data.healthyWorkerCount === 0 &&
          data.staleWorkerCount === 0 &&
          data.schedulerTickAgeMs === null &&
          input.report.injections.some(
            (injection) =>
              injection.kind === "database_unavailable" &&
              injection.observedAt === sampledAt &&
              injection.recoveredAt !== null &&
              bucketAtMs + 120_000 >=
                new Date(injection.scheduledAt).getTime() &&
              bucketAtMs + 60_000 <=
                new Date(injection.recoveredAt).getTime() &&
              sampledAtMs <=
                new Date(injection.recoveredAt).getTime() +
                  FAULT_EVIDENCE_POLL_TOLERANCE_MS,
          );
        if (
          bucketAtMs > sampledAtMs ||
          (sampledAtMs - bucketAtMs > 120_000 && !conservativeGap) ||
          (minute === 1 && sampledAtMs - startedAtMs > 120_000)
        ) {
          throw new Error("Primary evidence health sample time is invalid");
        }
        const priorHealth = health.get(minute - 1);
        if (
          priorHealth &&
          (bucketAtMs - new Date(priorHealth.bucketAt).getTime() !== 60_000 ||
            sampledAtMs < new Date(priorHealth.sampledAt).getTime() ||
            (sampledAtMs === new Date(priorHealth.sampledAt).getTime() &&
              !priorHealth.conservativeGap) ||
            (sampledAtMs - new Date(priorHealth.sampledAt).getTime() > 90_000 &&
              !conservativeGap))
        ) {
          throw new Error("Primary evidence health sample cadence is invalid");
        }
        const runtimeTruthState =
          data.runtimeTruthState === null
            ? null
            : text(data.runtimeTruthState, `health ${index} runtime truth`);
        const healthyWorkerCount = integer(
          data.healthyWorkerCount,
          `health ${index} healthy workers`,
        );
        integer(data.staleWorkerCount, `health ${index} stale workers`);
        if (
          data.schedulerTickAgeMs !== null &&
          (!Number.isFinite(data.schedulerTickAgeMs) ||
            Number(data.schedulerTickAgeMs) < 0)
        ) {
          throw new Error("Primary evidence health scheduler age is invalid");
        }
        if (runtimeTruthState === "live" && healthyWorkerCount !== 2) {
          throw new Error(
            "Primary evidence health requires exactly two healthy scheduler workers",
          );
        }
        const truthState =
          runtimeTruthState === "live" && healthyWorkerCount === 2
            ? "healthy"
            : "degraded";
        const reportedState =
          runtimeTruthState === "live"
            ? "healthy"
            : (runtimeTruthState ?? "unknown");
        if (
          data.truthState !== truthState ||
          data.reportedState !== reportedState
        ) {
          throw new Error(
            "Primary evidence health claims contradict raw runtime truth",
          );
        }
        health.set(minute, {
          bucketAt,
          conservativeGap,
          minute,
          sampledAt,
          reportedState,
          truthState,
        });
        break;
      }
      case "fault_observed": {
        if (awaitingFaultRecovery !== null) {
          throw new Error(
            `Primary fault recovery is missing before ${String(data.faultId)}`,
          );
        }
        const faultId = text(data.faultId, `fault observation ${index} id`);
        const faultIndex = input.expectedFaults.findIndex(
          (fault) => fault.id === faultId,
        );
        const expected = input.expectedFaults[faultIndex];
        const faultKind = text(
          data.faultKind,
          `fault observation ${index} kind`,
        );
        const scheduledAt = iso(
          data.scheduledAt,
          `fault observation ${index} scheduledAt`,
        );
        const incidentId = text(
          data.incidentId,
          `fault observation ${index} incidentId`,
        );
        const sourceKind = text(
          data.sourceKind,
          `fault observation ${index} source kind`,
        );
        const sourceId = text(
          data.sourceId,
          `fault observation ${index} source id`,
        );
        if (
          !FAULT_SOURCE_KINDS.has(sourceKind) ||
          sourceKind === "runtime_snapshot"
        ) {
          throw new Error(
            `Primary fault ${faultId} durable source kind is invalid`,
          );
        }
        const sourceIdentity = `${sourceKind}:${sourceId}`;
        if (faultSourceIdentities.has(sourceIdentity)) {
          throw new Error(`Primary fault ${faultId} reused a source identity`);
        }
        faultSourceIdentities.add(sourceIdentity);
        const injection = input.report.injections[faultIndex];
        if (
          !expected ||
          !injection ||
          faultId !== expected.id ||
          faultKind !== expected.kind ||
          scheduledAt !== expected.scheduledAt ||
          injection.id !== expected.id ||
          injection.kind !== expected.kind ||
          injection.scheduledAt !== expected.scheduledAt ||
          injection.observedAt !== occurredAt ||
          injection.incidentId !== incidentId ||
          observedFaults.has(faultId)
        ) {
          throw new Error(
            `Primary fault observation does not match deterministic schedule at index ${observedFaults.size}`,
          );
        }
        const scheduledAtMs = new Date(scheduledAt).getTime();
        if (
          occurredAtMs < scheduledAtMs ||
          occurredAtMs >
            scheduledAtMs + expected.durationMs + FAULT_EVIDENCE_TIMEOUT_MS
        ) {
          throw new Error(
            `Primary fault ${faultId} observation escaped its evidence window`,
          );
        }
        observedFaults.set(faultId, {
          sequence: index,
          faultId,
          faultKind,
          scheduledAt,
          observedAt: occurredAt,
          incidentId,
          sourceKind,
          sourceId,
        });
        awaitingFaultRecovery = faultId;
        break;
      }
      case "fault_recovered": {
        const faultId = text(data.faultId, `fault recovery ${index} id`);
        const faultIndex = input.expectedFaults.findIndex(
          (fault) => fault.id === faultId,
        );
        const expected = input.expectedFaults[faultIndex];
        const faultKind = text(data.faultKind, `fault recovery ${index} kind`);
        const scheduledAt = iso(
          data.scheduledAt,
          `fault recovery ${index} scheduledAt`,
        );
        const incidentId = text(
          data.incidentId,
          `fault recovery ${index} incidentId`,
        );
        const sourceKind = text(
          data.sourceKind,
          `fault recovery ${index} source kind`,
        );
        const sourceId = text(
          data.sourceId,
          `fault recovery ${index} source id`,
        );
        if (!FAULT_SOURCE_KINDS.has(sourceKind)) {
          throw new Error(
            `Primary fault ${faultId} recovery source is invalid`,
          );
        }
        if (sourceKind === "runtime_snapshot") {
          const runtime = object(
            data.runtimeEvidence,
            "runtime recovery evidence",
          );
          const generatedAt = iso(
            runtime.generatedAt,
            "runtime recovery generatedAt",
          );
          const cursor = decimalCursor(
            runtime.cursor,
            "runtime recovery cursor",
          ).toString();
          const healthyWorkers = integer(
            runtime.healthyWorkerCount,
            "runtime recovery healthy workers",
          );
          integer(runtime.staleWorkerCount, "runtime recovery stale workers");
          const tickAge = integer(
            runtime.schedulerTickAgeMs,
            "runtime recovery scheduler tick age",
          );
          if (
            faultKind !== "database_unavailable" ||
            generatedAt !== occurredAt ||
            sourceId !== `operations-runtime:${cursor}:${generatedAt}` ||
            runtime.state !== "live" ||
            runtime.databaseBackend !== "postgresql" ||
            runtime.durable !== true ||
            healthyWorkers !== 2 ||
            tickAge > 5_000
          ) {
            throw new Error(
              "Primary runtime recovery evidence is not fresh durable healthy truth",
            );
          }
        } else if (data.runtimeEvidence !== undefined) {
          throw new Error(
            "Primary runtime recovery evidence has the wrong source kind",
          );
        }
        const sourceIdentity = `${sourceKind}:${sourceId}`;
        if (faultSourceIdentities.has(sourceIdentity)) {
          throw new Error(`Primary fault ${faultId} reused a source identity`);
        }
        faultSourceIdentities.add(sourceIdentity);
        const observed = observedFaults.get(faultId);
        const injection = input.report.injections[faultIndex];
        if (
          !expected ||
          !observed ||
          !injection ||
          awaitingFaultRecovery !== faultId ||
          faultId !== expected.id ||
          faultKind !== expected.kind ||
          scheduledAt !== expected.scheduledAt ||
          observed.faultKind !== faultKind ||
          observed.scheduledAt !== scheduledAt ||
          observed.incidentId !== incidentId ||
          injection.recoveredAt !== occurredAt ||
          injection.incidentId !== incidentId ||
          recoveredFaults.has(faultId)
        ) {
          throw new Error(
            `Primary fault recovery does not match its deterministic fault pair at index ${recoveredFaults.size}`,
          );
        }
        const scheduledAtMs = new Date(scheduledAt).getTime();
        if (
          occurredAtMs < new Date(observed.observedAt).getTime() ||
          occurredAtMs >
            scheduledAtMs +
              expected.durationMs +
              FAULT_EVIDENCE_TIMEOUT_MS +
              FAULT_EVIDENCE_POLL_TOLERANCE_MS
        ) {
          throw new Error(
            `Primary fault ${faultId} recovery escaped its evidence window`,
          );
        }
        recoveredFaults.set(faultId, {
          sequence: index,
          faultId,
          faultKind,
          scheduledAt,
          recoveredAt: occurredAt,
          incidentId,
          sourceKind,
          sourceId,
        });
        awaitingFaultRecovery = null;
        break;
      }
      case "sse_disconnected":
        disconnectCount += 1;
        if (disconnectCount > 1) {
          throw new Error(
            "Primary evidence contains extra SSE disconnect rows",
          );
        }
        disconnected = {
          occurredAt,
          faultId: text(data.faultId, `SSE disconnect ${index} faultId`),
          incidentId: text(
            data.incidentId,
            `SSE disconnect ${index} incidentId`,
          ),
          cursor: decimalCursor(data.cursor, `SSE disconnect ${index}`),
        };
        break;
      case "sse_reconnected":
        reconnectCount += 1;
        if (reconnectCount > 1 || disconnected === null) {
          throw new Error(
            "Primary evidence contains extra or out-of-order SSE reconnect rows",
          );
        }
        reconnected = {
          occurredAt,
          faultId: text(data.faultId, `SSE reconnect ${index} faultId`),
          incidentId: text(
            data.incidentId,
            `SSE reconnect ${index} incidentId`,
          ),
          cursor: decimalCursor(data.cursor, `SSE reconnect ${index}`),
        };
        break;
      default:
        throw new Error(
          `Primary evidence kind is invalid at sequence ${index}: ${String(record.kind)}`,
        );
    }
  }

  if (
    awaitingFaultRecovery !== null ||
    observedFaults.size !== input.expectedFaults.length ||
    recoveredFaults.size !== input.expectedFaults.length
  ) {
    throw new Error(
      "Primary fault observation/recovery pair coverage is missing or extra",
    );
  }
  const sseFaults = input.expectedFaults.filter(
    (fault) => fault.kind === "sse_disconnect",
  );
  const sseFault = sseFaults[0];
  const sseObserved = sseFault ? observedFaults.get(sseFault.id) : undefined;
  const sseRecovered = sseFault ? recoveredFaults.get(sseFault.id) : undefined;
  if (
    sseFaults.length !== 1 ||
    !sseObserved ||
    !sseRecovered ||
    !disconnected ||
    !reconnected ||
    disconnected.faultId !== sseFault.id ||
    reconnected.faultId !== sseFault.id ||
    disconnected.incidentId !== sseObserved.incidentId ||
    reconnected.incidentId !== sseObserved.incidentId ||
    disconnected.occurredAt !== sseObserved.observedAt ||
    reconnected.occurredAt !== sseRecovered.recoveredAt
  ) {
    throw new Error(
      "Primary SSE cursor evidence is not correlated to the exact scheduled SSE fault",
    );
  }
  const requiredBuckets = input.requiredHealthSampleBuckets;
  const expectedResponsibilities = requiredBuckets * 10;
  if (responsibilities.length !== expectedResponsibilities) {
    throw new Error(
      "Primary evidence responsibility count does not match the run contract",
    );
  }
  const cyclesByAgent = new Map<number, Set<number>>();
  const taskByAgent = new Map<number, number>();
  const nextCycleByAgent = new Map<number, number>();
  const lastResponsibilityTimeByAgent = new Map<
    number,
    { completedAtMs: number; observedAtMs: number }
  >();
  for (const responsibility of responsibilities) {
    const receipt = receipts.get(responsibility.receiptId);
    if (
      !receipt ||
      receipt.sequence >= responsibility.sequence ||
      !receipt.succeeded ||
      receipt.toolName !== "synthetic_fixture_write" ||
      receipt.finishedAt !== responsibility.completedAt ||
      !receipt.originAttempt ||
      receipt.originAttempt.taskId !== responsibility.taskId ||
      receipt.originAttempt.agentId !== responsibility.agentId ||
      receipt.originAttempt.cycleNumber !== responsibility.cycleNumber
    ) {
      throw new Error(
        "Primary evidence responsibility is not bound to its durable receipt and invocation",
      );
    }
    const stableTask = taskByAgent.get(responsibility.agentId);
    if (stableTask !== undefined && stableTask !== responsibility.taskId) {
      throw new Error("Primary evidence agent changed responsibility task");
    }
    taskByAgent.set(responsibility.agentId, responsibility.taskId);
    const expectedCycle = nextCycleByAgent.get(responsibility.agentId) ?? 0;
    const completedAtMs = new Date(responsibility.completedAt).getTime();
    const observedAtMs = new Date(responsibility.observedAt).getTime();
    const priorTime = lastResponsibilityTimeByAgent.get(responsibility.agentId);
    if (
      responsibility.cycleNumber !== expectedCycle ||
      (priorTime &&
        (completedAtMs < priorTime.completedAtMs ||
          observedAtMs < priorTime.observedAtMs))
    ) {
      throw new Error(
        "Primary evidence agent cycle order is not a contiguous observed prefix",
      );
    }
    nextCycleByAgent.set(responsibility.agentId, expectedCycle + 1);
    lastResponsibilityTimeByAgent.set(responsibility.agentId, {
      completedAtMs,
      observedAtMs,
    });
    const cycles =
      cyclesByAgent.get(responsibility.agentId) ?? new Set<number>();
    cycles.add(responsibility.cycleNumber);
    cyclesByAgent.set(responsibility.agentId, cycles);
  }
  if (cyclesByAgent.size !== 10) {
    throw new Error("Primary evidence must contain exactly ten agents");
  }
  for (const cycles of cyclesByAgent.values()) {
    if (
      cycles.size !== requiredBuckets ||
      [...cycles].some((cycle) => cycle < 0 || cycle >= requiredBuckets)
    ) {
      throw new Error("Primary evidence agent-cycle coverage is incomplete");
    }
  }
  const agentIds = [...cyclesByAgent.keys()];
  const completedCyclesByAgent = new Map(
    agentIds.map((agentId) => [agentId, 0]),
  );
  const coverageTimeline = [
    ...responsibilities.map((responsibility) => ({
      kind: "responsibility" as const,
      at: new Date(responsibility.observedAt).getTime(),
      sequence: responsibility.sequence,
      responsibility,
    })),
    ...[...lags.values()].map((lag) => ({
      kind: "lag" as const,
      at: new Date(lag.observedAt).getTime(),
      sequence: lag.sequence,
      lag,
    })),
  ].sort((left, right) => left.at - right.at || left.sequence - right.sequence);
  let recomputedMaxResponsibilityCycleLag = 0;
  for (const item of coverageTimeline) {
    if (item.kind === "responsibility") {
      completedCyclesByAgent.set(
        item.responsibility.agentId,
        (completedCyclesByAgent.get(item.responsibility.agentId) ?? 0) + 1,
      );
      continue;
    }
    const recomputedLag = Math.max(
      ...agentIds.map((agentId) =>
        Math.max(
          0,
          item.lag.minute - (completedCyclesByAgent.get(agentId) ?? 0),
        ),
      ),
    );
    if (item.lag.lag !== recomputedLag) {
      throw new Error(
        "Primary evidence responsibility cycle lag is not derived from ordered agent-cycle evidence",
      );
    }
    recomputedMaxResponsibilityCycleLag = Math.max(
      recomputedMaxResponsibilityCycleLag,
      recomputedLag,
    );
  }
  if (
    lags.size !== requiredBuckets ||
    [...lags.keys()].some((minute) => minute < 1 || minute > requiredBuckets)
  ) {
    throw new Error("Primary evidence cycle lag coverage is incomplete");
  }
  if (
    health.size !== requiredBuckets ||
    [...health.keys()].some((minute) => minute < 1 || minute > requiredBuckets)
  ) {
    throw new Error("Primary evidence health coverage is incomplete");
  }
  const healthRows = [...health.values()];
  if (
    completedAtMs - new Date(healthRows.at(-1)!.sampledAt).getTime() >
    120_000
  ) {
    throw new Error("Primary evidence health samples do not span the run");
  }

  const referencedReceiptIds = new Set(
    responsibilities.map((responsibility) => responsibility.receiptId),
  );
  for (const receipt of receipts.values()) {
    const staleCandidate =
      receipt.succeeded &&
      receipt.finishedAt !== null &&
      receipt.winningAttempt?.state === "lost" &&
      receipt.winningAttempt.finishedAt !== null &&
      new Date(receipt.finishedAt).getTime() >
        new Date(receipt.winningAttempt.finishedAt).getTime();
    if (
      receipt.irreversible &&
      receipt.succeeded &&
      !referencedReceiptIds.has(receipt.receiptId)
    ) {
      throw new Error(
        "Primary evidence contains an unreferenced irreversible receipt without a responsibility",
      );
    }
    if (!referencedReceiptIds.has(receipt.receiptId) && !staleCandidate) {
      throw new Error("Primary evidence contains an extra unrelated receipt");
    }
  }

  const irreversibleKeyCounts = new Map<string, number>();
  let staleOwnerCommits = 0;
  for (const receipt of receipts.values()) {
    if (receipt.irreversible && receipt.succeeded) {
      irreversibleKeyCounts.set(
        receipt.operationKey,
        (irreversibleKeyCounts.get(receipt.operationKey) ?? 0) + 1,
      );
    }
    if (
      receipt.succeeded &&
      receipt.finishedAt &&
      receipt.winningAttempt?.state === "lost" &&
      receipt.winningAttempt.finishedAt &&
      new Date(receipt.finishedAt).getTime() >
        new Date(receipt.winningAttempt.finishedAt).getTime()
    ) {
      staleOwnerCommits += 1;
    }
  }
  const duplicateIrreversibleReceiptKeys = [...irreversibleKeyCounts]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
  const recoveryDurationsMs = input.expectedFaults.map((expected) => {
    const observed = observedFaults.get(expected.id)!;
    const recovered = recoveredFaults.get(expected.id)!;
    return (
      new Date(recovered.recoveredAt).getTime() -
      new Date(observed.observedAt).getTime()
    );
  });
  const healthTruthMismatches = [...health]
    .filter(
      ([, sample]) =>
        sample.reportedState === "healthy" && sample.truthState !== "healthy",
    )
    .map(([minute]) => `minute-${minute}`);
  const disruptiveKinds = new Set([
    "worker_loss",
    "database_unavailable",
    "emergency_stop",
  ]);
  for (const sample of healthRows) {
    if (sample.truthState === "healthy") continue;
    const sampledAtMs = new Date(sample.sampledAt).getTime();
    const insideScheduledRecovery = input.report.injections.some(
      (injection) =>
        disruptiveKinds.has(injection.kind) &&
        injection.recoveredAt !== null &&
        sampledAtMs >= new Date(injection.scheduledAt).getTime() - 5_000 &&
        sampledAtMs <=
          new Date(injection.recoveredAt).getTime() +
            FAULT_EVIDENCE_POLL_TOLERANCE_MS,
    );
    if (!insideScheduledRecovery) {
      healthTruthMismatches.push(`minute-${sample.minute}`);
    }
  }
  healthTruthMismatches.sort();
  const recomputed: EnduranceInvariantInput = {
    expectedResponsibilities,
    completedResponsibilities: responsibilities.length,
    maxResponsibilityCycleLag: recomputedMaxResponsibilityCycleLag,
    irreversibleReceiptSuccessCount: [...irreversibleKeyCounts.values()].reduce(
      (total, count) => total + count,
      0,
    ),
    duplicateIrreversibleReceiptKeys,
    staleOwnerCommits,
    recoveryDurationsMs,
    missingIncidentIds: input.expectedFaults
      .filter((expected) => !observedFaults.get(expected.id)?.incidentId)
      .map((expected) => expected.id),
    healthTruthMismatches,
    sseReconnectObserved:
      disconnected !== null &&
      reconnected !== null &&
      reconnected.cursor > disconnected.cursor,
    healthSampleBuckets: health.size,
    requiredHealthSampleBuckets: requiredBuckets,
  };
  for (const key of Object.keys(recomputed) as Array<
    keyof EnduranceInvariantInput
  >) {
    if (!same(input.report.metrics[key], recomputed[key])) {
      const label = key
        .replace(/([a-z])([A-Z])/gu, "$1 $2")
        .toLocaleLowerCase("en-US");
      throw new Error(
        `Primary evidence ${label} does not match report metrics`,
      );
    }
  }
  return recomputed;
}
