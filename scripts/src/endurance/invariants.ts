export interface EnduranceInvariantInput {
  expectedResponsibilities: number;
  completedResponsibilities: number;
  maxResponsibilityCycleLag: number;
  irreversibleReceiptSuccessCount: number;
  duplicateIrreversibleReceiptKeys: string[];
  staleOwnerCommits: number;
  recoveryDurationsMs: number[];
  missingIncidentIds: string[];
  healthTruthMismatches: string[];
  sseReconnectObserved: boolean;
  healthSampleBuckets: number;
  requiredHealthSampleBuckets?: number;
}

export interface EnduranceAssertion {
  id:
    | "responsibilities_complete"
    | "responsibility_cycle_lag_bounded"
    | "irreversible_receipt_evidence_observed"
    | "no_duplicate_irreversible_receipts"
    | "no_stale_owner_commits"
    | "recoveries_within_target"
    | "all_injections_visible"
    | "health_truth_consistent"
    | "sse_reconnected"
    | "health_samples_complete";
  label: string;
  pass: boolean;
  expected: string | number | boolean;
  actual: string | number | boolean;
}

export interface EnduranceInvariantResult {
  pass: boolean;
  assertions: EnduranceAssertion[];
}

const RECOVERY_TARGET_MS = 120_000;
const REQUIRED_HEALTH_BUCKETS = 1_440;

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

export function evaluateEnduranceInvariants(
  input: EnduranceInvariantInput,
): EnduranceInvariantResult {
  const expectedResponsibilities = nonNegativeInteger(
    input.expectedResponsibilities,
    "expectedResponsibilities",
  );
  const completedResponsibilities = nonNegativeInteger(
    input.completedResponsibilities,
    "completedResponsibilities",
  );
  const maxResponsibilityCycleLag = nonNegativeInteger(
    input.maxResponsibilityCycleLag,
    "maxResponsibilityCycleLag",
  );
  const staleOwnerCommits = nonNegativeInteger(
    input.staleOwnerCommits,
    "staleOwnerCommits",
  );
  const irreversibleReceiptSuccessCount = nonNegativeInteger(
    input.irreversibleReceiptSuccessCount,
    "irreversibleReceiptSuccessCount",
  );
  const healthSampleBuckets = nonNegativeInteger(
    input.healthSampleBuckets,
    "healthSampleBuckets",
  );
  const requiredHealthSampleBuckets = nonNegativeInteger(
    input.requiredHealthSampleBuckets ?? REQUIRED_HEALTH_BUCKETS,
    "requiredHealthSampleBuckets",
  );
  if (
    input.recoveryDurationsMs.some(
      (duration) => !Number.isFinite(duration) || duration < 0,
    )
  ) {
    throw new TypeError("recoveryDurationsMs must contain non-negative values");
  }
  const longestRecoveryMs = input.recoveryDurationsMs.length
    ? Math.max(...input.recoveryDurationsMs)
    : 0;

  const assertions: EnduranceAssertion[] = [
    {
      id: "responsibilities_complete",
      label: "Every expected responsibility completed",
      pass: completedResponsibilities === expectedResponsibilities,
      expected: expectedResponsibilities,
      actual: completedResponsibilities,
    },
    {
      id: "responsibility_cycle_lag_bounded",
      label: "Every agent remained within two scheduled responsibility cycles",
      pass: maxResponsibilityCycleLag <= 2,
      expected: "<=2",
      actual: maxResponsibilityCycleLag,
    },
    {
      id: "irreversible_receipt_evidence_observed",
      label:
        "At least one irreversible effect completed with durable receipt evidence",
      pass: irreversibleReceiptSuccessCount > 0,
      expected: ">=1",
      actual: irreversibleReceiptSuccessCount,
    },
    {
      id: "no_duplicate_irreversible_receipts",
      label: "No irreversible effect key completed more than once",
      pass: input.duplicateIrreversibleReceiptKeys.length === 0,
      expected: 0,
      actual: input.duplicateIrreversibleReceiptKeys.length,
    },
    {
      id: "no_stale_owner_commits",
      label: "No stale lease owner committed a result",
      pass: staleOwnerCommits === 0,
      expected: 0,
      actual: staleOwnerCommits,
    },
    {
      id: "recoveries_within_target",
      label: "Every recoverable worker loss reclaimed within 120 seconds",
      pass: longestRecoveryMs <= RECOVERY_TARGET_MS,
      expected: `<=${RECOVERY_TARGET_MS}`,
      actual: longestRecoveryMs,
    },
    {
      id: "all_injections_visible",
      label: "Every injected fault produced durable incident evidence",
      pass: input.missingIncidentIds.length === 0,
      expected: 0,
      actual: input.missingIncidentIds.length,
    },
    {
      id: "health_truth_consistent",
      label: "Health samples never reported false green",
      pass: input.healthTruthMismatches.length === 0,
      expected: 0,
      actual: input.healthTruthMismatches.length,
    },
    {
      id: "sse_reconnected",
      label: "Operations delivery recovered after stream loss",
      pass: input.sseReconnectObserved,
      expected: true,
      actual: input.sseReconnectObserved,
    },
    {
      id: "health_samples_complete",
      label: `At least ${requiredHealthSampleBuckets.toLocaleString("en-US")} persisted minute buckets exist`,
      pass: healthSampleBuckets >= requiredHealthSampleBuckets,
      expected: `>=${requiredHealthSampleBuckets}`,
      actual: healthSampleBuckets,
    },
  ];

  return {
    pass: assertions.every((assertion) => assertion.pass),
    assertions,
  };
}
