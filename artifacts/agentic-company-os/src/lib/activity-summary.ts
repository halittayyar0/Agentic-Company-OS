import type { MessageKey } from "./i18n";

// Only these app-authored, versioned events have translated display summaries.
// User/model/native text and unknown future event schemas remain original source.
export const operationsEventMessageKeys = {
  runtime_registered: "eventRuntimeRegistered",
  runtime_state_changed: "eventRuntimeStateChanged",
  attempt_created: "eventAttemptCreated",
  attempt_state_changed: "eventAttemptStateChanged",
  receipt_reserved: "eventReceiptReserved",
  receipt_state_changed: "eventReceiptStateChanged",
  invocation_created: "eventInvocationCreated",
  invocation_state_changed: "eventInvocationStateChanged",
  recovery_recorded: "eventRecoveryRecorded",
  runtime_control_changed: "eventRuntimeControlChanged",
  reconciliation_recorded: "eventReconciliationRecorded",
  health_sample_recorded: "eventHealthSampleRecorded",
} as const satisfies Record<string, MessageKey>;

export type OperationsEventKind = keyof typeof operationsEventMessageKeys;

export function knownOperationsEventKind(
  value: unknown,
): OperationsEventKind | null {
  return typeof value === "string" &&
    Object.hasOwn(operationsEventMessageKeys, value)
    ? (value as OperationsEventKind)
    : null;
}

export function activityOperationsEventKind(event: {
  type: string;
  detail?: unknown;
}): OperationsEventKind | null {
  if (
    event.type !== "operations_changed" ||
    !event.detail ||
    typeof event.detail !== "object" ||
    Array.isArray(event.detail)
  )
    return null;
  const detail = event.detail as Record<string, unknown>;
  return detail.schemaVersion === 1
    ? knownOperationsEventKind(detail.kind)
    : null;
}
