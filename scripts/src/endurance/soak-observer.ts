import type { EnduranceInvariantInput } from "./invariants";
import type {
  EnduranceFaultEvidenceSourceKind,
  EndurancePrimaryEvidenceKind,
  EndurancePrimaryEvidenceRecord,
  FaultObservation,
} from "./report-schema";

interface ScheduledFaultEvidence {
  id: string;
  kind: string;
  scheduledAt: string;
  observedAt: string | null;
  recoveredAt: string | null;
  incidentId: string | null;
}

function canonicalIso(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}

function canonicalCursor(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new TypeError("SSE cursor must be a canonical decimal");
  }
  return BigInt(value);
}

export class SoakEvidenceObserver {
  private readonly expectedResponsibilities: number;
  private readonly runId: string;
  private completedResponsibilities = 0;
  private maxResponsibilityCycleLag = 0;
  private staleOwnerCommits = 0;
  private readonly faults = new Map<string, ScheduledFaultEvidence>();
  private readonly irreversibleSuccessCounts = new Map<string, number>();
  private readonly irreversibleSuccessReceipts = new Map<string, string>();
  private readonly health = new Map<
    number,
    { reportedState: string; truthState: string }
  >();
  private disconnectedCursor: bigint | null = null;
  private reconnectedCursor: bigint | null = null;
  private readonly primaryEvidence: EndurancePrimaryEvidenceRecord[] = [];
  private readonly primaryReceiptIdentity = new Map<string, string>();

  constructor(input: { expectedResponsibilities: number; runId?: string }) {
    if (
      !Number.isSafeInteger(input.expectedResponsibilities) ||
      input.expectedResponsibilities < 0
    ) {
      throw new TypeError(
        "expectedResponsibilities must be a non-negative integer",
      );
    }
    this.expectedResponsibilities = input.expectedResponsibilities;
    this.runId = input.runId?.trim() || "observer";
  }

  private appendPrimary(
    kind: EndurancePrimaryEvidenceKind,
    occurredAt: string,
    data: Record<string, unknown>,
  ): void {
    if (this.primaryEvidence.length >= 100_000) {
      throw new Error("Primary endurance evidence exceeded its safe bound");
    }
    this.primaryEvidence.push({
      schemaVersion: 1,
      runId: this.runId,
      sequence: this.primaryEvidence.length,
      occurredAt: canonicalIso(occurredAt, "primary evidence occurredAt"),
      kind,
      data,
    });
  }

  scheduleFault(input: {
    id: string;
    kind: string;
    scheduledAt: string;
  }): void {
    if (!input.id.trim() || this.faults.has(input.id)) {
      throw new TypeError("fault id must be unique and non-empty");
    }
    this.faults.set(input.id, {
      ...input,
      scheduledAt: canonicalIso(input.scheduledAt, "scheduledAt"),
      observedAt: null,
      recoveredAt: null,
      incidentId: null,
    });
  }

  observeIncident(input: {
    faultId: string;
    incidentId: string;
    observedAt: string;
    sourceKind: EnduranceFaultEvidenceSourceKind;
    sourceId: string;
  }): void {
    const fault = this.faults.get(input.faultId);
    if (!fault) throw new Error(`Unknown scheduled fault: ${input.faultId}`);
    if (!input.incidentId.trim()) throw new TypeError("incidentId is required");
    if (!input.sourceId.trim()) throw new TypeError("sourceId is required");
    fault.incidentId = input.incidentId;
    fault.observedAt = canonicalIso(input.observedAt, "observedAt");
    this.appendPrimary("fault_observed", fault.observedAt, {
      faultId: fault.id,
      faultKind: fault.kind,
      scheduledAt: fault.scheduledAt,
      incidentId: fault.incidentId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
    });
  }

  observeRecovery(input: {
    faultId: string;
    recoveredAt: string;
    sourceKind: EnduranceFaultEvidenceSourceKind;
    sourceId: string;
  }): void {
    const fault = this.faults.get(input.faultId);
    if (!fault) throw new Error(`Unknown scheduled fault: ${input.faultId}`);
    if (!fault.incidentId || !fault.observedAt) {
      throw new Error(
        `Fault recovery has no observed incident: ${input.faultId}`,
      );
    }
    if (!input.sourceId.trim()) throw new TypeError("sourceId is required");
    fault.recoveredAt = canonicalIso(input.recoveredAt, "recoveredAt");
    this.appendPrimary("fault_recovered", fault.recoveredAt, {
      faultId: fault.id,
      faultKind: fault.kind,
      scheduledAt: fault.scheduledAt,
      incidentId: fault.incidentId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
    });
  }

  completeResponsibilities(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError(
        "completed responsibility count must be non-negative",
      );
    }
    this.completedResponsibilities += count;
  }

  observeResponsibility(input: {
    receiptId: string;
    taskId: number;
    agentId: number;
    cycleNumber: number;
    completedAt: string;
    observedAt: string;
  }): void {
    for (const [label, value, minimum] of [
      ["taskId", input.taskId, 1],
      ["agentId", input.agentId, 1],
      ["cycleNumber", input.cycleNumber, 0],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < minimum) {
        throw new TypeError(`${label} is invalid`);
      }
    }
    if (!input.receiptId.trim()) throw new TypeError("receiptId is required");
    this.completedResponsibilities += 1;
    this.appendPrimary("responsibility_completed", input.observedAt, {
      receiptId: input.receiptId,
      taskId: input.taskId,
      agentId: input.agentId,
      cycleNumber: input.cycleNumber,
      completedAt: canonicalIso(input.completedAt, "completedAt"),
    });
  }

  observeResponsibilityCycleLag(
    lag: number,
    evidence?: { minute: number; observedAt: string },
  ): void {
    if (!Number.isSafeInteger(lag) || lag < 0) {
      throw new TypeError("responsibility cycle lag must be non-negative");
    }
    this.maxResponsibilityCycleLag = Math.max(
      this.maxResponsibilityCycleLag,
      lag,
    );
    if (evidence) {
      if (!Number.isSafeInteger(evidence.minute) || evidence.minute < 1) {
        throw new TypeError("responsibility lag minute is invalid");
      }
      this.appendPrimary("responsibility_cycle_lag", evidence.observedAt, {
        minute: evidence.minute,
        lag,
      });
    }
  }

  observeReceipt(input: {
    receiptId: string;
    key: string;
    irreversible: boolean;
    succeeded: boolean;
    observedAt?: string;
    state?: string;
    toolName?: string;
    sideEffectClass?: string;
    finishedAt?: string | null;
    originAttempt?: {
      id: string;
      taskId: number;
      agentId: number;
      cycleNumber: number;
      state: string;
      finishedAt: string | null;
    } | null;
    invocations?: Array<{
      id: string;
      state: string;
      effectStartedAt: string | null;
      finishedAt: string | null;
    }>;
  }): void {
    if (!input.receiptId.trim()) throw new TypeError("receiptId is required");
    if (!input.key.trim()) throw new TypeError("receipt key is required");
    if (input.observedAt) {
      const data = {
        receiptId: input.receiptId,
        operationKey: input.key,
        irreversible: input.irreversible,
        succeeded: input.succeeded,
        state: input.state ?? (input.succeeded ? "succeeded" : "failed"),
        toolName: input.toolName ?? null,
        sideEffectClass: input.sideEffectClass ?? null,
        finishedAt: input.finishedAt ?? null,
        originAttempt: input.originAttempt ?? null,
        invocations: input.invocations ?? [],
      };
      const identity = JSON.stringify(data);
      const prior = this.primaryReceiptIdentity.get(input.receiptId);
      if (prior && prior !== identity) {
        throw new Error(
          `Receipt ${input.receiptId} changed its primary evidence identity`,
        );
      }
      if (!prior) {
        this.primaryReceiptIdentity.set(input.receiptId, identity);
        this.appendPrimary("receipt_observed", input.observedAt, data);
      }
    }
    if (!input.irreversible || !input.succeeded) return;
    const observedKey = this.irreversibleSuccessReceipts.get(input.receiptId);
    if (observedKey !== undefined) {
      if (observedKey !== input.key) {
        throw new Error(
          `Irreversible receipt ${input.receiptId} changed its operation key`,
        );
      }
      return;
    }
    this.irreversibleSuccessReceipts.set(input.receiptId, input.key);
    this.irreversibleSuccessCounts.set(
      input.key,
      (this.irreversibleSuccessCounts.get(input.key) ?? 0) + 1,
    );
  }

  observeStaleOwnerCommit(): void {
    this.staleOwnerCommits += 1;
  }

  observeHealth(input: {
    minute: number;
    reportedState: string;
    truthState: string;
    bucketAt?: string;
    sampledAt?: string;
    runtimeTruthState?: string | null;
    healthyWorkerCount?: number;
    staleWorkerCount?: number;
    schedulerTickAgeMs?: number | null;
  }): void {
    if (!Number.isSafeInteger(input.minute) || input.minute < 1) {
      throw new TypeError("health minute must be a positive integer");
    }
    this.health.set(input.minute, {
      reportedState: input.reportedState,
      truthState: input.truthState,
    });
    if (input.sampledAt && input.bucketAt) {
      this.appendPrimary("health_observed", input.sampledAt, {
        minute: input.minute,
        bucketAt: canonicalIso(input.bucketAt, "health bucketAt"),
        sampledAt: canonicalIso(input.sampledAt, "health sampledAt"),
        reportedState: input.reportedState,
        truthState: input.truthState,
        runtimeTruthState: input.runtimeTruthState ?? null,
        healthyWorkerCount: input.healthyWorkerCount ?? null,
        staleWorkerCount: input.staleWorkerCount ?? null,
        schedulerTickAgeMs: input.schedulerTickAgeMs ?? null,
      });
    }
  }

  observeSseDisconnect(
    cursor: string,
    observedAt?: string,
    correlation?: { faultId: string; incidentId: string },
  ): void {
    this.disconnectedCursor = canonicalCursor(cursor);
    if (observedAt) {
      this.appendPrimary("sse_disconnected", observedAt, {
        cursor,
        ...(correlation ?? {}),
      });
    }
  }

  observeSseReconnect(
    cursor: string,
    observedAt?: string,
    correlation?: { faultId: string; incidentId: string },
  ): void {
    this.reconnectedCursor = canonicalCursor(cursor);
    if (observedAt) {
      this.appendPrimary("sse_reconnected", observedAt, {
        cursor,
        ...(correlation ?? {}),
      });
    }
  }

  finalize(): {
    metrics: EnduranceInvariantInput;
    injections: FaultObservation[];
    primaryEvidence: EndurancePrimaryEvidenceRecord[];
  } {
    const injections = [...this.faults.values()].map((fault) => {
      const recoveryMs =
        fault.observedAt && fault.recoveredAt
          ? new Date(fault.recoveredAt).getTime() -
            new Date(fault.observedAt).getTime()
          : null;
      return {
        id: fault.id,
        kind: fault.kind,
        scheduledAt: fault.scheduledAt,
        observedAt: fault.observedAt,
        recoveredAt: fault.recoveredAt,
        incidentId: fault.incidentId,
        pass:
          fault.incidentId !== null &&
          recoveryMs !== null &&
          recoveryMs >= 0 &&
          recoveryMs <= 120_000,
      } satisfies FaultObservation;
    });
    const recoveryDurationsMs = [...this.faults.values()].flatMap((fault) =>
      fault.observedAt && fault.recoveredAt
        ? [
            new Date(fault.recoveredAt).getTime() -
              new Date(fault.observedAt).getTime(),
          ]
        : [],
    );
    const duplicateIrreversibleReceiptKeys = [
      ...this.irreversibleSuccessCounts.entries(),
    ]
      .filter(([, count]) => count > 1)
      .map(([key]) => key)
      .sort();
    const healthTruthMismatches = [...this.health.entries()]
      .filter(
        ([, sample]) =>
          sample.reportedState === "healthy" && sample.truthState !== "healthy",
      )
      .map(([minute]) => `minute-${minute}`);

    return {
      injections,
      primaryEvidence: this.primaryEvidence.map((item) =>
        structuredClone(item),
      ),
      metrics: {
        expectedResponsibilities: this.expectedResponsibilities,
        completedResponsibilities: this.completedResponsibilities,
        maxResponsibilityCycleLag: this.maxResponsibilityCycleLag,
        irreversibleReceiptSuccessCount: this.irreversibleSuccessReceipts.size,
        duplicateIrreversibleReceiptKeys,
        staleOwnerCommits: this.staleOwnerCommits,
        recoveryDurationsMs,
        missingIncidentIds: injections
          .filter((injection) => injection.incidentId === null)
          .map((injection) => injection.id),
        healthTruthMismatches,
        sseReconnectObserved:
          this.disconnectedCursor !== null &&
          this.reconnectedCursor !== null &&
          this.reconnectedCursor > this.disconnectedCursor,
        healthSampleBuckets: this.health.size,
      },
    };
  }
}
